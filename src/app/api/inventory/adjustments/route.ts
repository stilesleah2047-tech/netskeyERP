import { NextRequest, NextResponse } from "next/server";
import mongoose from "mongoose";
import { z } from "zod";
import { connectDb } from "@/lib/server/db";
import { Branch } from "@/lib/server/models/Branch";
import { Product } from "@/lib/server/models/Product";
import { StockMovement } from "@/lib/server/models/StockMovement";
import { getAuth, requireRole } from "@/lib/server/auth";
import { currentStock, recordInbound, recordOutbound } from "@/lib/server/stock";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  branchId: z.string().min(1).optional(),
  productId: z.string().min(1),
  // The physical count the owner/manager just took. Stock is corrected TO
  // this number by writing the difference as an ADJUSTMENT movement.
  countedQuantity: z.number().int().min(0).max(10_000_000),
  note: z.string().trim().max(500).optional(),
});

// POST /api/inventory/adjustments
// Reconcile recorded stock to a physical count. We never overwrite the
// ledger; we append one ADJUSTMENT movement for the delta so the correction
// is itself auditable. Owners adjust any branch; managers only their own.
export async function POST(req: NextRequest) {
  await connectDb();
  const auth = getAuth(req);
  if (!requireRole(auth, "SUPER_ADMIN", "BRANCH_MANAGER")) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const json = await req.json().catch(() => null);
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request" },
      { status: 400 }
    );
  }

  let branchId: string | null;
  if (auth!.role === "SUPER_ADMIN") {
    branchId = parsed.data.branchId ?? null;
    if (!branchId) return NextResponse.json({ error: "branchId is required" }, { status: 400 });
  } else {
    branchId = auth!.branchId;
    if (parsed.data.branchId && parsed.data.branchId !== auth!.branchId) {
      return NextResponse.json({ error: "Cannot adjust another branch" }, { status: 403 });
    }
  }

  const { productId, countedQuantity, note } = parsed.data;
  if (!mongoose.isValidObjectId(branchId) || !mongoose.isValidObjectId(productId)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  const [branch, product] = await Promise.all([
    Branch.findOne({ _id: branchId, businessId: auth!.businessId }).lean(),
    Product.findOne({ _id: productId, businessId: auth!.businessId }).lean(),
  ]);
  if (!branch) return NextResponse.json({ error: "Branch not found" }, { status: 404 });
  if (!product) return NextResponse.json({ error: "Product not found" }, { status: 404 });

  const current = await currentStock(auth!.businessId, branchId!, productId);
  const delta = countedQuantity - current;

  if (delta === 0) {
    return NextResponse.json({ productId, previous: current, counted: countedQuantity, delta: 0 });
  }

  if (delta > 0) {
    // Found MORE than recorded. Value the extra units at the most recent
    // known buying cost for this branch+product (0 if never bought).
    const lastLayer = await StockMovement.findOne({
      businessId: auth!.businessId,
      branchId,
      productId,
      unitCost: { $gt: 0 },
    })
      .sort({ createdAt: -1 })
      .lean();
    await recordInbound({
      businessId: auth!.businessId,
      branchId: branchId!,
      productId,
      type: "ADJUSTMENT",
      quantity: delta,
      unitCost: lastLayer?.unitCost ?? 0,
      relatedType: "ADJUSTMENT",
      note: note ?? "Physical count adjustment",
      createdBy: auth!.sub,
    });
  } else {
    // Found FEWER than recorded (shrinkage / breakage). Consume FIFO.
    await recordOutbound({
      businessId: auth!.businessId,
      branchId: branchId!,
      productId,
      type: "ADJUSTMENT",
      quantity: -delta,
      allowNegative: true,
      relatedType: "ADJUSTMENT",
      note: note ?? "Physical count adjustment",
      createdBy: auth!.sub,
    });
  }

  return NextResponse.json({ productId, previous: current, counted: countedQuantity, delta });
}
