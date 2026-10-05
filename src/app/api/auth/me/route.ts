import { NextRequest, NextResponse } from "next/server";
import { connectDb } from "@/lib/server/db";
import { User } from "@/lib/server/models/User";
import { Branch } from "@/lib/server/models/Branch";
import { Business } from "@/lib/server/models/Business";
import { getAuth } from "@/lib/server/auth";
import { isPlatformAdminEmail } from "@/lib/server/platform";
import { TIERS, type TierId, type SubscriptionStatus } from "@/lib/tiers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  await connectDb();
  const auth = getAuth(req);
  if (!auth) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const user = await User.findById(auth.sub).lean();
  if (!user || !user.isActive) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  const branch = user.branchId ? await Branch.findById(user.branchId).lean() : null;
  const business = await Business.findById(user.businessId).lean();

  const tier = (business?.tier as TierId) ?? "STARTER";
  const status = (business?.subscriptionStatus as SubscriptionStatus) ?? "TRIALING";
  const tierDef = TIERS[tier];

  return NextResponse.json({
    user: {
      id: user._id,
      name: user.name,
      role: user.role,
      businessId: user.businessId,
      businessName: business?.name ?? null,
      branchId: user.branchId,
      branchName: branch?.branchName ?? null,
      phoneNumber: user.phoneNumber,
      email: user.email,
      isPlatformAdmin: isPlatformAdminEmail(user.email),
    },
    subscription: {
      tier,
      tierName: tierDef.name,
      priceKsh: tierDef.priceKsh,
      status,
      trialEndsAt: business?.trialEndsAt ?? null,
      currentPeriodEnd: business?.currentPeriodEnd ?? null,
      maxBranches: tierDef.maxBranches,
      maxUsers: tierDef.maxUsers,
    },
  });
}