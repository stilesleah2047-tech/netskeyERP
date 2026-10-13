import { Schema, model, models, Model, Types, Document } from "mongoose";

// A single immutable entry in the stock ledger. Every change to on-hand
// stock is recorded here exactly once: a purchase, a sale, the two legs of a
// transfer, or a manual adjustment (physical count / write-off). On-hand
// stock for a branch+product is simply the sum of `quantityDelta` over all
// its movements — there is no separately-stored running total to drift.
//
// Inbound movements (PURCHASE / TRANSFER_IN / positive ADJUSTMENT) also act
// as FIFO cost layers: `unitCost` is the buying price of those units and
// `remainingQty` is how many of them are still unsold. Outbound movements
// (SALE / TRANSFER_OUT / negative ADJUSTMENT) consume the oldest layers
// first and record the money value they removed in `costOfGoods`.
export type MovementType =
  | "PURCHASE"
  | "SALE"
  | "TRANSFER_IN"
  | "TRANSFER_OUT"
  | "ADJUSTMENT";

export const MOVEMENT_TYPES: MovementType[] = [
  "PURCHASE",
  "SALE",
  "TRANSFER_IN",
  "TRANSFER_OUT",
  "ADJUSTMENT",
];

export interface IStockMovement extends Document {
  _id: Types.ObjectId;
  businessId: Types.ObjectId;
  branchId: Types.ObjectId;
  productId: Types.ObjectId;
  type: MovementType;
  // Signed change to on-hand stock: positive = stock in, negative = stock out.
  quantityDelta: number;
  // For inbound layers: buying price per unit. For outbound movements: the
  // weighted cost per unit that was actually consumed (costOfGoods/|delta|).
  unitCost: number;
  // FIFO bookkeeping — only meaningful on inbound layers. Starts equal to
  // quantityDelta and is decremented as later outbound movements consume it.
  remainingQty: number;
  // Total money value removed by an outbound movement (0 for inbound).
  costOfGoods: number;
  // What produced this movement, for auditing / linking back.
  relatedType: "PURCHASE" | "TRANSACTION" | "TRANSFER" | "ADJUSTMENT" | null;
  relatedId: Types.ObjectId | null;
  note: string | null;
  createdBy: Types.ObjectId | null;
  createdAt: Date; // authoritative — server clock
  updatedAt: Date;
}

const stockMovementSchema = new Schema<IStockMovement>(
  {
    businessId: { type: Schema.Types.ObjectId, ref: "Business", required: true, index: true },
    branchId: { type: Schema.Types.ObjectId, ref: "Branch", required: true },
    productId: { type: Schema.Types.ObjectId, ref: "Product", required: true },
    type: { type: String, enum: MOVEMENT_TYPES, required: true },
    quantityDelta: { type: Number, required: true },
    unitCost: { type: Number, required: true, default: 0, min: 0 },
    remainingQty: { type: Number, required: true, default: 0 },
    costOfGoods: { type: Number, required: true, default: 0 },
    relatedType: {
      type: String,
      enum: ["PURCHASE", "TRANSACTION", "TRANSFER", "ADJUSTMENT", null],
      default: null,
    },
    relatedId: { type: Schema.Types.ObjectId, default: null },
    note: { type: String, default: null, trim: true },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

// On-hand lookups: "this branch + product, in order" (also used by FIFO to
// walk the oldest open layers first).
stockMovementSchema.index({ businessId: 1, branchId: 1, productId: 1, createdAt: 1 });
// COGS-in-range reporting scans sales by business and date.
stockMovementSchema.index({ businessId: 1, type: 1, createdAt: 1 });

export const StockMovement =
  (models.StockMovement as Model<IStockMovement>) ||
  model<IStockMovement>("StockMovement", stockMovementSchema);
