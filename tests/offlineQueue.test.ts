// Regression test for the pre-pilot review's critical bug: sync stopped
// permanently once more than 100 rows were pending.
import "fake-indexeddb/auto";
import { test } from "node:test";
import assert from "node:assert/strict";

(globalThis as any).window = globalThis;

// A fake server that mimics /api/transactions/cash: max 100 per batch,
// duplicates reported in alreadySynced, rows from other users rejected.
const serverRows = new Set<string>();
let batches: number[] = [];
let signedInUser = "user-a";
(globalThis as any).fetch = async (_url: string, init: any) => {
  const { sales } = JSON.parse(init.body);
  batches.push(sales.length);
  if (sales.length > 100) {
    return new Response(JSON.stringify({ error: "too many" }), { status: 400, headers: { "content-type": "application/json" } });
  }
  const inserted: any[] = [], alreadySynced: string[] = [], rejected: any[] = [];
  for (const s of sales) {
    if (serverRows.has(s.clientUuid)) alreadySynced.push(s.clientUuid);
    else if (s.queuedByUserId && s.queuedByUserId !== signedInUser) rejected.push({ clientUuid: s.clientUuid, error: "other user" });
    else { serverRows.add(s.clientUuid); inserted.push({ clientUuid: s.clientUuid }); }
  }
  return new Response(JSON.stringify({ inserted, alreadySynced, rejected }), { status: 200, headers: { "content-type": "application/json" } });
};

test("a backlog of 250 sales syncs in chunks and leaves nothing pending", async () => {
  const q = await import("../src/lib/offlineQueue");
  for (let i = 0; i < 250; i++) {
    await q.queueCashSale({
      clientUuid: crypto.randomUUID(), productId: "p", quantity: 1,
      clientSubmittedAt: new Date().toISOString(), userId: "user-a", branchId: "b1",
    });
  }
  batches = [];
  const r = await q.flushQueue("user-a");
  assert.deepEqual(batches, [100, 100, 50]);
  assert.equal(r.synced, 250);
  assert.equal(await q.countPending("user-a"), 0);
});

test("a sale already saved by the immediate POST is marked synced, not re-sent forever", async () => {
  const q = await import("../src/lib/offlineQueue");
  const id = crypto.randomUUID();
  await q.queueCashSale({ clientUuid: id, productId: "p", quantity: 1,
    clientSubmittedAt: new Date().toISOString(), userId: "user-a", branchId: "b1" });
  serverRows.add(id); // the server already has it (e.g. response was lost)
  await q.flushQueue("user-a");
  assert.equal(await q.countPending("user-a"), 0);
  batches = [];
  await q.flushQueue("user-a");
  assert.deepEqual(batches, [], "nothing left to send");
});

test("another cashier's queued sales are not sent under the current login", async () => {
  const q = await import("../src/lib/offlineQueue");
  await q.queueCashSale({ clientUuid: crypto.randomUUID(), productId: "p", quantity: 1,
    clientSubmittedAt: new Date().toISOString(), userId: "user-b", branchId: "b1" });
  batches = [];
  await q.flushQueue("user-a");
  assert.deepEqual(batches, []);
  assert.equal(await q.countPending("user-b"), 1);
});

test("rejected sales stop retrying and are surfaced", async () => {
  const q = await import("../src/lib/offlineQueue");
  signedInUser = "user-c";
  const id = crypto.randomUUID();
  // A legacy-style row with a mismatched owner reaches the server and is refused.
  await q.queueCashSale({ clientUuid: id, productId: "p", quantity: 1,
    clientSubmittedAt: new Date().toISOString(), userId: "user-d", branchId: "b1" });
  const r = await q.flushQueue("user-d");
  assert.equal(r.rejected, 1);
  assert.equal(await q.countPending("user-d"), 0);
  const rejected = await q.getRejectedSales("user-d");
  assert.equal(rejected.length, 1);
  assert.equal(rejected[0].rejectReason, "other user");
});

test("every line of a multi-item sale keeps its own key but shares the receipt", async () => {
  const q = await import("../src/lib/offlineQueue");
  signedInUser = "user-a"; // the previous test signs the fake server in as someone else
  const group = crypto.randomUUID();
  const lines = [
    { productId: "p3l", quantity: 2, clientUnitPrice: 40 },
    { productId: "p5l", quantity: 1, clientUnitPrice: 60 },
  ];
  let sent: any[] = [];
  const realFetch = (globalThis as any).fetch;
  (globalThis as any).fetch = async (url: string, init: any) => {
    sent = JSON.parse(init.body).sales;
    return realFetch(url, init);
  };
  try {
    for (const l of lines) {
      await q.queueCashSale({
        clientUuid: crypto.randomUUID(), ...l, clientSubmittedAt: new Date().toISOString(),
        userId: "user-a", branchId: "b1", saleGroupId: group, receiptNo: "261108-ABCD",
      });
    }
    const r = await q.flushQueue("user-a");
    assert.equal(r.synced, 2);
    assert.equal(sent.length, 2);
    assert.equal(new Set(sent.map((s) => s.clientUuid)).size, 2);
    assert.ok(sent.every((s) => s.saleGroupId === group && s.receiptNo === "261108-ABCD"));
    // 2 x 40 + 1 x 60 = KES 140, as in the test report's planned online sale.
    assert.equal(sent.reduce((t, s) => t + s.quantity * s.clientUnitPrice, 0), 140);
  } finally {
    (globalThis as any).fetch = realFetch;
  }
});
