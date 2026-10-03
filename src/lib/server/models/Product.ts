import { Schema, model, models, Model, Types, Document } from "mongoose";

export interface IProduct extends Document {
  _id: Types.ObjectId;
  label: string;
  sizeLiters: number;
  unit: string; // display unit, e.g. "L" for water, "pcs" / "tray" for eggs
  category: string; // e.g. "Water", "Eggs"
  unitPrice: number;
  sortOrder: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const productSchema = new Schema<IProduct>(
  {
    label: { type: String, required: true, trim: true },
    sizeLiters: { type: Number, required: true, min: 0.1 },
    unit: { type: String, default: "L", trim: true },
    category: { type: String, default: "Water", trim: true },
    unitPrice: { type: Number, required: true, min: 0 },
    sortOrder: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true, index: true },
  },
  { timestamps: true }
);

export const Product =
  (models.Product as Model<IProduct>) || model<IProduct>("Product", productSchema);

// Branch-specific price override — optional, falls back to Product.unitPrice.
export interface IBranchPricing extends Document {
  branchId: Types.ObjectId;
  productId: Types.ObjectId;
  unitPrice: number;
  updatedAt: Date;
}

const branchPricingSchema = new Schema<IBranchPricing>(
  {
    branchId: { type: Schema.Types.ObjectId, ref: "Branch", required: true },
    productId: { type: Schema.Types.ObjectId, ref: "Product", required: true },
    unitPrice: { type: Number, required: true, min: 0 },
  },
  { timestamps: { createdAt: false, updatedAt: true } }
);
branchPricingSchema.index({ branchId: 1, productId: 1 }, { unique: true });

export const BranchPricing =
  (models.BranchPricing as Model<IBranchPricing>) ||
  model<IBranchPricing>("BranchPricing", branchPricingSchema);
