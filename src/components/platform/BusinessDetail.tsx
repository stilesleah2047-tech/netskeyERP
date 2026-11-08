"use client";

import { useEffect, useState } from "react";
import { apiFetch, ApiError } from "@/lib/api";
import { ksh, fmtDate, fmtDateTime, ago, STATUS_STYLES, type SubStatus } from "@/components/platform/shared";

interface Detail {
  business: {
    id: string;
    name: string;
    tierName: string;
    subscriptionStatus: SubStatus;
    trialEndsAt: string | null;
    currentPeriodEnd: string | null;
    createdAt: string;
    ownerId: string | null;
  };
  branches: { id: string; name: string; city: string; isActive: boolean; manager: string | null; sales30d: number; count30d: number; cash30d: number; mpesa30d: number }[];
  users: { id: string; name: string; email: string | null; phoneNumber: string; role: string; isOwner: boolean; branch: string | null; isActive: boolean; lastSeenAt: string | null; devices: number }[];
  pendingInvites: { role: string; email: string | null; expiresAt: string }[];
  recentSales: { id: string; at: string; branch: string | null; staff: string | null; product: string | null; quantity: number; amount: number; method: string; status: string; offline: boolean; priceMismatch: boolean; receiptNo: string | null }[];
}

const ROLE_LABEL: Record<string, string> = { SUPER_ADMIN: "Owner", BRANCH_MANAGER: "Manager", DELIVERY: "Cashier" };

