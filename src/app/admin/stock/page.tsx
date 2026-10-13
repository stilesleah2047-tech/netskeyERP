"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { apiFetch, ApiError } from "@/lib/api";
import { AuthUser, Branch, Product } from "@/lib/types";
import { useToast } from "@/components/ui/Toast";
import { SkeletonTable } from "@/components/ui/Skeleton";
import EmptyState from "@/components/ui/EmptyState";

interface StockRow {
  branchId: string;
  branchName: string;
  productId: string;
  label: string;
  unit: string;
  quantity: number;
  status: "OUT" | "LOW" | "OK";
}

interface TransferRow {
  _id: string;
  fromBranchId: { _id: string; branchName: string } | string;
  toBranchId: { _id: string; branchName: string } | string;
  productId: { _id: string; label: string; unit?: string } | string;
  quantity: number;
  costTotal: number;
  note: string | null;
  createdBy?: { name: string } | null;
  createdAt: string;
}

const statusStyles: Record<StockRow["status"], string> = {
  OK: "bg-confirm-500/15 text-confirm-600",
  LOW: "bg-cash-500/15 text-cash-700",
  OUT: "bg-alert-500/15 text-alert-600",
};

function branchText(v: TransferRow["fromBranchId"]): string {
  return typeof v === "string" ? v : v?.branchName ?? "—";
}
function productText(v: TransferRow["productId"]): string {
  return typeof v === "string" ? v : v?.label ?? "—";
}

