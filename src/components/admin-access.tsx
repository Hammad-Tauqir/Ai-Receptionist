"use client";

import { Copy, LoaderCircle, Trash2, UserPlus } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";

type ApprovedUser = { email: string; addedAt: number; addedBy: string; owner: boolean };
type PendingInvitation = { id: number; email: string; createdAt: number; expiresAt: number; createdBy: string };
type InvitationResult =
  | { kind: "invited"; invitation: PendingInvitation; url: string }
  | { kind: "approved"; user: ApprovedUser };

export function AdminAccess() {
  const [users, setUsers] = useState<ApprovedUser[]>([]);
  const [pending, setPending] = useState<PendingInvitation[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyEmail, setBusyEmail] = useState("");
  const [email, setEmail] = useState("");
  const [invitation, setInvitation] = useState<{ email: string; url: string } | null>(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  async function load() {
    setLoading(true);
    try {
      const response = await fetch("/api/admin/allowed-users", { cache: "no-store" });
      const data = await response.json() as { users?: ApprovedUser[]; pending?: PendingInvitation[]; error?: string };
      if (!response.ok || !data.users || !data.pending) throw new Error(data.error);
      setUsers(data.users);
      setPending(data.pending);
    } catch {
      setError("Access list could not be loaded. Please refresh the page.");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { void load(); }, []);

  async function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalized = email.trim().toLowerCase();
    if (!normalized) return;
    setBusyEmail(normalized); setError(""); setNotice(""); setInvitation(null);
    try {
      const response = await fetch("/api/admin/allowed-users", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: normalized }),
      });
      const data = await response.json() as InvitationResult & { error?: string };
      if (!response.ok) throw new Error(data.error || "Could not create invitation.");
      if (data.kind === "invited") setInvitation({ email: normalized, url: data.url });
      else setNotice(`${normalized} already has an account. Access has been restored.`);
      setEmail("");
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not create invitation.");
    } finally {
      setBusyEmail("");
    }
  }

  async function copyLink() {
    if (!invitation) return;
    try { await navigator.clipboard.writeText(invitation.url); setNotice("Invitation link copied."); }
    catch { setError("Copy failed. Select and copy the link below manually."); }
  }

  async function revoke(emailToRevoke: string) {
    if (!window.confirm(`Remove access or cancel the invitation for ${emailToRevoke}?`)) return;
    setBusyEmail(emailToRevoke); setError(""); setNotice("");
    try {
      const response = await fetch("/api/admin/allowed-users", {
        method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: emailToRevoke }),
      });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error || "Could not remove access.");
      if (invitation?.email === emailToRevoke) setInvitation(null);
      setNotice(`${emailToRevoke} no longer has access.`);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not remove access.");
    } finally {
      setBusyEmail("");
    }
  }

  return <div className="admin-access">
    <form className="invite-form" onSubmit={event => void add(event)}>
      <label htmlFor="allowed-email">Invite an email</label>
      <div><input id="allowed-email" type="email" required maxLength={254} placeholder="person@example.com" value={email} onChange={event => setEmail(event.target.value)} disabled={Boolean(busyEmail)} />
        <button className="button button-primary" disabled={Boolean(busyEmail)}>{busyEmail ? <LoaderCircle className="spin" size={16} /> : <UserPlus size={16} />}Create invite</button></div>
      <p>Copy the link and email it to that person yourself. It expires after 48 hours.</p>
    </form>
    {error && <p className="auth-error" role="alert">{error}</p>}
    {notice && <p className="auth-success" role="status">{notice}</p>}
    {invitation && <section className="invite-link" aria-label="New invitation link">
      <strong>Invite for {invitation.email}</strong>
      <p>This link is shown only now. Creating another invite for this email cancels this link.</p>
      <div><input type="text" value={invitation.url} readOnly aria-label="Invitation link" onFocus={event => event.currentTarget.select()} /><button className="account-link" type="button" onClick={() => void copyLink()}><Copy size={14} />Copy link</button></div>
    </section>}
    <section className="approved-list" aria-labelledby="approved-title"><h2 id="approved-title">Approved users</h2>
      {loading ? <p className="loading-state"><LoaderCircle className="spin" size={17} />Loading users…</p> : users.length === 0 ? <p>No approved users yet.</p> : <ul>{users.map(user => <li key={user.email}><div><strong>{user.email}</strong><span>{user.owner ? "Owner · configured by environment" : `Added by ${user.addedBy}`}</span></div><button aria-label={`Revoke ${user.email}`} disabled={user.owner || busyEmail === user.email} onClick={() => void revoke(user.email)}>{busyEmail === user.email ? <LoaderCircle className="spin" size={16} /> : <Trash2 size={16} />}{user.owner ? "Owner" : "Revoke"}</button></li>)}</ul>}
    </section>
    <section className="approved-list" aria-labelledby="pending-title"><h2 id="pending-title">Pending invitations</h2>
      {loading ? <p className="loading-state"><LoaderCircle className="spin" size={17} />Loading invitations…</p> : pending.length === 0 ? <p>No pending invitations.</p> : <ul>{pending.map(item => <li key={item.id}><div><strong>{item.email}</strong><span>Expires {new Date(item.expiresAt).toLocaleString()}</span></div><button aria-label={`Cancel invite for ${item.email}`} disabled={busyEmail === item.email} onClick={() => void revoke(item.email)}><Trash2 size={16} />Cancel</button></li>)}</ul>}
    </section>
  </div>;
}
