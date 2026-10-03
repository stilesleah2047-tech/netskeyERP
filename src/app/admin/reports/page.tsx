"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { apiFetch, ApiError } from "@/lib/api";
import { AuthUser, Branch } from "@/lib/types";
import { useToast } from "@/components/ui/Toast";
import { SkeletonCardGrid } from "@/components/ui/Skeleton";

interface ProfitReport {
  scope: "global" | "branch";
  range: { from: string; to: string };
  revenue: number;
  cashTotal: number;
  mpesaTotal: number;
  salesCount: number;
  costOfGoods: number;
  purchaseCount: number;
  grossProfit: number;
  expenses: number;
  expenseCount: number;
  netProfit: number;
}

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export default function ReportsPage() {
  const router = useRouter();
  const { show } = useToast();
  const [me, setMe] = useState<AuthUser | null>(null);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [report, setReport] = useState<ProfitReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetching, setFetching] = useState(false);

  const monthStart = new Date();
  monthStart.setDate(1);
  const [branchId, setBranchId] = useState("ALL");
  const [from, setFrom] = useState(isoDay(monthStart));
  const [to, setTo] = useState(isoDay(new Date()));

  const isSuper = me?.role === "SUPER_ADMIN";

  useEffect(() => {
    (async () => {
      try {
        const result = await apiFetch<{ user: AuthUser }>("/api/auth/me");
        if (result.user.role === "DELIVERY") {
          router.replace("/terminal");
          return;
        }
        setMe(result.user);
        if (result.user.role !== "SUPER_ADMIN" && result.user.branchId) {
          setBranchId(result.user.branchId);
        }
        if (result.user.role === "SUPER_ADMIN") {
          try {
            const br = await apiFetch<{ branches: Branch[] }>("/api/branches");
            setBranches(br.branches);
          } catch {
            /* best-effort */
          }
        }
        await runReport(result.user.role === "SUPER_ADMIN" ? "ALL" : result.user.branchId ?? "ALL");
      } catch {
        router.replace("/login");
        return;
      }
      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function runReport(forcedBranch?: string) {
    setFetching(true);
    try {
      const b = forcedBranch ?? branchId;
      const params = new URLSearchParams();
      if (b && b !== "ALL") params.set("branchId", b);
      if (from) params.set("from", new Date(from).toISOString());
      // include the whole "to" day
      if (to) {
        const end = new Date(to);
        end.setHours(23, 59, 59, 999);
        params.set("to", end.toISOString());
      }
      const result = await apiFetch<ProfitReport>("/api/reports/profit?" + params.toString());
      setReport(result);
    } catch (err) {
      show(err instanceof ApiError ? err.message : "Could not load report", "error");
    }
    setFetching(false);
  }

  function exportCsv() {
    if (!report) return;
    const rows: [string, string | number][] = [
      ["Metric", "Value (KES)"],
      ["Range from", report.range.from.slice(0, 10)],
      ["Range to", report.range.to.slice(0, 10)],
      ["Revenue", report.revenue],
      ["  Cash", report.cashTotal],
      ["  M-Pesa", report.mpesaTotal],
      ["Sales count", report.salesCount],
      ["Cost of goods", report.costOfGoods],
      ["Gross profit", report.grossProfit],
      ["Expenses", report.expenses],
      ["Estimated net profit", report.netProfit],
    ];
    const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `vessel-profit-${report.range.from.slice(0, 10)}_${report.range.to.slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (loading || !me) {
    return (
      <main className="min-h-screen bg-sand-50 pb-12">
        <header className="bg-depth-900 px-5 pb-8 pt-8">
          <div className="mx-auto h-14 max-w-5xl" />
        </header>
        <div className="mx-auto -mt-4 max-w-5xl px-5">
          <SkeletonCardGrid count={5} />
        </div>
      </main>
    );
  }

  const money = (n: number) => "KES " + n.toLocaleString();
  const netPositive = (report?.netProfit ?? 0) >= 0;

  return (
    <main className="min-h-screen bg-sand-50 pb-12">
      <header className="bg-depth-900 px-5 pb-8 pt-8 text-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between">
          <div>
            <p className="text-xs uppercase tracking-wide text-flow-400">Vessel</p>
            <h1 className="font-display text-xl font-bold">Reports &amp; profit overview</h1>
          </div>
          <Link
            href="/admin/dashboard"
            className="tap-target flex items-center rounded-xl2 bg-white/10 px-4 text-sm font-medium text-white hover:bg-white/15"
          >
            ← Dashboard
          </Link>
        </div>
      </header>

      <div className="mx-auto -mt-4 max-w-5xl space-y-5 px-5">
        {/* Filters */}
        <div className="rounded-xl2 bg-white p-4 shadow-soft">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
            {isSuper && (
              <div>
                <label className="mb-1 block text-xs font-medium text-depth-600">Branch</label>
                <select
                  value={branchId}
                  onChange={(e) => setBranchId(e.target.value)}
                  className="tap-target w-full rounded-xl border border-depth-200 bg-white px-3"
                >
                  <option value="ALL">All branches</option>
                  {branches.map((b) => (
                    <option key={b._id} value={b._id}>
                      {b.branchName}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div>
              <label className="mb-1 block text-xs font-medium text-depth-600">From</label>
              <input
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                className="tap-target w-full rounded-xl border border-depth-200 px-3"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-depth-600">To</label>
              <input
                type="date"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                className="tap-target w-full rounded-xl border border-depth-200 px-3"
              />
            </div>
            <div className="flex items-end">
              <button
                onClick={() => runReport()}
                disabled={fetching}
                className="tap-target w-full rounded-full bg-gradient-to-r from-flow-500 to-flow-700 font-display font-semibold text-white disabled:opacity-60"
              >
                {fetching ? "Loading…" : "Run report"}
              </button>
            </div>
          </div>
        </div>

        {report && (
          <>
            {/* Profit cards */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <div className="rounded-xl2 bg-white p-5 shadow-soft">
                <p className="text-xs uppercase tracking-wide text-depth-500">Revenue (sales)</p>
                <p className="mt-1 font-display text-2xl font-bold text-depth-900">{money(report.revenue)}</p>
                <p className="mt-1 text-xs text-depth-500">
                  {report.salesCount} sales · cash {money(report.cashTotal)} · M-Pesa {money(report.mpesaTotal)}
                </p>
              </div>
              <div className="rounded-xl2 bg-white p-5 shadow-soft">
                <p className="text-xs uppercase tracking-wide text-depth-500">Cost of goods</p>
                <p className="mt-1 font-display text-2xl font-bold text-depth-900">{money(report.costOfGoods)}</p>
                <p className="mt-1 text-xs text-depth-500">{report.purchaseCount} purchases in range</p>
              </div>
              <div className="rounded-xl2 bg-white p-5 shadow-soft">
                <p className="text-xs uppercase tracking-wide text-depth-500">Gross profit</p>
                <p className="mt-1 font-display text-2xl font-bold text-flow-700">{money(report.grossProfit)}</p>
                <p className="mt-1 text-xs text-depth-500">Revenue − cost of goods</p>
              </div>
              <div className="rounded-xl2 bg-white p-5 shadow-soft">
                <p className="text-xs uppercase tracking-wide text-depth-500">Expenses</p>
                <p className="mt-1 font-display text-2xl font-bold text-depth-900">{money(report.expenses)}</p>
                <p className="mt-1 text-xs text-depth-500">{report.expenseCount} expenses in range</p>
              </div>
              <div className="rounded-xl2 bg-white p-5 shadow-soft sm:col-span-2 lg:col-span-2">
                <p className="text-xs uppercase tracking-wide text-depth-500">Estimated net profit</p>
                <p
                  className={
                    "mt-1 font-display text-3xl font-bold " +
                    (netPositive ? "text-confirm-600" : "text-alert-600")
                  }
                >
                  {money(report.netProfit)}
                </p>
                <p className="mt-1 text-xs text-depth-500">Gross profit − expenses</p>
              </div>
            </div>

            <div className="flex items-center justify-between rounded-xl2 border border-depth-200 bg-sand-100 px-4 py-3">
              <p className="text-xs text-depth-500">
                Management / profit overview — a decision aid, not full accounting software.
              </p>
              <button
                onClick={exportCsv}
                className="tap-target shrink-0 rounded-full border border-depth-300 bg-white px-5 text-sm font-medium text-depth-800 hover:bg-sand-50"
              >
                Export CSV
              </button>
            </div>
          </>
        )}
      </div>
    </main>
  );
}
