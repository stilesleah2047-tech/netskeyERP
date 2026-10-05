import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { connectDb } from "@/lib/server/db";
import { Branch } from "@/lib/server/models/Branch";
import { User } from "@/lib/server/models/User";
import { getAuth, requireRole } from "@/lib/server/auth";
import { normalizeKenyanPhone } from "@/lib/server/phone";
import { branchLimitError, userLimitError, loadTier } from "@/lib/server/subscription";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  await connectDb();
  const auth = getAuth(req);
  if (!auth) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  if (auth.role === "SUPER_ADMIN") {
    const branches = await Branch.find({ businessId: auth.businessId }).sort({ branchName: 1 }).lean();
    return NextResponse.json({ branches });
  }
  if (!auth.branchId) return NextResponse.json({ branches: [] });
  const branch = await Branch.findOne({ _id: auth.branchId, businessId: auth.businessId }).lean();
  return NextResponse.json({ branches: branch ? [branch] : [] });
}

const createSchema = z.object({
  branchName: z.string().trim().min(1).max(120),
  locationCity: z.string().trim().min(1).max(120),
  manager: z
    .object({
      name: z.string().trim().min(1).max(120),
      email: z.string().email(),
      phoneNumber: z.string().min(9).max(15),
      password: z.string().min(8, "Password must be at least 8 characters"),
    })
    .optional(),
});

export async function POST(req: NextRequest) {
  await connectDb();
  const auth = getAuth(req);
  if (!requireRole(auth, "SUPER_ADMIN")) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const json = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
  }
  const { branchName, locationCity, manager } = parsed.data;
  const businessId = auth!.businessId;

  const tier = await loadTier(businessId);
  const branchErr = await branchLimitError(businessId, tier);
  if (branchErr) return NextResponse.json({ error: branchErr }, { status: 403 });

  let managerPhone: string | null = null;
  if (manager) {
    const userErr = await userLimitError(businessId, tier);
    if (userErr) return NextResponse.json({ error: userErr }, { status: 403 });
    try {
      managerPhone = normalizeKenyanPhone(manager.phoneNumber);
    } catch (e) {
      return NextResponse.json({ error: (e as Error).message }, { status: 400 });
    }
    const lowerEmail = manager.email.toLowerCase();
    const emailTaken = await User.findOne({ email: lowerEmail }).lean();
    if (emailTaken) {
      return NextResponse.json({ error: "An account with this email already exists." }, { status: 409 });
    }
    const phoneTaken = await User.findOne({ phoneNumber: managerPhone }).lean();
    if (phoneTaken) {
      return NextResponse.json({ error: "An account with this phone number already exists." }, { status: 409 });
    }
  }

  const branch = await Branch.create({ branchName, locationCity, businessId });

  if (manager && managerPhone) {
    try {
      const passwordHash = await bcrypt.hash(manager.password, 12);
      const managerUser = await User.create({
        businessId,
        name: manager.name,
        role: "BRANCH_MANAGER",
        branchId: branch._id,
        phoneNumber: managerPhone,
        email: manager.email.toLowerCase(),
        passwordHash,
      });
      branch.managerId = managerUser._id;
      await branch.save();
      return NextResponse.json(
        { branch, manager: { id: managerUser._id, name: managerUser.name, email: managerUser.email } },
        { status: 201 }
      );
    } catch (err: any) {
      await Branch.deleteOne({ _id: branch._id }).catch(() => {});
      if (err?.code === 11000) {
        return NextResponse.json({ error: "A user with this phone number or email already exists." }, { status: 409 });
      }
      return NextResponse.json({ error: "Could not create the branch manager. Please try again." }, { status: 500 });
    }
  }

  return NextResponse.json({ branch }, { status: 201 });
}