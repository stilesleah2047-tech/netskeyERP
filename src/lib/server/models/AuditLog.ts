import { Schema, model, models, Model, Types, Document } from "mongoose";

// Append-only record of sensitive changes (who did what, to what, when).
// Pre-pilot review: owners could create owners and change prices with no
// trail. Never update or delete these rows from application code.
export interface IAuditLog extends Document {
  _id: Types.ObjectId;
  businessId: Types.ObjectId;
  actorId: Types.ObjectId;
  action: string; // e.g. "user.create", "user.deactivate", "product.update"
  targetType: string; // "User" | "Branch" | "Product" | ...
  targetId: Types.ObjectId | null;
  details: Record<string, unknown>;
  createdAt: Date;
}

const auditLogSchema = new Schema<IAuditLog>(
  {
    businessId: { type: Schema.Types.ObjectId, ref: "Business", required: true, index: true },
    actorId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    action: { type: String, required: true },
    targetType: { type: String, required: true },
    targetId: { type: Schema.Types.ObjectId, default: null },
    details: { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

auditLogSchema.index({ businessId: 1, createdAt: -1 });

export const AuditLog =
  (models.AuditLog as Model<IAuditLog>) || model<IAuditLog>("AuditLog", auditLogSchema);
