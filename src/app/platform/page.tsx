"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch, ApiError } from "@/lib/api";
import { AuthUser } from "@/lib/types";
import { useToast } from "@/components/ui/Toast";
import { SkeletonList } from "@/components/ui/Skeleton";
import {
  BusinessCard,
  CreateBusinessForm,
  InviteLinkBox,
  type BizRow,
  type InviteResult,
} from "@/components/platform/shared";
import OverviewTab, { type Overview } from "@/components/platform/OverviewTab";
import ActivityTab from "@/components/platform/ActivityTab";
import BusinessDetail from "@/components/platform/BusinessDetail";

// Admin console for the platform operator: create business accounts and
// monitor every business on the platform. Only emails listed in
// PLATFORM_ADMIN_EMAILS can open it; every API it calls re-checks that.

type Tab = "overview" | "businesses" | "activity";
const TABS: { id: Tab; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "businesses", label: "Businesses" },
  { id: "activity", label: "Activity" },
];

function tabFromHash(): Tab {
  const h = typeof window !== "undefined" ? window.location.hash.replace("#", "") : "";
  return (TABS.find((t) => t.id === h)?.id ?? "overview") as Tab;
}

export default function PlatformPage() {
  const router = useRouter();
  const { show } = useToast();
  const [me, setMe] = useState<AuthUser | null>(null);
  const [tab, setTab] = useState<Tab>("overview");
  const [overview, setOverview] = useState<Overview | null>(null);
  const [rows, setRows] = useState<BizRow[]>([]);
  const [loadingRows, setLoadingRows] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [lastLink, setLastLink] = useState<{ business: string; url: string; expiresAt: string } | null>(null);

  const loadOverview = useCallback(async () => {
    try {
      setOverview(await apiFetch<Overview>("/api/platform/overview"));
    } catch (err) {
      show(err instanceof ApiError ? err.message : "Could not load overview", "error");
    }
  }, [show]);

  const loadRows = useCallback(async () => {
    try {
      const r = await apiFetch<{ businesses: BizRow[] }>("/api/platform/businesses");
      setRows(r.businesses);
    } catch (err) {
      show(err instanceof ApiError ? err.message : "Could not load businesses", "error");
    }
    setLoadingRows(false);
  }, [show]);

  useEffect(() => {
    (async () => {
      try {
        const r = await apiFetch<{ user: AuthUser }>("/api/auth/me");
        if (!r.user.isPlatformAdmin) {
          router.replace(r.user.role === "DELIVERY" ? "/terminal" : "/admin/dashboard");
          return;
        }
        setMe(r.user);
      } catch {
        router.replace("/login");
        return;
      }
      setTab(tabFromHash());
      loadOverview();
      loadRows();
    })();

    const onHash = () => setTab(tabFromHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep the overview fresh while the console is open.
  useEffect(() => {
    if (!me) return;
    const t = setInterval(() => {
      if (document.visibilityState === "visible") loadOverview();
    }, 60_000);
    return () => clearInterval(t);
  }, [me, loadOverview]);

  function goTab(t: Tab) {
    setTab(t);
    window.location.hash = t;
  }

  async function signOut() {
    try {
      await apiFetch("/api/auth/logout", { method: "POST" });
    } catch {
      /* cookies are cleared server-side when reachable; go to login either way */
    }
    router.replace("/login");
  }

  async function patch(id: string, update: Record<string, unknown>, label: string) {
    setSavingId(id);
    try {
      await apiFetch("/api/platform/businesses/" + id, { method: "PATCH", body: JSON.stringify(update) });
      show(label, "success");
      await Promise.all([loadRows(), loadOverview()]);
    } catch (err) {
      show(err instanceof ApiError ? err.message : "Update failed", "error");
    }
    setSavingId(null);
  }

  function showLink(business: string, r: InviteResult) {
    setLastLink({ business, url: window.location.origin + r.acceptPath, expiresAt: r.expiresAt });
  }

  async function reissue(b: BizRow, ownerEmail: string) {
    setSavingId(b.id);
    try {
      const r = await apiFetch<InviteResult>("/api/platform/businesses/" + b.id + "/owner-invite", {
        method: "POST",
        body: JSON.stringify({ ownerEmail }),
      });
      showLink(b.name, r);
      show("New owner link created for " + b.name, "success");
      await loadRows();
    } catch (err) {
      show(err instanceof ApiError ? err.message : "Could not create link", "error");
    }
    setSavingId(null);
  }

  if (!me) {
    return (
      <main className="min-h-screen bg-depth-950 pb-12">
        <div className="mx-auto max-w-5xl px-5 pt-10">
          <SkeletonList rows={4} />
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-depth-950 pb-16 text-white">
      <header
        className="sticky top-0 z-30 border-b border-white/10 bg-depth-950/95 px-5 pb-0 backdrop-blur"
        style={{ paddingTop: "max(1.5rem, env(safe-area-inset-top))" }}
      >
        <div className="mx-auto max-w-5xl">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-flow-400">Admin console</p>
              <h1 className="font-display text-2xl font-bold">All businesses</h1>
            </div>
            <div className="flex items-center gap-3 text-sm">
              <span className="hidden text-white/50 sm:inline">{me.email}</span>
              <button onClick={signOut} className="tap-target rounded-xl2 border border-white/20 px-4 text-white/80">
                Sign out
              </button>
            </div>
          </div>
          <nav className="mt-4 flex gap-1" aria-label="Console sections">
            {TABS.map((t) => (
              <button
                key={t.id}
                onClick={() => goTab(t.id)}
                aria-current={tab === t.id ? "page" : undefined}
                className={
                  "rounded-t-xl px-4 py-2.5 text-sm font-medium transition " +
                  (tab === t.id ? "bg-white/10 text-white" : "text-white/50 hover:text-white/80")
                }
              >
                {t.label}
              </button>
            ))}
          </nav>
        </div>
      </header>

      <div className="mx-auto max-w-5xl px-5 pt-6">
        {tab === "overview" &&
          (overview ? <OverviewTab data={overview} onOpen={setOpenId} /> : <SkeletonList rows={4} />)}

        {tab === "businesses" && (
          <div className="space-y-6">
            <CreateBusinessForm
              onCreated={async (name, r) => {
                showLink(name, r);
                await Promise.all([loadRows(), loadOverview()]);
              }}
            />
            {lastLink && <InviteLinkBox link={lastLink} onClose={() => setLastLink(null)} />}
            {loadingRows ? (
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
                    onOpen={setOpenId}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        {tab === "activity" && <ActivityTab businesses={rows.map((r) => ({ id: r.id, name: r.name }))} />}
      </div>

      {openId && <BusinessDetail id={openId} onClose={() => setOpenId(null)} />}
    </main>
  );
}
