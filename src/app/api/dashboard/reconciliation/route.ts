import { NextRequest, NextResponse } from "next/server";
import mongoose from "mongoose";
import { connectDb } from "@/lib/server/db";
import { Transaction } from "@/lib/server/models/Transaction";
import { DailyInventory } from "@/lib/server/models/DailyInventory";
import { getAuth, resolveBranchScope } from "@/lib/server/auth";
import { businessDate, businessDayRange, isBusinessDateString } from "@/lib/server/businessDay";
import { isObjectId } from "@/lib/server/ids";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  await connectDb();
  const auth = getAuth(req);
  if (!auth) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const branchId = resolveBranchScope(auth, req.nextUrl.searchParams.get("branchId"));
  const dateParam = req.nextUrl.searchParams.get("date");
  if (dateParam && !isBusinessDateString(dateParam)) {
    return NextResponse.json({ error: "date must be YYYY-MM-DD" }, { status: 400 });
  }
  if (branchId && !isObjectId(branchId)) {
    return NextResponse.json({ error: "Invalid branchId" }, { status: 400 });
  }
  const date = dateParam || businessDate();

  const invMatch: Record<string, unknown> = { date, businessId: new mongoose.Types.ObjectId(auth.businessId) };
  if (branchId) invMatch.branchId = new mongoose.Types.ObjectId(branchId);

  const inventoryRows = await DailyInventory.aggregate([
    { $match: invMatch },
    // Tenant-scoped lookup: never show another business's product label even
    // if a foreign productId ever reached DailyInventory (review 1.2).
    {
      $lookup: {
        from: "products",
        let: { pid: "$productId", bid: "$businessId" },
        pipeline: [{ $match: { $expr: { $and: [{ $eq: ["$_id", "$$pid"] }, { $eq: ["$businessId", "$$bid"] }] } } }],
        as: "product",
      },
    },
    { $unwind: "$product" },
    { $lookup: { from: "branches", localField: "branchId", foreignField: "_id", as: "branch" } },
    { $unwind: "$branch" },
    {
      $project: {
        _id: 0,
        branchId: 1,
        branchName: "$branch.branchName",
        productId: 1,
        productLabel: "$product.label",
        sizeLiters: "$product.sizeLiters",
        morningDispatched: 1,
        eveningPhysicalCount: 1,
      },
    },
  ]);

  // Sales counted over the Africa/Nairobi business day.
  const { start: dayStart, end: dayEnd } = businessDayRange(date);

  const soldMatch: Record<string, unknown> = {
    businessId: new mongoose.Types.ObjectId(auth.businessId),
    createdAt: { $gte: dayStart, $lt: dayEnd },
    paymentStatus: "SUCCESS",
  };
  if (branchId) soldMatch.branchId = new mongoose.Types.ObjectId(branchId);

  const soldRows = await Transaction.aggregate([
    { $match: soldMatch },
    { $group: { _id: { branchId: "$branchId", productId: "$productId" }, totalSold: { $sum: "$quantity" } } },
  ]);
  const soldMap = new Map(
    soldRows.map((r) => [r._id.branchId.toString() + ":" + r._id.productId.toString(), r.totalSold as number])
  );

  const rows = inventoryRows.map((row: any) => {
    const key = row.branchId.toString() + ":" + row.productId.toString();
    const totalSold = soldMap.get(key) ?? 0;
    const expectedRemaining = row.morningDispatched - totalSold;
    const reconciledOk =
      row.eveningPhysicalCount != null ? row.eveningPhysicalCount === expectedRemaining : null;
    return { ...row, totalSold, expectedRemaining, reconciledOk };
  });

  return NextResponse.json({ date, rows });
}
