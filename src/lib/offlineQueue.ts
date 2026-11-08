import { openDB, DBSchema, IDBPDatabase } from "idb";
import { apiFetch } from "@/lib/api";

// Offline cash-sale queue (PRD 5.3 / 5.5).
//
// Every sale is written here BEFORE the success screen is shown, then synced
// in the background. Pre-pilot review fixes:
//   * Rows are marked synced after the immediate POST succeeds (previously
//     they stayed "pending" forever and were re-sent).
//   * The server reports duplicates in `alreadySynced`; those are treated as
//     synced instead of piling up.
//   * The queue is flushed in chunks of at most MAX_BATCH, so a large backlog
//     can never exceed the server's per-request limit and wedge sync.
//   * Each row records the userId/branchId that made the sale, and only rows
//     belonging to the signed-in user are sent, so a shared device never
//     credits one cashier's sales to another.
//   * Rows the server rejects are moved to "rejected" with the reason and are
//     NOT retried forever; the terminal shows them so someone can act.

export const MAX_BATCH = 100;

export type QueueStatus = "pending" | "synced" | "rejected";

export interface QueuedCashSale {
  clientUuid: string;
  customerName?: string;
  customerPhone?: string;
  productId: string;
  quantity: number;
  clientSubmittedAt: string;
  /** Price shown on the device at the time of sale (KES per unit). */
  clientUnitPrice?: number;
  userId: string;
  branchId: string | null;
  status: QueueStatus;
  rejectReason?: string;
  /** Shared by every line of one multi-item sale. */
  saleGroupId?: string;
  receiptNo?: string;
  /** Legacy field from v1 rows. */
  synced?: boolean;
}

interface QueueDB extends DBSchema {
  cash_sales: { key: string; value: QueuedCashSale };
}

const DB_NAME = "aquaflow-offline";
const STORE = "cash_sales";
let dbPromise: Promise<IDBPDatabase<QueueDB>> | null = null;

function getDb() {
  if (typeof window === "undefined") throw new Error("offlineQueue can only run in the browser");
  if (!dbPromise) {
    dbPromise = openDB<QueueDB>(DB_NAME, 2, {
      async upgrade(db, oldVersion, _newVersion, tx) {
        if (oldVersion < 1) {
          db.createObjectStore(STORE, { keyPath: "clientUuid" });
        }
        if (oldVersion >= 1 && oldVersion < 2) {
          // Migrate v1 rows: boolean `synced` -> `status`. v1 rows carry no
          // owner, so they are left with userId "" and are claimed by the
          // next user who flushes (same behaviour as before the upgrade).
          const store = tx.objectStore(STORE);
          let cursor = await store.openCursor();
          while (cursor) {
            const row = cursor.value as QueuedCashSale;
            row.status = row.synced ? "synced" : "pending";
            row.userId = row.userId ?? "";
            row.branchId = row.branchId ?? null;
            delete row.synced;
            await cursor.update(row);
            cursor = await cursor.continue();
          }
        }
      },
    });
  }
  return dbPromise;
}

export function generateClientUuid(): string {
  return crypto.randomUUID();
}

export async function queueCashSale(sale: Omit<QueuedCashSale, "status">): Promise<void> {
  const db = await getDb();
  await db.put(STORE, { ...sale, status: "pending" });
}

function belongsTo(row: QueuedCashSale, userId: string) {
  // Legacy rows with no owner are allowed through for any user.
  return !row.userId || row.userId === userId;
}

export async function getPendingSales(userId: string): Promise<QueuedCashSale[]> {
  const db = await getDb();
  const all = await db.getAll(STORE);
  return all.filter((s) => s.status === "pending" && belongsTo(s, userId));
}

export async function getRejectedSales(userId: string): Promise<QueuedCashSale[]> {
  const db = await getDb();
  const all = await db.getAll(STORE);
  return all.filter((s) => s.status === "rejected" && belongsTo(s, userId));
}

export async function countPending(userId: string): Promise<number> {
  return (await getPendingSales(userId)).length;
}

