import { Schema, model, models, Model, Types, Document } from "mongoose";

// An inter-branch stock movement: `quantity` units of a product leave
// `fromBranchId` and arrive at `toBranchId`. The two stock-ledger legs
// (TRANSFER_OUT at the source, TRANSFER_IN at the destination) carry the
// cost that FIFO consumed, so a transfer never invents or loses value.
// Both legs and this record are written inside one database transaction,
// so a transfer is all-or-nothing and two simultaneous transfers can never
// overdraw the source branch.
export interface IStockTransfer extends Document {
  _id: Types.ObjectId;
  businessId: Types.ObjectId;
  fromBranchId: Types.ObjectId;
  toBranchId: Types.ObjectId;
  productId: Types.ObjectId;
  quantity: number;
  costTotal: number; // total FIFO cost that moved with the units
  note: string | null;
  createdBy: Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}

const stockTransferSchema = new Schema<IStockTransfer>(
  {
    businessId: { type: Schema.Types.ObjectId, ref: "Business", required: true, index: true },
    fromBranchId: { type: Schema.Types.ObjectId, ref: "Branch", required: true },
    toBranchId: { type: Schema.Types.ObjectId, ref: "Branch", required: true },
    productId: { type: Schema.Types.ObjectId, ref: "Product", required: true },
    quantity: { type: Number, required: true, min: 1 },
    costTotal: { type: Number, required: true, default: 0, min: 0 },
    note: { type: String, default: null, trim: true },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

stockTransferSchema.index({ businessId: 1, createdAt: -1 });

export const StockTransfer =
  (models.StockTransfer as Model<IStockTransfer>) ||
  model<IStockTransfer>("StockTransfer", stockTransferSchema);
