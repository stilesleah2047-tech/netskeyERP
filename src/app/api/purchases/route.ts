import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { connectDb } from "@/lib/server/db";
import { Purchase } from "@/lib/server/models/Purchase";
import { Product } from "@/lib/server/models/Product";
import { Branch } from "@/lib/server/models/Branch";
import { getAuth, resolveBranchScope } from "@/lib/server/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/purchases?branchId=&from=&to=
export async function GET(req: NextRequest) {
  await connectDb();
  const auth = getAuth(req);
  if (!auth) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const url = new URL(req.url);
  const scopeBranch = resolveBranchScope(auth, url.searchParams.get("branchId"));

  const filter: Record<string, unknown> = { businessId: auth.businessId };
  if (scopeBranch) filter.branchId = scopeBranch;

  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  if (from || to) {
    const createdAt: Record<string, Date> = {};
    if (from) createdAt.$gte = new Date(from);
    if (to) createdAt.$lte = new Date(to);
    filter.createdAt = createdAt;
  }

  const purchases = await Purchase.find(filter)
    .populate("branchId", "branchName")
    .populate("recordedBy", "name")
    .sort({ createdAt: -1 })
    .limit(500)
    .lean();

  return NextResponse.json({ purchases });
}

const createSchema = z.object({
  branchId: z.string().trim().min(1).optional(),
  supplierName: z.string().trim().min(1).max(120),
  productId: z.string().trim().min(1).optional(),
  productLabel: z.string().trim().min(1).max(120).optional(),
  quantity: z.number().int().positive().max(1_000_000),
  unitCost: z.number().nonnegative().max(100_000_000),
  reference: z.string().trim().max(80).optional(),
  notes: z.string().trim().max(500).optional(),
});

// POST /api/purchases — records a supplier purchase. The buying price is
// snapshotted (unitCost/totalCost) so historical records never shift when
// product prices change later. A completed purchase conceptually increases
// branch stock.
export async function POST(req: NextRequest) {
  await connectDb();
  const auth = getAuth(req);
  if (!auth) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const json = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request" },
      { status: 400 }
    );
  }

  // Resolve branch + enforce scope.
  let branchId: string | null;
  if (auth.role === "SUPER_ADMIN") {
    branchId = parsed.data.branchId ?? null;
    if (!branchId) {
      return NextResponse.json({ error: "branchId is required" }, { status: 400 });
    }
  } else {
    branchId = auth.branchId;
    if (parsed.data.branchId && parsed.data.branchId !== auth.branchId) {
      return NextResponse.json({ error: "Cannot record for another branch" }, { status: 403 });
    }
  }

  // The target branch MUST belong to this tenant.
  const branchDoc = await Branch.findOne({ _id: branchId, businessId: auth.businessId }).lean();
  if (!branchDoc) {
    return NextResponse.json({ error: "Branch not found in your business" }, { status: 404 });
  }

  // Resolve a human-readable product label snapshot. Prefer an explicit
  // productId lookup; fall back to a free-text label for ad-hoc items.
  let productLabel = parsed.data.productLabel ?? null;
  let productId: string | null = parsed.data.productId ?? null;
  if (productId) {
    const product = await Product.findOne({ _id: productId, businessId: auth.businessId }).lean();
    if (!product) {
      return NextResponse.json({ error: "Product not found" }, { status: 400 });
    }
    productLabel = (product as { label: string }).label;
  }
  if (!productLabel) {
    return NextResponse.json({ error: "productId or productLabel is required" }, { status: 400 });
  }

  const totalCost = parsed.data.quantity * parsed.data.unitCost;

  const purchase = await Purchase.create({
    businessId: auth.businessId,
    branchId,
    supplierName: parsed.data.supplierName,
    productId,
    productLabel,
    quantity: parsed.data.quantity,
    unitCost: parsed.data.unitCost,
    totalCost,
    reference: parsed.data.reference ?? null,
    notes: parsed.data.notes ?? null,
    recordedBy: auth.sub,
  });

  return NextResponse.json({ purchase }, { status: 201 });
}
