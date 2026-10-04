import { NextRequest, NextResponse } from "next/server";
import mongoose from "mongoose";
import { connectDb } from "@/lib/server/db";
import { Transaction } from "@/lib/server/models/Transaction";
import { Purchase } from "@/lib/server/models/Purchase";
import { Expense } from "@/lib/server/models/Expense";
import { getAuth, resolveBranchScope } from "@/lib/server/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Management / profit overview — NOT full accounting.
//   Revenue      = sum of SUCCESS sales in range
//   Cost of Goods= sum of purchase cost in range (stock bought in)
//   Gross Profit = Revenue - Cost of Goods
//   Expenses     = sum of operating expenses in range
//   Net Profit   = Gross Profit - Expenses
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

  const branchObjId = branchId ? new mongoose.Types.ObjectId(branchId) : null;
  const businessObjId = new mongoose.Types.ObjectId(auth.businessId);
  const dateMatch = { createdAt: { $gte: from, $lte: to } };

  const salesMatch: Record<string, unknown> = { ...dateMatch, businessId: businessObjId, paymentStatus: "SUCCESS" };
  if (branchObjId) salesMatch.branchId = branchObjId;

  const costMatch: Record<string, unknown> = { ...dateMatch, businessId: businessObjId };
  if (branchObjId) costMatch.branchId = branchObjId;

  const [salesAgg, purchaseAgg, expenseAgg] = await Promise.all([
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
      { $group: { _id: null, costOfGoods: { $sum: "$totalCost" }, purchaseCount: { $sum: 1 } } },
    ]),
    Expense.aggregate([
      { $match: costMatch },
      { $group: { _id: null, expenses: { $sum: "$amount" }, expenseCount: { $sum: 1 } } },
    ]),
  ]);

  const revenue = salesAgg[0]?.revenue ?? 0;
  const costOfGoods = purchaseAgg[0]?.costOfGoods ?? 0;
  const expenses = expenseAgg[0]?.expenses ?? 0;
  const grossProfit = revenue - costOfGoods;
  const netProfit = grossProfit - expenses;

  return NextResponse.json({
    scope: branchId ? "branch" : "global",
    range: { from: from.toISOString(), to: to.toISOString() },
    revenue,
    cashTotal: salesAgg[0]?.cashTotal ?? 0,
    mpesaTotal: salesAgg[0]?.mpesaTotal ?? 0,
    salesCount: salesAgg[0]?.salesCount ?? 0,
    costOfGoods,
    purchaseCount: purchaseAgg[0]?.purchaseCount ?? 0,
    grossProfit,
    expenses,
    expenseCount: expenseAgg[0]?.expenseCount ?? 0,
    netProfit,
  });
}
