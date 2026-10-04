import { Schema, model, models, Model, Types, Document } from "mongoose";

// A recorded stock purchase from a supplier. Completing a purchase is what
// increases branch stock. Price fields are snapshotted onto the record so
// historical purchases never change when a product's price changes later.
export interface IPurchase extends Document {
  _id: Types.ObjectId;
  businessId: Types.ObjectId; // tenant this purchase belongs to
  branchId: Types.ObjectId;
  supplierName: string;
  productId: Types.ObjectId | null;
  productLabel: string; // snapshot of the product name at purchase time
  quantity: number;
  unitCost: number; // buying price, snapshotted
  totalCost: number; // quantity * unitCost, snapshotted
  reference: string | null;
  notes: string | null;
  recordedBy: Types.ObjectId;
  createdAt: Date; // authoritative — server clock
  updatedAt: Date;
}

const purchaseSchema = new Schema<IPurchase>(
  {
    businessId: { type: Schema.Types.ObjectId, ref: "Business", required: true, index: true },
    branchId: { type: Schema.Types.ObjectId, ref: "Branch", required: true },
    supplierName: { type: String, required: true, trim: true },
    productId: { type: Schema.Types.ObjectId, ref: "Product", default: null },
    productLabel: { type: String, required: true, trim: true },
    quantity: { type: Number, required: true, min: 1 },
    unitCost: { type: Number, required: true, min: 0 },
    totalCost: { type: Number, required: true, min: 0 },
    reference: { type: String, default: null, trim: true },
    notes: { type: String, default: null, trim: true },
    recordedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true }
);

purchaseSchema.index({ branchId: 1, createdAt: -1 });
purchaseSchema.index({ productId: 1 });

export const Purchase =
  (models.Purchase as Model<IPurchase>) || model<IPurchase>("Purchase", purchaseSchema);
