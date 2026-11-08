"use client";

import { StatCard, ksh, ago, STATUS_STYLES, type SubStatus } from "@/components/platform/shared";

export interface Overview {
  generatedAt: string;
  totals: {
    businesses: number;
    active: number;
    trialing: number;
    suspended: number;
    users: number;
    branches: number;
    mrr: number;
    salesToday: number;
    salesTodayCount: number;
    sales7d: number;
    sales30d: number;
    sales30dCount: number;
  };
  trend: { date: string; revenue: number; count: number }[];
  businesses: {
    id: string;
    name: string;
    tierName: string;
    subscriptionStatus: SubStatus;
    hasOwner: boolean;
    users: number;
    branches: number;
    salesToday: number;
    salesTodayCount: number;
    sales7d: number;
    sales30d: number;
    lastSaleAt: string | null;
    lastSeenAt: string | null;
  }[];
  alerts: { level: "high" | "medium" | "info"; businessId: string | null; businessName: string | null; message: string }[];
}

const ALERT_STYLES = {
  high: "border-alert-500/40 bg-alert-500/10 text-alert-300",
  medium: "border-cash-500/40 bg-cash-500/10 text-cash-300",
  info: "border-white/15 bg-white/5 text-white/70",
};

export default function OverviewTab({ data, onOpen }: { data: Overview; onOpen: (id: string) => void }) {
  const t = data.totals;
  const max = Math.max(1, ...data.trend.map((d) => d.revenue));

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Sales today" value={ksh(t.salesToday)} accent="text-flow-300" />
        <StatCard label="Sales · 7 days" value={ksh(t.sales7d)} />
        <StatCard label="Sales · 30 days" value={ksh(t.sales30d)} />
        <StatCard label="MRR (active plans)" value={ksh(t.mrr)} accent="text-confirm-400" />
        <StatCard label="Businesses" value={`${t.businesses} (${t.active} active)`} />
        <StatCard label="Trialing / suspended" value={`${t.trialing} / ${t.suspended}`} />
        <StatCard label="Branches" value={String(t.branches)} />
        <StatCard label="Active users" value={String(t.users)} />
      </div>

      <section className="rounded-xl2 border border-white/10 bg-white/5 p-4">
        <h2 className="font-display text-base font-semibold text-white">Sales across all businesses · last 14 days</h2>
        <div className="mt-4 flex h-40 items-end gap-1.5" role="img" aria-label="Daily sales for the last 14 days">
          {data.trend.map((d) => (
            <div key={d.date} className="flex h-full flex-1 flex-col items-center justify-end gap-1" title={`${d.date}: ${ksh(d.revenue)} · ${d.count} sales`}>
              <div
                className="w-full rounded-t bg-gradient-to-t from-flow-700 to-flow-400"
                style={{ height: `${Math.max(2, (d.revenue / max) * 100)}%` }}
              />
              <span className="text-[10px] text-white/40">{d.date.slice(8)}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-xl2 border border-white/10 bg-white/5 p-4">
        <h2 className="font-display text-base font-semibold text-white">Needs attention</h2>
        {data.alerts.length === 0 ? (
          <p className="mt-2 text-sm text-white/60">Nothing needs attention right now.</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {data.alerts.map((a, i) => (
              <li key={i} className={"flex flex-wrap items-center justify-between gap-2 rounded-xl border px-3 py-2 text-sm " + ALERT_STYLES[a.level]}>
                <span>
                  {a.businessName && <strong className="text-white">{a.businessName}: </strong>}
                  {a.message}
                </span>
                {a.businessId && (
                  <button onClick={() => onOpen(a.businessId!)} className="text-xs font-semibold text-flow-300 underline">
                    Open
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-xl2 border border-white/10 bg-white/5 p-4">
        <h2 className="font-display text-base font-semibold text-white">Business activity</h2>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="text-xs uppercase tracking-wide text-white/40">
              <tr>
                <th className="py-2 pr-3 font-medium">Business</th>
                <th className="py-2 pr-3 font-medium">Status</th>
                <th className="py-2 pr-3 text-right font-medium">Today</th>
                <th className="py-2 pr-3 text-right font-medium">7 days</th>
                <th className="py-2 pr-3 text-right font-medium">30 days</th>
                <th className="py-2 pr-3 font-medium">Last sale</th>
                <th className="py-2 pr-3 font-medium">Last seen</th>
              </tr>
            </thead>
            <tbody>
              {data.businesses.map((b) => (
                <tr key={b.id} onClick={() => onOpen(b.id)} className="cursor-pointer border-t border-white/5 text-white/80 hover:bg-white/5">
                  <td className="py-2 pr-3">
                    <span className="font-medium text-white">{b.name}</span>
                    <span className="block text-xs text-white/40">
                      {b.tierName} · {b.branches} branch(es) · {b.users} user(s){b.hasOwner ? "" : " · owner pending"}
                    </span>
                  </td>
                  <td className="py-2 pr-3">
                    <span className={"rounded-full px-2 py-0.5 text-xs " + STATUS_STYLES[b.subscriptionStatus]}>{b.subscriptionStatus}</span>
                  </td>
                  <td className="py-2 pr-3 text-right">{ksh(b.salesToday)}</td>
                  <td className="py-2 pr-3 text-right">{ksh(b.sales7d)}</td>
                  <td className="py-2 pr-3 text-right">{ksh(b.sales30d)}</td>
                  <td className="py-2 pr-3 text-white/60">{ago(b.lastSaleAt)}</td>
                  <td className="py-2 pr-3 text-white/60">{ago(b.lastSeenAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <p className="text-xs text-white/30">Updated {ago(data.generatedAt)} · refreshes every minute</p>
    </div>
  );
}
