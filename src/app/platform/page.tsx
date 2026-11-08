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
  // Present while the owner has not joined yet.
  ownerInvite: { email: string | null; expiresAt: string | null } | null;
}

interface InviteResult {
  acceptPath: string;
  expiresAt: string;
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
  // The most recent invite link, shown once so the operator can send it.
  const [lastLink, setLastLink] = useState<{ business: string; url: string; expiresAt: string } | null>(null);

  useEffect(() => {
    (async () => {
      let me: AuthUser;
      try {
        const result = await apiFetch<{ user: AuthUser }>('/api/auth/me');
        me = result.user;
      } catch {
        router.replace('/login');
        return;
      }
      if (!me.isPlatformAdmin) {
        router.replace(me.role === 'DELIVERY' ? '/terminal' : '/admin/dashboard');
        return;
      }
      setReady(true);
      await load();
      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function load() {
    const result = await apiFetch<{ businesses: BizRow[]; stats: Stats }>('/api/platform/businesses');
    setRows(result.businesses);
    setStats(result.stats);
  }

  async function patch(id: string, update: Record<string, unknown>, label: string) {
    setSavingId(id);
    try {
      await apiFetch('/api/platform/businesses/' + id, {
        method: 'PATCH',
        body: JSON.stringify(update),
      });
      show(label, 'success');
      await load();
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Update failed';
      show(message, 'error');
    }
    setSavingId(null);
  }

  function showLink(business: string, r: InviteResult) {
    setLastLink({ business, url: window.location.origin + r.acceptPath, expiresAt: r.expiresAt });
  }

  async function reissue(b: BizRow, ownerEmail: string) {
    setSavingId(b.id);
    try {
      const r = await apiFetch<InviteResult>('/api/platform/businesses/' + b.id + '/owner-invite', {
        method: 'POST',
        body: JSON.stringify({ ownerEmail }),
      });
      showLink(b.name, r);
      show('New owner link created for ' + b.name, 'success');
      await load();
    } catch (err) {
      show(err instanceof ApiError ? err.message : 'Could not create link', 'error');
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
            Every business on your platform, across all tenants. Create businesses, change plans,
            extend billing periods, and suspend accounts here. Public signup is closed: only you can
            add a business.
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

        <CreateBusinessForm
          onCreated={async (name, r) => {
            showLink(name, r);
            await load();
          }}
        />

        {lastLink && <InviteLinkBox link={lastLink} onClose={() => setLastLink(null)} />}

        {loading ? (
          <SkeletonList rows={4} />
        ) : rows.length === 0 ? (
          <div className="rounded-xl2 border border-white/10 bg-white/5 p-8 text-center text-white/60">
            No businesses yet. Create the first one above.
          </div>
        ) : (
          <div className="space-y-4">
            {rows.map((b) => (
              <BusinessCard
                key={b.id}
                b={b}
                saving={savingId === b.id}
                onPatch={patch}
                onReissue={reissue}
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

function CreateBusinessForm({ onCreated }: { onCreated: (name: string, r: InviteResult) => void }) {
  const { show } = useToast();
  const [businessName, setBusinessName] = useState('');
  const [ownerEmail, setOwnerEmail] = useState('');
  const [tier, setTier] = useState<TierId>('STARTER');
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (businessName.trim().length < 2 || !ownerEmail.includes('@')) {
      show('Enter a business name and the owner\'s email', 'error');
      return;
    }
    setBusy(true);
    try {
      const r = await apiFetch<InviteResult>('/api/platform/businesses', {
        method: 'POST',
        body: JSON.stringify({ businessName: businessName.trim(), ownerEmail: ownerEmail.trim(), tier }),
      });
      show(businessName.trim() + ' created', 'success');
      onCreated(businessName.trim(), r);
      setBusinessName('');
      setOwnerEmail('');
      setTier('STARTER');
    } catch (err) {
      show(err instanceof ApiError ? err.message : 'Could not create business', 'error');
    }
    setBusy(false);
  }

  return (
    <div className="rounded-xl2 border border-white/10 bg-white/5 p-4">
      <h2 className="font-display text-base font-semibold text-white">Create a business</h2>
      <p className="mt-0.5 text-xs text-white/50">
        You get a one-time link to send the owner. They open it to set their own name, phone and
        password. The link works for 7 days.
      </p>
      <div className="mt-3 grid gap-3 sm:grid-cols-[2fr_2fr_1fr_auto] sm:items-end">
        <div>
          <label className="mb-1 block text-xs text-white/50" htmlFor="new-biz-name">Business name</label>
          <input
            id="new-biz-name"
            value={businessName}
            onChange={(e) => setBusinessName(e.target.value)}
            placeholder="e.g. Maji Safi Refills"
            className="w-full rounded-xl border border-white/15 bg-depth-900 px-3 py-2 text-sm text-white"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs text-white/50" htmlFor="new-biz-email">Owner&apos;s email</label>
          <input
            id="new-biz-email"
            type="email"
            value={ownerEmail}
            onChange={(e) => setOwnerEmail(e.target.value)}
            placeholder="owner@example.com"
            className="w-full rounded-xl border border-white/15 bg-depth-900 px-3 py-2 text-sm text-white"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs text-white/50" htmlFor="new-biz-tier">Plan</label>
          <select
            id="new-biz-tier"
            value={tier}
            onChange={(e) => setTier(e.target.value as TierId)}
            className="w-full rounded-xl border border-white/15 bg-depth-900 px-3 py-2 text-sm text-white"
          >
            {TIER_OPTIONS.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </div>
        <button
          type="button"
          disabled={busy}
          onClick={submit}
          className="tap-target rounded-xl2 bg-gradient-to-r from-flow-500 to-flow-700 px-4 text-sm font-semibold text-depth-950 disabled:opacity-60"
        >
          {busy ? 'Creating…' : 'Create business'}
        </button>
      </div>
    </div>
  );
}

function InviteLinkBox({
  link,
  onClose,
}: {
  link: { business: string; url: string; expiresAt: string };
  onClose: () => void;
}) {
  const { show } = useToast();
  return (
    <div className="rounded-xl2 border border-flow-500/40 bg-flow-500/10 p-4">
      <p className="text-sm font-semibold text-white">Owner invite link for {link.business}</p>
      <p className="mt-0.5 text-xs text-white/60">
        Copy it now and send it to the owner. It is shown only once and expires {fmtDate(link.expiresAt)}.
      </p>
      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        <input
          readOnly
          value={link.url}
          onFocus={(e) => e.target.select()}
          className="w-full rounded-xl border border-white/15 bg-depth-900 px-3 py-2 font-mono text-xs text-white"
        />
        <button
          type="button"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(link.url);
              show('Link copied', 'success');
            } catch {
              show('Select the link and copy it manually', 'info');
            }
          }}
          className="tap-target rounded-xl2 bg-flow-500 px-4 text-sm font-semibold text-depth-950"
        >
          Copy
        </button>
        <button
          type="button"
          onClick={onClose}
          className="tap-target rounded-xl2 border border-white/20 px-4 text-sm text-white/80"
        >
          Done
        </button>
      </div>
    </div>
  );
}

function BusinessCard({
  b,
  saving,
  onPatch,
  onReissue,
}: {
  b: BizRow;
  saving: boolean;
  onPatch: (id: string, update: Record<string, unknown>, label: string) => void;
  onReissue: (b: BizRow, ownerEmail: string) => void;
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
          {!b.owner && b.ownerInvite && (
            <p className="mt-0.5 text-xs text-cash-400">
              Owner not joined yet
              {b.ownerInvite.email
                ? ' · invite sent to ' + b.ownerInvite.email + ' · expires ' + fmtDate(b.ownerInvite.expiresAt)
                : ' · no active invite link'}
            </p>
          )}
          <p className="mt-0.5 text-xs text-white/40">Created {fmtDate(b.createdAt)}</p>
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
        {!b.owner && (
          <button
            type="button"
            disabled={saving}
            onClick={() => {
              const email = window.prompt('Owner\'s email for the new link', b.ownerInvite?.email ?? '');
              if (email && email.includes('@')) onReissue(b, email.trim());
            }}
            className="tap-target rounded-xl2 border border-flow-500/40 px-4 text-sm font-medium text-flow-300 disabled:opacity-60"
          >
            New owner link
          </button>
        )}
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
