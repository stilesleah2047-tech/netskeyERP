import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { connectDb } from "@/lib/server/db";
import { Business } from "@/lib/server/models/Business";
import { User } from "@/lib/server/models/User";
import { Branch } from "@/lib/server/models/Branch";
import { Transaction } from "@/lib/server/models/Transaction";
import { UserSession } from "@/lib/server/models/UserSession";
import { Invite } from "@/lib/server/models/Invite";
import { requirePlatformAdmin } from "@/lib/server/platform";
import { isObjectId } from "@/lib/server/ids";
import { TIERS, type TierId } from "@/lib/tiers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const patchSchema = z.object({
  tier: z.enum(["STARTER", "GROWTH", "ENTERPRISE"]).optional(),
  subscriptionStatus: z.enum(["TRIALING", "ACTIVE", "PAST_DUE", "SUSPENDED"]).optional(),
  // Extend/renew the paid period by N days (operator convenience, since
  // there's no gateway). Sets currentPeriodEnd = now + days.
  extendDays: z.number().int().min(1).max(366).optional(),
});

/**
 * Platform operator updates a single business's subscription — change
 * plan tier, flip status (e.g. ACTIVE / SUSPENDED), or extend the billing
 * period. Operator-only, cross-tenant.
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  await connectDb();
  const admin = await requirePlatformAdmin(req);
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  const json = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
  }
  const { tier, subscriptionStatus, extendDays } = parsed.data;

  const update: Record<string, unknown> = {};
  if (tier) update.tier = tier;
  if (subscriptionStatus) update.subscriptionStatus = subscriptionStatus;
  if (extendDays) {
    update.currentPeriodEnd = new Date(Date.now() + extendDays * 24 * 60 * 60 * 1000);
    // Extending the period implies the account is paid/active.
    if (!subscriptionStatus) update.subscriptionStatus = "ACTIVE";
  }
  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  const business = await Business.findByIdAndUpdate(id, update, { new: true }).lean();
  if (!business) return NextResponse.json({ error: "Business not found" }, { status: 404 });

  const t = (business.tier as TierId) ?? "STARTER";
  return NextResponse.json({
    business: {
      id: String(business._id),
      name: business.name,
      tier: t,
      tierName: TIERS[t].name,
      priceKsh: TIERS[t].priceKsh,
      subscriptionStatus: business.subscriptionStatus,
      trialEndsAt: business.trialEndsAt ?? null,
      currentPeriodEnd: business.currentPeriodEnd ?? null,
    },
  });
}

/**
 * Everything the operator needs to see about one business: owner, branches,
 * staff (with when they last used the app), 30-day sales by branch and the
 * most recent sales. Read-only. Operator-only, cross-tenant.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  await connectDb();
  const admin = await requirePlatformAdmin(req);
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  if (!isObjectId(id)) return NextResponse.json({ error: "Invalid business id" }, { status: 400 });

  const business = await Business.findById(id).lean();
  if (!business) return NextResponse.json({ error: "Business not found" }, { status: 404 });

  const since30 = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const [branches, users, salesByBranch, recent, pendingInvites] = await Promise.all([
    Branch.find({ businessId: id }).select("branchName locationCity isActive managerId createdAt").sort({ createdAt: 1 }).lean(),
    User.find({ businessId: id }).select("name email phoneNumber role branchId isActive createdAt").sort({ createdAt: 1 }).lean(),
    Transaction.aggregate<{ _id: unknown; revenue: number; count: number; cash: number; mpesa: number }>([
      { $match: { businessId: business._id, paymentStatus: "SUCCESS", createdAt: { $gte: since30 } } },
      {
        $group: {
          _id: "$branchId",
          revenue: { $sum: "$amountTotal" },
          count: { $sum: 1 },
          cash: { $sum: { $cond: [{ $eq: ["$paymentMethod", "CASH"] }, "$amountTotal", 0] } },
          mpesa: { $sum: { $cond: [{ $eq: ["$paymentMethod", "MPESA"] }, "$amountTotal", 0] } },
        },
      },
    ]),
    Transaction.find({ businessId: id })
      .select("branchId staffId quantity amountTotal paymentMethod paymentStatus syncedFromOffline priceMismatch receiptNo createdAt productId")
      .populate("productId", "label")
      .sort({ createdAt: -1 })
      .limit(25)
      .lean(),
    Invite.find({ businessId: id, acceptedAt: null, expiresAt: { $gt: new Date() } }).select("role email expiresAt").lean(),
  ]);

  const sessions = await UserSession.aggregate<{ _id: unknown; at: Date; devices: number }>([
    { $match: { userId: { $in: users.map((u) => u._id) } } },
    { $group: { _id: "$userId", at: { $max: "$lastUsedAt" }, devices: { $sum: 1 } } },
  ]);
  const seenMap = new Map(sessions.map((s) => [String(s._id), s]));
  const branchName = new Map(branches.map((b) => [String(b._id), b.branchName]));
  const userName = new Map(users.map((u) => [String(u._id), u.name]));
  const salesMap = new Map(salesByBranch.map((s) => [String(s._id), s]));

  const t = (business.tier as TierId) ?? "STARTER";
  return NextResponse.json({
    business: {
      id: String(business._id),
      name: business.name,
      tier: t,
      tierName: TIERS[t].name,
      subscriptionStatus: business.subscriptionStatus,
      trialEndsAt: business.trialEndsAt ?? null,
      currentPeriodEnd: business.currentPeriodEnd ?? null,
      isActive: business.isActive,
      createdAt: business.createdAt,
      ownerId: business.ownerId ? String(business.ownerId) : null,
    },
    branches: branches.map((b) => {
      const s = salesMap.get(String(b._id));
      return {
        id: String(b._id),
        name: b.branchName,
        city: b.locationCity,
        isActive: b.isActive !== false,
        manager: b.managerId ? userName.get(String(b.managerId)) ?? null : null,
        sales30d: s?.revenue ?? 0,
        count30d: s?.count ?? 0,
        cash30d: s?.cash ?? 0,
        mpesa30d: s?.mpesa ?? 0,
      };
    }),
    users: users.map((u) => {
      const seen = seenMap.get(String(u._id));
      return {
        id: String(u._id),
        name: u.name,
        email: u.email,
        phoneNumber: u.phoneNumber,
        role: u.role,
        isOwner: business.ownerId ? String(business.ownerId) === String(u._id) : false,
        branch: u.branchId ? branchName.get(String(u.branchId)) ?? null : null,
        isActive: u.isActive,
        lastSeenAt: seen?.at ?? null,
        devices: seen?.devices ?? 0,
      };
    }),
    pendingInvites: pendingInvites.map((i) => ({ role: i.role, email: i.email, expiresAt: i.expiresAt })),
    recentSales: recent.map((r) => ({
      id: String(r._id),
      at: r.createdAt,
      branch: branchName.get(String(r.branchId)) ?? null,
      staff: userName.get(String(r.staffId)) ?? null,
      product: (r.productId as any)?.label ?? null,
      quantity: r.quantity,
      amount: r.amountTotal,
      method: r.paymentMethod,
      status: r.paymentStatus,
      offline: r.syncedFromOffline,
      priceMismatch: !!r.priceMismatch,
      receiptNo: r.receiptNo ?? null,
    })),
  });
}
