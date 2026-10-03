"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { apiFetch, ApiError } from "@/lib/api";
import { AuthUser, Branch, Product } from "@/lib/types";
import { useToast } from "@/components/ui/Toast";
import { SkeletonList } from "@/components/ui/Skeleton";
import EmptyState from "@/components/ui/EmptyState";

interface PurchaseRow {
  _id: string;
  branchId: { _id: string; branchName: string } | string;
  supplierName: string;
  productLabel: string;
  quantity: number;
  unitCost: number;
  totalCost: number;
  reference: string | null;
  recordedBy: { _id: string; name: string } | string | null;
  createdAt: string;
}

function branchLabel(b: PurchaseRow["branchId"]): string {
  return typeof b === "object" && b ? b.branchName : "—";
}
function recorderLabel(r: PurchaseRow["recordedBy"]): string {
  return typeof r === "object" && r ? r.name : "—";
}

export default function PurchasesPage() {
  const router = useRouter();
  const { show } = useToast();
  const [me, setMe] = useState<AuthUser | null>(null);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [purchases, setPurchases] = useState<PurchaseRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // form state
  const [branchId, setBranchId] = useState("");
  const [supplierName, setSupplierName] = useState("");
  const [productId, setProductId] = useState("");
  const [quantity, setQuantity] = useState("");
  const [unitCost, setUnitCost] = useState("");
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");

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
        try {
          const [br, pr] = await Promise.all([
            apiFetch<{ branches: Branch[] }>("/api/branches"),
            apiFetch<{ products: Product[] }>("/api/products"),
          ]);
          setBranches(br.branches);
          setProducts(pr.products);
        } catch {
          /* best-effort */
        }
        await loadPurchases();
      } catch {
        router.replace("/login");
        return;
      }
      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadPurchases() {
    const result = await apiFetch<{ purchases: PurchaseRow[] }>("/api/purchases");
    setPurchases(result.purchases);
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const qty = parseInt(quantity, 10);
    const cost = parseFloat(unitCost);
    if (!supplierName.trim()) {
      setError("Supplier name is required.");
      return;
    }
    if (!productId) {
      setError("Choose the product purchased.");
      return;
    }
    if (!Number.isInteger(qty) || qty <= 0) {
      setError("Enter a valid quantity.");
      return;
    }
    if (!Number.isFinite(cost) || cost < 0) {
      setError("Enter a valid buying price.");
      return;
    }
    if (isSuper && !branchId) {
      setError("Select the branch this purchase belongs to.");
      return;
    }

    setSaving(true);
    try {
      await apiFetch("/api/purchases", {
        method: "POST",
        body: JSON.stringify({
          branchId: branchId || undefined,
          supplierName: supplierName.trim(),
          productId,
          quantity: qty,
          unitCost: cost,
          reference: reference.trim() || undefined,
          notes: notes.trim() || undefined,
        }),
      });
      show("Purchase recorded · stock increased", "success");
      setQuantity("");
      setUnitCost("");
      setReference("");
      setNotes("");
      await loadPurchases();
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "Could not record purchase";
      setError(message);
      show(message, "error");
    }
    setSaving(false);
  }

  const total = purchases.reduce((s, p) => s + p.totalCost, 0);
  const previewTotal =
    quantity && unitCost ? (parseInt(quantity, 10) || 0) * (parseFloat(unitCost) || 0) : 0;

  if (loading || !me) {
    return (
      <main className="min-h-screen bg-sand-50 pb-12">
        <header className="bg-depth-900 px-5 pb-8 pt-8">
          <div className="mx-auto h-14 max-w-4xl" />
        </header>
        <div className="mx-auto -mt-4 max-w-4xl px-5">
          <SkeletonList rows={4} />
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-sand-50 pb-12">
      <header className="bg-depth-900 px-5 pb-8 pt-8 text-white">
        <div className="mx-auto flex max-w-4xl items-center justify-between">
          <div>
            <p className="text-xs uppercase tracking-wide text-flow-400">Vessel</p>
            <h1 className="font-display text-xl font-bold">Purchases</h1>
          </div>
          <Link
            href="/admin/dashboard"
            className="tap-target flex items-center rounded-xl2 bg-white/10 px-4 text-sm font-medium text-white hover:bg-white/15"
          >
            ← Dashboard
          </Link>
        </div>
      </header>

      <div className="mx-auto -mt-4 max-w-4xl space-y-5 px-5">
        {error && (
          <div className="rounded-xl2 border border-alert-500/30 bg-alert-500/10 px-4 py-3 text-sm text-alert-600">
            {error}
          </div>
        )}

        {/* Record form */}
        <form onSubmit={handleAdd} className="rounded-xl2 bg-white p-4 shadow-soft">
          <h2 className="mb-3 font-display font-semibold text-depth-900">Record a purchase</h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {isSuper && (
              <div>
                <label className="mb-1 block text-xs font-medium text-depth-600">Branch</label>
                <select
                  value={branchId}
                  onChange={(e) => setBranchId(e.target.value)}
                  className="tap-target w-full rounded-xl border border-depth-200 bg-white px-3"
                >
                  <option value="">Select branch…</option>
                  {branches.map((b) => (
                    <option key={b._id} value={b._id}>
                      {b.branchName}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div>
              <label className="mb-1 block text-xs font-medium text-depth-600">Supplier</label>
              <input
                value={supplierName}
                onChange={(e) => setSupplierName(e.target.value)}
                placeholder="e.g. Dasani Distributors"
                className="tap-target w-full rounded-xl border border-depth-200 px-3"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-depth-600">Product</label>
              <select
                value={productId}
                onChange={(e) => setProductId(e.target.value)}
                className="tap-target w-full rounded-xl border border-depth-200 bg-white px-3"
              >
                <option value="">Select product…</option>
                {products.map((p) => (
                  <option key={p._id} value={p._id}>
                    {p.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-depth-600">Quantity</label>
              <input
                type="number"
                min="1"
                step="1"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                placeholder="0"
                className="tap-target w-full rounded-xl border border-depth-200 px-3"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-depth-600">Buying price / unit (KES)</label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={unitCost}
                onChange={(e) => setUnitCost(e.target.value)}
                placeholder="0"
                className="tap-target w-full rounded-xl border border-depth-200 px-3"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-depth-600">Reference (optional)</label>
              <input
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                placeholder="Invoice / ref no."
                className="tap-target w-full rounded-xl border border-depth-200 px-3"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="mb-1 block text-xs font-medium text-depth-600">Notes (optional)</label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                className="w-full rounded-xl border border-depth-200 px-3 py-2"
              />
            </div>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-4">
            <button
              type="submit"
              disabled={saving}
              className="tap-target rounded-full bg-gradient-to-r from-flow-500 to-flow-700 px-8 font-display font-semibold text-white disabled:opacity-60"
            >
              {saving ? "Saving…" : "Record purchase"}
            </button>
            {previewTotal > 0 && (
              <span className="font-mono text-sm text-depth-600">
                Total cost: KES {previewTotal.toLocaleString()}
              </span>
            )}
          </div>
        </form>

        {/* List */}
        <div className="rounded-xl2 bg-white shadow-soft">
          <div className="flex items-center justify-between border-b border-depth-100 px-4 py-3">
            <h2 className="font-display font-semibold text-depth-900">Recent purchases</h2>
            <span className="font-mono text-sm text-depth-600">Total: KES {total.toLocaleString()}</span>
          </div>
          {purchases.length === 0 ? (
            <EmptyState
              icon="📦"
              title="No purchases yet"
              description="Record stock bought from suppliers above — it feeds the profit overview and stock levels."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-sm">
                <thead>
                  <tr className="border-b border-depth-100 text-left text-xs uppercase tracking-wide text-depth-500">
                    <th className="px-4 py-2.5">Date</th>
                    {isSuper && <th className="px-4 py-2.5">Branch</th>}
                    <th className="px-4 py-2.5">Supplier</th>
                    <th className="px-4 py-2.5">Product</th>
                    <th className="px-4 py-2.5 text-right">Qty</th>
                    <th className="px-4 py-2.5 text-right">Unit</th>
                    <th className="px-4 py-2.5 text-right">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-depth-100">
                  {purchases.map((p) => (
                    <tr key={p._id} className="animate-fade-up">
                      <td className="px-4 py-2.5 text-depth-600">
                        {new Date(p.createdAt).toLocaleDateString()}
                      </td>
                      {isSuper && <td className="px-4 py-2.5 text-depth-700">{branchLabel(p.branchId)}</td>}
                      <td className="px-4 py-2.5 text-depth-800">{p.supplierName}</td>
                      <td className="px-4 py-2.5 text-depth-800">{p.productLabel}</td>
                      <td className="px-4 py-2.5 text-right text-depth-700">{p.quantity}</td>
                      <td className="px-4 py-2.5 text-right font-mono text-depth-700">
                        {p.unitCost.toLocaleString()}
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono text-depth-900">
                        {p.totalCost.toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
