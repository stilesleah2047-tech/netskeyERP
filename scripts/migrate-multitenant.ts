import dotenv from "dotenv";
import path from "path";
dotenv.config({ path: path.resolve(__dirname, "../.env.local") });

import mongoose from "mongoose";
import { connectDb } from "../src/lib/server/db";
import { User } from "../src/lib/server/models/User";
import { Branch } from "../src/lib/server/models/Branch";
import { Product, BranchPricing } from "../src/lib/server/models/Product";
import { Transaction } from "../src/lib/server/models/Transaction";
import { DailyInventory } from "../src/lib/server/models/DailyInventory";
import { Expense } from "../src/lib/server/models/Expense";
import { Purchase } from "../src/lib/server/models/Purchase";
import { Business } from "../src/lib/server/models/Business";
import { DEFAULT_TIER, TRIAL_DAYS } from "../src/lib/tiers";

async function migrate() {
  await connectDb();

  const owner = await User.findOne({ role: "SUPER_ADMIN" }).sort({ createdAt: 1 });
  if (!owner) {
    console.error(
      "No SUPER_ADMIN found. Create one via the /signup page, or run `npm run seed` first, then re-run this migration."
    );
    await mongoose.disconnect();
    process.exit(1);
  }

  const businessName = process.env.SEED_BUSINESS_NAME || "My Business";

  let business = await Business.findOne({ ownerId: owner._id });
  if (!business) {
    business = await Business.create({
      name: businessName,
      ownerId: owner._id,
      tier: DEFAULT_TIER,
      subscriptionStatus: "TRIALING",
      trialEndsAt: new Date(Date.now() + TRIAL_DAYS * 24 * 60 * 60 * 1000),
    });
    console.log(`Created business "${business.name}" (${business._id}) owned by ${owner.email}`);
  } else {
    const patch: Record<string, unknown> = {};
    if (!business.tier) patch.tier = DEFAULT_TIER;
    if (!business.subscriptionStatus) patch.subscriptionStatus = "TRIALING";
    if (!business.trialEndsAt) patch.trialEndsAt = new Date(Date.now() + TRIAL_DAYS * 24 * 60 * 60 * 1000);
    if (Object.keys(patch).length > 0) {
      await Business.updateOne({ _id: business._id }, { $set: patch });
      console.log(`Patched subscription fields on existing business "${business.name}"`);
    }
    console.log(`Reusing existing business "${business.name}" (${business._id})`);
  }
  const businessId = business._id;

  const filter = { businessId: { $exists: false } } as Record<string, unknown>;
  const set = { $set: { businessId } };

  const collections: [string, mongoose.Model<any>][] = [
    ["users", User],
    ["branches", Branch],
    ["products", Product],
    ["branchpricings", BranchPricing],
    ["transactions", Transaction],
    ["dailyinventories", DailyInventory],
    ["expenses", Expense],
    ["purchases", Purchase],
  ];

  for (const [label, Model] of collections) {
    const res = await Model.updateMany(filter, set);
    console.log(`  ${label}: updated ${res.modifiedCount} document(s)`);
  }

  console.log("Migration complete. All legacy data now belongs to:", business.name);
  await mongoose.disconnect();
  process.exit(0);
}

migrate().catch((err) => {
  console.error("migration failed:", err.message);
  process.exit(1);
});