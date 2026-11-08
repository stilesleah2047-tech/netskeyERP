import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { connectDb } from "@/lib/server/db";
import { Transaction } from "@/lib/server/models/Transaction";
import { Product, BranchPricing } from "@/lib/server/models/Product";
import { getAuth, requireRole, resolveBranchScope } from "@/lib/server/auth";
import { normalizeKenyanPhone } from "@/lib/server/phone";
import { recordOutbound } from "@/lib/server/stock";

export const runtime = "nodejs";

const saleSchema = z.object({
  clientUuid: z.string().uuid(),
  customerName: z.string().trim().max(120).optional(),
  // Optional for walk-in cash sales; validated when present.
  customerPhone: z.string().trim().max(15).optional(),
  productId: z.string().min(1),
  quantity: z.number().int().min(1).max(500),
  clientSubmittedAt: z.string().datetime().optional(),
  // Offline price snapshot and the owner of the queued row (pre-pilot review
  // section 3). Optional so older clients keep working.
  clientUnitPrice: z.number().nonnegative().optional(),
  queuedByUserId: z.string().optional(),
  queuedBranchId: z.string().optional(),
  // Multi-item sale: every line of one basket carries the same group id and
  // receipt number. Each line keeps its own clientUuid, so exactly-once sync
  // and per-line stock deduction work as before.
  saleGroupId: z.string().uuid().optional(),
  receiptNo: z.string().trim().max(32).optional(),
});
const bodySchema = z.object({ sales: z.array(saleSchema).min(1).max(100) });

export async function POST(req: NextRequest) {
  await connectDb();
  const auth = getAuth(req);
  if (!requireRole(auth, "DELIVERY", "BRANCH_MANAGER")) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const json = await req.json().catch(() => null);
  const normalized = Array.isArray(json?.sales) ? json : { sales: [json] };
  const parsed = bodySchema.safeParse(normalized);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
  }

  const branchId = resolveBranchScope(auth!);
  if (!branchId) {
    return NextResponse.json({ error: "No active branch assignment for this account" }, { status: 403 });
  }

  const { sales } = parsed.data;
  const productIds = Array.from(new Set(sales.map((s) => s.productId)));
  const products = await Product.find({ _id: { $in: productIds }, businessId: auth!.businessId }).lean();
  const overrides = await BranchPricing.find({ branchId, productId: { $in: productIds }, businessId: auth!.businessId }).lean();
  const productMap = new Map(products.map((p) => [p._id.toString(), p]));
  const overrideMap = new Map(overrides.map((o) => [o.productId.toString(), o.unitPrice]));

  const rejected: { clientUuid: string; error: string }[] = [];
  const inserted: any[] = [];
  // Sales the server already has (same clientUuid). Reported back so the
  // device marks them synced instead of re-sending them forever.
  const alreadySynced: string[] = [];

  const existing = await Transaction.find({
    clientUuid: { $in: sales.map((s) => s.clientUuid) },
    businessId: auth!.businessId,
  })
    .select("clientUuid")
    .lean();
  const existingSet = new Set(existing.map((e) => e.clientUuid));

  for (const sale of sales) {
    if (existingSet.has(sale.clientUuid)) {
      alreadySynced.push(sale.clientUuid);
      continue;
    }
    // A queued sale must be synced by the person who made it, at the branch
    // it was made in. Otherwise a shared device or a staff transfer would
    // credit the sale to the wrong cashier or branch.
    if (sale.queuedByUserId && sale.queuedByUserId !== auth!.sub) {
      rejected.push({ clientUuid: sale.clientUuid, error: "Recorded by another staff member; they must sign in to sync it" });
      continue;
    }
    if (sale.queuedBranchId && sale.queuedBranchId !== branchId) {
      rejected.push({ clientUuid: sale.clientUuid, error: "Recorded at a different branch than your current assignment" });
      continue;
    }
    let phone: string | null = null;
    try {
      if (sale.customerPhone) phone = normalizeKenyanPhone(sale.customerPhone);
    } catch (e: any) {
      rejected.push({ clientUuid: sale.clientUuid, error: e.message });
      continue;
    }
    const product = productMap.get(sale.productId);
    if (!product || !product.isActive) {
      rejected.push({ clientUuid: sale.clientUuid, error: "Product not available" });
      continue;
    }
    const unitPrice = overrideMap.get(sale.productId) ?? product.unitPrice;
    // The server price stays authoritative, but a difference from what the
    // cashier saw (and charged) is flagged for the owner, not hidden.
    const priceMismatch = sale.clientUnitPrice != null && Math.abs(sale.clientUnitPrice - unitPrice) > 0.001;

    try {
      const created = await Transaction.create({
        businessId: auth!.businessId,
        branchId,
        staffId: auth!.sub,
        customerName: sale.customerName ?? null,
        customerPhone: phone,
        productId: product._id,
        sizeLiters: product.sizeLiters,
        quantity: sale.quantity,
        unitPrice,
        amountTotal: Math.round(sale.quantity * unitPrice * 100) / 100,
        paymentMethod: "CASH",
        paymentStatus: "SUCCESS",
        clientUuid: sale.clientUuid,
        syncedFromOffline: !!sale.clientSubmittedAt,
        clientSubmittedAt: sale.clientSubmittedAt ? new Date(sale.clientSubmittedAt) : null,
        clientUnitPrice: sale.clientUnitPrice ?? null,
        priceMismatch,
        saleGroupId: sale.saleGroupId ?? null,
        receiptNo: sale.receiptNo ?? null,
      });
      inserted.push(created);
      // Draw the sold units out of the stock ledger (FIFO). Sales are NEVER
      // blocked by stock, so this is allowed to drive on-hand negative — a
      // negative figure is the signal to reconcile, not a reason to refuse
      // the sale that already happened in the field.
      try {
        await recordOutbound({
          businessId: auth!.businessId,
          branchId,
          productId: product._id,
          type: "SALE",
          quantity: sale.quantity,
          allowNegative: true,
          relatedType: "TRANSACTION",
          relatedId: created._id,
          createdBy: auth!.sub,
        });
      } catch {
        // The sale itself is committed; a ledger hiccup must not fail it.
        // A backfill (npm run backfill:stock) can repair ledger gaps.
      }
    } catch (err: any) {
      if (err?.code === 11000) {
        // Raced with another sync of the same sale: it is saved, so say so.
        alreadySynced.push(sale.clientUuid);
        continue;
      }
      rejected.push({ clientUuid: sale.clientUuid, error: "Could not save this sale" });
    }
  }

  return NextResponse.json({ inserted, alreadySynced, rejected });
}
