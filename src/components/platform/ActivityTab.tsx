"use client";

import { useEffect, useState } from "react";
import { apiFetch, ApiError } from "@/lib/api";
import { fmtDateTime } from "@/components/platform/shared";

interface Entry {
  id: string;
  at: string;
  action: string;
  businessId: string;
  businessName: string;
  actor: { name: string; email: string | null; role: string } | null;
  targetType: string;
  details: Record<string, any>;
}

// Plain-language labels for audit actions.
const LABELS: Record<string, string> = {
  "business.create": "Business created",
  "business.owner_invite.reissue": "New owner link issued",
  "user.create": "Staff account created",
  "user.deactivate": "Staff deactivated",
  "user.reactivate": "Staff reactivated",
  "user.reassign": "Staff role or branch changed",
  "branch.deactivate": "Branch deactivated",
  "branch.reactivate": "Branch reactivated",
  "product.update": "Product or price changed",
  "inventory.morningDispatched.overwrite": "Morning count overwritten",
  "inventory.eveningPhysicalCount.overwrite": "Evening count overwritten",
};

function describe(e: Entry): string {
  const d = e.details ?? {};
  if (e.action === "product.update" && d.changes) {
    return Object.entries(d.changes).map(([k, v]) => `${k} → ${v}`).join(", ");
  }
  if (e.action.startsWith("inventory.") && "from" in d) return `${d.from} → ${d.to} (${d.date})`;
  if (e.action === "business.create") return `${d.tier ?? ""} · owner ${d.ownerEmail ?? ""}`;
  if (e.action === "user.create") return d.role ? `role ${d.role}` : "";
  if (e.action === "user.reassign" && d.before && d.after) return `${d.before.role} → ${d.after.role}`;
  return "";
}

export default function ActivityTab({
  businesses,
  initialBusinessId,
}: {
  businesses: { id: string; name: string }[];
  initialBusinessId?: string;
}) {
  const [businessId, setBusinessId] = useState(initialBusinessId ?? "");
  const [entries, setEntries] = useState<Entry[]>([]);
  const [nextBefore, setNextBefore] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load(before?: string) {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ limit: "50" });
      if (businessId) params.set("businessId", businessId);
      if (before) params.set("before", before);
      const r = await apiFetch<{ activity: Entry[]; nextBefore: string | null }>("/api/platform/activity?" + params);
      setEntries((prev) => (before ? [...prev, ...r.activity] : r.activity));
      setNextBefore(r.nextBefore);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load activity");
    }
    setLoading(false);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [businessId]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label htmlFor="activity-biz" className="mb-1 block text-xs text-white/50">Business</label>
          <select
            id="activity-biz"
            value={businessId}
            onChange={(e) => setBusinessId(e.target.value)}
            className="rounded-xl border border-white/15 bg-depth-900 px-3 py-2 text-sm text-white"
          >
            <option value="">All businesses</option>
            {businesses.map((b) => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </select>
        </div>
        <button onClick={() => load()} className="tap-target rounded-xl2 border border-white/20 px-4 text-sm text-white/80">
          Refresh
        </button>
      </div>

      {error && <p className="text-sm text-alert-400">{error}</p>}

      <div className="overflow-hidden rounded-xl2 border border-white/10">
        {entries.length === 0 && !loading ? (
          <p className="p-6 text-center text-sm text-white/60">No activity recorded yet.</p>
        ) : (
          <ul className="divide-y divide-white/5">
            {entries.map((e) => (
              <li key={e.id} className="flex flex-wrap items-start justify-between gap-2 bg-white/5 px-4 py-3 text-sm">
                <div>
                  <p className="font-medium text-white">{LABELS[e.action] ?? e.action}</p>
                  <p className="text-xs text-white/50">
                    {e.businessName} · by {e.actor ? `${e.actor.name} (${e.actor.role})` : "unknown"}
                    {describe(e) && <> · {describe(e)}</>}
                  </p>
                </div>
                <span className="text-xs text-white/40">{fmtDateTime(e.at)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {nextBefore && (
        <button
          disabled={loading}
          onClick={() => load(nextBefore)}
          className="tap-target w-full rounded-xl2 border border-white/20 text-sm text-white/80 disabled:opacity-60"
        >
          {loading ? "Loading…" : "Load older"}
        </button>
      )}
    </div>
  );
}
