import { Schema, model, models, Model, Types, Document } from "mongoose";

// Business expense categories. Kept as a constrained string set so the UI
// can offer a dropdown while the owner can still extend later via code.
export const EXPENSE_CATEGORIES = [
  "Transport",
  "Electricity",
  "Rent",
  "Salaries",
  "Repairs",
  "Packaging",
  "Other",
] as const;
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

export interface IExpense extends Document {
  _id: Types.ObjectId;
  businessId: Types.ObjectId; // tenant this expense belongs to
  branchId: Types.ObjectId;
  category: ExpenseCategory;
  amount: number;
  description: string;
  reference: string | null;
  notes: string | null;
  recordedBy: Types.ObjectId;
  createdAt: Date; // authoritative — server clock
  updatedAt: Date;
}

const expenseSchema = new Schema<IExpense>(
  {
    businessId: { type: Schema.Types.ObjectId, ref: "Business", required: true, index: true },
    branchId: { type: Schema.Types.ObjectId, ref: "Branch", required: true },
    category: { type: String, enum: EXPENSE_CATEGORIES, required: true },
    amount: { type: Number, required: true, min: 0 },
    description: { type: String, required: true, trim: true },
    reference: { type: String, default: null, trim: true },
    notes: { type: String, default: null, trim: true },
    recordedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true } // createdAt/updatedAt from the server clock, never client input
);

expenseSchema.index({ branchId: 1, createdAt: -1 });
expenseSchema.index({ category: 1 });

// `models.Expense` guard avoids OverwriteModelError on serverless warm
// re-invocations where the module is evaluated more than once.
export const Expense =
  (models.Expense as Model<IExpense>) || model<IExpense>("Expense", expenseSchema);
