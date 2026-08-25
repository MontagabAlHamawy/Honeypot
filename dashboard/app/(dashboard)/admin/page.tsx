"use client";

import { useEffect, useState } from "react";
import { Users, ShieldCheck, KeyRound, AlertCircle } from "lucide-react";
import { formatDate } from "@/lib/utils";

type UserRow = {
  id: string;
  email: string;
  role: string;
  createdAt: string;
};

export default function AdminPage() {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(true);
  const [error, setError] = useState("");

  const [newUserEmail, setNewUserEmail] = useState("");
  const [newUserPassword, setNewUserPassword] = useState("");
  const [newUserRole, setNewUserRole] = useState("analyst");
  const [creatingUser, setCreatingUser] = useState(false);

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordChallengeId, setPasswordChallengeId] = useState("");
  const [passwordOtp, setPasswordOtp] = useState("");
  const [changingPassword, setChangingPassword] = useState(false);
  const [successMessage, setSuccessMessage] = useState("");

  async function loadUsers() {
    setLoadingUsers(true);
    try {
      const res = await fetch("/api/admin/users");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load users");
      setUsers(Array.isArray(data.users) ? data.users : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load users");
    } finally {
      setLoadingUsers(false);
    }
  }

  useEffect(() => {
    void loadUsers();
  }, []);

  async function createUser(e: React.FormEvent) {
    e.preventDefault();
    setCreatingUser(true);
    setError("");
    setSuccessMessage("");
    try {
      const res = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: newUserEmail,
          password: newUserPassword,
          role: newUserRole,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to create user");
      setNewUserEmail("");
      setNewUserPassword("");
      setNewUserRole("analyst");
      setSuccessMessage("User created successfully.");
      await loadUsers();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create user");
    } finally {
      setCreatingUser(false);
    }
  }

  async function requestPasswordOtp(e: React.FormEvent) {
    e.preventDefault();
    setChangingPassword(true);
    setError("");
    setSuccessMessage("");
    try {
      if (newPassword !== confirmPassword) {
        throw new Error("New password and confirmation do not match.");
      }
      const res = await fetch("/api/auth/password/change/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to request OTP");
      setPasswordChallengeId(String(data.challengeId || ""));
      setSuccessMessage("OTP sent to your email. Enter it below to confirm password change.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to request OTP");
    } finally {
      setChangingPassword(false);
    }
  }

  async function verifyPasswordOtp(e: React.FormEvent) {
    e.preventDefault();
    setChangingPassword(true);
    setError("");
    setSuccessMessage("");
    try {
      const res = await fetch("/api/auth/password/change/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          challengeId: passwordChallengeId,
          otp: passwordOtp,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to verify OTP");

      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setPasswordOtp("");
      setPasswordChallengeId("");
      setSuccessMessage("Password updated successfully.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to verify OTP");
    } finally {
      setChangingPassword(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground tracking-tight">Admin Security</h1>
        <p className="text-sm text-muted-foreground mt-1 font-mono">
          Manage users and account password protection
        </p>
      </div>

      {error && (
        <div className="flex items-center gap-2 bg-destructive/10 border border-destructive/30 rounded-lg px-4 py-3 text-sm text-red-400">
          <AlertCircle className="w-4 h-4 shrink-0" />
          {error}
        </div>
      )}
      {successMessage && (
        <div className="flex items-center gap-2 bg-emerald-500/10 border border-emerald-500/30 rounded-lg px-4 py-3 text-sm text-emerald-300">
          <ShieldCheck className="w-4 h-4 shrink-0" />
          {successMessage}
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <div className="bg-card border border-border rounded-xl p-4 sm:p-6">
          <h2 className="text-sm font-semibold text-foreground uppercase tracking-widest mb-4 flex items-center gap-2">
            <Users className="w-4 h-4" />
            Add New User
          </h2>
          <form onSubmit={createUser} className="space-y-4">
            <div>
              <label className="text-xs text-muted-foreground uppercase tracking-widest">Email</label>
              <input
                type="email"
                value={newUserEmail}
                onChange={(e) => setNewUserEmail(e.target.value)}
                required
                className="mt-1 w-full bg-input border border-border rounded-lg px-3 py-2.5 text-sm text-foreground font-mono focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground uppercase tracking-widest">Password</label>
              <input
                type="password"
                value={newUserPassword}
                onChange={(e) => setNewUserPassword(e.target.value)}
                minLength={8}
                required
                className="mt-1 w-full bg-input border border-border rounded-lg px-3 py-2.5 text-sm text-foreground font-mono focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground uppercase tracking-widest">Role</label>
              <select
                value={newUserRole}
                onChange={(e) => setNewUserRole(e.target.value)}
                className="mt-1 w-full bg-input border border-border rounded-lg px-3 py-2.5 text-sm text-foreground font-mono focus:outline-none focus:ring-2 focus:ring-primary/50"
              >
                <option value="analyst">Analyst</option>
                <option value="admin">Admin</option>
              </select>
            </div>
            <button
              type="submit"
              disabled={creatingUser}
              className="w-full bg-primary text-primary-foreground rounded-lg px-4 py-2.5 text-sm font-semibold hover:bg-primary/90 disabled:opacity-50 transition-all"
            >
              {creatingUser ? "Creating..." : "Create User"}
            </button>
          </form>
        </div>

        <div className="bg-card border border-border rounded-xl p-4 sm:p-6">
          <h2 className="text-sm font-semibold text-foreground uppercase tracking-widest mb-4 flex items-center gap-2">
            <KeyRound className="w-4 h-4" />
            Change Password With OTP
          </h2>

          <form onSubmit={requestPasswordOtp} className="space-y-4">
            <div>
              <label className="text-xs text-muted-foreground uppercase tracking-widest">Current Password</label>
              <input
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                required
                className="mt-1 w-full bg-input border border-border rounded-lg px-3 py-2.5 text-sm text-foreground font-mono focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground uppercase tracking-widest">New Password</label>
              <input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                minLength={8}
                required
                className="mt-1 w-full bg-input border border-border rounded-lg px-3 py-2.5 text-sm text-foreground font-mono focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground uppercase tracking-widest">Confirm New Password</label>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                minLength={8}
                required
                className="mt-1 w-full bg-input border border-border rounded-lg px-3 py-2.5 text-sm text-foreground font-mono focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
            </div>
            <button
              type="submit"
              disabled={changingPassword}
              className="w-full bg-primary text-primary-foreground rounded-lg px-4 py-2.5 text-sm font-semibold hover:bg-primary/90 disabled:opacity-50 transition-all"
            >
              {changingPassword ? "Sending OTP..." : "Send OTP"}
            </button>
          </form>

          {passwordChallengeId && (
            <form onSubmit={verifyPasswordOtp} className="space-y-3 mt-4 border-t border-border pt-4">
              <label className="text-xs text-muted-foreground uppercase tracking-widest">OTP Code</label>
              <input
                type="text"
                inputMode="numeric"
                value={passwordOtp}
                onChange={(e) => setPasswordOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
                required
                className="w-full bg-input border border-border rounded-lg px-3 py-2.5 text-sm text-foreground font-mono tracking-[0.25em] focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
              <button
                type="submit"
                disabled={changingPassword || passwordOtp.length < 6}
                className="w-full bg-emerald-600 text-white rounded-lg px-4 py-2.5 text-sm font-semibold hover:bg-emerald-500 disabled:opacity-50 transition-all"
              >
                {changingPassword ? "Verifying..." : "Verify OTP & Update Password"}
              </button>
            </form>
          )}
        </div>
      </div>

      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="px-4 sm:px-6 py-4 border-b border-border">
          <h2 className="text-sm font-semibold text-foreground uppercase tracking-widest">System Users</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border">
                {["Email", "Role", "Created"].map((h) => (
                  <th
                    key={h}
                    className="px-4 sm:px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-widest"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {loadingUsers ? (
                <tr>
                  <td colSpan={3} className="px-4 sm:px-6 py-8 text-center text-sm text-muted-foreground">
                    Loading users...
                  </td>
                </tr>
              ) : users.length === 0 ? (
                <tr>
                  <td colSpan={3} className="px-4 sm:px-6 py-8 text-center text-sm text-muted-foreground">
                    No users found.
                  </td>
                </tr>
              ) : (
                users.map((user) => (
                  <tr key={user.id}>
                    <td className="px-4 sm:px-6 py-3 text-sm font-mono text-foreground">{user.email}</td>
                    <td className="px-4 sm:px-6 py-3 text-sm text-muted-foreground">{user.role}</td>
                    <td className="px-4 sm:px-6 py-3 text-xs font-mono text-muted-foreground">
                      {formatDate(user.createdAt)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
