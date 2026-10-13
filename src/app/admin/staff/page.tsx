"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { apiFetch, ApiError } from "@/lib/api";
import { AuthUser, Branch, UserRole } from "@/lib/types";
import { useToast } from "@/components/ui/Toast";
import { SkeletonList } from "@/components/ui/Skeleton";
import EmptyState from "@/components/ui/EmptyState";
import ConfirmButton from "@/components/ui/ConfirmButton";

interface StaffMember {
  _id: string;
  name: string;
  role: UserRole;
  branchId: string | null;
  phoneNumber: string;
  email: string;
  isActive: boolean;
}

interface PendingInvite {
  id: string;
  role: UserRole;
  email: string | null;
  branch: { _id: string; branchName: string } | string | null;
  expiresAt: string;
  createdAt: string;
}

const roleBadgeStyles: Record<UserRole, string> = {
  DELIVERY: "bg-depth-100 text-depth-700",
  BRANCH_MANAGER: "bg-flow-500/15 text-flow-700",
  SUPER_ADMIN: "bg-alert-500/15 text-alert-700",
};

export default function StaffPage() {
  const router = useRouter();
  const { show } = useToast();
  const [me, setMe] = useState<AuthUser | null>(null);
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmSuperAdmin, setConfirmSuperAdmin] = useState(false);

  // Staff invite links.
  const [invites, setInvites] = useState<PendingInvite[]>([]);
  const [invRole, setInvRole] = useState<UserRole>("DELIVERY");
  const [invBranch, setInvBranch] = useState("");
  const [invEmail, setInvEmail] = useState("");
  const [invCreating, setInvCreating] = useState(false);
  const [newInviteLink, setNewInviteLink] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [role, setRole] = useState<UserRole>("DELIVERY");
  const [branchId, setBranchId] = useState("");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const isSuperAdmin = me?.role === "SUPER_ADMIN";

  useEffect(() => {
    (async () => {
      try {
        const result = await apiFetch<{ user: AuthUser }>("/api/auth/me");
        if (result.user.role === "DELIVERY") {
          router.replace("/terminal");
          return;
        }
        setMe(result.user);
      } catch {
        router.replace("/login");
        return;
      }
      const branchesResult = await apiFetch<{ branches: Branch[] }>("/api/branches");
      setBranches(branchesResult.branches);
      await loadStaff();
      await loadInvites();
      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadStaff() {
    const result = await apiFetch<{ users: StaffMember[] }>("/api/users");
    setStaff(result.users);
  }

  async function loadInvites() {
    try {
      const result = await apiFetch<{ invites: PendingInvite[] }>("/api/invites");
      setInvites(result.invites);
    } catch {
      // non-fatal
    }
  }

  async function handleCreateInvite(e: React.FormEvent) {
    e.preventDefault();
    const branch = isSuperAdmin ? invBranch : me?.branchId ?? "";
    if (!branch) {
      show("Choose which branch this invite is for.", "error");
      return;
    }
    if (!invEmail.trim()) {
      show("Enter the email the new member will sign in with.", "error");
      return;
    }
    setInvCreating(true);
    setNewInviteLink(null);
    try {
      const result = await apiFetch<{ acceptPath: string }>("/api/invites", {
        method: "POST",
        body: JSON.stringify({
          role: isSuperAdmin ? invRole : "DELIVERY",
          branchId: branch,
          email: invEmail.trim() || undefined,
        }),
      });
      const link =
        (typeof window !== "undefined" ? window.location.origin : "") + result.acceptPath;
      setNewInviteLink(link);
      setInvEmail("");
      show("Invite link created — copy and share it.", "success");
      await loadInvites();
    } catch (err) {
      show(err instanceof ApiError ? err.message : "Could not create invite", "error");
    }
    setInvCreating(false);
  }

  async function handleRevokeInvite(id: string) {
    try {
      await apiFetch("/api/invites/" + id, { method: "DELETE" });
      show("Invite revoked", "success");
      await loadInvites();
    } catch (err) {
      show(err instanceof ApiError ? err.message : "Could not revoke invite", "error");
    }
  }

  async function copyInviteLink(link: string) {
    try {
      await navigator.clipboard.writeText(link);
      show("Link copied to clipboard", "success");
    } catch {
      show("Copy failed — select and copy the link manually", "info");
    }
  }

  async function handleToggleActive(member: StaffMember) {
    try {
      await apiFetch("/api/users/" + member._id, {
        method: "PATCH",
        body: JSON.stringify({ isActive: !member.isActive }),
      });
      show(member.name + (member.isActive ? " deactivated" : " reactivated"), "success");
      await loadStaff();
    } catch (err) {
      show(err instanceof ApiError ? err.message : "Could not update staff member", "error");
    }
  }

  function validate(): string | null {
    if (!name.trim() || !phoneNumber.trim()) return "Name and phone number are required.";
    if (role !== "SUPER_ADMIN" && isSuperAdmin && !branchId) return "Choose which branch this account belongs to.";
    if (!email.trim()) return "Email is required — every account signs in with email and password.";
    if (password.length < 8) return "Password must be at least 8 characters.";
    return null;
  }

  async function submitCreate() {
    setSaving(true);
    try {
      await apiFetch("/api/users", {
        method: "POST",
        body: JSON.stringify({
          name: name.trim(),
          role,
          branchId: role !== "SUPER_ADMIN" && isSuperAdmin ? branchId : undefined,
          phoneNumber,
          email,
          password,
        }),
      });
      show(name.trim() + " added as " + role.replace("_", " ").toLowerCase(), "success");
      setName("");
      setBranchId("");
      setPhoneNumber("");
      setEmail("");
      setPassword("");
      setConfirmSuperAdmin(false);
      await loadStaff();
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "Could not create staff account";
      setError(message);
      show(message, "error");
    }
    setSaving(false);
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }

    if (role === "SUPER_ADMIN" && !confirmSuperAdmin) {
      setConfirmSuperAdmin(true);
      return;
    }

    await submitCreate();
  }

  if (loading || !me) {
    return (
      <main className="min-h-screen bg-sand-50 pb-12">
        <header className="bg-depth-900 px-5 pb-8 pt-8">
          <div className="mx-auto h-14 max-w-3xl" />
        </header>
        <div className="mx-auto -mt-4 max-w-3xl px-5">
          <SkeletonList rows={4} />
        </div>
      </main>
    );
  }

  const canCreateManagerOrAdmin = isSuperAdmin;

  return (
    <main className="min-h-screen bg-sand-50 pb-12">
      <header className="bg-depth-900 px-5 pb-8 pt-8 text-white">
        <div className="mx-auto flex max-w-3xl items-center justify-between">
          <div>
            <p className="text-xs uppercase tracking-wide text-flow-400">Vessel</p>
            <h1 className="font-display text-xl font-bold">Staff</h1>
          </div>
          <Link href="/admin/dashboard" className="tap-target flex items-center rounded-xl2 bg-white/10 px-4 text-sm font-medium text-white hover:bg-white/15">
            ← Dashboard
          </Link>
        </div>
      </header>

      <div className="mx-auto -mt-4 max-w-3xl space-y-5 px-5">
        {isSuperAdmin && branches.length === 0 && (
          <div className="rounded-xl2 border border-cash-500/30 bg-cash-500/10 px-4 py-3 text-sm text-cash-700">
            No branches exist yet.{" "}
            <Link href="/admin/branches" className="font-semibold underline underline-offset-2">
              Create a branch first
            </Link>{" "}
            before adding staff.
          </div>
        )}

        {error && (
          <div className="rounded-xl2 border border-alert-500/30 bg-alert-500/10 px-4 py-3 text-sm text-alert-600">{error}</div>
        )}

        <div className="rounded-xl2 bg-white shadow-soft">
          <div className="border-b border-depth-100 px-4 py-3">
            <h2 className="font-display font-semibold text-depth-900">Team</h2>
          </div>
          {staff.length === 0 ? (
            <EmptyState
              icon="🧑‍🤝‍🧑"
              title="No staff yet"
              description="Add your first team member below — a branch manager to run day-to-day operations, or a delivery worker to sell at the door. Everyone signs in the same way, with email and password."
            />
          ) : (
            <ul className="divide-y divide-depth-100">
              {staff.map((s) => {
                const branchName = branches.find((b) => b._id === s.branchId)?.branchName;
                const isSelf = me?.id === s._id;
                return (
                  <li key={s._id} className="flex items-center justify-between gap-3 px-4 py-3 animate-fade-up">
                    <div className="min-w-0">
                      <p className="font-medium text-depth-900">
                        {s.name}
                        {!s.isActive && (
                          <span className="ml-2 rounded-full bg-depth-100 px-2 py-0.5 text-xs font-medium text-depth-500">
                            Inactive
                          </span>
                        )}
                      </p>
                      <p className="truncate text-xs text-depth-500">
                        {s.email}
                        {branchName ? " · " + branchName : ""}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <span className={"rounded-full px-2.5 py-1 text-xs font-medium " + roleBadgeStyles[s.role]}>
                        {s.role.replace("_", " ")}
                      </span>
                      {!isSelf && (
                        s.isActive ? (
                          <ConfirmButton
                            label="Deactivate"
                            confirmLabel="Deactivate"
                            variant="danger"
                            onConfirm={() => handleToggleActive(s)}
                            className="rounded-lg border border-depth-200 px-3 py-1.5 text-sm font-medium text-depth-700"
                          />
                        ) : (
                          <button
                            onClick={() => handleToggleActive(s)}
                            className="rounded-lg border border-depth-200 px-3 py-1.5 text-sm font-medium text-depth-700"
                          >
                            Reactivate
                          </button>
                        )
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="rounded-xl2 bg-white shadow-soft">
          <div className="border-b border-depth-100 px-4 py-3">
            <h2 className="font-display font-semibold text-depth-900">Invite links</h2>
            <p className="mt-1 text-xs text-depth-500">
              Create a one-time link and share it (e.g. on WhatsApp). The person sets their own
              password when they open it. Links expire after 7 days.
            </p>
          </div>

          {newInviteLink && (
            <div className="m-4 rounded-xl2 border border-confirm-500/30 bg-confirm-500/10 p-3">
              <p className="mb-2 text-xs font-medium text-confirm-700">
                Share this link now — it is shown only once:
              </p>
              <div className="flex items-center gap-2">
                <input
                  readOnly
                  value={newInviteLink}
                  onFocus={(e) => e.currentTarget.select()}
                  className="min-w-0 flex-1 rounded-lg border border-depth-200 bg-white px-2 py-1.5 text-xs text-depth-700"
                />
                <button
                  type="button"
                  onClick={() => copyInviteLink(newInviteLink)}
                  className="shrink-0 rounded-lg bg-flow-500 px-3 py-1.5 text-sm font-semibold text-depth-950"
                >
                  Copy
                </button>
              </div>
            </div>
          )}

          {invites.length > 0 && (
            <ul className="divide-y divide-depth-100">
              {invites.map((i) => {
                const branchName =
                  typeof i.branch === "object" && i.branch ? i.branch.branchName : undefined;
                return (
                  <li key={i.id} className="flex items-center justify-between gap-3 px-4 py-3">
                    <div className="min-w-0">
                      <p className="font-medium text-depth-900">
                        {i.email ?? "(no email set)"}
                      </p>
                      <p className="truncate text-xs text-depth-500">
                        {i.role.replace("_", " ")}
                        {branchName ? " · " + branchName : ""} · expires{" "}
                        {new Date(i.expiresAt).toLocaleDateString()}
                      </p>
                    </div>
                    <ConfirmButton
                      label="Revoke"
                      confirmLabel="Revoke"
                      variant="danger"
                      onConfirm={() => handleRevokeInvite(i.id)}
                      className="shrink-0 rounded-lg border border-depth-200 px-3 py-1.5 text-sm font-medium text-depth-700"
                    />
                  </li>
                );
              })}
            </ul>
          )}

          <form onSubmit={handleCreateInvite} className="border-t border-depth-100 p-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {isSuperAdmin && (
                <div>
                  <label className="mb-1 block text-xs font-medium text-depth-600">Role</label>
                  <select
                    value={invRole}
                    onChange={(e) => setInvRole(e.target.value as UserRole)}
                    className="tap-target w-full rounded-xl border border-depth-200 px-3"
                  >
                    <option value="DELIVERY">Delivery</option>
                    <option value="BRANCH_MANAGER">Branch Manager</option>
                  </select>
                </div>
              )}
              {isSuperAdmin && (
                <div>
                  <label className="mb-1 block text-xs font-medium text-depth-600">Branch</label>
                  <select
                    value={invBranch}
                    onChange={(e) => setInvBranch(e.target.value)}
                    className="tap-target w-full rounded-xl border border-depth-200 px-3"
                  >
                    <option value="">Select a branch…</option>
                    {branches.map((b) => (
                      <option key={b._id} value={b._id}>
                        {b.branchName}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <div className={isSuperAdmin ? "sm:col-span-2" : ""}>
                <label className="mb-1 block text-xs font-medium text-depth-600">
                  Email (they sign in with this)
                </label>
                <input
                  type="email"
                  value={invEmail}
                  onChange={(e) => setInvEmail(e.target.value)}
                  placeholder="person@example.com"
                  className="tap-target w-full rounded-xl border border-depth-200 px-3"
                />
              </div>
            </div>
            <button
              type="submit"
              disabled={invCreating}
              className="tap-target mt-4 w-full rounded-xl2 border border-flow-500 font-display font-semibold text-flow-700 disabled:opacity-60 sm:w-auto sm:px-8"
            >
              {invCreating ? "Creating…" : "Create invite link"}
            </button>
          </form>
        </div>

        <form onSubmit={handleCreate} className="rounded-xl2 bg-white p-4 shadow-soft">
          <h2 className="mb-3 font-display font-semibold text-depth-900">Add staff member</h2>
          <p className="mb-3 text-xs text-depth-500">
            Every role signs in the same way, at the same page, with email and password — the account
            decides where they land after signing in.
          </p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-medium text-depth-600">Full name</label>
              <input value={name} onChange={(e) => setName(e.target.value)} className="tap-target w-full rounded-xl border border-depth-200 px-3" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-depth-600">Role</label>
              <select
                value={role}
                onChange={(e) => {
                  setRole(e.target.value as UserRole);
                  setConfirmSuperAdmin(false);
                }}
                className="tap-target w-full rounded-xl border border-depth-200 px-3"
              >
                <option value="DELIVERY">Delivery</option>
                {canCreateManagerOrAdmin && <option value="BRANCH_MANAGER">Branch Manager</option>}
                {canCreateManagerOrAdmin && <option value="SUPER_ADMIN">Super Admin</option>}
              </select>
            </div>

            {isSuperAdmin && role !== "SUPER_ADMIN" && (
              <div>
                <label className="mb-1 block text-xs font-medium text-depth-600">Branch</label>
                <select value={branchId} onChange={(e) => setBranchId(e.target.value)} className="tap-target w-full rounded-xl border border-depth-200 px-3">
                  <option value="">Select a branch…</option>
                  {branches.map((b) => (
                    <option key={b._id} value={b._id}>
                      {b.branchName} — {b.locationCity}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div>
              <label className="mb-1 block text-xs font-medium text-depth-600">Phone number</label>
              <input value={phoneNumber} onChange={(e) => setPhoneNumber(e.target.value)} placeholder="07XXXXXXXX" className="tap-target w-full rounded-xl border border-depth-200 px-3" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-depth-600">Email (used to sign in)</label>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="tap-target w-full rounded-xl border border-depth-200 px-3" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-depth-600">Password (used to sign in)</label>
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} className="tap-target w-full rounded-xl border border-depth-200 px-3" />
            </div>
          </div>

          {confirmSuperAdmin ? (
            <div className="mt-4 rounded-xl2 border border-alert-500/30 bg-alert-500/10 p-3">
              <p className="mb-2 text-sm text-alert-700">
                <strong>{name.trim() || "This account"}</strong> will get full access to every branch, all
                financial data, and the ability to create other admins. Confirm this is intended.
              </p>
              <div className="flex gap-2">
                <button
                  type="submit"
                  disabled={saving}
                  className="rounded-lg bg-alert-500 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
                >
                  {saving ? "Creating…" : "Yes, make Super Admin"}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmSuperAdmin(false)}
                  className="rounded-lg border border-depth-200 px-4 py-2 text-sm font-medium text-depth-600"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              type="submit"
              disabled={saving}
              className="tap-target mt-4 w-full rounded-xl2 bg-flow-500 font-display font-semibold text-depth-950 disabled:opacity-60 sm:w-auto sm:px-8"
            >
              {saving ? "Adding…" : "Add staff member"}
            </button>
          )}
        </form>
      </div>
    </main>
  );
}
