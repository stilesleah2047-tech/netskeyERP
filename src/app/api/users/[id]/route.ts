import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { connectDb } from "@/lib/server/db";
import { User } from "@/lib/server/models/User";
import { Business } from "@/lib/server/models/Business";
import { Branch } from "@/lib/server/models/Branch";
import { UserSession } from "@/lib/server/models/UserSession";
import { getAuth, requireRole } from "@/lib/server/auth";
import { audit } from "@/lib/server/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const updateSchema = z.object({
  // Deactivate / reactivate a staff account. A deactivated user keeps all
  // their history but can no longer sign in (login already rejects inactive
  // accounts). This is the "remove a staff member" action (Test report F-06).
  isActive: z.boolean().optional(),
  // Owner only: change a staff member's role and/or branch.
  role: z.enum(["SUPER_ADMIN", "BRANCH_MANAGER", "DELIVERY"]).optional(),
  branchId: z.string().trim().min(1).nullable().optional(),
}).refine((d) => d.isActive !== undefined || d.role !== undefined || d.branchId !== undefined, {
  message: "Nothing to change",
});

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  await connectDb();
  const auth = getAuth(req);
  if (!auth) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  if (!requireRole(auth, "BRANCH_MANAGER", "SUPER_ADMIN")) {
    return NextResponse.json({ error: "You do not have access to this" }, { status: 403 });
  }

  const json = await req.json().catch(() => null);
  const parsed = updateSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request" },
      { status: 400 }
    );
  }

  // You can never deactivate or demote your own account.
  if (params.id === auth!.sub) {
    return NextResponse.json({ error: "You cannot change your own account here." }, { status: 400 });
  }
  const changingAssignment = parsed.data.role !== undefined || parsed.data.branchId !== undefined;
  if (changingAssignment && auth!.role !== "SUPER_ADMIN") {
    return NextResponse.json({ error: "Only the business owner can change roles or branches." }, { status: 403 });
  }

  const target = await User.findOne({ _id: params.id, businessId: auth!.businessId });
  if (!target) return NextResponse.json({ error: "Staff member not found" }, { status: 404 });

  // The business owner can never be deactivated — it would orphan the tenant.
  const business = await Business.findById(auth!.businessId).select("ownerId").lean();
  if (business && target._id.toString() === business.ownerId?.toString()) {
    return NextResponse.json({ error: "The business owner account cannot be changed here." }, { status: 400 });
  }

  // Branch managers may only toggle delivery staff in their own branch.
  if (auth!.role === "BRANCH_MANAGER") {
    if (target.role !== "DELIVERY") {
      return NextResponse.json({ error: "Branch managers may only manage delivery staff." }, { status: 403 });
    }
    if (!target.branchId || target.branchId.toString() !== auth!.branchId) {
      return NextResponse.json({ error: "Branch managers may only manage staff in their own branch." }, { status: 403 });
    }
  }

  const before = { isActive: target.isActive, role: target.role, branchId: target.branchId?.toString() ?? null };

  if (changingAssignment) {
    const newRole = parsed.data.role ?? target.role;
    const newBranchId =
      newRole === "SUPER_ADMIN"
        ? null
        : parsed.data.branchId !== undefined
          ? parsed.data.branchId
          : target.branchId?.toString() ?? null;
    if (newRole !== "SUPER_ADMIN" && !newBranchId) {
      return NextResponse.json({ error: "A branch is required for this role." }, { status: 400 });
    }
    if (newBranchId) {
      const branch = await Branch.findOne({ _id: newBranchId, businessId: auth!.businessId, isActive: { $ne: false } }).lean();
      if (!branch) return NextResponse.json({ error: "Branch not found in your business" }, { status: 404 });
    }
    // Clear this user as manager of their old branch if they stop managing it.
    if (target.role === "BRANCH_MANAGER" && target.branchId &&
        (newRole !== "BRANCH_MANAGER" || newBranchId !== target.branchId.toString())) {
      await Branch.updateOne(
        { _id: target.branchId, businessId: auth!.businessId, managerId: target._id },
        { managerId: null }
      );
    }
    if (newRole === "BRANCH_MANAGER" && newBranchId) {
      await Branch.updateOne({ _id: newBranchId, businessId: auth!.businessId }, { managerId: target._id });
    }
    target.role = newRole as any;
    target.branchId = (newBranchId as any) ?? null;
  }
  if (parsed.data.isActive !== undefined) target.isActive = parsed.data.isActive;
  await target.save();

  // Revoke sessions so a deactivation or role change takes effect at the next
  // token refresh (at most 15 minutes) and cannot be extended.
  if (parsed.data.isActive === false || changingAssignment) {
    await UserSession.deleteMany({ userId: target._id });
  }

  await audit({
    businessId: auth!.businessId,
    actorId: auth!.sub,
    action: parsed.data.isActive === false ? "user.deactivate" : changingAssignment ? "user.reassign" : "user.reactivate",
    targetType: "User",
    targetId: target._id,
    details: { before, after: { isActive: target.isActive, role: target.role, branchId: target.branchId?.toString() ?? null } },
  });

  const obj: any = target.toObject();
  delete obj.passwordHash;
  return NextResponse.json({ user: obj });
}
