import { NextRequest, NextResponse } from "next/server";
import mongoose from "mongoose";
import { z } from "zod";
import { connectDb } from "@/lib/server/db";
import { Branch } from "@/lib/server/models/Branch";
import { Product, BranchPricing } from "@/lib/server/models/Product";
import { getAuth, requireRole } from "@/lib/server/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Branch-level price overrides (PRD 5.6 / Changes PR #3: "a different price per
// branch"). The sale flow already READS BranchPricing to charge the right
// amount; this route is the management (write) side owners use to set or clear
// those overrides. An override is optional — when none exists the branch simply
// charges the product's base `unitPrice`.
//
// Per-branch pricing is a Growth/Enterprise capability and is also available
// during the free trial, matching the plan rules in the Changes document.

// GET /api/branches/:id/prices
// Returns every active product with its base price and the branch's override
// (null when the branch has no override and therefore charges the base price).
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  await connectDb();
  const auth = getAuth(req);
  if (!requireRole(auth, "SUPER_ADMIN")) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  if (!mongoose.isValidObjectId(params.id)) {
    return NextResponse.json({ error: "Invalid branch id" }, { status: 400 });
  }

  const branch = await Branch.findOne({ _id: params.id, businessId: auth!.businessId }).lean();
  if (!branch) return NextResponse.json({ error: "Branch not found" }, { status: 404 });

  const [products, overrides] = await Promise.all([
    Product.find({ businessId: auth!.businessId, isActive: true }).sort({ sortOrder: 1 }).lean(),
    BranchPricing.find({ businessId: auth!.businessId, branchId: params.id }).lean(),
  ]);

  const overrideMap = new Map(overrides.map((o) => [o.productId.toString(), o.unitPrice]));

  const prices = products.map((p) => {
    const override = overrideMap.get(p._id.toString());
    return {
      productId: p._id.toString(),
      label: p.label,
      unit: p.unit,
      basePrice: p.unitPrice,
      overridePrice: override ?? null,
      effectivePrice: override ?? p.unitPrice,
    };
  });

  return NextResponse.json({ branchId: params.id, branchName: branch.branchName, prices });
}

const putSchema = z.object({
  productId: z.string().min(1),
  // `null` clears the override so the branch falls back to the base price.
  unitPrice: z.number().nonnegative().max(1_000_000).nullable(),
});

// PUT /api/branches/:id/prices
// Sets (or clears, when unitPrice is null) a single product's price for this
// branch. Owner only, scoped to the owner's own business.
export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  await connectDb();
  const auth = getAuth(req);
  if (!requireRole(auth, "SUPER_ADMIN")) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  if (!mongoose.isValidObjectId(params.id)) {
    return NextResponse.json({ error: "Invalid branch id" }, { status: 400 });
  }

  const json = await req.json().catch(() => null);
  const parsed = putSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request" },
      { status: 400 }
    );
  }
  const { productId, unitPrice } = parsed.data;
  if (!mongoose.isValidObjectId(productId)) {
    return NextResponse.json({ error: "Invalid product id" }, { status: 400 });
  }

  // Both the branch and the product must belong to the caller's business.
  const [branch, product] = await Promise.all([
    Branch.findOne({ _id: params.id, businessId: auth!.businessId }).lean(),
    Product.findOne({ _id: productId, businessId: auth!.businessId }).lean(),
  ]);
  if (!branch) return NextResponse.json({ error: "Branch not found" }, { status: 404 });
  if (!product) return NextResponse.json({ error: "Product not found" }, { status: 404 });

  if (unitPrice === null) {
    await BranchPricing.deleteOne({
      businessId: auth!.businessId,
      branchId: params.id,
      productId,
    });
    return NextResponse.json({ productId, overridePrice: null, effectivePrice: product.unitPrice });
  }

  await BranchPricing.findOneAndUpdate(
    { businessId: auth!.businessId, branchId: params.id, productId },
    { unitPrice },
    { upsert: true, new: true }
  );
  return NextResponse.json({ productId, overridePrice: unitPrice, effectivePrice: unitPrice });
}
