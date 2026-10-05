import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { connectDb } from "@/lib/server/db";
import { Business } from "@/lib/server/models/Business";
import { requirePlatformAdmin } from "@/lib/server/platform";
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