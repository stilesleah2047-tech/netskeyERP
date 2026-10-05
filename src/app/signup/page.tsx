"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch, ApiError } from "@/lib/api";
import { getDeviceId, getDeviceLabel } from "@/lib/deviceId";
import VesselLogo from "@/components/ui/VesselLogo";

export default function SignupPage() {
  const router = useRouter();
  const [businessName, setBusinessName] = useState("");
  const [ownerName, setOwnerName] = useState("");
  const [email, setEmail] = useState("");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const result = await apiFetch<{ redirectTo: string }>("/api/auth/signup", {
        method: "POST",
        body: JSON.stringify({
          businessName,
          ownerName,
          email,
          phoneNumber,
          password,
          deviceId: getDeviceId(),
          deviceLabel: getDeviceLabel(),
        }),
      });
      router.replace(result.redirectTo);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError("Something went wrong. Please try again.");
      }
    }
    setLoading(false);
  }

  const inputClass =
    "tap-target w-full rounded-xl2 border border-depth-200 bg-white px-4 text-depth-900 placeholder:text-depth-400 shadow-sm transition focus:border-flow-500 focus:outline-none focus:ring-2 focus:ring-flow-500/25";

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
          <h1 className="font-display text-3xl font-bold tracking-tight text-depth-900">
            Create your business
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-depth-500">
            Set up your company account. You&apos;ll be the owner and can add branches
            and branch managers next. Every new business starts with a free 14-day
            trial on the Starter plan (KSh 3,500/mo after trial).
          </p>

          <form onSubmit={handleSubmit} className="mt-8 space-y-5">
            <div>
              <label htmlFor="businessName" className="mb-1.5 block text-sm font-medium text-depth-700">
                Business name
              </label>
              <input
                id="businessName"
                type="text"
                required
                value={businessName}
                onChange={(e) => setBusinessName(e.target.value)}
                placeholder="e.g. Clearwater Supplies"
                className={inputClass}
              />
            </div>

            <div>
              <label htmlFor="ownerName" className="mb-1.5 block text-sm font-medium text-depth-700">
                Your name
              </label>
              <input
                id="ownerName"
                type="text"
                autoComplete="name"
                required
                value={ownerName}
                onChange={(e) => setOwnerName(e.target.value)}
                placeholder="Jane Owner"
                className={inputClass}
              />
            </div>

            <div>
              <label htmlFor="email" className="mb-1.5 block text-sm font-medium text-depth-700">
                Email
              </label>
              <input
                id="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@company.com"
                className={inputClass}
              />
            </div>

            <div>
              <label htmlFor="phoneNumber" className="mb-1.5 block text-sm font-medium text-depth-700">
                Phone number
              </label>
              <input
                id="phoneNumber"
                type="tel"
                autoComplete="tel"
                required
                value={phoneNumber}
                onChange={(e) => setPhoneNumber(e.target.value)}
                placeholder="07XXXXXXXX"
                className={inputClass}
              />
            </div>

            <div>
              <label htmlFor="password" className="mb-1.5 block text-sm font-medium text-depth-700">
                Password
              </label>
              <div className="relative">
                <input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="new-password"
                  required
                  minLength={8}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="At least 8 characters"
                  className="tap-target w-full rounded-xl2 border border-depth-200 bg-white px-4 pr-11 text-depth-900 placeholder:text-depth-400 shadow-sm transition focus:border-flow-500 focus:outline-none focus:ring-2 focus:ring-flow-500/25"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  className="absolute inset-y-0 right-3.5 flex items-center text-depth-400 hover:text-depth-700"
                >
                  {showPassword ? (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                      <path
                        d="M3 3l18 18M10.6 10.6a2 2 0 0 0 2.8 2.8M9.5 5.2A10.8 10.8 0 0 1 12 5c5 0 9 4 10 7-.4 1.1-1.1 2.3-2.1 3.4M6.6 6.6C4.6 8 3.2 9.9 2 12c1 3 5 7 10 7 1.3 0 2.5-.2 3.6-.7"
                        stroke="currentColor"
                        strokeWidth="1.6"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  ) : (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                      <path
                        d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7Z"
                        stroke="currentColor"
                        strokeWidth="1.6"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                      <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.6" />
                    </svg>
                  )}
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
              disabled={loading}
              className="tap-target group relative w-full overflow-hidden rounded-full bg-gradient-to-r from-flow-500 to-flow-700 font-display font-semibold text-white shadow-glow transition active:scale-[0.98] disabled:opacity-60"
            >
              <span className="relative z-10 flex items-center justify-center gap-2">
                {loading && (
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                )}
                {loading ? "Creating…" : "Create business account"}
              </span>
            </button>
          </form>
        </div>

        <p className="mt-6 text-center text-sm text-depth-500">
          Already have an account?{" "}
          <a href="/login" className="font-semibold text-flow-600 hover:text-flow-700">
            Login
          </a>
        </p>
      </div>
    </main>
  );
}