export default function StockPage() {
  const router = useRouter();
  const { show } = useToast();
  const [me, setMe] = useState<AuthUser | null>(null);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [stock, setStock] = useState<StockRow[]>([]);
  const [threshold, setThreshold] = useState(20);
  const [transfers, setTransfers] = useState<TransferRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterBranch, setFilterBranch] = useState("ALL");

  const isSuperAdmin = me?.role === "SUPER_ADMIN";

  // Physical-count adjustment form.
  const [adjBranch, setAdjBranch] = useState("");
  const [adjProduct, setAdjProduct] = useState("");
  const [adjCount, setAdjCount] = useState("");
  const [adjNote, setAdjNote] = useState("");
  const [adjSaving, setAdjSaving] = useState(false);

  // Transfer form.
  const [fromBranch, setFromBranch] = useState("");
  const [toBranch, setToBranch] = useState("");
  const [trProduct, setTrProduct] = useState("");
  const [trQty, setTrQty] = useState("");
  const [trNote, setTrNote] = useState("");
  const [trSaving, setTrSaving] = useState(false);

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
          setFilterBranch(result.user.branchId);
          setAdjBranch(result.user.branchId);
          setFromBranch(result.user.branchId);
        }
      } catch {
        router.replace("/login");
        return;
      }
      try {
        const [b, p] = await Promise.all([
          apiFetch<{ branches: Branch[] }>("/api/branches"),
          apiFetch<{ products: Product[] }>("/api/products"),
        ]);
        setBranches(b.branches);
        setProducts(p.products.filter((x) => x.isActive));
      } catch {
        // non-fatal; the forms simply have fewer options
      }
      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!me) return;
    loadStock();
    loadTransfers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me, filterBranch]);

  async function loadStock() {
    try {
      const q = isSuperAdmin && filterBranch !== "ALL" ? "?branchId=" + filterBranch : "";
      const res = await apiFetch<{ stock: StockRow[]; lowStockThreshold: number }>(
        "/api/inventory/stock" + q
      );
      setStock(res.stock);
      setThreshold(res.lowStockThreshold);
    } catch (err) {
      show(err instanceof ApiError ? err.message : "Could not load stock", "error");
    }
  }

  async function loadTransfers() {
    try {
      const res = await apiFetch<{ transfers: TransferRow[] }>("/api/inventory/transfers");
      setTransfers(res.transfers);
    } catch {
      // managers/owners only; ignore errors silently
    }
  }

  async function submitAdjustment(e: React.FormEvent) {
    e.preventDefault();
    const counted = Number(adjCount);
    if (!adjProduct || adjCount === "" || Number.isNaN(counted) || counted < 0) {
      show("Pick a product and enter the counted quantity.", "error");
      return;
    }
    if (isSuperAdmin && !adjBranch) {
      show("Choose which branch you counted.", "error");
      return;
    }
    setAdjSaving(true);
    try {
      const res = await apiFetch<{ previous: number; counted: number; delta: number }>(
        "/api/inventory/adjustments",
        {
          method: "POST",
          body: JSON.stringify({
            branchId: isSuperAdmin ? adjBranch : undefined,
            productId: adjProduct,
            countedQuantity: counted,
            note: adjNote.trim() || undefined,
          }),
        }
      );
      const d = res.delta;
      show(
        d === 0
          ? "Count matched — no change needed."
          : `Stock corrected by ${d > 0 ? "+" : ""}${d} (was ${res.previous}, now ${res.counted}).`,
        "success"
      );
      setAdjCount("");
      setAdjNote("");
      await loadStock();
    } catch (err) {
      show(err instanceof ApiError ? err.message : "Could not record the count", "error");
    }
    setAdjSaving(false);
  }

  async function submitTransfer(e: React.FormEvent) {
    e.preventDefault();
    const qty = Number(trQty);
    const source = isSuperAdmin ? fromBranch : me?.branchId ?? "";
    if (!source || !toBranch || !trProduct || !qty || qty <= 0) {
      show("Fill in the branches, product and a quantity.", "error");
      return;
    }
    if (source === toBranch) {
      show("Source and destination must be different branches.", "error");
      return;
    }
    setTrSaving(true);
    try {
      await apiFetch("/api/inventory/transfers", {
        method: "POST",
        body: JSON.stringify({
          fromBranchId: source,
          toBranchId: toBranch,
          productId: trProduct,
          quantity: qty,
          note: trNote.trim() || undefined,
        }),
      });
      show("Transfer recorded.", "success");
      setTrQty("");
      setTrNote("");
      await loadStock();
      await loadTransfers();
    } catch (err) {
      show(err instanceof ApiError ? err.message : "Could not complete the transfer", "error");
    }
    setTrSaving(false);
  }

  const branchName = useMemo(() => {
    const m: Record<string, string> = {};
    branches.forEach((b) => (m[b._id] = b.branchName));
    return m;
  }, [branches]);

  if (loading || !me) {
    return (
      <main className="min-h-screen bg-sand-50 pb-12">
        <header className="bg-depth-900 px-5 pb-8 pt-8">
          <div className="mx-auto h-14 max-w-5xl" />
        </header>
        <div className="mx-auto -mt-4 max-w-5xl px-5">
          <SkeletonTable rows={5} cols={4} />
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-sand-50 pb-12">
      <header className="bg-depth-900 px-5 pb-8 pt-8 text-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between">
          <div>
            <p className="text-xs uppercase tracking-wide text-flow-400">{me.businessName ?? "Vessel"}</p>
            <h1 className="font-display text-xl font-bold">Stock</h1>
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
        {/* On-hand stock */}
        <div className="rounded-xl2 bg-white shadow-soft">
          <div className="flex items-center justify-between border-b border-depth-100 px-4 py-3">
            <h2 className="font-display font-semibold text-depth-900">On-hand stock</h2>
            {isSuperAdmin && branches.length > 0 && (
              <select
                value={filterBranch}
                onChange={(e) => setFilterBranch(e.target.value)}
                className="rounded-lg border border-depth-200 px-2 py-1 text-sm"
              >
                <option value="ALL">All branches</option>
                {branches.map((b) => (
                  <option key={b._id} value={b._id}>
                    {b.branchName}
                  </option>
                ))}
              </select>
            )}
          </div>
          {stock.length === 0 ? (
            <EmptyState
              icon="📦"
              title="No stock movements yet"
              description="On-hand stock is built from purchases, sales and transfers. Record a purchase or a physical count to get started."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-depth-100 text-left text-xs uppercase tracking-wide text-depth-500">
                    {(filterBranch === "ALL" && isSuperAdmin) && <th className="px-4 py-2">Branch</th>}
                    <th className="px-4 py-2">Product</th>
                    <th className="px-4 py-2 text-right">On hand</th>
                    <th className="px-4 py-2 text-right">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {stock.map((r) => (
                    <tr key={r.branchId + r.productId} className="border-b border-depth-50">
                      {(filterBranch === "ALL" && isSuperAdmin) && (
                        <td className="px-4 py-2 text-depth-600">{r.branchName}</td>
                      )}
                      <td className="px-4 py-2 font-medium text-depth-900">{r.label}</td>
                      <td className="px-4 py-2 text-right tabular-nums text-depth-900">
                        {r.quantity}
                        {r.unit ? <span className="ml-1 text-xs text-depth-400">{r.unit}</span> : null}
                      </td>
                      <td className="px-4 py-2 text-right">
                        <span className={"rounded-full px-2.5 py-1 text-xs font-medium " + statusStyles[r.status]}>
                          {r.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="px-4 py-2 text-xs text-depth-400">
                Low-stock warning at or below {threshold} units. A negative figure means recorded
                sales exceeded recorded stock — take a physical count to reconcile.
              </p>
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          {/* Physical count adjustment */}
          <form onSubmit={submitAdjustment} className="rounded-xl2 bg-white p-4 shadow-soft">
            <h2 className="mb-1 font-display font-semibold text-depth-900">Record a physical count</h2>
            <p className="mb-3 text-xs text-depth-500">
              Correct the records to what you actually counted. The difference is logged as an
              auditable adjustment — nothing is overwritten.
            </p>
            <div className="space-y-3">
              {isSuperAdmin && (
                <div>
                  <label className="mb-1 block text-xs font-medium text-depth-600">Branch</label>
                  <select value={adjBranch} onChange={(e) => setAdjBranch(e.target.value)} className="tap-target w-full rounded-xl border border-depth-200 px-3">
                    <option value="">Select a branch…</option>
                    {branches.map((b) => (
                      <option key={b._id} value={b._id}>{b.branchName}</option>
                    ))}
                  </select>
                </div>
              )}
              <div>
                <label className="mb-1 block text-xs font-medium text-depth-600">Product</label>
                <select value={adjProduct} onChange={(e) => setAdjProduct(e.target.value)} className="tap-target w-full rounded-xl border border-depth-200 px-3">
                  <option value="">Select a product…</option>
                  {products.map((p) => (
                    <option key={p._id} value={p._id}>{p.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-depth-600">Counted quantity</label>
                <input type="number" min={0} value={adjCount} onChange={(e) => setAdjCount(e.target.value)} className="tap-target w-full rounded-xl border border-depth-200 px-3" />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-depth-600">Note (optional)</label>
                <input value={adjNote} onChange={(e) => setAdjNote(e.target.value)} placeholder="e.g. monthly stock take" className="tap-target w-full rounded-xl border border-depth-200 px-3" />
              </div>
            </div>
            <button type="submit" disabled={adjSaving} className="tap-target mt-4 w-full rounded-xl2 bg-flow-500 font-display font-semibold text-depth-950 disabled:opacity-60">
              {adjSaving ? "Saving…" : "Save count"}
            </button>
          </form>

          {/* Transfer */}
          <form onSubmit={submitTransfer} className="rounded-xl2 bg-white p-4 shadow-soft">
            <h2 className="mb-1 font-display font-semibold text-depth-900">Transfer stock</h2>
            <p className="mb-3 text-xs text-depth-500">
              Move stock between branches. Unlike a sale, a transfer is blocked if the source branch
              doesn&apos;t have enough on hand.
            </p>
            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-depth-600">From</label>
                {isSuperAdmin ? (
                  <select value={fromBranch} onChange={(e) => setFromBranch(e.target.value)} className="tap-target w-full rounded-xl border border-depth-200 px-3">
                    <option value="">Select a branch…</option>
                    {branches.map((b) => (
                      <option key={b._id} value={b._id}>{b.branchName}</option>
                    ))}
                  </select>
                ) : (
                  <input disabled value={me.branchName ?? branchName[me.branchId ?? ""] ?? "Your branch"} className="tap-target w-full rounded-xl border border-depth-200 bg-sand-50 px-3 text-depth-500" />
                )}
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-depth-600">To</label>
                <select value={toBranch} onChange={(e) => setToBranch(e.target.value)} className="tap-target w-full rounded-xl border border-depth-200 px-3">
                  <option value="">Select a branch…</option>
                  {branches
                    .filter((b) => b._id !== (isSuperAdmin ? fromBranch : me.branchId))
                    .map((b) => (
                      <option key={b._id} value={b._id}>{b.branchName}</option>
                    ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-depth-600">Product</label>
                <select value={trProduct} onChange={(e) => setTrProduct(e.target.value)} className="tap-target w-full rounded-xl border border-depth-200 px-3">
                  <option value="">Select a product…</option>
                  {products.map((p) => (
                    <option key={p._id} value={p._id}>{p.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-depth-600">Quantity</label>
                <input type="number" min={1} value={trQty} onChange={(e) => setTrQty(e.target.value)} className="tap-target w-full rounded-xl border border-depth-200 px-3" />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-depth-600">Note (optional)</label>
                <input value={trNote} onChange={(e) => setTrNote(e.target.value)} className="tap-target w-full rounded-xl border border-depth-200 px-3" />
              </div>
            </div>
            <button type="submit" disabled={trSaving} className="tap-target mt-4 w-full rounded-xl2 bg-flow-500 font-display font-semibold text-depth-950 disabled:opacity-60">
              {trSaving ? "Transferring…" : "Record transfer"}
            </button>
          </form>
        </div>

        {/* Transfer history */}
        <div className="rounded-xl2 bg-white shadow-soft">
          <div className="border-b border-depth-100 px-4 py-3">
            <h2 className="font-display font-semibold text-depth-900">Recent transfers</h2>
          </div>
          {transfers.length === 0 ? (
            <EmptyState icon="🔁" title="No transfers yet" description="Inter-branch stock movements will appear here." />
          ) : (
            <ul className="divide-y divide-depth-100">
              {transfers.map((t) => (
                <li key={t._id} className="flex items-center justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <p className="font-medium text-depth-900">
                      {t.quantity} × {productText(t.productId)}
                    </p>
                    <p className="truncate text-xs text-depth-500">
                      {branchText(t.fromBranchId)} → {branchText(t.toBranchId)}
                      {t.createdBy?.name ? " · by " + t.createdBy.name : ""}
                    </p>
                  </div>
                  <span className="shrink-0 text-xs text-depth-400">
                    {new Date(t.createdAt).toLocaleDateString()}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </main>
  );
}
