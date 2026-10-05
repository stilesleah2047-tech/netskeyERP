// Subscription tiers for the SaaS. Prices are in Kenyan Shillings (KSh)
// per month. `maxBranches` / `maxUsers` are hard caps enforced server-side
// when creating branches and staff. Use null for "unlimited".
//
// This file is intentionally free of server-only imports so both the API
// routes and the client pages can share the exact same definitions.

export type TierId = "STARTER" | "GROWTH" | "ENTERPRISE";

export interface TierDef {
  id: TierId;
  name: string;
  priceKsh: number; // monthly price in KSh
  maxBranches: number | null; // null = unlimited
  maxUsers: number | null; // total users in the business (owner + managers + staff); null = unlimited
  features: string[];
}

export const TIERS: Record<TierId, TierDef> = {
  STARTER: {
    id: "STARTER",
    name: "Starter",
    priceKsh: 3500,
    maxBranches: 1,
    maxUsers: 6, // owner + up to 5 staff/manager
    features: [
      "1 branch",
      "Up to 5 staff accounts",
      "Sales, cash & M-Pesa capture",
      "Daily stock reconciliation",
      "Profit & expense reports",
    ],
  },
  GROWTH: {
    id: "GROWTH",
    name: "Growth",
    priceKsh: 7500,
    maxBranches: 5,
    maxUsers: 30,
    features: [
      "Up to 5 branches",
      "Up to 30 staff accounts",
      "Everything in Starter",
      "Multi-branch dashboard & ranking",
      "Branch-level pricing overrides",
    ],
  },
  ENTERPRISE: {
    id: "ENTERPRISE",
    name: "Enterprise",
    priceKsh: 15000,
    maxBranches: null,
    maxUsers: null,
    features: [
      "Unlimited branches",
      "Unlimited staff accounts",
      "Everything in Growth",
      "Priority support",
    ],
  },
};

export const TIER_ORDER: TierId[] = ["STARTER", "GROWTH", "ENTERPRISE"];
export const DEFAULT_TIER: TierId = "STARTER";

// Days of free trial a brand-new business gets on signup.
export const TRIAL_DAYS = 14;

export type SubscriptionStatus = "TRIALING" | "ACTIVE" | "PAST_DUE" | "SUSPENDED";

export function formatKsh(amount: number): string {
  return "KSh " + amount.toLocaleString("en-KE");
}

// Whether a subscription status currently permits using the app.
// TRIALING and ACTIVE are allowed; PAST_DUE still allowed (grace) but
// should warn; SUSPENDED is blocked.
export function isUsable(status: SubscriptionStatus): boolean {
  return status !== "SUSPENDED";
}