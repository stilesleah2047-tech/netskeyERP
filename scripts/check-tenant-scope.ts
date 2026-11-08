/**
 * Tenant-isolation guard (pre-pilot review 1.1).
 *
 * Isolation depends on every API route filtering by the caller's businessId.
 * This check fails the build if a route that authenticates a user never
 * mentions `businessId`, which is the most likely way a future route would
 * leak data between tenants. Routes that are intentionally cross-tenant must
 * be listed in ALLOW with a reason.
 *
 *   npm run check:tenancy
 */
import fs from "fs";
import path from "path";

const ROOT = path.resolve(__dirname, "../src/app/api");

const ALLOW: Record<string, string> = {
  "auth/logout/route.ts": "only clears the caller's own session",
  "auth/sessions/route.ts": "scoped by userId (the caller's own sessions)",
  "auth/sessions/[deviceId]/route.ts": "scoped by userId (the caller's own sessions)",
  "auth/refresh/route.ts": "scoped by refresh-token hash",
  "auth/login/route.ts": "pre-authentication",
  "health/route.ts": "no data",
  "mpesa/callback/route.ts": "server-to-server; matched by CheckoutRequestID, authenticated by secret/IP",
  "platform/businesses/route.ts": "platform-operator console (requirePlatformAdmin)",
  "platform/businesses/[id]/route.ts": "platform-operator console (requirePlatformAdmin)",
  "platform/businesses/[id]/owner-invite/route.ts": "platform-operator console (requirePlatformAdmin)",
  "invites/accept/route.ts": "scoped by invite token, which carries the businessId",
};

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p) : e.name === "route.ts" ? [p] : [];
  });
}

const problems: string[] = [];
for (const file of walk(ROOT)) {
  const rel = path.relative(ROOT, file).split(path.sep).join("/");
  if (ALLOW[rel]) continue;
  const src = fs.readFileSync(file, "utf8");
  const authenticates = /getAuth\(|requirePlatformAdmin\(/.test(src);
  if (authenticates && !/businessId/.test(src)) {
    problems.push(rel);
  }
}

if (problems.length) {
  console.error("Routes that authenticate but never filter by businessId:");
  for (const p of problems) console.error("  - src/app/api/" + p);
  console.error("Add a { businessId: auth.businessId } filter, or list the route in ALLOW with a reason.");
  process.exit(1);
}
console.log("Tenant-scope check passed.");
