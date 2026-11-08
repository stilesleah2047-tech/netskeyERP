import { timingSafeEqual } from "crypto";

// M-Pesa safety switches (pre-pilot review section 6, concern 1).
//
// M-Pesa is outside the PRD's MVP scope, so it is OFF unless MPESA_ENABLED is
// "true". When it is on, the callback must be authenticated by at least one
// of:
//   * DARAJA_CALLBACK_SECRET: a random string appended to the callback URL as
//     ?s=<secret>; the callback rejects requests without it.
//   * DARAJA_CALLBACK_IP_ALLOWLIST: Safaricom's published callback IPs.
// In production, a callback with neither configured is rejected, rather than
// accepted from anyone as before.

export function mpesaEnabled(): boolean {
  return process.env.MPESA_ENABLED === "true";
}

export function callbackSecret(): string | null {
  const s = process.env.DARAJA_CALLBACK_SECRET?.trim();
  return s ? s : null;
}

/** The callback URL to give Daraja, including the secret when configured. */
export function callbackUrlWithSecret(base: string): string {
  const secret = callbackSecret();
  if (!secret) return base;
  const url = new URL(base);
  url.searchParams.set("s", secret);
  return url.toString();
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/**
 * Returns null if the callback request is authentic, or a reason to reject.
 */
export function checkCallbackAuth(sourceIp: string, providedSecret: string | null): string | null {
  if (!mpesaEnabled()) return "M-Pesa is disabled (MPESA_ENABLED is not true)";

  const secret = callbackSecret();
  const allowlist = (process.env.DARAJA_CALLBACK_IP_ALLOWLIST ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  if (!secret && allowlist.length === 0) {
    return process.env.NODE_ENV === "production"
      ? "No DARAJA_CALLBACK_SECRET or DARAJA_CALLBACK_IP_ALLOWLIST configured"
      : null; // local development / sandbox only
  }
  if (secret && (!providedSecret || !safeEqual(providedSecret, secret))) {
    return "Missing or wrong callback secret";
  }
  if (allowlist.length > 0 && !allowlist.includes(sourceIp)) {
    return "Source IP not in DARAJA_CALLBACK_IP_ALLOWLIST";
  }
  return null;
}
