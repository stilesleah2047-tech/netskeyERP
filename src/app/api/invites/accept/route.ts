import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { connectDb } from "@/lib/server/db";
import { Invite } from "@/lib/server/models/Invite";
import { User } from "@/lib/server/models/User";
import { Branch } from "@/lib/server/models/Branch";
import { Business } from "@/lib/server/models/Business";
import { UserSession } from "@/lib/server/models/UserSession";
import { normalizeKenyanPhone } from "@/lib/server/phone";
import { loadTier, userLimitError } from "@/lib/server/subscription";
import {
  signAccessToken,
  generateRefreshToken,
  hashRefreshToken,
  refreshTtlMs,
} from "@/lib/server/jwt";
import {
  ACCESS_COOKIE,
  REFRESH_COOKIE,
  accessCookieOptions,
  refreshCookieOptions,
} from "@/lib/server/auth";
import { hashToken } from "@/lib/server/invites";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Public endpoint — no auth. The one-time token in the link IS the
// authorisation. We only ever match on the SHA-256 hash of the token; the raw
// value never touches the database.

// Look up a still-valid invite by its raw token. Returns null when the token
// is unknown, already used, or expired.
async function findValidInvite(rawToken: string) {
  if (!rawToken) return null;
  const invite = await Invite.findOne({ tokenHash: hashToken(rawToken) });
  if (!invite) return null;
  if (invite.acceptedAt) return null;
  if (invite.expiresAt.getTime() <= Date.now()) return null;
  return invite;
}

// GET /api/invites/accept?token=...
// Preview the invitation so the join page can show who it is for before the
// person fills anything in. Never leaks the token hash or other invites.
export async function GET(req: NextRequest) {
  await connectDb();
  const token = new URL(req.url).searchParams.get("token") ?? "";
  const invite = await findValidInvite(token);
  if (!invite) {
    return NextResponse.json(
      { error: "This invitation link is invalid, already used, or has expired." },
      { status: 404 }
    );
  }

  const [business, branch] = await Promise.all([
    Business.findById(invite.businessId).select("name").lean(),
    invite.branchId ? Branch.findById(invite.branchId).select("branchName").lean() : null,
  ]);

  return NextResponse.json({
    invite: {
      role: invite.role,
      email: invite.email,
      businessName: business?.name ?? null,
      branchName: branch?.branchName ?? null,
    },
  });
}

const acceptSchema = z.object({
  token: z.string().min(1),
  name: z.string().trim().min(1).max(120),
  phoneNumber: z.string().min(9).max(15),
  password: z.string().min(8, "Password must be at least 8 characters"),
  deviceId: z.string().uuid(),
  deviceLabel: z.string().max(120).optional(),
});

// POST /api/invites/accept
// The invitee sets their own name / phone / password. We create their account
// scoped to the invite's business + branch + role, consume the invite, and log
// them straight in (same cookie/session flow as signup).
export async function POST(req: NextRequest) {
  await connectDb();

  const json = await req.json().catch(() => null);
  const parsed = acceptSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request" },
      { status: 400 }
    );
  }
  const { token, name, phoneNumber, password, deviceId, deviceLabel } = parsed.data;

  const invite = await findValidInvite(token);
  if (!invite) {
    return NextResponse.json(
      { error: "This invitation link is invalid, already used, or has expired." },
      { status: 404 }
    );
  }

  // The branch must still exist and be active (it may have been archived
  // between sending the invite and accepting it).
  if (invite.branchId) {
    const branch = await Branch.findOne({
      _id: invite.branchId,
      businessId: invite.businessId,
      isActive: true,
    }).lean();
    if (!branch) {
      return NextResponse.json(
        { error: "The branch for this invitation is no longer available. Ask for a new link." },
        { status: 409 }
      );
    }
  }

  // Respect the business's plan user cap.
  const tier = await loadTier(invite.businessId);
  const capError = await userLimitError(invite.businessId, tier);
  if (capError) return NextResponse.json({ error: capError }, { status: 403 });

  let phone: string;
  try {
    phone = normalizeKenyanPhone(phoneNumber);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }

  // Email: use the one the inviter pinned, otherwise derive nothing — invited
  // staff sign in by the email captured here. If the invite had no email we
  // require the phone to double as a contact only, and build a login email is
  // NOT invented; instead we reject so the inviter supplies one.
  const email = invite.email;
  if (!email) {
    return NextResponse.json(
      { error: "This invitation is missing an email. Ask the sender to re-issue it with your email." },
      { status: 400 }
    );
  }

  const passwordHash = await bcrypt.hash(password, 12);

  let user;
  try {
    user = await User.create({
      businessId: invite.businessId,
      name,
      role: invite.role,
      branchId: invite.role === "SUPER_ADMIN" ? null : invite.branchId,
      phoneNumber: phone,
      email: email.toLowerCase(),
      passwordHash,
    });
  } catch (err: unknown) {
    const e = err as { code?: number };
    if (e?.code === 11000) {
      return NextResponse.json(
        { error: "An account with this email or phone already exists in this business." },
        { status: 409 }
      );
    }
    throw err;
  }

  // Consume the invite so the link cannot be reused.
  invite.acceptedAt = new Date();
  invite.acceptedUserId = user._id;
  await invite.save();

  // A new manager takes over their branch.
  if (user.role === "BRANCH_MANAGER" && user.branchId) {
    await Branch.findOneAndUpdate(
      { _id: user.branchId, businessId: invite.businessId },
      { managerId: user._id }
    );
  }

  // Log them straight in.
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

  const res = NextResponse.json({
    user: {
      id: user._id,
      name: user.name,
      role: user.role,
      businessId: user.businessId,
      branchId: user.branchId,
      email: user.email,
    },
    redirectTo: user.role === "DELIVERY" ? "/terminal" : "/admin/dashboard",
  });
  res.cookies.set(ACCESS_COOKIE, accessToken, accessCookieOptions());
  res.cookies.set(
    REFRESH_COOKIE,
    refreshToken,
    refreshCookieOptions(Math.floor(refreshTtlMs() / 1000))
  );
  return res;
}
