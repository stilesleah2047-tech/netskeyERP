"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { apiFetch, ApiError } from "@/lib/api";
import { AuthUser } from "@/lib/types";
import { useToast } from "@/components/ui/Toast";
import { SkeletonTable } from "@/components/ui/Skeleton";

interface PriceRow {
  productId: string;
  label: string;
  unit?: string;
  basePrice: number;
  overridePrice: number | null;
  effectivePrice: number;
}

export default function BranchPricesPage() {
  const router = useRouter();
  const params = useParams();
  const branchId = String(params.id);
  const { show } = useToast();

  const [me, setMe] = useState<AuthUser | null>(null);
  const [branchName, setBranchName] = useState("");
  const [rows, setRows] = useState<PriceRow[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const result = await apiFetch<{ user: AuthUser }>("/api/auth/me");
        if (result.user.role !== "SUPER_ADMIN") {
          router.replace("/admin/dashboard");
          return;
        }
        setMe(result.user);
      } catch {
        router.replace("/login");
        return;
      }
      await load();
      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function load() {
    try {
      const res = await apiFetch<{ branchName: string; prices: PriceRow[] }>(
        "/api/branches/" + branchId + "/prices"
      );
      setBranchName(res.branchName);
      setRows(res.prices);
      const d: Record<string, string> = {};
      res.prices.forEach((p) => (d[p.productId] = p.overridePrice != null ? String(p.overridePrice) : ""));
      setDrafts(d);
    } catch (err) {
      show(err instanceof ApiError ? err.message : "Could not load prices", "error");
    }
  }

  async function save(row: PriceRow, clear: boolean) {
    setSavingId(row.productId);
    const raw = drafts[row.productId];
    const unitPrice = clear ? null : Number(raw);
    if (!clear && (raw === "" || Number.isNaN(unitPrice as number) || (unitPrice as number) < 0)) {
      show("Enter a valid price, or clear the override.", "error");
      setSavingId(null);
      return;
    }
    try {
      await apiFetch("/api/branches/" + branchId + "/prices", {
        method: "PUT",
        body: JSON.stringify({ productId: row.productId, unitPrice }),
      });
      show(
        clear ? `${row.label} now uses the base price` : `${row.label} price set for this branch`,
        "success"
      );
      await load();
    } catch (err) {
      show(err instanceof ApiError ? err.message : "Could not save the price", "error");
    }
    setSavingId(null);
  }

  if (loading || !me) {
    return (
      <main className="min-h-screen bg-sand-50 pb-12">
        <header className="bg-depth-900 px-5 pb-8 pt-8">
          <div className="mx-auto h-14 max-w-3xl" />
        </header>
        <div className="mx-auto -mt-4 max-w-3xl px-5">
          <SkeletonTable rows={5} cols={3} />
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-sand-50 pb-12">
      <header className="bg-depth-900 px-5 pb-8 pt-8 text-white">
        <div className="mx-auto flex max-w-3xl items-center justify-between">
          <div>
            <p className="text-xs uppercase tracking-wide text-flow-400">Branch pricing</p>
            <h1 className="font-display text-xl font-bold">{branchName || "Branch"}</h1>
          </div>
          <Link
            href="/admin/branches"
            className="tap-target flex items-center rounded-xl2 bg-white/10 px-4 text-sm font-medium text-white hover:bg-white/15"
          >
            ← Branches
          </Link>
        </div>
      </header>

      <div className="mx-auto -mt-4 max-w-3xl space-y-5 px-5">
        <div className="rounded-xl2 bg-white shadow-soft">
          <div className="border-b border-depth-100 px-4 py-3">
            <h2 className="font-display font-semibold text-depth-900">Prices at this branch</h2>
            <p className="mt-1 text-xs text-depth-500">
              Leave a product blank to charge the catalogue&apos;s base price. Set a number to charge a
              different price only at this branch.
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-depth-100 text-left text-xs uppercase tracking-wide text-depth-500">
                  <th className="px-4 py-2">Product</th>
                  <th className="px-4 py-2 text-right">Base</th>
                  <th className="px-4 py-2">This branch</th>
                  <th className="px-4 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.productId} className="border-b border-depth-50">
                    <td className="px-4 py-2 font-medium text-depth-900">{r.label}</td>
                    <td className="px-4 py-2 text-right tabular-nums text-depth-500">KSh {r.basePrice}</td>
                    <td className="px-4 py-2">
                      <input
                        type="number"
                        min={0}
                        value={drafts[r.productId] ?? ""}
                        placeholder={"base " + r.basePrice}
                        onChange={(e) => setDrafts((d) => ({ ...d, [r.productId]: e.target.value }))}
                        className="w-28 rounded-lg border border-depth-200 px-2 py-1"
                      />
                    </td>
                    <td className="px-4 py-2">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => save(r, false)}
                          disabled={savingId === r.productId}
                          className="rounded-lg bg-flow-500 px-3 py-1.5 text-sm font-semibold text-depth-950 disabled:opacity-60"
                        >
                          Save
                        </button>
                        {r.overridePrice != null && (
                          <button
                            onClick={() => save(r, true)}
                            disabled={savingId === r.productId}
                            className="rounded-lg border border-depth-200 px-3 py-1.5 text-sm font-medium text-depth-600 disabled:opacity-60"
                          >
                            Clear
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </main>
  );
}
