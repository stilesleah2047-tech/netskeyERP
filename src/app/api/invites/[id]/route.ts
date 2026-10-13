import { NextRequest, NextResponse } from "next/server";
import mongoose from "mongoose";
import { connectDb } from "@/lib/server/db";
import { Invite } from "@/lib/server/models/Invite";
import { getAuth, requireRole } from "@/lib/server/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// DELETE /api/invites/:id — revoke a pending invite. Owners revoke any;
// managers only their own branch's invites.
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  await connectDb();
  const auth = getAuth(req);
  if (!requireRole(auth, "SUPER_ADMIN", "BRANCH_MANAGER")) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  if (!mongoose.isValidObjectId(params.id)) {
    return NextResponse.json({ error: "Invalid invite id" }, { status: 400 });
  }

  const filter: Record<string, unknown> = { _id: params.id, businessId: auth!.businessId };
  if (auth!.role === "BRANCH_MANAGER") filter.branchId = auth!.branchId;

  const invite = await Invite.findOne(filter);
  if (!invite) return NextResponse.json({ error: "Invite not found" }, { status: 404 });
  if (invite.acceptedAt) {
    return NextResponse.json({ error: "This invite has already been used" }, { status: 409 });
  }

  await Invite.deleteOne({ _id: invite._id });
  return NextResponse.json({ ok: true });
}
