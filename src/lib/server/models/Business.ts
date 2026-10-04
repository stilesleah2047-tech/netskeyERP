import { Schema, model, models, Model, Types, Document } from "mongoose";

/**
 * A Business is the top-level tenant in the system. Every other record
 * (users, branches, products, sales, inventory, expenses, purchases)
 * belongs to exactly one Business via a required `businessId`, and every
 * query is scoped by it. This is what lets many independent companies use
 * the same deployment without ever seeing each other's data.
 *
 * The owner is the first user created at sign-up: a SUPER_ADMIN with no
 * branch assignment (branchId = null) who can see and manage ALL branches
 * within their own business.
 */
export interface IBusiness extends Document {
  _id: Types.ObjectId;
  name: string;
  ownerId: Types.ObjectId; // the SUPER_ADMIN who created the business
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const businessSchema = new Schema<IBusiness>(
  {
    name: { type: String, required: true, trim: true },
    ownerId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

export const Business =
  (models.Business as Model<IBusiness>) || model<IBusiness>("Business", businessSchema);
