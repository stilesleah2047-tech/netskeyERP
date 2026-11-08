import { AuditLog } from "@/lib/server/models/AuditLog";

/**
 * Write an audit entry. Never throws: a failed audit write must not fail the
 * business action it describes, but it is logged to the server console.
 */
export async function audit(entry: {
  businessId: string;
  actorId: string;
  action: string;
  targetType: string;
  targetId?: unknown;
  details?: Record<string, unknown>;
}) {
  try {
    await AuditLog.create({
      businessId: entry.businessId,
      actorId: entry.actorId,
      action: entry.action,
      targetType: entry.targetType,
      targetId: entry.targetId ?? null,
      details: entry.details ?? {},
    });
  } catch (err) {
    console.error("[audit] failed to record", entry.action, err);
  }
}
