import crypto from "crypto";

// Hash an invite token for storage/lookup. Kept in a shared lib (not a route
// file) because Next.js only allows HTTP handler exports from route modules.
export function hashToken(raw: string): string {
  return crypto.createHash("sha256").update(raw).digest("hex");
}
