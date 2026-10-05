// Platform (operator) access control. The platform operator is YOU — the
// person running this SaaS for many client businesses — not a client's
// business owner. Platform admins are identified by email via the
// PLATFORM_ADMIN_EMAILS env var (comma-separated). The JWT carries no
// email, so callers must re-read the User from the DB and pass its email
// here.
//
// We read process.env directly (not the zod-validated getEnv) so the
// platform check never couples to unrelated required env like the Daraja
// M-Pesa keys.

export function platformAdminEmails(): string[] {
  const raw = process.env.PLATFORM_ADMIN_EMAILS ?? "";
  return raw
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

export function isPlatformAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return platformAdminEmails().includes(email.toLowerCase());
}

import type { NextRequest } from "next/server";
import { getAuth } from "@/lib/server/auth";
import { User } from "@/lib/server/models/User";

/**
 * Resolve and authorize the current request as a platform operator.
 * Returns the authenticated User's id/email on success, or null if the
 * caller is not a platform admin. The DB must already be connected.
 *
 * The JWT has no email, so we re-read the User and match its email
 * against PLATFORM_ADMIN_EMAILS.
 */
export async function requirePlatformAdmin(
  req: NextRequest
): Promise<{ userId: string; email: string } | null> {
  const auth = getAuth(req);
  if (!auth) return null;
  const user = await User.findById(auth.sub).select("email isActive").lean();
  if (!user || !user.isActive) return null;
  if (!isPlatformAdminEmail(user.email)) return null;
  return { userId: auth.sub, email: user.email };
}