import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { connectDb } from "@/lib/server/db";
import { Product } from "@/lib/server/models/Product";
import { getAuth, requireRole } from "@/lib/server/auth";
import { audit } from "@/lib/server/audit";

export const runtime = "nodejs";

const updateSchema = z.object({
  label: z.string().trim().min(1).max(60).optional(),
  sizeLiters: z.number().positive().max(1000).optional(),
  unit: z.string().trim().min(1).max(12).optional(),
  category: z.string().trim().min(1).max(40).optional(),
  unitPrice: z.number().nonnegative().optional(),
  sortOrder: z.number().int().optional(),
  isActive: z.boolean().optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  await connectDb();
  const auth = getAuth(req);
  if (!auth) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  // Products and their prices are tenant-wide, so only the owner may change
  // them. Branch-specific prices go through /api/branches/[id]/prices.
  if (!requireRole(auth, "SUPER_ADMIN")) {
    return NextResponse.json({ error: "Only the business owner can change products and prices" }, { status: 403 });
  }

  const json = await req.json().catch(() => null);
  const parsed = updateSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
  }
  if (Object.keys(parsed.data).length === 0) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }

  const product = await Product.findOneAndUpdate(
    { _id: params.id, businessId: auth!.businessId },
    parsed.data,
    { new: true }
  );
  if (!product) return NextResponse.json({ error: "Product not found" }, { status: 404 });
  await audit({
    businessId: auth!.businessId,
    actorId: auth!.sub,
    action: "product.update",
    targetType: "Product",
    targetId: product._id,
    details: { changes: parsed.data },
  });
  return NextResponse.json({ product });
}
