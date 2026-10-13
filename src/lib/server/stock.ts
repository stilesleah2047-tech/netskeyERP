import mongoose, { ClientSession, Types } from "mongoose";
import { StockMovement, MovementType } from "@/lib/server/models/StockMovement";

// ---------------------------------------------------------------------------
// Stock ledger engine (FIFO).
//
// Everything that changes on-hand stock goes through here, so there is ONE
// code path and ONE source of truth. On-hand = sum of every movement's
// signed `quantityDelta`. Cost of goods is valued FIFO: the oldest units
// bought are the first ones considered sold / transferred out.
//
// Design notes grounded in the PRD:
//  - SALES ARE NEVER BLOCKED by stock. A delivery worker in the field must
//    always be able to record a sale, even if the office's stock figure is
//    behind reality. So an outbound SALE is allowed to drive stock negative;
//    the negative simply flags "your records say you oversold, go reconcile".
//  - TRANSFERS ARE BLOCKED when the source branch lacks the stock, because a
//    transfer is an internal, deliberate action that must balance.
//  - Movements are immutable. A correction is a NEW movement (ADJUSTMENT),
//    never an edit, so the ledger stays auditable.
// ---------------------------------------------------------------------------

export class InsufficientStockError extends Error {
  available: number;
  requested: number;
  constructor(available: number, requested: number) {
    super(`Insufficient stock: ${available} available, ${requested} requested`);
    this.name = "InsufficientStockError";
    this.available = available;
    this.requested = requested;
  }
}

type Id = Types.ObjectId | string;

export interface InboundArgs {
  businessId: Id;
  branchId: Id;
  productId: Id;
  type: Extract<MovementType, "PURCHASE" | "TRANSFER_IN" | "ADJUSTMENT">;
  quantity: number; // > 0
  unitCost: number; // buying price per unit for this layer
  relatedType?: "PURCHASE" | "TRANSACTION" | "TRANSFER" | "ADJUSTMENT" | null;
  relatedId?: Id | null;
  note?: string | null;
  createdBy?: Id | null;
  session?: ClientSession;
}

export interface OutboundArgs {
  businessId: Id;
  branchId: Id;
  productId: Id;
  type: Extract<MovementType, "SALE" | "TRANSFER_OUT" | "ADJUSTMENT">;
  quantity: number; // > 0 (the amount leaving)
  allowNegative: boolean; // true for SALE, false for TRANSFER_OUT
  relatedType?: "PURCHASE" | "TRANSACTION" | "TRANSFER" | "ADJUSTMENT" | null;
  relatedId?: Id | null;
  note?: string | null;
  createdBy?: Id | null;
  session?: ClientSession;
}

/** Record a stock-IN. The movement doubles as a FIFO cost layer. */
export async function recordInbound(args: InboundArgs) {
  if (args.quantity <= 0) throw new Error("Inbound quantity must be positive");
  const [doc] = await StockMovement.create(
    [
      {
        businessId: args.businessId,
        branchId: args.branchId,
        productId: args.productId,
        type: args.type,
        quantityDelta: args.quantity,
        unitCost: args.unitCost,
        remainingQty: args.quantity, // open layer
        costOfGoods: 0,
        relatedType: args.relatedType ?? null,
        relatedId: args.relatedId ?? null,
        note: args.note ?? null,
        createdBy: args.createdBy ?? null,
      },
    ],
    args.session ? { session: args.session } : {}
  );
  return doc;
}

/**
 * Record a stock-OUT, consuming FIFO cost layers oldest-first.
 * Returns the created movement plus the total cost of goods removed.
 */
