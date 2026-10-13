import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import mongoose from "mongoose";
import { z } from "zod";
import { connectDb } from "@/lib/server/db";
import { Invite, INVITE_TTL_DAYS } from "@/lib/server/models/Invite";
import { Branch } from "@/lib/server/models/Branch";
import { getAuth, requireRole } from "@/lib/server/auth";
import { hashToken } from "@/lib/server/invites";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/invites — pending (unaccepted, unexpired) invites for this business.
// Managers see only their own branch's invites.
export async function GET(req: NextRequest) {
  await connectDb();
  const auth = getAuth(req);
  if (!requireRole(auth, "SUPER_ADMIN", "BRANCH_MANAGER")) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const filter: Record<string, unknown> = {
    businessId: auth!.businessId,
    acceptedAt: null,
    expiresAt: { $gt: new Date() },
  };
  if (auth!.role === "BRANCH_MANAGER") filter.branchId = auth!.branchId;

  const invites = await Invite.find(filter)
    .populate("branchId", "branchName")
    .populate("createdBy", "name")
    .sort({ createdAt: -1 })
    .lean();

  // Never leak the token hash to the client.
  const safe = invites.map((i) => ({
    id: i._id,
    role: i.role,
    email: i.email,
    branch: i.branchId,
    expiresAt: i.expiresAt,
    createdAt: i.createdAt,
    createdBy: i.createdBy,
  }));
  return NextResponse.json({ invites: safe });
}

const createSchema = z.object({
  role: z.enum(["DELIVERY", "BRANCH_MANAGER"]),
  branchId: z.string().min(1),
  email: z.string().email().optional(),
});

// POST /api/invites — create a one-time invite link. The raw token is
// returned ONCE here (to share via WhatsApp); only its hash is stored.
export async function POST(req: NextRequest) {
  await connectDb();
  const auth = getAuth(req);
  if (!requireRole(auth, "SUPER_ADMIN", "BRANCH_MANAGER")) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const json = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request" },
      { status: 400 }
    );
  }
  const { role, branchId, email } = parsed.data;

  if (!mongoose.isValidObjectId(branchId)) {
    return NextResponse.json({ error: "Invalid branch id" }, { status: 400 });
  }

  // A branch manager may only invite DELIVERY staff to their own branch.
  if (auth!.role === "BRANCH_MANAGER") {
    if (role !== "DELIVERY") {
      return NextResponse.json({ error: "Managers may only invite delivery staff" }, { status: 403 });
    }
    if (branchId !== auth!.branchId) {
      return NextResponse.json({ error: "Managers may only invite to their own branch" }, { status: 403 });
    }
  }

  const branch = await Branch.findOne({ _id: branchId, businessId: auth!.businessId, isActive: true }).lean();
  if (!branch) return NextResponse.json({ error: "Branch not found" }, { status: 404 });

  const rawToken = crypto.randomBytes(24).toString("base64url");
  const invite = await Invite.create({
    businessId: auth!.businessId,
    branchId,
    role,
    email: email?.toLowerCase() ?? null,
    tokenHash: hashToken(rawToken),
    expiresAt: new Date(Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000),
    createdBy: auth!.sub,
  });

  // Return a relative path; the client prepends its own origin so the link is
  // correct regardless of which domain the app is served from.
  return NextResponse.json(
    {
      invite: { id: invite._id, role, branchId, expiresAt: invite.expiresAt },
      token: rawToken,
      acceptPath: `/invite/accept?token=${rawToken}`,
    },
    { status: 201 }
  );
}
