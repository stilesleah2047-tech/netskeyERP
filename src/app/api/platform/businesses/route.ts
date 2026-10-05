import { NextRequest, NextResponse } from "next/server";
import { connectDb } from "@/lib/server/db";
import { Business } from "@/lib/server/models/Business";
import { User } from "@/lib/server/models/User";
import { Branch } from "@/lib/server/models/Branch";
import { requirePlatformAdmin } from "@/lib/server/platform";
import { TIERS, type TierId } from "@/lib/tiers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Platform command center — list EVERY business across all tenants with
 * subscription + usage stats. Operator-only (platform admin email).
 * This is the one place that intentionally crosses the tenant boundary;
 * ordinary business owners can never reach it.
 */
export async function GET(req: NextRequest) {
  await connectDb();
  const admin = await requirePlatformAdmin(req);
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const businesses = await Business.find({}).sort({ createdAt: -1 }).lean();

  // Usage counts per business in two grouped queries instead of N+1.
  const [userCounts, branchCounts] = await Promise.all([
    User.aggregate<{ _id: unknown; count: number }>([
      { $group: { _id: "$businessId", count: { $sum: 1 } } },
    ]),
    Branch.aggregate<{ _id: unknown; count: number }>([
      { $group: { _id: "$businessId", count: { $sum: 1 } } },
    ]),
  ]);
  const userMap = new Map(userCounts.map((u) => [String(u._id), u.count]));
  const branchMap = new Map(branchCounts.map((b) => [String(b._id), b.count]));

  // Owner contact lookup.
  const ownerIds = businesses.map((b) => b.ownerId);
  const owners = await User.find({ _id: { $in: ownerIds } })
    .select("name email phoneNumber")
    .lean();
  const ownerMap = new Map(owners.map((o) => [String(o._id), o]));

  const rows = businesses.map((b) => {
    const tier = (b.tier as TierId) ?? "STARTER";
    const owner = ownerMap.get(String(b.ownerId));
    return {
      id: String(b._id),
      name: b.name,
      tier,
      tierName: TIERS[tier].name,
      priceKsh: TIERS[tier].priceKsh,
      subscriptionStatus: b.subscriptionStatus ?? "TRIALING",
      trialEndsAt: b.trialEndsAt ?? null,
      currentPeriodEnd: b.currentPeriodEnd ?? null,
      isActive: b.isActive,
      createdAt: b.createdAt,
      userCount: userMap.get(String(b._id)) ?? 0,
      branchCount: branchMap.get(String(b._id)) ?? 0,
      maxUsers: TIERS[tier].maxUsers,
      maxBranches: TIERS[tier].maxBranches,
      owner: owner
        ? { name: owner.name, email: owner.email, phoneNumber: owner.phoneNumber }
        : null,
    };
  });

  // Headline MRR = sum of monthly price for businesses that are ACTIVE.
  const mrr = rows
    .filter((r) => r.subscriptionStatus === "ACTIVE")
    .reduce((sum, r) => sum + r.priceKsh, 0);

  return NextResponse.json({
    businesses: rows,
    stats: {
      total: rows.length,
      active: rows.filter((r) => r.subscriptionStatus === "ACTIVE").length,
      trialing: rows.filter((r) => r.subscriptionStatus === "TRIALING").length,
      suspended: rows.filter((r) => r.subscriptionStatus === "SUSPENDED").length,
      mrr,
    },
  });
}