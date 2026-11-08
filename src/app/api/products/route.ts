import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { connectDb } from "@/lib/server/db";
import { Product, BranchPricing } from "@/lib/server/models/Product";
import { getAuth, requireRole } from "@/lib/server/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  await connectDb();
  const auth = getAuth(req);
  if (!auth) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  // Admin/manager catalog screens pass ?includeInactive=1 so deactivated
  // products are visible and can be reactivated (Test report F-04). The
  // terminal and any sales flow keep the default of active-only.
  const includeInactive = req.nextUrl.searchParams.get("includeInactive") === "1";
  const canSeeInactive =
    includeInactive && (auth.role === "SUPER_ADMIN" || auth.role === "BRANCH_MANAGER");

  const filter: Record<string, unknown> = { businessId: auth.businessId };
  if (!canSeeInactive) filter.isActive = true;

  const products = await Product.find(filter).sort({ sortOrder: 1 }).lean();

  // ?pricing=branch (used by the terminal) returns each product at the price
  // the server will actually charge at the caller's branch, so the screen and
  // the recorded sale agree.
  if (req.nextUrl.searchParams.get("pricing") === "branch" && auth.branchId) {
    const overrides = await BranchPricing.find({
      businessId: auth.businessId,
      branchId: auth.branchId,
      productId: { $in: products.map((p) => p._id) },
    }).lean();
    const map = new Map(overrides.map((o) => [o.productId.toString(), o.unitPrice]));
    for (const p of products) {
      const o = map.get(p._id.toString());
      if (o != null) (p as any).unitPrice = o;
    }
  }
  return NextResponse.json({ products });
}

const createSchema = z.object({
  label: z.string().trim().min(1).max(60),
  sizeLiters: z.number().positive().max(1000),
  unit: z.string().trim().min(1).max(12).optional(),
  category: z.string().trim().min(1).max(40).optional(),
  unitPrice: z.number().nonnegative(),
  sortOrder: z.number().int().optional(),
});

export async function POST(req: NextRequest) {
  await connectDb();
  const auth = getAuth(req);
  if (!auth) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  // Products and their prices are tenant-wide, so only the owner may change
  // them. Branch-specific prices go through /api/branches/[id]/prices.
  if (!requireRole(auth, "SUPER_ADMIN")) {
    return NextResponse.json({ error: "Only the business owner can change products and prices" }, { status: 403 });
  }

  const json = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
  }
  const product = await Product.create({ ...parsed.data, businessId: auth!.businessId });
  return NextResponse.json({ product }, { status: 201 });
}
