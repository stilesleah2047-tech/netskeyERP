import { NextRequest, NextResponse } from "next/server";
import { connectDb } from "@/lib/server/db";
import { AuditLog } from "@/lib/server/models/AuditLog";
import { Business } from "@/lib/server/models/Business";
import { User } from "@/lib/server/models/User";
import { requirePlatformAdmin } from "@/lib/server/platform";
import { isObjectId } from "@/lib/server/ids";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Audit trail across every business, newest first. Optional ?businessId=
 * narrows it to one business; ?before=<ISO date> pages backwards.
 * Operator-only.
 */
export async function GET(req: NextRequest) {
  await connectDb();
  const admin = await requirePlatformAdmin(req);
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const sp = req.nextUrl.searchParams;
  const filter: Record<string, unknown> = {};
  const businessId = sp.get("businessId");
  if (businessId) {
    if (!isObjectId(businessId)) return NextResponse.json({ error: "Invalid businessId" }, { status: 400 });
    filter.businessId = businessId;
  }
  const before = sp.get("before");
  if (before) {
    const d = new Date(before);
    if (isNaN(d.getTime())) return NextResponse.json({ error: "Invalid before date" }, { status: 400 });
    filter.createdAt = { $lt: d };
  }
  const limit = Math.min(Math.max(Number(sp.get("limit")) || 50, 1), 200);

  const logs = await AuditLog.find(filter).sort({ createdAt: -1 }).limit(limit).lean();

  const [bizs, actors] = await Promise.all([
    Business.find({ _id: { $in: Array.from(new Set(logs.map((l) => String(l.businessId)))) } }).select("name").lean(),
    User.find({ _id: { $in: Array.from(new Set(logs.map((l) => String(l.actorId)))) } }).select("name email role").lean(),
  ]);
  const bizMap = new Map(bizs.map((b) => [String(b._id), b.name]));
  const actorMap = new Map(actors.map((a) => [String(a._id), a]));

  return NextResponse.json({
    activity: logs.map((l) => {
      const actor = actorMap.get(String(l.actorId));
      return {
        id: String(l._id),
        at: l.createdAt,
        action: l.action,
        businessId: String(l.businessId),
        businessName: bizMap.get(String(l.businessId)) ?? "(deleted business)",
        actor: actor ? { name: actor.name, email: actor.email, role: actor.role } : null,
        targetType: l.targetType,
        details: l.details ?? {},
      };
    }),
    nextBefore: logs.length === limit ? logs[logs.length - 1].createdAt : null,
  });
}