export default function BusinessDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const [data, setData] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setData(null);
    setError(null);
    apiFetch<Detail>("/api/platform/businesses/" + id)
      .then(setData)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Could not load this business"));
  }, [id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const total30 = data?.branches.reduce((n, b) => n + b.sales30d, 0) ?? 0;

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/60" onClick={onClose}>
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Business details"
        onClick={(e) => e.stopPropagation()}
        className="h-full w-full max-w-3xl overflow-y-auto bg-depth-950 p-5 text-white shadow-2xl"
        style={{ paddingTop: "max(1.25rem, env(safe-area-inset-top))" }}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-flow-400">Business</p>
            <h2 className="font-display text-xl font-bold">{data?.business.name ?? "Loading…"}</h2>
            {data && (
              <p className="mt-1 text-xs text-white/50">
                <span className={"mr-2 rounded-full px-2 py-0.5 " + STATUS_STYLES[data.business.subscriptionStatus]}>
                  {data.business.subscriptionStatus}
                </span>
                {data.business.tierName} · created {fmtDate(data.business.createdAt)} · trial ends {fmtDate(data.business.trialEndsAt)} · paid through {fmtDate(data.business.currentPeriodEnd)}
              </p>
            )}
          </div>
          <button onClick={onClose} className="tap-target rounded-xl2 border border-white/20 px-4 text-sm">Close</button>
        </div>

        {error && <p className="mt-6 text-sm text-alert-400">{error}</p>}
        {!data && !error && <div className="mt-6 h-40 animate-pulse rounded-xl2 bg-white/5" />}

        {data && (
          <div className="mt-6 space-y-6">
            {!data.business.ownerId && (
              <p className="rounded-xl border border-cash-500/40 bg-cash-500/10 px-3 py-2 text-sm text-cash-300">
                The owner has not joined yet.
                {data.pendingInvites.find((i) => i.role === "SUPER_ADMIN")
                  ? " Invite link expires " + fmtDate(data.pendingInvites.find((i) => i.role === "SUPER_ADMIN")!.expiresAt) + "."
                  : " No active link: issue a new one from the Businesses tab."}
              </p>
            )}

            <section>
              <h3 className="font-display text-base font-semibold">Branches · sales in the last 30 days: {ksh(total30)}</h3>
              <div className="mt-2 overflow-x-auto rounded-xl2 border border-white/10">
                <table className="w-full min-w-[560px] text-left text-sm">
                  <thead className="bg-white/5 text-xs uppercase tracking-wide text-white/40">
                    <tr>
                      <th className="px-3 py-2 font-medium">Branch</th>
                      <th className="px-3 py-2 font-medium">Manager</th>
                      <th className="px-3 py-2 text-right font-medium">Sales</th>
                      <th className="px-3 py-2 text-right font-medium">Cash</th>
                      <th className="px-3 py-2 text-right font-medium">M-Pesa</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.branches.length === 0 && (
                      <tr><td colSpan={5} className="px-3 py-4 text-center text-white/50">No branches yet</td></tr>
                    )}
                    {data.branches.map((b) => (
                      <tr key={b.id} className="border-t border-white/5">
                        <td className="px-3 py-2">
                          {b.name} <span className="text-xs text-white/40">{b.city}{b.isActive ? "" : " · inactive"}</span>
                        </td>
                        <td className="px-3 py-2 text-white/70">{b.manager ?? "—"}</td>
                        <td className="px-3 py-2 text-right">{ksh(b.sales30d)} <span className="text-xs text-white/40">({b.count30d})</span></td>
                        <td className="px-3 py-2 text-right text-white/70">{ksh(b.cash30d)}</td>
                        <td className="px-3 py-2 text-right text-white/70">{ksh(b.mpesa30d)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <section>
              <h3 className="font-display text-base font-semibold">People ({data.users.length})</h3>
              <div className="mt-2 overflow-x-auto rounded-xl2 border border-white/10">
                <table className="w-full min-w-[640px] text-left text-sm">
                  <thead className="bg-white/5 text-xs uppercase tracking-wide text-white/40">
                    <tr>
                      <th className="px-3 py-2 font-medium">Name</th>
                      <th className="px-3 py-2 font-medium">Role</th>
                      <th className="px-3 py-2 font-medium">Branch</th>
                      <th className="px-3 py-2 font-medium">Contact</th>
                      <th className="px-3 py-2 font-medium">Last seen</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.users.map((u) => (
                      <tr key={u.id} className={"border-t border-white/5 " + (u.isActive ? "" : "opacity-50")}>
                        <td className="px-3 py-2">{u.name}{u.isActive ? "" : " (deactivated)"}</td>
                        <td className="px-3 py-2 text-white/70">{u.isOwner ? "Owner" : ROLE_LABEL[u.role] ?? u.role}</td>
                        <td className="px-3 py-2 text-white/70">{u.branch ?? "—"}</td>
                        <td className="px-3 py-2 text-xs text-white/60">{u.email}<br />{u.phoneNumber}</td>
                        <td className="px-3 py-2 text-white/60">{ago(u.lastSeenAt)}{u.devices > 1 ? ` · ${u.devices} devices` : ""}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {data.pendingInvites.filter((i) => i.role !== "SUPER_ADMIN").length > 0 && (
                <p className="mt-2 text-xs text-white/50">
                  Pending staff invites:{" "}
                  {data.pendingInvites.filter((i) => i.role !== "SUPER_ADMIN").map((i) => `${i.email ?? "no email"} (${ROLE_LABEL[i.role] ?? i.role})`).join(", ")}
                </p>
              )}
            </section>

            <section>
              <h3 className="font-display text-base font-semibold">Most recent sales</h3>
              <div className="mt-2 overflow-x-auto rounded-xl2 border border-white/10">
                <table className="w-full min-w-[640px] text-left text-sm">
                  <thead className="bg-white/5 text-xs uppercase tracking-wide text-white/40">
                    <tr>
                      <th className="px-3 py-2 font-medium">When</th>
                      <th className="px-3 py-2 font-medium">Branch · staff</th>
                      <th className="px-3 py-2 font-medium">Item</th>
                      <th className="px-3 py-2 text-right font-medium">Amount</th>
                      <th className="px-3 py-2 font-medium">Payment</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.recentSales.length === 0 && (
                      <tr><td colSpan={5} className="px-3 py-4 text-center text-white/50">No sales yet</td></tr>
                    )}
                    {data.recentSales.map((s) => (
                      <tr key={s.id} className="border-t border-white/5">
                        <td className="px-3 py-2 text-white/70">{fmtDateTime(s.at)}</td>
                        <td className="px-3 py-2 text-white/70">{s.branch ?? "—"} · {s.staff ?? "—"}</td>
                        <td className="px-3 py-2">{s.quantity} × {s.product ?? "—"}</td>
                        <td className="px-3 py-2 text-right">{ksh(s.amount)}</td>
                        <td className="px-3 py-2 text-xs text-white/60">
                          {s.method} · {s.status}
                          {s.offline && " · synced offline"}
                          {s.priceMismatch && <span className="text-cash-400"> · price differed</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </div>
        )}
      </aside>
    </div>
  );
}
