import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { connectDb } from "@/lib/server/db";
import { DailyInventory } from "@/lib/server/models/DailyInventory";
import { Branch } from "@/lib/server/models/Branch";
import { Product } from "@/lib/server/models/Product";
import { getAuth, requireRole, resolveBranchScope } from "@/lib/server/auth";
import { businessDate } from "@/lib/server/businessDay";
import { isObjectId } from "@/lib/server/ids";
import { audit } from "@/lib/server/audit";

export const runtime = "nodejs";

// Africa/Nairobi business day, not the server's UTC date.
function todayLocal(): string {
  return businessDate();
}

const dispatchSchema = z.object({
  productId: z.string().min(1),
  morningDispatched: z.number().int().min(0),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  branchId: z.string().optional(),
});

export async function POST(req: NextRequest) {
  await connectDb();
  const auth = getAuth(req);
  if (!requireRole(auth, "BRANCH_MANAGER", "SUPER_ADMIN")) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const json = await req.json().catch(() => null);
  const parsed = dispatchSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
  }

  const branchId = resolveBranchScope(auth!, parsed.data.branchId);
  if (!branchId) return NextResponse.json({ error: "branchId is required" }, { status: 400 });

  // The branch MUST belong to this tenant — blocks a crafted branchId from
  // writing inventory into another business.
  const branch = await Branch.findOne({ _id: branchId, businessId: auth!.businessId }).lean();
  if (!branch) return NextResponse.json({ error: "Branch not found in your business" }, { status: 404 });

  // The product must belong to this tenant too (pre-pilot review 1.2).
  if (!isObjectId(parsed.data.productId)) {
    return NextResponse.json({ error: "Invalid productId" }, { status: 400 });
  }
  const product = await Product.findOne({ _id: parsed.data.productId, businessId: auth!.businessId }).select("_id").lean();
  if (!product) return NextResponse.json({ error: "Product not found in your business" }, { status: 404 });

  const date = parsed.data.date ?? todayLocal();
  // Overwriting a past count is allowed (corrections happen) but is recorded
  // in the audit log with the previous value, so nothing changes silently.
  const previous = await DailyInventory.findOne({ branchId, productId: parsed.data.productId, date })
    .select("morningDispatched")
    .lean();
  if (previous && (previous as any).morningDispatched != null && (previous as any).morningDispatched !== parsed.data.morningDispatched) {
    await audit({
      businessId: auth!.businessId,
      actorId: auth!.sub,
      action: "inventory.morningDispatched.overwrite",
      targetType: "DailyInventory",
      targetId: (previous as any)._id,
      details: { date, branchId, productId: parsed.data.productId, from: (previous as any).morningDispatched, to: parsed.data.morningDispatched },
    });
  }
  const row = await DailyInventory.findOneAndUpdate(
    { branchId, productId: parsed.data.productId, date },
    { morningDispatched: parsed.data.morningDispatched, recordedBy: auth!.sub, businessId: auth!.businessId },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  return NextResponse.json({ inventory: row });
}
