"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { apiFetch, ApiError } from "@/lib/api";
import { AuthUser, Branch } from "@/lib/types";
import { useToast } from "@/components/ui/Toast";
import { SkeletonList } from "@/components/ui/Skeleton";
import EmptyState from "@/components/ui/EmptyState";

const CATEGORIES = [
  "Transport",
  "Electricity",
  "Rent",
  "Salaries",
  "Repairs",
  "Packaging",
  "Other",
] as const;

interface ExpenseRow {
  _id: string;
  branchId: { _id: string; branchName: string } | string;
  category: string;
  amount: number;
  description: string;
  reference: string | null;
  notes: string | null;
  recordedBy: { _id: string; name: string } | string | null;
  createdAt: string;
}

function branchLabel(b: ExpenseRow["branchId"]): string {
  return typeof b === "object" && b ? b.branchName : "—";
}
function recorderLabel(r: ExpenseRow["recordedBy"]): string {
  return typeof r === "object" && r ? r.name : "—";
}

export default function ExpensesPage() {
  const router = useRouter();
  const { show } = useToast();
  const [me, setMe] = useState<AuthUser | null>(null);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [expenses, setExpenses] = useState<ExpenseRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // form state
  const [branchId, setBranchId] = useState("");
  const [category, setCategory] = useState<string>("Transport");
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
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
          const br = await apiFetch<{ branches: Branch[] }>("/api/branches");
          setBranches(br.branches);
        } catch {
          /* best-effort */
        }
        await loadExpenses();
      } catch {
        router.replace("/login");
        return;
      }
      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadExpenses() {
    const result = await apiFetch<{ expenses: ExpenseRow[] }>("/api/expenses");
    setExpenses(result.expenses);
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const amt = parseFloat(amount);
    if (!Number.isFinite(amt) || amt <= 0) {
      setError("Enter a valid amount.");
      return;
    }
    if (!description.trim()) {
      setError("A short description is required.");
      return;
    }
    if (isSuper && !branchId) {
      setError("Select the branch this expense belongs to.");
      return;
    }

    setSaving(true);
    try {
      await apiFetch("/api/expenses", {
        method: "POST",
        body: JSON.stringify({
          branchId: branchId || undefined,
          category,
          amount: amt,
          description: description.trim(),
          reference: reference.trim() || undefined,
          notes: notes.trim() || undefined,
        }),
      });
      show("Expense recorded", "success");
      setAmount("");
      setDescription("");
      setReference("");
      setNotes("");
      await loadExpenses();
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "Could not record expense";
      setError(message);
      show(message, "error");
    }
    setSaving(false);
  }

  const total = expenses.reduce((s, e) => s + e.amount, 0);

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
            <h1 className="font-display text-xl font-bold">Expenses</h1>
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
          <h2 className="mb-3 font-display font-semibold text-depth-900">Record an expense</h2>
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
              <label className="mb-1 block text-xs font-medium text-depth-600">Category</label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="tap-target w-full rounded-xl border border-depth-200 bg-white px-3"
              >
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-depth-600">Amount (KES)</label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0"
                className="tap-target w-full rounded-xl border border-depth-200 px-3"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-depth-600">Reference (optional)</label>
              <input
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                placeholder="Receipt / ref no."
                className="tap-target w-full rounded-xl border border-depth-200 px-3"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="mb-1 block text-xs font-medium text-depth-600">Description</label>
              <input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="e.g. Fuel for the delivery run"
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
          <button
            type="submit"
            disabled={saving}
            className="tap-target mt-4 w-full rounded-full bg-gradient-to-r from-flow-500 to-flow-700 font-display font-semibold text-white disabled:opacity-60 sm:w-auto sm:px-8"
          >
            {saving ? "Saving…" : "Record expense"}
          </button>
        </form>

        {/* List */}
        <div className="rounded-xl2 bg-white shadow-soft">
          <div className="flex items-center justify-between border-b border-depth-100 px-4 py-3">
            <h2 className="font-display font-semibold text-depth-900">Recent expenses</h2>
            <span className="font-mono text-sm text-depth-600">
              Total: KES {total.toLocaleString()}
            </span>
          </div>
          {expenses.length === 0 ? (
            <EmptyState
              icon="🧾"
              title="No expenses yet"
              description="Record your first expense above — rent, transport, salaries and the like."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm">
                <thead>
                  <tr className="border-b border-depth-100 text-left text-xs uppercase tracking-wide text-depth-500">
                    <th className="px-4 py-2.5">Date</th>
                    {isSuper && <th className="px-4 py-2.5">Branch</th>}
                    <th className="px-4 py-2.5">Category</th>
                    <th className="px-4 py-2.5">Description</th>
                    <th className="px-4 py-2.5">By</th>
                    <th className="px-4 py-2.5 text-right">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-depth-100">
                  {expenses.map((e) => (
                    <tr key={e._id} className="animate-fade-up">
                      <td className="px-4 py-2.5 text-depth-600">
                        {new Date(e.createdAt).toLocaleDateString()}
                      </td>
                      {isSuper && <td className="px-4 py-2.5 text-depth-700">{branchLabel(e.branchId)}</td>}
                      <td className="px-4 py-2.5">
                        <span className="rounded-full bg-flow-500/10 px-2.5 py-1 text-xs font-medium text-flow-700">
                          {e.category}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-depth-800">{e.description}</td>
                      <td className="px-4 py-2.5 text-depth-600">{recorderLabel(e.recordedBy)}</td>
                      <td className="px-4 py-2.5 text-right font-mono text-depth-900">
                        {e.amount.toLocaleString()}
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
