import { Schema, model, models, Model, Types, Document } from "mongoose";

// A one-time staff invitation. Owners (and managers, for their own branch's
// delivery staff) create an invite instead of setting someone's password
// for them. We store only the SHA-256 hash of the token — the raw token is
// shown to the inviter once (to paste into WhatsApp) and never persisted.
// The invitee opens the link, sets their own name/phone/password, and the
// invite is consumed. Invites expire after a fixed window.
export interface IInvite extends Document {
  _id: Types.ObjectId;
  businessId: Types.ObjectId;
  branchId: Types.ObjectId | null; // null only for SUPER_ADMIN invites
  role: "DELIVERY" | "BRANCH_MANAGER" | "SUPER_ADMIN";
  email: string | null; // optional pre-fill / restriction
  tokenHash: string;
  expiresAt: Date;
  acceptedAt: Date | null;
  acceptedUserId: Types.ObjectId | null;
  createdBy: Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}

const inviteSchema = new Schema<IInvite>(
  {
    businessId: { type: Schema.Types.ObjectId, ref: "Business", required: true, index: true },
    branchId: { type: Schema.Types.ObjectId, ref: "Branch", default: null },
    role: {
      type: String,
      enum: ["DELIVERY", "BRANCH_MANAGER", "SUPER_ADMIN"],
      required: true,
    },
    email: { type: String, default: null, lowercase: true, trim: true },
    tokenHash: { type: String, required: true, index: true },
    expiresAt: { type: Date, required: true },
    acceptedAt: { type: Date, default: null },
    acceptedUserId: { type: Schema.Types.ObjectId, ref: "User", default: null },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

inviteSchema.index({ businessId: 1, createdAt: -1 });

export const Invite =
  (models.Invite as Model<IInvite>) || model<IInvite>("Invite", inviteSchema);

// Days an invitation link stays valid.
export const INVITE_TTL_DAYS = 7;
