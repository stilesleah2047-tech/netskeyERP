import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { connectDb } from "@/lib/server/db";
import { Business } from "@/lib/server/models/Business";
import { requirePlatformAdmin, isPlatformAdminEmail } from "@/lib/server/platform";
import { issueOwnerInvite } from "@/lib/server/ownerInvite";
import { isObjectId } from "@/lib/server/ids";
import { audit } from "@/lib/server/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({ ownerEmail: z.string().trim().email() });

/**
 * Re-issue the owner invite for a business whose owner has not joined yet
 * (link expired or lost). Any earlier pending owner link stops working.
 * Operator-only.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  await connectDb();
  const admin = await requirePlatformAdmin(req);
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  if (!isObjectId(id)) return NextResponse.json({ error: "Invalid business id" }, { status: 400 });

  const json = await req.json().catch(() => null);
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
  }
  if (isPlatformAdminEmail(parsed.data.ownerEmail)) {
    return NextResponse.json({ error: "A platform-operator email cannot be a business owner." }, { status: 400 });
  }

  const business = await Business.findById(id).select("ownerId").lean();
  if (!business) return NextResponse.json({ error: "Business not found" }, { status: 404 });
  if (business.ownerId) {
    return NextResponse.json({ error: "This business already has an owner." }, { status: 409 });
  }

  const invite = await issueOwnerInvite({ businessId: id, email: parsed.data.ownerEmail, createdBy: admin.userId });
  await audit({
    businessId: id,
    actorId: admin.userId,
    action: "business.owner_invite.reissue",
    targetType: "Business",
    targetId: business._id,
    details: { ownerEmail: parsed.data.ownerEmail.toLowerCase() },
  });
  return NextResponse.json(invite, { status: 201 });
}
