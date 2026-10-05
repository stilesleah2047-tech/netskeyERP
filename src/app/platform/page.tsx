"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch, ApiError } from "@/lib/api";
import { AuthUser } from "@/lib/types";
import { useToast } from "@/components/ui/Toast";
import { SkeletonList } from "@/components/ui/Skeleton";

type TierId = "STARTER" | "GROWTH" | "ENTERPRISE";
type SubStatus = "TRIALING" | "ACTIVE" | "PAST_DUE" | "SUSPENDED";

interface BizRow {
  id: string;
  name: string;
  tier: TierId;
  tierName: string;
  priceKsh: number;
  subscriptionStatus: SubStatus;
  trialEndsAt: string | null;
  currentPeriodEnd: string | null;
  isActive: boolean;
  createdAt: string;
  userCount: number;
  branchCount: number;
  maxUsers: number | null;
  maxBranches: number | null;
  owner: { name: string; email: string; phoneNumber: string } | null;
}

interface Stats {
  total: number;
  active: number;
  trialing: number;
  suspended: number;
  mrr: number;
}

const TIER_OPTIONS: TierId[] = ["STARTER", "GROWTH", "ENTERPRISE"];
const STATUS_OPTIONS: SubStatus[] = ["TRIALING", "ACTIVE", "PAST_DUE", "SUSPENDED"];

function ksh(n: number) {
  return "KSh " + n.toLocaleString("en-KE");
}

function fmtDate(d: string | null) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-KE", { year: "numeric", month: "short", day: "numeric" });
}

const STATUS_STYLES: Record<SubStatus, string> = {
  ACTIVE: "bg-confirm-500/15 text-confirm-600",
  TRIALING: "bg-flow-500/15 text-flow-600",
  PAST_DUE: "bg-cash-500/15 text-cash-600",
  SUSPENDED: "bg-alert-500/15 text-alert-600",
};

