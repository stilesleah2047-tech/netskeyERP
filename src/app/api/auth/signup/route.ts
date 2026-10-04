import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import mongoose from "mongoose";
import { connectDb } from "@/lib/server/db";
import { User } from "@/lib/server/models/User";
import { Business } from "@/lib/server/models/Business";
import { Product } from "@/lib/server/models/Product";
import { UserSession } from "@/lib/server/models/UserSession";
import { signAccessToken, generateRefreshToken, hashRefreshToken, refreshTtlMs } from "@/lib/server/jwt";
import { ACCESS_COOKIE, REFRESH_COOKIE, accessCookieOptions, refreshCookieOptions } from "@/lib/server/auth";
import { normalizeKenyanPhone } from "@/lib/server/phone";

export const runtime = "nodejs";

/**
 * Owner self-signup — the ONLY way a new tenant (Business) enters the
 * system. It atomically:
 *   1. creates the Business,
 *   2. creates the owner as a SUPER_ADMIN (branchId = null) bound to it,
 *   3. seeds a default water + eggs product catalog scoped to the business,
 *   4. logs the owner straight in (session + cookies), same as /login.
 *
 * Branches and branch managers are created LATER by the owner from the
 * admin UI; delivery staff are then added by branch managers. Signup only
 * bootstraps the tenant and its first user.
 */
const signupSchema = z.object({
  businessName: z.string().min(2).max(120),
  ownerName: z.string().min(2).max(120),
  email: z.string().email(),
  phoneNumber: z.string().min(1),
  password: z.string().min(8, "Password must be at least 8 characters"),
  deviceId: z.string().uuid(),
  deviceLabel: z.string().max(120).optional(),
});

const DEFAULT_CATALOG = [
  { label: "5L Jerrycan", sizeLiters: 5, unit: "L", category: "Water", unitPrice: 60, sortOrder: 1 },
  { label: "10L Jerrycan", sizeLiters: 10, unit: "L", category: "Water", unitPrice: 110, sortOrder: 2 },
  { label: "20L Jerrycan", sizeLiters: 20, unit: "L", category: "Water", unitPrice: 200, sortOrder: 3 },
  { label: "Tray of Eggs (30)", sizeLiters: 30, unit: "pcs", category: "Eggs", unitPrice: 400, sortOrder: 4 },
  { label: "Half Tray (15)", sizeLiters: 15, unit: "pcs", category: "Eggs", unitPrice: 210, sortOrder: 5 },
  { label: "Single Egg", sizeLiters: 1, unit: "pcs", category: "Eggs", unitPrice: 15, sortOrder: 6 },
];

export async function POST(req: NextRequest) {
  await connectDb();

  const json = await req.json().catch(() => null);
  const parsed = signupSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
  }
  const { businessName, ownerName, email, phoneNumber, password, deviceId, deviceLabel } = parsed.data;

  let normalizedPhone: string;
  try {
    normalizedPhone = normalizeKenyanPhone(phoneNumber);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }

  const lowerEmail = email.toLowerCase();

  // Email + phone are globally unique across all tenants (login is by
  // email alone, with no tenant selector), so reject collisions early
  // with a friendly message rather than a raw duplicate-key error.
  const emailTaken = await User.findOne({ email: lowerEmail }).lean();
  if (emailTaken) {
    return NextResponse.json({ error: "An account with this email already exists." }, { status: 409 });
  }
  const phoneTaken = await User.findOne({ phoneNumber: normalizedPhone }).lean();
  if (phoneTaken) {
    return NextResponse.json({ error: "An account with this phone number already exists." }, { status: 409 });
  }

  const passwordHash = await bcrypt.hash(password, 12);

  // Create owner first (with a temporary businessId), then the business,
  // then point the owner at the real business id and persist. This avoids
  // a chicken-and-egg between User.businessId (required) and
  // Business.ownerId (required).
  const ownerId = new mongoose.Types.ObjectId();
  const businessId = new mongoose.Types.ObjectId();

  const business = new Business({ _id: businessId, name: businessName.trim(), ownerId });
  const owner = new User({
    _id: ownerId,
    businessId,
    name: ownerName.trim(),
    role: "SUPER_ADMIN",
    branchId: null,
    phoneNumber: normalizedPhone,
    email: lowerEmail,
    passwordHash,
  });

  try {
    await business.save();
    await owner.save();
  } catch (e) {
    // Roll back a partial create so a failed signup never leaves an
    // orphaned business or user behind.
    await Business.deleteOne({ _id: businessId }).catch(() => {});
    await User.deleteOne({ _id: ownerId }).catch(() => {});
    const msg = (e as Error).message || "";
    if (msg.includes("duplicate key")) {
      return NextResponse.json({ error: "An account with this email or phone already exists." }, { status: 409 });
    }
    return NextResponse.json({ error: "Could not create your business. Please try again." }, { status: 500 });
  }

  // Seed the default catalog for the new tenant.
  await Product.insertMany(DEFAULT_CATALOG.map((p) => ({ ...p, businessId })));

  // Auto-login: create the session + issue cookies, exactly like /login.
  const refreshToken = generateRefreshToken();
  const refreshTokenHash = hashRefreshToken(refreshToken);
  const expiresAt = new Date(Date.now() + refreshTtlMs());
  await UserSession.findOneAndUpdate(
    { userId: owner._id, deviceId },
    { refreshTokenHash, expiresAt, deviceLabel: deviceLabel ?? null, lastUsedAt: new Date() },
    { upsert: true, new: true }
  );

  const accessToken = signAccessToken({
    sub: owner._id.toString(),
    businessId: businessId.toString(),
    role: owner.role,
    branchId: null,
    deviceId,
  });

  const res = NextResponse.json({
    user: {
      id: owner._id,
      name: owner.name,
      role: owner.role,
      businessId,
      businessName: business.name,
      branchId: null,
      branchName: null,
      phoneNumber: owner.phoneNumber,
      email: owner.email,
    },
    redirectTo: "/admin/dashboard",
  });
  res.cookies.set(ACCESS_COOKIE, accessToken, accessCookieOptions());
  res.cookies.set(REFRESH_COOKIE, refreshToken, refreshCookieOptions(Math.floor(refreshTtlMs() / 1000)));
  return res;
}
