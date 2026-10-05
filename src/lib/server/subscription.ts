// Server-side helpers that turn the shared tier definitions in
// `@/lib/tiers` into enforceable limits. Routes call these before
// creating a branch or a user so a tenant can never exceed what their
// plan allows. There is no real payment gateway yet; this is purely the
// tier/limit model that the platform console drives.

import { Types } from "mongoose";
import { Branch } from "@/lib/server/models/Branch";
import { User } from "@/lib/server/models/User";
import { Business, IBusiness } from "@/lib/server/models/Business";
import { TIERS, type TierId } from "@/lib/tiers";

export function tierOf(business: Pick<IBusiness, "tier">): TierId {
  return (business.tier as TierId) ?? "STARTER";
}

/**
 * Returns an error message string if adding one more branch would exceed
 * the business's plan, or null if it's allowed.
 */
export async function branchLimitError(
  businessId: Types.ObjectId | string,
  tier: TierId
): Promise<string | null> {
  const max = TIERS[tier].maxBranches;
  if (max === null) return null; // unlimited
  const count = await Branch.countDocuments({ businessId });
  if (count >= max) {
    return `Your ${TIERS[tier].name} plan allows ${max} branch${max === 1 ? "" : "es"}. Upgrade to add more.`;
  }
  return null;
}

/**
 * Returns an error message string if adding one more user (any role)
 * would exceed the business's plan, or null if it's allowed.
 */
export async function userLimitError(
  businessId: Types.ObjectId | string,
  tier: TierId
): Promise<string | null> {
  const max = TIERS[tier].maxUsers;
  if (max === null) return null; // unlimited
  const count = await User.countDocuments({ businessId });
  if (count >= max) {
    return `Your ${TIERS[tier].name} plan allows ${max} user accounts. Upgrade to add more.`;
  }
  return null;
}

/** Load the business tier for a tenant, defaulting to STARTER. */
export async function loadTier(businessId: Types.ObjectId | string): Promise<TierId> {
  const biz = await Business.findById(businessId).select("tier").lean();
  return tierOf({ tier: (biz?.tier as TierId) ?? "STARTER" } as IBusiness);
}