// Server-side helpers that turn the shared tier definitions in
// `@/lib/tiers` into enforceable limits. Routes call these before
// creating a branch or a user so a tenant can never exceed what their
// plan allows. There is no real payment gateway yet; this is purely the
// tier/limit model that the platform console drives.

import { Types } from "mongoose";
import { Branch } from "@/lib/server/models/Branch";
import { User } from "@/lib/server/models/User";
import { Business, IBusiness } from "@/lib/server/models/Business";
import {
  isUsable,
  TIERS,
  effectiveMaxBranches,
  type TierId,
  type SubscriptionStatus,
} from "@/lib/tiers";

export function tierOf(business: Pick<IBusiness, "tier">): TierId {
  return (business.tier as TierId) ?? "STARTER";
}

export interface BusinessPlan {
  tier: TierId;
  status: SubscriptionStatus;
}

/**
 * Returns an error message string if adding one more branch would exceed
 * the business's plan, or null if it's allowed.
 */
export async function branchLimitError(
  businessId: Types.ObjectId | string,
  tier: TierId,
  status: SubscriptionStatus = "ACTIVE"
): Promise<string | null> {
  const max = effectiveMaxBranches(tier, status);
  if (max === null) return null; // unlimited
  // Only count live branches toward the cap so a deactivated branch frees a
  // slot (Test report F-06).
  const count = await Branch.countDocuments({ businessId, isActive: { $ne: false } });
  if (count >= max) {
    if (status === "TRIALING") {
      return `Your free trial allows ${max} branch${max === 1 ? "" : "es"}. Upgrade to add more.`;
    }
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
  const count = await User.countDocuments({ businessId, isActive: { $ne: false } });
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

/**
 * Load both the tier and the current subscription status for a tenant.
 * Needed so limit checks can apply trial allowances (Test report F-01).
 */
export async function loadPlan(businessId: Types.ObjectId | string): Promise<BusinessPlan> {
  const biz = await Business.findById(businessId).select("tier subscriptionStatus").lean();
  return {
    tier: (biz?.tier as TierId) ?? "STARTER",
    status: (biz?.subscriptionStatus as SubscriptionStatus) ?? "TRIALING",
  };
}

// Also count only live users toward the user cap (deactivated staff free a slot).
export async function liveUserCount(businessId: Types.ObjectId | string): Promise<number> {
  return User.countDocuments({ businessId, isActive: { $ne: false } });
}

/**
 * Why this business may not be used right now, or null if it may.
 * Checked at login, token refresh and /api/auth/me so a SUSPENDED or
 * deactivated tenant is locked out within one access-token lifetime
 * (pre-pilot review 1.5). Platform admins manage tenants from /platform and
 * are not affected by their own tenant's status.
 */
export async function businessBlockReason(businessId: string | { toString(): string }): Promise<string | null> {
  const business = await Business.findById(businessId.toString()).select("isActive subscriptionStatus").lean();
  if (!business) return "This business no longer exists.";
  if (business.isActive === false) return "This business account has been deactivated. Contact support.";
  if (!isUsable(business.subscriptionStatus as any)) {
    return "This business account is suspended. Contact support to restore access.";
  }
  return null;
}
