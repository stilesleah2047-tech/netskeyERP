import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { connectDb } from "@/lib/server/db";
import { User, IUser } from "@/lib/server/models/User";
import { UserSession } from "@/lib/server/models/UserSession";
import { Branch } from "@/lib/server/models/Branch";
import { Business } from "@/lib/server/models/Business";
import { signAccessToken, generateRefreshToken, hashRefreshToken, refreshTtlMs } from "@/lib/server/jwt";
import { ACCESS_COOKIE, REFRESH_COOKIE, accessCookieOptions, refreshCookieOptions } from "@/lib/server/auth";
import { isPlatformAdminEmail } from "@/lib/server/platform";
import { getEnv } from "@/lib/server/env";

export const runtime = "nodejs";

const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_MS = 15 * 60 * 1000;

// PER-BUSINESS IDENTITY: the same email can now belong to one user in each of
// several businesses. `businessId` is optional — when the email resolves to a
// single business we log straight in; when it resolves to several we return a
// business picker and the client re-submits with the chosen `businessId`.
const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  deviceId: z.string().uuid(),
  deviceLabel: z.string().max(120).optional(),
  businessId: z.string().min(1).optional(),
});

async function enforceDeviceBinding(userId: string, deviceId: string) {
  const env = getEnv();
  const existing = await UserSession.find({ userId }).sort({ lastUsedAt: -1 }).lean();
  const alreadyBound = existing.some((s) => s.deviceId === deviceId);
  if (alreadyBound || existing.length < env.DELIVERY_MAX_DEVICES) {
    return { allowed: true as const };
  }
  return {
    allowed: false as const,
    activeDevices: existing.map((s) => ({ deviceId: s.deviceId, label: s.deviceLabel, lastUsedAt: s.lastUsedAt })),
  };
}

// Build the full success response for an authenticated user: binds the
// device, issues tokens, sets cookies. Shared by the single-business and
// business-picker paths so there is exactly one login finalisation code path.
async function finalizeLogin(
  user: IUser,
  deviceId: string,
  deviceLabel: string | undefined
): Promise<NextResponse> {
  if (user.role === "DELIVERY") {
    const binding = await enforceDeviceBinding(user._id.toString(), deviceId);
    if (!binding.allowed) {
      return NextResponse.json(
        {
          error: `This account is already active on ${getEnv().DELIVERY_MAX_DEVICES} device(s). Log out one to continue.`,
          activeDevices: binding.activeDevices,
        },
        { status: 409 }
      );
    }
  }

  const refreshToken = generateRefreshToken();
  const refreshTokenHash = hashRefreshToken(refreshToken);
  const expiresAt = new Date(Date.now() + refreshTtlMs());

  await UserSession.findOneAndUpdate(
    { userId: user._id, deviceId },
    { refreshTokenHash, expiresAt, deviceLabel: deviceLabel ?? null, lastUsedAt: new Date() },
    { upsert: true, new: true }
  );

  const accessToken = signAccessToken({
    sub: user._id.toString(),
    businessId: user.businessId.toString(),
    role: user.role,
    branchId: user.branchId ? user.branchId.toString() : null,
    deviceId,
  });

  const branch = user.branchId ? await Branch.findById(user.branchId).lean() : null;
  const business = await Business.findById(user.businessId).lean();

  const res = NextResponse.json({
    user: {
      id: user._id,
      name: user.name,
      role: user.role,
      businessId: user.businessId,
      businessName: business?.name ?? null,
      branchId: user.branchId,
      branchName: branch?.branchName ?? null,
      phoneNumber: user.phoneNumber,
      email: user.email,
    },
    redirectTo: user.role === "DELIVERY" ? "/terminal" : "/admin/dashboard",
    isPlatformAdmin: isPlatformAdminEmail(user.email),
  });

  res.cookies.set(ACCESS_COOKIE, accessToken, accessCookieOptions());
  res.cookies.set(REFRESH_COOKIE, refreshToken, refreshCookieOptions(Math.floor(refreshTtlMs() / 1000)));
  return res;
}

// Full single-account login with lockout accounting. Used when we already
// know exactly which user (one candidate, or a business was picked).
async function loginSingle(
  user: IUser,
  password: string,
  deviceId: string,
  deviceLabel: string | undefined
): Promise<NextResponse> {
  if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
    const minutesLeft = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60000);
    return NextResponse.json({ error: `Account locked. Try again in ${minutesLeft} minute(s).` }, { status: 423 });
  }

  const validPassword = await user.comparePassword(password);
  if (!validPassword) {
    user.failedLoginAttempts += 1;
    if (user.failedLoginAttempts >= MAX_FAILED_ATTEMPTS) {
      user.lockedUntil = new Date(Date.now() + LOCKOUT_MS);
      user.failedLoginAttempts = 0;
    }
    await user.save();
    return NextResponse.json({ error: "Incorrect email or password" }, { status: 401 });
  }

  user.failedLoginAttempts = 0;
  user.lockedUntil = null;
  await user.save();

  return finalizeLogin(user, deviceId, deviceLabel);
}

export async function POST(req: NextRequest) {
  await connectDb();

  const json = await req.json().catch(() => null);
  const parsed = loginSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
  }
  const { email, password, deviceId, deviceLabel, businessId } = parsed.data;
  const lowerEmail = email.toLowerCase();

  // The caller already chose a business (second step of the picker), or the
  // email is unambiguous — resolve to that single account.
  if (businessId) {
    const user = await User.findOne({ email: lowerEmail, businessId }).select("+passwordHash");
    if (!user || !user.isActive) {
      return NextResponse.json({ error: "Incorrect email or password" }, { status: 401 });
    }
    return loginSingle(user, password, deviceId, deviceLabel);
  }

  // Find every active account using this email across all businesses.
  const candidates = await User.find({ email: lowerEmail, isActive: true }).select("+passwordHash");

  if (candidates.length === 0) {
    return NextResponse.json({ error: "Incorrect email or password" }, { status: 401 });
  }
  if (candidates.length === 1) {
    // Unambiguous — behave exactly like the classic single-account login,
    // including lockout accounting.
    return loginSingle(candidates[0], password, deviceId, deviceLabel);
  }

  // Multiple businesses share this email. Figure out which ones this password
  // actually unlocks (skipping locked accounts so we never leak their state).
  const matches: IUser[] = [];
  for (const u of candidates) {
    if (u.lockedUntil && u.lockedUntil.getTime() > Date.now()) continue;
    // eslint-disable-next-line no-await-in-loop
    if (await u.comparePassword(password)) matches.push(u);
  }

  if (matches.length === 0) {
    return NextResponse.json({ error: "Incorrect email or password" }, { status: 401 });
  }
  if (matches.length === 1) {
    const user = matches[0];
    user.failedLoginAttempts = 0;
    user.lockedUntil = null;
    await user.save();
    return finalizeLogin(user, deviceId, deviceLabel);
  }

  // Same email + password in more than one business: ask which to enter.
  const businesses = await Business.find({
    _id: { $in: matches.map((m) => m.businessId) },
  })
    .select("name")
    .lean();
  const nameMap = new Map(businesses.map((b) => [b._id.toString(), b.name]));

  return NextResponse.json({
    needsBusinessSelection: true,
    businesses: matches.map((m) => ({
      businessId: m.businessId.toString(),
      businessName: nameMap.get(m.businessId.toString()) ?? "(unnamed business)",
    })),
  });
}
