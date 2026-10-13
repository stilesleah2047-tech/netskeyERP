"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { apiFetch, ApiError } from "@/lib/api";
import { getDeviceId, getDeviceLabel } from "@/lib/deviceId";
import VesselLogo from "@/components/ui/VesselLogo";

interface InvitePreview {
  role: "DELIVERY" | "BRANCH_MANAGER" | "SUPER_ADMIN";
  email: string | null;
  businessName: string | null;
  branchName: string | null;
}

const roleLabel: Record<InvitePreview["role"], string> = {
  DELIVERY: "Delivery staff",
  BRANCH_MANAGER: "Branch manager",
  SUPER_ADMIN: "Administrator",
};

const inputClass =
  "tap-target w-full rounded-xl2 border border-depth-200 bg-white px-4 text-depth-900 placeholder:text-depth-400 shadow-sm transition focus:border-flow-500 focus:outline-none focus:ring-2 focus:ring-flow-500/25";

function AcceptInviteInner() {
  const router = useRouter();
  const params = useSearchParams();
  const token = params.get("token") ?? "";

  const [preview, setPreview] = useState<InvitePreview | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [checking, setChecking] = useState(true);

  const [name, setName] = useState("");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      if (!token) {
        setLoadError("This invitation link is missing its code.");
        setChecking(false);
        return;
      }
      try {
        const result = await apiFetch<{ invite: InvitePreview }>(
          "/api/invites/accept?token=" + encodeURIComponent(token)
        );
        setPreview(result.invite);
      } catch (err) {
        setLoadError(
          err instanceof ApiError
            ? err.message
            : "We couldn't open this invitation. Please ask for a new link."
        );
      }
      setChecking(false);
    })();
  }, [token]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!name.trim() || !phoneNumber.trim()) {
      setError("Please fill in your name and phone number.");
      return;
    }
    if (password.length < 8) {
      setError("Choose a password of at least 8 characters.");
      return;
    }
    setSubmitting(true);
    try {
      const result = await apiFetch<{ redirectTo: string }>("/api/invites/accept", {
        method: "POST",
        body: JSON.stringify({
          token,
          name: name.trim(),
          phoneNumber: phoneNumber.trim(),
          password,
          deviceId: getDeviceId(),
          deviceLabel: getDeviceLabel(),
        }),
      });
      router.replace(result.redirectTo);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong. Please try again.");
      setSubmitting(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-sand-50 px-4 py-10">
      <div className="w-full max-w-sm animate-fade-up">
        <div className="mb-8 flex items-center justify-center gap-2.5">
          <VesselLogo size={34} />
          <span className="font-display text-lg font-bold tracking-tight text-depth-900">
            vessel<span className="text-flow-500">.</span>
            <span className="ml-1 font-body text-sm font-normal text-depth-500">erp</span>
          </span>
        </div>

        <div className="rounded-3xl border border-depth-200 bg-white p-8 shadow-soft sm:p-10">
          {checking ? (
            <p className="text-sm text-depth-500">Opening your invitation…</p>
          ) : loadError ? (
            <>
              <h1 className="font-display text-2xl font-bold tracking-tight text-depth-900">
                Invitation unavailable
              </h1>
              <p className="mt-3 rounded-lg bg-alert-500/10 px-3 py-2 text-sm text-alert-600">
                {loadError}
              </p>
              <a
                href="/login"
                className="tap-target mt-6 flex w-full items-center justify-center rounded-full bg-depth-900 text-sm font-medium text-sand-50 transition hover:bg-depth-800"
              >
                Go to login
              </a>
            </>
          ) : preview ? (
            <>
              <h1 className="font-display text-2xl font-bold tracking-tight text-depth-900">
                Join {preview.businessName ?? "the team"}
              </h1>
              <p className="mt-2 text-sm leading-relaxed text-depth-500">
                You&apos;ve been invited as{" "}
                <strong className="text-depth-700">{roleLabel[preview.role]}</strong>
                {preview.branchName ? (
                  <>
                    {" "}at <strong className="text-depth-700">{preview.branchName}</strong>
                  </>
                ) : null}
                . Set up your account below.
              </p>

              <form onSubmit={handleSubmit} className="mt-6 space-y-4">
                {preview.email && (
                  <div>
                    <label className="mb-1.5 block text-sm font-medium text-depth-700">
                      Email (used to sign in)
                    </label>
                    <input value={preview.email} disabled className={inputClass + " bg-sand-50 text-depth-500"} />
                  </div>
                )}
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-depth-700">Full name</label>
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className={inputClass}
                    autoComplete="name"
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-depth-700">Phone number</label>
                  <input
                    value={phoneNumber}
                    onChange={(e) => setPhoneNumber(e.target.value)}
                    placeholder="07XXXXXXXX"
                    className={inputClass}
                    autoComplete="tel"
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-depth-700">
                    Choose a password
                  </label>
                  <div className="relative">
                    <input
                      type={showPassword ? "text" : "password"}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className={inputClass + " pr-11"}
                      autoComplete="new-password"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((v) => !v)}
                      className="absolute inset-y-0 right-3.5 flex items-center text-xs font-medium text-depth-400 hover:text-depth-700"
                    >
                      {showPassword ? "Hide" : "Show"}
                    </button>
                  </div>
                </div>

                {error && (
                  <p role="alert" className="rounded-lg bg-alert-500/10 px-3 py-2 text-sm text-alert-600">
                    {error}
                  </p>
                )}

                <button
                  type="submit"
                  disabled={submitting}
                  className="tap-target w-full rounded-full bg-gradient-to-r from-flow-500 to-flow-700 font-display font-semibold text-white shadow-glow transition active:scale-[0.98] disabled:opacity-60"
                >
                  {submitting ? "Creating your account…" : "Create account & sign in"}
                </button>
              </form>
            </>
          ) : null}
        </div>
      </div>
    </main>
  );
}

export default function AcceptInvitePage() {
  return (
    <Suspense fallback={null}>
      <AcceptInviteInner />
    </Suspense>
  );
}
