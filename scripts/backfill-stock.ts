import dotenv from "dotenv";
import path from "path";
dotenv.config({ path: path.resolve(__dirname, "../.env.local") });

import mongoose from "mongoose";
import { connectDb } from "../src/lib/server/db";
import { Purchase } from "../src/lib/server/models/Purchase";
import { Transaction } from "../src/lib/server/models/Transaction";
import { StockMovement } from "../src/lib/server/models/StockMovement";
import { recordInbound, recordOutbound } from "../src/lib/server/stock";

// BACKFILL the stock ledger from history.
//
// The stock ledger (StockMovement) is the single source of truth for on-hand
// stock and FIFO cost. Deployments that recorded purchases and sales BEFORE
// the ledger existed need their history replayed into it once, in the exact
// chronological order it happened, so FIFO layers build up correctly.
//
// What gets replayed:
//   - every Purchase that has a productId  -> PURCHASE inbound layer
//   - every realised SALE (CASH, or MPESA that SUCCEEDED) -> SALE outbound
// Pending / failed M-Pesa attempts never moved stock, so they are skipped.
//
// SAFETY: this refuses to run if the ledger already has ANY movements, so it
// can never double-count. To re-run intentionally, clear the stockmovements
// collection first (only on a throwaway/dev database).
//     npm run backfill:stock

async function backfill() {
  await connectDb();

  const existing = await StockMovement.estimatedDocumentCount();
  if (existing > 0) {
    console.error(
      `Refusing to run: the stock ledger already has ${existing} movement(s).\n` +
        "Backfill is a one-time operation. If you really mean to rebuild it, clear\n" +
        "the stockmovements collection first (dev/testing only)."
    );
    await mongoose.disconnect();
    process.exit(1);
  }

  // Pull purchases and realised sales, tag each with a kind, then process the
  // combined stream strictly by server timestamp so FIFO is faithful.
  const purchases = await Purchase.find({ productId: { $ne: null } })
    .sort({ createdAt: 1 })
    .lean();
  const sales = await Transaction.find({
    $or: [{ paymentMethod: "CASH" }, { paymentStatus: "SUCCESS" }],
  })
    .sort({ createdAt: 1 })
    .lean();

  type Event =
    | { kind: "PURCHASE"; at: Date; doc: (typeof purchases)[number] }
    | { kind: "SALE"; at: Date; doc: (typeof sales)[number] };

  const events: Event[] = [
    ...purchases.map((p) => ({ kind: "PURCHASE" as const, at: p.createdAt, doc: p })),
    ...sales.map((s) => ({ kind: "SALE" as const, at: s.createdAt, doc: s })),
  ].sort((a, b) => a.at.getTime() - b.at.getTime());

  let inbound = 0;
  let outbound = 0;
  let skipped = 0;

  for (const ev of events) {
    if (ev.kind === "PURCHASE") {
      const p = ev.doc;
      // eslint-disable-next-line no-await-in-loop
      await recordInbound({
        businessId: p.businessId,
        branchId: p.branchId,
        productId: p.productId!,
        type: "PURCHASE",
        quantity: p.quantity,
        unitCost: p.unitCost,
        relatedType: "PURCHASE",
        relatedId: p._id,
        note: "Backfilled from purchase history",
        createdBy: p.recordedBy ?? null,
      });
      inbound += 1;
    } else {
      const s = ev.doc;
      if (!s.productId) {
        skipped += 1;
        continue;
      }
      // eslint-disable-next-line no-await-in-loop
      await recordOutbound({
        businessId: s.businessId,
        branchId: s.branchId,
        productId: s.productId,
        type: "SALE",
        quantity: s.quantity,
        allowNegative: true, // sales are never blocked, even historically
        relatedType: "TRANSACTION",
        relatedId: s._id,
        note: "Backfilled from sales history",
        createdBy: s.staffId ?? null,
      });
      outbound += 1;
    }
  }

  console.log(
    `Backfill complete: ${inbound} purchase layer(s), ${outbound} sale(s) replayed, ${skipped} skipped.`
  );
  console.log(
    "Note: ledger createdAt reflects when this script ran, not the original dates, but FIFO order was preserved by replaying chronologically."
  );
  await mongoose.disconnect();
  process.exit(0);
}

backfill().catch((err) => {
  console.error("stock backfill failed:", err?.message ?? err);
  process.exit(1);
});
