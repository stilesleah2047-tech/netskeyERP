# Pre-pilot review fixes

This branch addresses the open items from the *AquaFlow ERP Pre-Pilot Review*
(commit 2fbf7e6) and the *AquaFlow / Vessel initial test report* (11 Oct 2026)
that earlier commits had not yet covered. Earlier commits on `main` already
added the stock ledger, transfers, invites, user/branch deactivation, branch
prices and the F-01..F-07 fixes.

## Deploy checklist

| Variable | Needed | Purpose |
|---|---|---|
| `MPESA_ENABLED` | optional | M-Pesa is **off** unless set to `true` (it is out of MVP scope). |
| `DARAJA_CALLBACK_SECRET` | if M-Pesa on | Random string; appended to the callback URL and checked on every callback. |
| `DARAJA_CALLBACK_IP_ALLOWLIST` | if M-Pesa on | Safaricom callback IPs. In production at least one of secret/allowlist is required. |

No data migration is needed. Existing offline queues on devices are upgraded
automatically (IndexedDB v1 -> v2) the next time the terminal opens.

## What changed

**Offline POS and sync (review section 3)**
- Fixed the critical bug: sales sent immediately are now marked synced, the server
  reports duplicates in `alreadySynced`, and the queue flushes in chunks of 100.
  Sync can no longer wedge after ~100 rows.
- Queued rows record the user and branch that made the sale; only that user's rows
  are flushed and the server rejects mismatches, so shared devices cannot misattribute sales.
- Rejected sales stop retrying and are listed on the terminal with the reason.
- Pending count is loaded from IndexedDB on open.
- Terminal opens offline: service worker (`public/sw.js`) caches the shell, and the
  signed-in user and price list are cached on the device.
- Terminal shows branch-override prices; the device price is stored with each sale
  and `priceMismatch` is flagged when the server price differs.
- Customer phone is optional for cash sales.

**Permissions (section 5)**
- Expenses, purchases and the profit report require Owner or Branch Manager (cashiers get 403).
- Product create/edit is Owner-only.
- Owners can change a user's role/branch; deactivation and reassignment revoke sessions.
- New append-only `AuditLog` for user creation/changes, branch (de)activation,
  product edits and overwritten inventory counts.

**Tenancy (section 1)**
- Login, token refresh and `/api/auth/me` block SUSPENDED or inactive businesses
  (platform admins exempt).
- Inventory dispatch/evening-count validate the product belongs to the tenant;
  the reconciliation product lookup is tenant-scoped.
- `npm run check:tenancy` fails if an authenticated route never filters by `businessId`.
- `migrate-multitenant` refuses to run on a database with more than one business.

**Time and validation (sections 2 and 4)**
- All "today"/business-day logic uses Africa/Nairobi (`src/lib/server/businessDay.ts`).
- Malformed `branchId` values return 400 instead of 500.

**M-Pesa (section 6)**
- Disabled by default; callback requires secret and/or IP allowlist in production;
  success is accepted only if the paid amount matches the sale.
- The terminal no longer says "FAILED" after 60 s; it warns the cashier not to take cash.

**Housekeeping**
- `tsconfig.tsbuildinfo` untracked. `npm test` runs 12 unit tests (including a regression
  test for the 100-row sync failure).

## Not done in this branch
- Multi-item sales and printable receipts (PRD 5.3) — a POS feature, not a fix.
- Atomic signup transaction, email verification, distributed rate limiting.
- Live cross-tenant integration tests against MongoDB (needs a test database).
- The end-to-end flows in the test report still need re-running on a two-branch tenant.

## Business accounts are operator-only

Public signup is closed. `/api/auth/signup` has been removed and `/signup`
now explains that accounts are by invitation.

To add a business, a platform admin (an email in `PLATFORM_ADMIN_EMAILS`)
opens the Platform Command Center and fills in **Create a business**
(business name, owner's email, plan). This creates the business with the
default catalogue and returns a one-time owner link, valid for 7 days.
The owner opens the link and sets their own name, phone and password; they
become the business's owner of record. If the link expires or is lost,
**New owner link** issues a fresh one and cancels the old one.

`npm test` includes checks that no public signup API exists, that only the
platform route creates businesses, and that every platform handler requires
a platform admin.

## Admin console (`/platform`)

Platform admins are sent straight to `/platform` after signing in. It has
three tabs:

- **Overview** – platform-wide sales today / 7 / 30 days, MRR, counts, a
  14-day sales chart, a "Needs attention" list (trials ending, unpaid or past
  due, owners who have not joined, businesses with no sales for 7 days, price
  mismatches, rejected M-Pesa callbacks) and a per-business activity table.
  Refreshes every minute.
- **Businesses** – create a business (owner invite link), change plan or
  status, mark paid, suspend/reactivate, issue a new owner link.
- **Activity** – the audit log across all businesses, filterable by business.

Clicking any business opens a detail panel: branches with 30-day sales,
everyone in the business with when they were last seen, pending invites and
the 25 most recent sales. APIs: `/api/platform/overview`,
`/api/platform/activity`, `GET /api/platform/businesses/[id]`.