/** Remove a rejected sale once someone has dealt with it. */
export async function dismissRejected(clientUuid: string): Promise<void> {
  const db = await getDb();
  const row = await db.get(STORE, clientUuid);
  if (row && row.status === "rejected") await db.delete(STORE, clientUuid);
}

async function setStatus(ids: string[], status: QueueStatus, reasons?: Map<string, string>) {
  if (ids.length === 0) return;
  const db = await getDb();
  const tx = db.transaction(STORE, "readwrite");
  for (const id of ids) {
    const row = await tx.store.get(id);
    if (row) {
      row.status = status;
      if (reasons?.has(id)) row.rejectReason = reasons.get(id);
      await tx.store.put(row);
    }
  }
  await tx.done;
}

/** Remove synced rows older than a week so IndexedDB does not grow forever. */
async function pruneSynced() {
  const db = await getDb();
  const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const tx = db.transaction(STORE, "readwrite");
  let cursor = await tx.store.openCursor();
  while (cursor) {
    const row = cursor.value;
    if (row.status === "synced" && new Date(row.clientSubmittedAt).getTime() < cutoff) {
      await cursor.delete();
    }
    cursor = await cursor.continue();
  }
  await tx.done;
}

export interface SyncResponse {
  inserted: { clientUuid: string }[];
  alreadySynced?: string[];
  rejected?: { clientUuid: string; error: string }[];
}

/** Apply a server response to the queue. Used by flushQueue and by the
 *  terminal's immediate POST, so both paths mark rows the same way. */
export async function applySyncResult(result: SyncResponse) {
  const ok = [...result.inserted.map((r) => r.clientUuid), ...(result.alreadySynced ?? [])];
  await setStatus(ok, "synced");
  const rejected = result.rejected ?? [];
  await setStatus(
    rejected.map((r) => r.clientUuid),
    "rejected",
    new Map(rejected.map((r) => [r.clientUuid, r.error]))
  );
  return { synced: ok.length, rejected: rejected.length };
}

export function toWire(row: QueuedCashSale) {
  return {
    clientUuid: row.clientUuid,
    customerName: row.customerName,
    customerPhone: row.customerPhone,
    productId: row.productId,
    quantity: row.quantity,
    clientSubmittedAt: row.clientSubmittedAt,
    clientUnitPrice: row.clientUnitPrice,
    // The server verifies these against the signed-in session.
    queuedByUserId: row.userId || undefined,
    queuedBranchId: row.branchId ?? undefined,
    saleGroupId: row.saleGroupId,
    receiptNo: row.receiptNo,
  };
}

export interface FlushResult {
  synced: number;
  rejected: number;
  failed: number;
}

let flushing = false;

export async function flushQueue(userId: string): Promise<FlushResult> {
  if (flushing) return { synced: 0, rejected: 0, failed: 0 };
  flushing = true;
  try {
    const pending = await getPendingSales(userId);
    let synced = 0;
    let rejected = 0;
    let failed = 0;

    for (let i = 0; i < pending.length; i += MAX_BATCH) {
      const chunk = pending.slice(i, i + MAX_BATCH);
      try {
        const result = await apiFetch<SyncResponse>("/api/transactions/cash", {
          method: "POST",
          body: JSON.stringify({ sales: chunk.map(toWire) }),
        });
        const r = await applySyncResult(result);
        synced += r.synced;
        rejected += r.rejected;
        failed += chunk.length - r.synced - r.rejected;
      } catch {
        // Network / server failure: leave the rest pending and retry later.
        failed += pending.length - i;
        break;
      }
    }

    pruneSynced().catch(() => {});
    return { synced, rejected, failed };
  } finally {
    flushing = false;
  }
}

export function registerOfflineSync(userId: string, onFlush?: (r: FlushResult) => void) {
  if (typeof window === "undefined") return () => {};

  const handler = async () => {
    const result = await flushQueue(userId);
    onFlush?.(result);
  };

  window.addEventListener("online", handler);
  if (navigator.onLine) handler();

  const interval = setInterval(() => {
    if (navigator.onLine) handler();
  }, 30000);

  return () => {
    window.removeEventListener("online", handler);
    clearInterval(interval);
  };
}
