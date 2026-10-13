import { NextRequest, NextResponse } from "next/server";
import { connectDb } from "@/lib/server/db";
import { Branch } from "@/lib/server/models/Branch";
import { Product } from "@/lib/server/models/Product";
import { getAuth, resolveBranchScope } from "@/lib/server/auth";
import { stockLevels } from "@/lib/server/stock";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// On-hand stock is low (but not out) at or below this many units. A simple
// business-wide default; per-product reorder points are a later enhancement.
const LOW_STOCK_THRESHOLD = 20;

// GET /api/inventory/stock?branchId=
// Current on-hand per branch + product, straight from the ledger (sum of all
// movements). Owners see every branch; staff see only their own branch.
export async function GET(req: NextRequest) {
  await connectDb();
  const auth = getAuth(req);
  if (!auth) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const url = new URL(req.url);
  const scopeBranch = resolveBranchScope(auth, url.searchParams.get("branchId"));

  const [levels, branches, products] = await Promise.all([
    stockLevels(auth.businessId, scopeBranch),
    Branch.find({ businessId: auth.businessId }).select("branchName").lean(),
    Product.find({ businessId: auth.businessId }).select("label unit isActive").lean(),
  ]);

  const branchName = new Map(branches.map((b) => [b._id.toString(), b.branchName]));
  const productMeta = new Map(
    products.map((p) => [p._id.toString(), { label: p.label, unit: p.unit || "", isActive: p.isActive }])
  );

  const rows = levels
    .map((r) => {
      const meta = productMeta.get(r.productId);
      return {
        branchId: r.branchId,
        branchName: branchName.get(r.branchId) ?? "(unknown branch)",
        productId: r.productId,
        label: meta?.label ?? "(removed product)",
        unit: meta?.unit ?? "",
        quantity: r.quantity,
        status: r.quantity <= 0 ? "OUT" : r.quantity <= LOW_STOCK_THRESHOLD ? "LOW" : "OK",
        knownProduct: productMeta.has(r.productId),
      };
    })
    // Only surface live catalogue products in the stock screen.
    .filter((r) => r.knownProduct)
    .sort((a, b) =>
      a.branchName.localeCompare(b.branchName) || a.label.localeCompare(b.label)
    );

  return NextResponse.json({
    scope: scopeBranch ? "branch" : "global",
    lowStockThreshold: LOW_STOCK_THRESHOLD,
    stock: rows,
  });
}
