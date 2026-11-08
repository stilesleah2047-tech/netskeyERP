import crypto from "crypto";
import { Types } from "mongoose";
import { Invite, INVITE_TTL_DAYS } from "@/lib/server/models/Invite";
import { hashToken } from "@/lib/server/invites";

/**
 * Issue a one-time owner (SUPER_ADMIN) invite for a business, cancelling any
 * earlier pending owner invites so only the newest link works. Returns the
 * raw token once; only its hash is stored.
 */
export async function issueOwnerInvite(params: {
  businessId: Types.ObjectId | string;
  email: string;
  createdBy: string;
}) {
  const now = new Date();
  await Invite.updateMany(
    { businessId: params.businessId, role: "SUPER_ADMIN", acceptedAt: null, expiresAt: { $gt: now } },
    { expiresAt: now }
  );

  const rawToken = crypto.randomBytes(24).toString("base64url");
  const invite = await Invite.create({
    businessId: params.businessId,
    branchId: null,
    role: "SUPER_ADMIN",
    email: params.email.toLowerCase(),
    tokenHash: hashToken(rawToken),
    expiresAt: new Date(now.getTime() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000),
    createdBy: params.createdBy,
  });

  return {
    expiresAt: invite.expiresAt,
    acceptPath: `/invite/accept?token=${rawToken}`,
  };
}
