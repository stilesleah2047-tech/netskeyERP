import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { connectDb } from "@/lib/server/db";
import { Branch } from "@/lib/server/models/Branch";
import { User } from "@/lib/server/models/User";
import { UserSession } from "@/lib/server/models/UserSession";
import { getAuth, requireRole } from "@/lib/server/auth";
import { audit } from "@/lib/server/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const updateSchema = z.object({
  // Only owners can turn a branch on/off. Deactivating a branch keeps all its
  // history intact but takes it offline (Test report F-06).
  isActive: z.boolean(),
});

// PATCH /api/branches/:id — activate / deactivate a branch (owner only).
// Deactivating cascades to the branch's staff so they can no longer sign in;
// reactivating only re-enables the branch itself (staff are re-enabled
// individually from the Staff page, to avoid silently un-disabling someone
// who was removed on purpose).
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  await connectDb();
  const auth = getAuth(req);
  if (!requireRole(auth, "SUPER_ADMIN")) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const json = await req.json().catch(() => null);
  const parsed = updateSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request" },
      { status: 400 }
    );
  }

  const branch = await Branch.findOneAndUpdate(
    { _id: params.id, businessId: auth!.businessId },
    { isActive: parsed.data.isActive },
    { new: true }
  );
  if (!branch) return NextResponse.json({ error: "Branch not found" }, { status: 404 });

  // Cascade: take this branch's staff offline when it is deactivated.
  if (parsed.data.isActive === false) {
    await User.updateMany(
      { businessId: auth!.businessId, branchId: branch._id, role: { $ne: "SUPER_ADMIN" } },
      { isActive: false }
    );
    const staff = await User.find({ businessId: auth!.businessId, branchId: branch._id, role: { $ne: "SUPER_ADMIN" } })
      .select("_id")
      .lean();
    await UserSession.deleteMany({ userId: { $in: staff.map((u) => u._id) } });
  }

  await audit({
    businessId: auth!.businessId,
    actorId: auth!.sub,
    action: parsed.data.isActive ? "branch.reactivate" : "branch.deactivate",
    targetType: "Branch",
    targetId: branch._id,
  });

  return NextResponse.json({ branch });
}
