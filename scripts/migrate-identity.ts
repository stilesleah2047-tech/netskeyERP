import dotenv from "dotenv";
import path from "path";
dotenv.config({ path: path.resolve(__dirname, "../.env.local") });

import mongoose from "mongoose";
import { connectDb } from "../src/lib/server/db";
import { User } from "../src/lib/server/models/User";

// PER-BUSINESS IDENTITY migration.
//
// The app used to enforce PLATFORM-WIDE unique email / phoneNumber on the
// users collection (a single-field unique index each). The multi-tenant model
// now scopes identity to a business: the SAME email or phone may be reused by
// one user in each different business. This script drops the old single-field
// unique indexes and builds the new COMPOUND unique indexes
// ({ businessId, email } and { businessId, phoneNumber }).
//
// It is SAFE TO RE-RUN: dropping a missing index and creating an existing one
// are both no-ops here. Run once per environment after deploying the new code:
//     npm run migrate:identity

async function migrate() {
  await connectDb();
  const coll = User.collection;

  const indexes = await coll.indexes();
  // Any legacy single-field unique index on email or phoneNumber, whatever it
  // was named, gets dropped. We identify them by their key shape so we do not
  // depend on the exact auto-generated index name.
  for (const idx of indexes) {
    const keys = Object.keys(idx.key);
    const isSingle = keys.length === 1;
    const onIdentity = keys[0] === "email" || keys[0] === "phoneNumber";
    if (isSingle && onIdentity && idx.unique) {
      // eslint-disable-next-line no-await-in-loop
      await coll.dropIndex(idx.name as string);
      console.log(`Dropped legacy platform-wide unique index: ${idx.name}`);
    }
  }

  // Build the new per-business compound unique indexes (model-defined). This
  // will fail loudly if the existing data actually violates per-business
  // uniqueness, which is exactly what we want to learn before going live.
  await User.syncIndexes();
  console.log("Built per-business unique indexes: {businessId,email}, {businessId,phoneNumber}");

  const after = await coll.indexes();
  console.log("Current user indexes:");
  for (const idx of after) {
    console.log(`  ${idx.name}: ${JSON.stringify(idx.key)}${idx.unique ? " (unique)" : ""}`);
  }

  await mongoose.disconnect();
  process.exit(0);
}

migrate().catch((err) => {
  console.error("identity migration failed:", err?.message ?? err);
  console.error(
    "If this reports a duplicate-key error, two users in the SAME business share an email or phone — fix that data, then re-run."
  );
  process.exit(1);
});