export async function recordOutbound(args: OutboundArgs) {
  if (args.quantity <= 0) throw new Error("Outbound quantity must be positive");

  const session = args.session;
  // Oldest open layers first. `remainingQty > 0` are the layers still holding
  // un-consumed units.
  const layersQuery = StockMovement.find({
    businessId: args.businessId,
    branchId: args.branchId,
    productId: args.productId,
    remainingQty: { $gt: 0 },
  })
    .sort({ createdAt: 1, _id: 1 });
  if (session) layersQuery.session(session);
  const layers = await layersQuery.exec();

  const available = layers.reduce((sum, l) => sum + l.remainingQty, 0);
  if (!args.allowNegative && available < args.quantity) {
    throw new InsufficientStockError(available, args.quantity);
  }

  let toConsume = args.quantity;
  let costOfGoods = 0;
  let lastUnitCost = 0;

  for (const layer of layers) {
    if (toConsume <= 0) break;
    const take = Math.min(layer.remainingQty, toConsume);
    layer.remainingQty -= take;
    costOfGoods += take * layer.unitCost;
    lastUnitCost = layer.unitCost;
    toConsume -= take;
    await layer.save(session ? { session } : undefined);
  }

  // Oversold (SALE only, allowNegative): the units beyond stock are valued at
  // the most recent known unit cost (0 if we have never bought this product).
  if (toConsume > 0) {
    costOfGoods += toConsume * lastUnitCost;
  }

  costOfGoods = Math.round(costOfGoods * 100) / 100;
  const unitCost = args.quantity > 0 ? costOfGoods / args.quantity : 0;

  const [doc] = await StockMovement.create(
    [
      {
        businessId: args.businessId,
        branchId: args.branchId,
        productId: args.productId,
        type: args.type,
        quantityDelta: -args.quantity,
        unitCost,
        remainingQty: 0, // outbound movements are not layers
        costOfGoods,
        relatedType: args.relatedType ?? null,
        relatedId: args.relatedId ?? null,
        note: args.note ?? null,
        createdBy: args.createdBy ?? null,
      },
    ],
    session ? { session } : {}
  );
  return { movement: doc, costOfGoods };
}

/**
 * Current on-hand quantity for one branch+product (sum of all deltas).
 */
export async function currentStock(
  businessId: Id,
  branchId: Id,
  productId: Id,
  session?: ClientSession
): Promise<number> {
  const pipeline = [
    {
      $match: {
        businessId: new mongoose.Types.ObjectId(String(businessId)),
        branchId: new mongoose.Types.ObjectId(String(branchId)),
        productId: new mongoose.Types.ObjectId(String(productId)),
      },
    },
    { $group: { _id: null, qty: { $sum: "$quantityDelta" } } },
  ];
  const agg = session
    ? await StockMovement.aggregate(pipeline).session(session)
    : await StockMovement.aggregate(pipeline);
  return agg[0]?.qty ?? 0;
}

export interface StockRow {
  branchId: string;
  productId: string;
  quantity: number;
}

/**
 * On-hand quantity per branch+product across the whole business (optionally
 * narrowed to one branch). Used by the stock screen and reports.
 */
export async function stockLevels(
  businessId: Id,
  branchId?: Id | null
): Promise<StockRow[]> {
  const match: Record<string, unknown> = {
    businessId: new mongoose.Types.ObjectId(String(businessId)),
  };
  if (branchId) match.branchId = new mongoose.Types.ObjectId(String(branchId));

  const rows = await StockMovement.aggregate([
    { $match: match },
    {
      $group: {
        _id: { branchId: "$branchId", productId: "$productId" },
        quantity: { $sum: "$quantityDelta" },
      },
    },
  ]);

  return rows.map((r: { _id: { branchId: unknown; productId: unknown }; quantity: number }) => ({
    branchId: String(r._id.branchId),
    productId: String(r._id.productId),
    quantity: r.quantity,
  }));
}

/**
 * Run `fn` inside a MongoDB transaction when the deployment supports it
 * (Atlas / any replica set), transparently falling back to a plain
 * sequential run on a standalone mongod used in local dev. Transfers use
 * this so both ledger legs commit together or not at all.
 */
export async function withOptionalTransaction<T>(
  fn: (session: ClientSession | undefined) => Promise<T>
): Promise<T> {
  const session = await mongoose.startSession();
  try {
    let result: T;
    await session.withTransaction(async () => {
      result = await fn(session);
    });
    // @ts-expect-error assigned inside withTransaction
    return result;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    // Standalone mongod (no replica set) rejects transactions — retry without.
    if (
      msg.includes("Transaction numbers") ||
      msg.includes("replica set") ||
      msg.includes("not supported") ||
      msg.includes("IllegalOperation")
    ) {
      return fn(undefined);
    }
    throw err;
  } finally {
    await session.endSession();
  }
}
