import { Schema, model, models, Model, Types, Document } from "mongoose";

export interface IBranch extends Document {
  _id: Types.ObjectId;
  businessId: Types.ObjectId; // tenant this branch belongs to
  branchName: string;
  locationCity: string;
  managerId: Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}

const branchSchema = new Schema<IBranch>(
  {
    businessId: { type: Schema.Types.ObjectId, ref: "Business", required: true, index: true },
    branchName: { type: String, required: true, trim: true },
    locationCity: { type: String, required: true, trim: true },
    managerId: { type: Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

export const Branch =
  (models.Branch as Model<IBranch>) || model<IBranch>("Branch", branchSchema);
