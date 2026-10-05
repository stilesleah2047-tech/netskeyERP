import { Schema, model, models, Model, Types, Document } from "mongoose";
import { DEFAULT_TIER, type TierId, type SubscriptionStatus } from "@/lib/tiers";

export interface IBusiness extends Document {
  _id: Types.ObjectId;
  name: string;
  ownerId: Types.ObjectId;
  isActive: boolean;
  tier: TierId;
  subscriptionStatus: SubscriptionStatus;
  trialEndsAt: Date | null;
  currentPeriodEnd: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const businessSchema = new Schema<IBusiness>(
  {
    name: { type: String, required: true, trim: true },
    ownerId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    isActive: { type: Boolean, default: true },
    tier: {
      type: String,
      enum: ["STARTER", "GROWTH", "ENTERPRISE"],
      default: DEFAULT_TIER,
    },
    subscriptionStatus: {
      type: String,
      enum: ["TRIALING", "ACTIVE", "PAST_DUE", "SUSPENDED"],
      default: "TRIALING",
    },
    trialEndsAt: { type: Date, default: null },
    currentPeriodEnd: { type: Date, default: null },
  },
  { timestamps: true }
);

export const Business =
  (models.Business as Model<IBusiness>) || model<IBusiness>("Business", businessSchema);