import { NextRequest, NextResponse } from "next/server";
import mongoose from "mongoose";
import { connectDb } from "@/lib/server/db";
import { Business } from "@/lib/server/models/Business";
import { User } from "@/lib/server/models/User";
import { Branch } from "@/lib/server/models/Branch";
import { Transaction } from "@/lib/server/models/Transaction";
import { UserSession } from "@/lib/server/models/UserSession";
import { MpesaCallbackLog } from "@/lib/server/models/MpesaCallbackLog";
import { requirePlatformAdmin } from "@/lib/server/platform";
import { businessDate, businessDayRange } from "@/lib/server/businessDay";
import { TIERS, type TierId } from "@/lib/tiers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DAY = 24 * 60 * 60 * 1000;

/**
 * Platform-wide monitoring for the operator: headline numbers, a 14-day
 * sales trend, per-business health and a list of things that need attention.
 * Operator-only; intentionally crosses the tenant boundary.
 */
export async function GET(req: NextRequest) {
  await connectDb();
  const admin = await requirePlatformAdmin(req);
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const now = new Date();
  const today = businessDayRange();
  const start30 = new Date(today.start.getTime() - 29 * DAY);
  const sevenDaysAgo = new Date(now.getTime() - 7 * DAY);

  const paid = { paymentStatus: "SUCCESS" };

  const [businesses, userCounts, branchCounts, salesByBizDay, lastSaleByBiz, lastSeenByBiz, mismatch7d, mpesaRejected24h] =
    await Promise.all([
      Business.find({}).select("name tier subscriptionStatus trialEndsAt currentPeriodEnd isActive ownerId createdAt").lean(),
      User.aggregate<{ _id: unknown; total: number; active: number }>([
        { $group: { _id: "$businessId", total: { $sum: 1 }, active: { $sum: { $cond: ["$isActive", 1, 0] } } } },
      ]),
      Branch.aggregate<{ _id: unknown; count: number }>([
        { $match: { isActive: { $ne: false } } },
        { $group: { _id: "$businessId", count: { $sum: 1 } } },
      ]),
      // Revenue and sale count per business per Nairobi day, last 30 days.
      Transaction.aggregate<{ _id: { b: unknown; d: string }; revenue: number; count: number }>([
        { $match: { ...paid, createdAt: { $gte: start30 } } },
        {
          $group: {
            _id: {
              b: "$businessId",
              d: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt", timezone: "Africa/Nairobi" } },
            },
            revenue: { $sum: "$amountTotal" },
            count: { $sum: 1 },
          },
        },
      ]),
      Transaction.aggregate<{ _id: unknown; at: Date }>([
        { $match: paid },
        { $group: { _id: "$businessId", at: { $max: "$createdAt" } } },
      ]),
      // Last time anyone in each business used the app.
      UserSession.aggregate<{ _id: unknown; at: Date }>([
        { $lookup: { from: "users", localField: "userId", foreignField: "_id", as: "u" } },
        { $unwind: "$u" },
        { $group: { _id: "$u.businessId", at: { $max: "$lastUsedAt" } } },
      ]),
      Transaction.countDocuments({ priceMismatch: true, createdAt: { $gte: sevenDaysAgo } }),
      MpesaCallbackLog.countDocuments({
        _id: { $gte: mongoose.Types.ObjectId.createFromTime(Math.floor((now.getTime() - DAY) / 1000)) },
        processingNote: /^Rejected/,
      }),
    ]);

  const userMap = new Map(userCounts.map((u) => [String(u._id), u]));
  const branchMap = new Map(branchCounts.map((b) => [String(b._id), b.count]));
  const lastSaleMap = new Map(lastSaleByBiz.map((r) => [String(r._id), r.at]));
  const lastSeenMap = new Map(lastSeenByBiz.map((r) => [String(r._id), r.at]));

  const todayStr = businessDate(now);
  const days14: string[] = [];
  for (let i = 13; i >= 0; i--) days14.push(businessDate(new Date(today.start.getTime() + 12 * 60 * 60 * 1000 - i * DAY)));
  const day7Set = new Set(days14.slice(-7));

  const trend = new Map(days14.map((d) => [d, { date: d, revenue: 0, count: 0 }]));
  const perBiz = new Map<string, { today: number; todayCount: number; d7: number; d30: number; count30: number }>();
  let rev7 = 0, rev30 = 0, revToday = 0, countToday = 0, count30 = 0;

  for (const r of salesByBizDay) {
    const b = String(r._id.b);
    const d = r._id.d;
    const e = perBiz.get(b) ?? { today: 0, todayCount: 0, d7: 0, d30: 0, count30: 0 };
    e.d30 += r.revenue;
    e.count30 += r.count;
    rev30 += r.revenue;
    count30 += r.count;
    if (day7Set.has(d)) { e.d7 += r.revenue; rev7 += r.revenue; }
    if (d === todayStr) { e.today += r.revenue; e.todayCount += r.count; revToday += r.revenue; countToday += r.count; }
    perBiz.set(b, e);
    const t = trend.get(d);
    if (t) { t.revenue += r.revenue; t.count += r.count; }
  }

  type Alert = { level: "high" | "medium" | "info"; businessId: string | null; businessName: string | null; message: string };
  const alerts: Alert[] = [];

  const rows = businesses.map((b) => {
    const id = String(b._id);
    const tier = (b.tier as TierId) ?? "STARTER";
    const s = perBiz.get(id) ?? { today: 0, todayCount: 0, d7: 0, d30: 0, count30: 0 };
    const u = userMap.get(id);
    const lastSaleAt = lastSaleMap.get(id) ?? null;
    const lastSeenAt = lastSeenMap.get(id) ?? null;

    const status = b.subscriptionStatus ?? "TRIALING";
    if (status === "TRIALING" && b.trialEndsAt) {
      const left = (new Date(b.trialEndsAt).getTime() - now.getTime()) / DAY;
      if (left < 0) alerts.push({ level: "high", businessId: id, businessName: b.name, message: "Trial has ended but the account is still marked as trialing" });
      else if (left <= 3) alerts.push({ level: "medium", businessId: id, businessName: b.name, message: `Trial ends in ${Math.ceil(left)} day(s)` });
    }
    if (status === "ACTIVE" && b.currentPeriodEnd && new Date(b.currentPeriodEnd).getTime() < now.getTime()) {
      alerts.push({ level: "high", businessId: id, businessName: b.name, message: "Paid period has ended; payment not recorded" });
    }
    if (status === "PAST_DUE") alerts.push({ level: "high", businessId: id, businessName: b.name, message: "Payment is past due" });
    if (!b.ownerId) alerts.push({ level: "info", businessId: id, businessName: b.name, message: "Owner has not accepted the invite yet" });
    const ageDays = (now.getTime() - new Date(b.createdAt).getTime()) / DAY;
    if (b.ownerId && status !== "SUSPENDED" && ageDays > 7 && (!lastSaleAt || now.getTime() - new Date(lastSaleAt).getTime() > 7 * DAY)) {
      alerts.push({ level: "medium", businessId: id, businessName: b.name, message: lastSaleAt ? "No sales in the last 7 days" : "No sales recorded yet" });
    }

    return {
      id,
      name: b.name,
      tier,
      tierName: TIERS[tier].name,
      priceKsh: TIERS[tier].priceKsh,
      subscriptionStatus: status,
      hasOwner: !!b.ownerId,
      users: u?.active ?? 0,
      branches: branchMap.get(id) ?? 0,
      salesToday: s.today,
      salesTodayCount: s.todayCount,
      sales7d: s.d7,
      sales30d: s.d30,
      lastSaleAt,
      lastSeenAt,
    };
  });

  if (mismatch7d > 0) {
    alerts.push({ level: "medium", businessId: null, businessName: null, message: `${mismatch7d} sale(s) in the last 7 days synced at a different price than the cashier saw` });
  }
  if (mpesaRejected24h > 0) {
    alerts.push({ level: "high", businessId: null, businessName: null, message: `${mpesaRejected24h} M-Pesa callback(s) rejected in the last 24 hours (possible forgery or misconfiguration)` });
  }

  const order = { high: 0, medium: 1, info: 2 };
  alerts.sort((a, b) => order[a.level] - order[b.level]);
  rows.sort((a, b) => b.sales30d - a.sales30d);

  const totalUsers = userCounts.reduce((n, u) => n + u.active, 0);
  const totalBranches = branchCounts.reduce((n, b) => n + b.count, 0);
  const mrr = rows.filter((r) => r.subscriptionStatus === "ACTIVE").reduce((n, r) => n + r.priceKsh, 0);

  return NextResponse.json({
    generatedAt: now,
    totals: {
      businesses: rows.length,
      active: rows.filter((r) => r.subscriptionStatus === "ACTIVE").length,
      trialing: rows.filter((r) => r.subscriptionStatus === "TRIALING").length,
      suspended: rows.filter((r) => r.subscriptionStatus === "SUSPENDED").length,
      users: totalUsers,
      branches: totalBranches,
      mrr,
      salesToday: revToday,
      salesTodayCount: countToday,
      sales7d: rev7,
      sales30d: rev30,
      sales30dCount: count30,
    },
    trend: Array.from(trend.values()),
    businesses: rows,
    alerts,
  });
}
