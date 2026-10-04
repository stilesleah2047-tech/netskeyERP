import dotenv from "dotenv";
import path from "path";
// Plain `dotenv` only auto-loads a file literally named `.env` — it does
// NOT know about Next.js's `.env.local` convention. This script runs
// standalone via tsx (outside Next.js's own env loading), so it has to
// point dotenv at `.env.local` explicitly, or every var here silently
// stays undefined even when the file exists and is filled in correctly.
dotenv.config({ path: path.resolve(__dirname, "../.env.local") });

import bcrypt from "bcryptjs";
import mongoose from "mongoose";
import { connectDb } from "../src/lib/server/db";
import { User } from "../src/lib/server/models/User";
import { Product } from "../src/lib/server/models/Product";
import { Business } from "../src/lib/server/models/Business";

/**
 * Run once against a fresh database: `npm run seed`.
 * Creates the first SUPER_ADMIN (email/password, from env) so there's a
 * way into the single /login page at all, and seeds a default jerrycan
 * size catalog. Safe to re-run — it's idempotent (skips if already
 * present).
 */
async function seed() {
  await connectDb();

  const email = process.env.SEED_SUPER_ADMIN_EMAIL;
  const password = process.env.SEED_SUPER_ADMIN_PASSWORD;

  // Everything the demo seed creates belongs to one demo Business tenant.
  // In the live product, businesses are created via owner self-signup at
  // /signup; this seed just mirrors that shape for a fresh local DB.
  const demoBusinessName = process.env.SEED_BUSINESS_NAME || "Demo Water & Eggs Co.";

  if (!email || !password) {
    console.error("SEED_SUPER_ADMIN_EMAIL / SEED_SUPER_ADMIN_PASSWORD not set — nothing to seed for auth.");
    await mongoose.disconnect();
    process.exit(0);
  }

  let business = await Business.findOne({ name: demoBusinessName });
  const existing = await User.findOne({ email });

  if (existing) {
    console.log(`Super admin (${email}) already exists, skipping`);
    if (!business) {
      // Backfill a business for a legacy single-tenant admin if needed.
      business = await Business.create({ name: demoBusinessName, ownerId: existing._id });
      existing.businessId = business._id;
      await existing.save();
      console.log(`Linked existing super admin to new business "${demoBusinessName}"`);
    }
  } else {
    const passwordHash = await bcrypt.hash(password, 12);
    // Create the owner first with a placeholder business, then the
    // business, then point them at each other — mirrors signup ordering.
    const owner = new User({
      name: "Super Admin",
      role: "SUPER_ADMIN",
      branchId: null,
      phoneNumber: "254700000000",
      email,
      passwordHash,
      businessId: new mongoose.Types.ObjectId(), // temporary, overwritten below
    });
    business = await Business.create({ name: demoBusinessName, ownerId: owner._id });
    owner.businessId = business._id;
    await owner.save();
    console.log(`Business "${demoBusinessName}" + super admin created (${email}) — change the password after first login`);
  }

  const businessId = business!._id;

  const existingProducts = await Product.countDocuments({ businessId });
  if (existingProducts === 0) {
    await Product.insertMany([
      // Water catalog
      { businessId, label: "5L Jerrycan", sizeLiters: 5, unit: "L", category: "Water", unitPrice: 60, sortOrder: 1 },
      { businessId, label: "10L Jerrycan", sizeLiters: 10, unit: "L", category: "Water", unitPrice: 110, sortOrder: 2 },
      { businessId, label: "20L Jerrycan", sizeLiters: 20, unit: "L", category: "Water", unitPrice: 200, sortOrder: 3 },
      // Eggs catalog
      { businessId, label: "Tray of Eggs (30)", sizeLiters: 30, unit: "pcs", category: "Eggs", unitPrice: 400, sortOrder: 4 },
      { businessId, label: "Half Tray (15)", sizeLiters: 15, unit: "pcs", category: "Eggs", unitPrice: 210, sortOrder: 5 },
      { businessId, label: "Single Egg", sizeLiters: 1, unit: "pcs", category: "Eggs", unitPrice: 15, sortOrder: 6 },
    ]);
    console.log("Seeded default product catalog (water 5L/10L/20L + eggs tray/half/single)");
  } else {
    console.log("Products already exist for this business, skipping catalog seed");
  }

  await mongoose.disconnect();
  process.exit(0);
}

seed().catch((err) => {
  console.error("seed failed:", err.message);
  process.exit(1);
});
