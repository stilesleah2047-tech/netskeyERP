import { NextRequest, NextResponse } from "next/server";
import { connectDb } from "@/lib/server/db";
import { Business } from "@/lib/server/models/Business";
import { User } from "@/lib/server/models/User";
import { Branch } from "@/lib/server/models/Branch";
import { Product } from "@/lib/server/models/Product";
import { Invite } from "@/lib/server/models/Invite";
import { requirePlatformAdmin, isPlatformAdminEmail } from "@/lib/server/platform";
import { DEFAULT_CATALOG } from "@/lib/server/defaultCatalog";
import { issueOwnerInvite } from "@/lib/server/ownerInvite";
import { audit } from "@/lib/server/audit";
import { TIERS, TRIAL_DAYS, type TierId } from "@/lib/tiers";
import { z } from "zod";

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

  // Businesses still waiting for their owner to accept the invite.
  const pendingInvites = await Invite.find({
    role: "SUPER_ADMIN",
    acceptedAt: null,
    expiresAt: { $gt: new Date() },
    businessId: { $in: businesses.filter((b) => !b.ownerId).map((b) => b._id) },
  })
    .select("businessId email expiresAt")
    .lean();
  const pendingMap = new Map(pendingInvites.map((i) => [String(i.businessId), i]));

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
      ownerInvite: !b.ownerId
        ? (() => {
            const i = pendingMap.get(String(b._id));
            return i ? { email: i.email, expiresAt: i.expiresAt } : { email: null, expiresAt: null };
          })()
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

const createSchema = z.object({
  businessName: z.string().trim().min(2).max(120),
  ownerEmail: z.string().trim().email(),
  tier: z.enum(["STARTER", "GROWTH", "ENTERPRISE"]).default("STARTER"),
});

/**
 * Create a new business. Operator-only: public signup has been removed, so
 * this is the ONLY way a business comes into existence. The owner is not
 * created here; instead a one-time owner invite link is returned for the
 * operator to send. The owner sets their own name, phone and password when
 * they accept it, so the operator never handles their password.
 */
export async function POST(req: NextRequest) {
  await connectDb();
  const admin = await requirePlatformAdmin(req);
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const json = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
  }
  const { businessName, ownerEmail, tier } = parsed.data;

  if (isPlatformAdminEmail(ownerEmail)) {
    return NextResponse.json({ error: "A platform-operator email cannot be a business owner." }, { status: 400 });
  }

  const business = await Business.create({
    name: businessName,
    ownerId: null,
    tier,
    subscriptionStatus: "TRIALING",
    trialEndsAt: new Date(Date.now() + TRIAL_DAYS * 24 * 60 * 60 * 1000),
    currentPeriodEnd: null,
  });

  try {
    await Product.insertMany(DEFAULT_CATALOG.map((p) => ({ ...p, businessId: business._id })));
    const invite = await issueOwnerInvite({ businessId: business._id, email: ownerEmail, createdBy: admin.userId });

    await audit({
      businessId: String(business._id),
      actorId: admin.userId,
      action: "business.create",
      targetType: "Business",
      targetId: business._id,
      details: { name: businessName, tier, ownerEmail: ownerEmail.toLowerCase() },
    });

    return NextResponse.json(
      { business: { id: String(business._id), name: business.name, tier }, ...invite },
      { status: 201 }
    );
  } catch (err) {
    // Roll back so a half-created business never lingers.
    await Product.deleteMany({ businessId: business._id }).catch(() => {});
    await Invite.deleteMany({ businessId: business._id }).catch(() => {});
    await Business.deleteOne({ _id: business._id }).catch(() => {});
    throw err;
  }
}