export default function PlatformPage() {
  const router = useRouter();
  const { show } = useToast();
  const [ready, setReady] = useState(false);
  const [rows, setRows] = useState<BizRow[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      let me: AuthUser;
      try {
        const result = await apiFetch<{ user: AuthUser }>("/api/auth/me");
        me = result.user;
      } catch {
        router.replace("/login");
        return;
      }
      if (!me.isPlatformAdmin) {
        router.replace(me.role === "DELIVERY" ? "/terminal" : "/admin/dashboard");
        return;
      }
      setReady(true);
      await load();
      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function load() {
    const result = await apiFetch<{ businesses: BizRow[]; stats: Stats }>("/api/platform/businesses");
    setRows(result.businesses);
    setStats(result.stats);
  }

  async function patch(id: string, update: Record<string, unknown>, label: string) {
    setSavingId(id);
    try {
      await apiFetch("/api/platform/businesses/" + id, {
        method: "PATCH",
        body: JSON.stringify(update),
      });
      show(label, "success");
      await load();
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "Update failed";
      show(message, "error");
    }
    setSavingId(null);
  }

  if (!ready) {
    return (
      <main className="min-h-screen bg-depth-950 pb-12">
        <header className="px-5 pb-8 pt-8">
          <div className="mx-auto h-14 max-w-5xl" />
        </header>
        <div className="mx-auto max-w-5xl px-5">
          <SkeletonList rows={4} />
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-depth-950 pb-16 text-white">
      <header className="border-b border-white/10 px-5 pb-6 pt-8">
        <div className="mx-auto max-w-5xl">
          <p className="text-xs uppercase tracking-[0.2em] text-flow-400">Operator</p>
          <h1 className="font-display text-2xl font-bold">Platform Command Center</h1>
          <p className="mt-1 text-sm text-white/60">
            Every business on your platform, across all tenants. Change plans, extend billing periods,
            and suspend accounts here.
          </p>
        </div>
      </header>

      <div className="mx-auto max-w-5xl space-y-6 px-5 pt-6">
        {stats && (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            <StatCard label="Businesses" value={String(stats.total)} />
            <StatCard label="Active" value={String(stats.active)} accent="text-confirm-400" />
            <StatCard label="Trialing" value={String(stats.trialing)} accent="text-flow-400" />
            <StatCard label="Suspended" value={String(stats.suspended)} accent="text-alert-400" />
            <StatCard label="MRR (active)" value={ksh(stats.mrr)} accent="text-flow-300" />
          </div>
        )}

        {loading ? (
          <SkeletonList rows={4} />
        ) : rows.length === 0 ? (
          <div className="rounded-xl2 border border-white/10 bg-white/5 p-8 text-center text-white/60">
            No businesses have signed up yet.
          </div>
        ) : (
          <div className="space-y-4">
            {rows.map((b) => (
              <BusinessCard
                key={b.id}
                b={b}
                saving={savingId === b.id}
                onPatch={patch}
              />
            ))}
          </div>
        )}
      </div>
    </main>
  );
}

function StatCard({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div className="rounded-xl2 border border-white/10 bg-white/5 p-4">
      <p className="text-xs uppercase tracking-wide text-white/50">{label}</p>
      <p className={"mt-1 font-display text-xl font-bold " + (accent ?? "text-white")}>{value}</p>
    </div>
  );
}

function BusinessCard({
  b,
  saving,
  onPatch,
}: {
  b: BizRow;
  saving: boolean;
  onPatch: (id: string, update: Record<string, unknown>, label: string) => void;
}) {
  const overBranches = b.maxBranches !== null && b.branchCount > b.maxBranches;
  const overUsers = b.maxUsers !== null && b.userCount > b.maxUsers;
  return (
    <div className="rounded-xl2 border border-white/10 bg-white/5 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="font-display text-lg font-semibold text-white">{b.name}</h2>
            <span className={"rounded-full px-2.5 py-0.5 text-xs font-medium " + STATUS_STYLES[b.subscriptionStatus]}>
              {b.subscriptionStatus}
            </span>
          </div>
          {b.owner && (
            <p className="mt-0.5 text-xs text-white/50">
              {b.owner.name} · {b.owner.email} · {b.owner.phoneNumber}
            </p>
          )}
          <p className="mt-0.5 text-xs text-white/40">Joined {fmtDate(b.createdAt)}</p>
        </div>
        <div className="text-right">
          <p className="font-display text-base font-semibold text-flow-300">
            {b.tierName} · {ksh(b.priceKsh)}/mo
          </p>
          <p className="mt-0.5 text-xs text-white/50">
            Trial ends {fmtDate(b.trialEndsAt)} · Paid thru {fmtDate(b.currentPeriodEnd)}
          </p>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-4 text-sm">
        <span className={overBranches ? "text-alert-400" : "text-white/70"}>
          Branches: {b.branchCount}
          {b.maxBranches === null ? " / ∞" : " / " + b.maxBranches}
        </span>
        <span className={overUsers ? "text-alert-400" : "text-white/70"}>
          Users: {b.userCount}
          {b.maxUsers === null ? " / ∞" : " / " + b.maxUsers}
        </span>
      </div>

      <div className="mt-4 flex flex-wrap items-end gap-3 border-t border-white/10 pt-4">
        <div>
          <label className="mb-1 block text-xs text-white/50">Plan</label>
          <select
            defaultValue={b.tier}
            disabled={saving}
            onChange={(e) =>
              onPatch(b.id, { tier: e.target.value }, b.name + " moved to " + e.target.value)
            }
            className="rounded-xl border border-white/15 bg-depth-900 px-3 py-2 text-sm text-white"
          >
            {TIER_OPTIONS.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs text-white/50">Status</label>
          <select
            defaultValue={b.subscriptionStatus}
            disabled={saving}
            onChange={(e) =>
              onPatch(b.id, { subscriptionStatus: e.target.value }, b.name + " set to " + e.target.value)
            }
            className="rounded-xl border border-white/15 bg-depth-900 px-3 py-2 text-sm text-white"
          >
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
        <button
          type="button"
          disabled={saving}
          onClick={() => onPatch(b.id, { extendDays: 30 }, b.name + " extended 30 days (now ACTIVE)")}
          className="tap-target rounded-xl2 bg-gradient-to-r from-flow-500 to-flow-700 px-4 text-sm font-semibold text-depth-950 disabled:opacity-60"
        >
          {saving ? "Saving…" : "Mark paid +30 days"}
        </button>
        {b.subscriptionStatus !== "SUSPENDED" ? (
          <button
            type="button"
            disabled={saving}
            onClick={() => onPatch(b.id, { subscriptionStatus: "SUSPENDED" }, b.name + " suspended")}
            className="tap-target rounded-xl2 border border-alert-500/40 px-4 text-sm font-medium text-alert-300 disabled:opacity-60"
          >
            Suspend
          </button>
        ) : (
          <button
            type="button"
            disabled={saving}
            onClick={() => onPatch(b.id, { subscriptionStatus: "ACTIVE" }, b.name + " reactivated")}
            className="tap-target rounded-xl2 border border-confirm-500/40 px-4 text-sm font-medium text-confirm-300 disabled:opacity-60"
          >
            Reactivate
          </button>
        )}
      </div>
    </div>
  );
}