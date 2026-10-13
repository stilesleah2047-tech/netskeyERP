import { NextRequest, NextResponse } from "next/server";
import mongoose from "mongoose";
import { z } from "zod";
import { connectDb } from "@/lib/server/db";
import { Branch } from "@/lib/server/models/Branch";
import { Product } from "@/lib/server/models/Product";
import { StockTransfer } from "@/lib/server/models/StockTransfer";
import { getAuth, requireRole } from "@/lib/server/auth";
import {
  recordInbound,
  recordOutbound,
  withOptionalTransaction,
  InsufficientStockError,
} from "@/lib/server/stock";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/inventory/transfers?branchId=
// History of inter-branch transfers. Owners see all; a branch manager sees
// transfers touching their own branch (either leg).
export async function GET(req: NextRequest) {
  await connectDb();
  const auth = getAuth(req);
  if (!requireRole(auth, "SUPER_ADMIN", "BRANCH_MANAGER")) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const filter: Record<string, unknown> = { businessId: auth!.businessId };
  if (auth!.role === "BRANCH_MANAGER") {
    const b = new mongoose.Types.ObjectId(auth!.branchId!);
    filter.$or = [{ fromBranchId: b }, { toBranchId: b }];
  }

  const transfers = await StockTransfer.find(filter)
    .populate("fromBranchId", "branchName")
    .populate("toBranchId", "branchName")
    .populate("productId", "label unit")
    .populate("createdBy", "name")
    .sort({ createdAt: -1 })
    .limit(300)
    .lean();

  return NextResponse.json({ transfers });
}

const createSchema = z.object({
  fromBranchId: z.string().min(1),
  toBranchId: z.string().min(1),
  productId: z.string().min(1),
  quantity: z.number().int().positive().max(1_000_000),
  note: z.string().trim().max(500).optional(),
});

// POST /api/inventory/transfers
// Move stock from one branch to another. Unlike a sale, a transfer is a
// deliberate internal action and IS blocked when the source branch lacks the
// stock. Both ledger legs and the transfer record commit atomically.
export async function POST(req: NextRequest) {
  await connectDb();
  const auth = getAuth(req);
  if (!requireRole(auth, "SUPER_ADMIN", "BRANCH_MANAGER")) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const json = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request" },
      { status: 400 }
    );
  }
  const { fromBranchId, toBranchId, productId, quantity, note } = parsed.data;

  if (fromBranchId === toBranchId) {
    return NextResponse.json({ error: "Source and destination must differ" }, { status: 400 });
  }
  if (
    !mongoose.isValidObjectId(fromBranchId) ||
    !mongoose.isValidObjectId(toBranchId) ||
    !mongoose.isValidObjectId(productId)
  ) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  // A branch manager may only send stock OUT of their own branch.
  if (auth!.role === "BRANCH_MANAGER" && fromBranchId !== auth!.branchId) {
    return NextResponse.json(
      { error: "You can only transfer out of your own branch" },
      { status: 403 }
    );
  }

  // Both branches and the product must belong to this business.
  const [fromBranch, toBranch, product] = await Promise.all([
    Branch.findOne({ _id: fromBranchId, businessId: auth!.businessId, isActive: true }).lean(),
    Branch.findOne({ _id: toBranchId, businessId: auth!.businessId, isActive: true }).lean(),
    Product.findOne({ _id: productId, businessId: auth!.businessId }).lean(),
  ]);
  if (!fromBranch) return NextResponse.json({ error: "Source branch not found" }, { status: 404 });
  if (!toBranch) return NextResponse.json({ error: "Destination branch not found" }, { status: 404 });
  if (!product) return NextResponse.json({ error: "Product not found" }, { status: 404 });

  try {
    const transfer = await withOptionalTransaction(async (session) => {
      // Pull FIFO cost out of the source branch (blocks on insufficient stock).
      const { costOfGoods } = await recordOutbound({
        businessId: auth!.businessId,
        branchId: fromBranchId,
        productId,
        type: "TRANSFER_OUT",
        quantity,
        allowNegative: false,
        relatedType: "TRANSFER",
        note: note ?? null,
        createdBy: auth!.sub,
        session,
      });

      // Put the same units — carrying the same cost — into the destination
      // branch as a fresh FIFO layer.
      const unitCost = quantity > 0 ? costOfGoods / quantity : 0;
      await recordInbound({
        businessId: auth!.businessId,
        branchId: toBranchId,
        productId,
        type: "TRANSFER_IN",
        quantity,
        unitCost,
        relatedType: "TRANSFER",
        note: note ?? null,
        createdBy: auth!.sub,
        session,
      });

      const [doc] = await StockTransfer.create(
        [
          {
            businessId: auth!.businessId,
            fromBranchId,
            toBranchId,
            productId,
            quantity,
            costTotal: costOfGoods,
            note: note ?? null,
            createdBy: auth!.sub,
          },
        ],
        session ? { session } : {}
      );
      return doc;
    });

    return NextResponse.json({ transfer }, { status: 201 });
  } catch (err: unknown) {
    if (err instanceof InsufficientStockError) {
      return NextResponse.json(
        { error: `Not enough stock to transfer: ${err.available} available, ${err.requested} requested` },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: "Could not complete transfer" }, { status: 500 });
  }
}
