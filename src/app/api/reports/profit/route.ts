import { NextRequest, NextResponse } from "next/server";
import mongoose from "mongoose";
import { connectDb } from "@/lib/server/db";
import { Transaction } from "@/lib/server/models/Transaction";
import { Purchase } from "@/lib/server/models/Purchase";
import { Expense } from "@/lib/server/models/Expense";
import { Product } from "@/lib/server/models/Product";
import { StockMovement } from "@/lib/server/models/StockMovement";
import { getAuth, resolveBranchScope } from "@/lib/server/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Management / profit overview — NOT full accounting.
//   Revenue            = sum of SUCCESS sales in range
//   Cost of goods SOLD = FIFO cost of the units actually sold in range, read
//                        straight from the stock ledger (sum of costOfGoods on
//                        SALE movements in range). Because it comes from the
//                        ledger, it correctly reflects inter-branch transfers
//                        and only ever counts units that were really sold —
//                        unsold stock stays as inventory, not an expense
//                        (Test report F-07).
//   Gross profit       = Revenue - Cost of goods sold
//   Stock purchased    = total spent restocking in range (cash out, shown
//                        separately so owners still see buying activity)
//   Expenses           = operating expenses in range
//   Net profit         = Gross profit - Expenses
//
// NOTE: COGS and stock-on-hand are ledger-derived. For data created before
// the ledger existed, run `npm run backfill:stock` once to seed historical
// movements; all new purchases/sales/transfers write the ledger automatically.
export async function GET(req: NextRequest) {
  await connectDb();
  const auth = getAuth(req);
  if (!auth) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const url = new URL(req.url);
  const branchId = resolveBranchScope(auth, url.searchParams.get("branchId"));

  // Default range: start of the current month -> now.
  const now = new Date();
  const defaultFrom = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
  const from = url.searchParams.get("from") ? new Date(url.searchParams.get("from")!) : defaultFrom;
  const to = url.searchParams.get("to") ? new Date(url.searchParams.get("to")!) : now;

  // F-03: reject a reversed / invalid date range instead of silently
  // returning an empty report.
  if (isNaN(from.getTime()) || isNaN(to.getTime())) {
    return NextResponse.json({ error: "Please provide valid report dates." }, { status: 400 });
  }
  if (from.getTime() > to.getTime()) {
    return NextResponse.json(
      { error: "The start date must be on or before the end date." },
      { status: 400 }
    );
  }

  const branchObjId = branchId ? new mongoose.Types.ObjectId(branchId) : null;
  const businessObjId = new mongoose.Types.ObjectId(auth.businessId);
  const dateMatch = { createdAt: { $gte: from, $lte: to } };

  const salesMatch: Record<string, unknown> = { ...dateMatch, businessId: businessObjId, paymentStatus: "SUCCESS" };
  if (branchObjId) salesMatch.branchId = branchObjId;

  const costMatch: Record<string, unknown> = { ...dateMatch, businessId: businessObjId };
  if (branchObjId) costMatch.branchId = branchObjId;

  // FIFO cost of goods SOLD in range: sum costOfGoods over SALE movements.
  const cogsMatch: Record<string, unknown> = { ...dateMatch, businessId: businessObjId, type: "SALE" };
  if (branchObjId) cogsMatch.branchId = branchObjId;

  // On-hand stock scope (all-time ledger balance per product).
  const stockMatch: Record<string, unknown> = { businessId: businessObjId };
  if (branchObjId) stockMatch.branchId = branchObjId;

  const [salesAgg, purchaseAgg, expenseAgg, cogsAgg, stockAgg, products] = await Promise.all([
    Transaction.aggregate([
      { $match: salesMatch },
      {
        $group: {
          _id: null,
          revenue: { $sum: "$amountTotal" },
          cashTotal: { $sum: { $cond: [{ $eq: ["$paymentMethod", "CASH"] }, "$amountTotal", 0] } },
          mpesaTotal: { $sum: { $cond: [{ $eq: ["$paymentMethod", "MPESA"] }, "$amountTotal", 0] } },
          salesCount: { $sum: 1 },
        },
      },
    ]),
    Purchase.aggregate([
      { $match: costMatch },
      { $group: { _id: null, stockPurchased: { $sum: "$totalCost" }, purchaseCount: { $sum: 1 } } },
    ]),
    Expense.aggregate([
      { $match: costMatch },
      { $group: { _id: null, expenses: { $sum: "$amount" }, expenseCount: { $sum: 1 } } },
    ]),
    StockMovement.aggregate([
      { $match: cogsMatch },
      { $group: { _id: null, cogs: { $sum: "$costOfGoods" } } },
    ]),
    // On-hand per product = sum of every movement's signed delta in scope.
    StockMovement.aggregate([
      { $match: stockMatch },
      { $group: { _id: "$productId", qty: { $sum: "$quantityDelta" } } },
    ]),
    Product.find({ businessId: businessObjId }).select("label unit").lean(),
  ]);

  const costOfGoodsSold = Math.round(cogsAgg[0]?.cogs ?? 0);

  const productMeta = new Map<string, { label: string; unit: string }>();
  for (const p of products as { _id: unknown; label: string; unit?: string }[]) {
    productMeta.set(String(p._id), { label: p.label, unit: p.unit || "" });
  }

  const stockOnHand = (stockAgg as { _id: unknown; qty: number }[])
    .filter((row) => row._id && productMeta.has(String(row._id)))
    .map((row) => ({
      productId: String(row._id),
      label: productMeta.get(String(row._id))?.label ?? "(removed product)",
      unit: productMeta.get(String(row._id))?.unit ?? "",
      quantity: row.qty || 0,
    }))
    .sort((a, b) => a.label.localeCompare(b.label));

  const revenue = salesAgg[0]?.revenue ?? 0;
  const stockPurchased = purchaseAgg[0]?.stockPurchased ?? 0;
  const expenses = expenseAgg[0]?.expenses ?? 0;
  const grossProfit = revenue - costOfGoodsSold;
  const netProfit = grossProfit - expenses;

  return NextResponse.json({
    scope: branchId ? "branch" : "global",
    range: { from: from.toISOString(), to: to.toISOString() },
    revenue,
    cashTotal: salesAgg[0]?.cashTotal ?? 0,
    mpesaTotal: salesAgg[0]?.mpesaTotal ?? 0,
    salesCount: salesAgg[0]?.salesCount ?? 0,
    // Cost of goods SOLD (not all stock purchased). `costOfGoods` kept as an
    // alias for backward compatibility with any existing clients.
    costOfGoodsSold,
    costOfGoods: costOfGoodsSold,
    stockPurchased,
    purchaseCount: purchaseAgg[0]?.purchaseCount ?? 0,
    grossProfit,
    expenses,
    expenseCount: expenseAgg[0]?.expenseCount ?? 0,
    netProfit,
    stockOnHand,
  });
}
