"use client";

import { LoaderCircle, ShieldCheck } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";

export function AcceptInviteForm() {
  const invitationRead = useRef(false);
  const [token, setToken] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (invitationRead.current) return;
    invitationRead.current = true;
    const value = new URLSearchParams(window.location.hash.slice(1)).get("token");
    setToken(value && /^[A-Za-z0-9_-]{43}$/.test(value) ? value : "");
    window.history.replaceState(null, "", window.location.pathname);
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token) return;
    if (password !== confirmation) { setError("Passwords do not match."); return; }
    setPending(true); setError("");
    try {
      const response = await fetch("/api/invitations/accept", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, name: name.trim(), password }),
      });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error || "Could not activate this invite.");
      window.location.assign("/login?invited=1");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not activate this invite.");
    } finally {
      setPending(false);
    }
  }

  return <main className="auth-page"><section className="auth-card" aria-labelledby="invite-title">
    <span className="auth-icon"><ShieldCheck size={28} /></span>
    <p className="eyebrow">PERSONAL INVITATION</p>
    <h1 id="invite-title">Set your password<span>.</span></h1>
    {token === null ? <p className="loading-state"><LoaderCircle className="spin" size={17} />Loading invitation…</p>
      : !token ? <><p className="auth-error" role="alert">This invitation link is missing or invalid. Ask the owner for a new link.</p><a className="button button-secondary auth-button" href="/login">Back to login</a></>
      : <><p>Create your account with a password only you know.</p>
        {error && <p className="auth-error" role="alert">{error}</p>}
        <form className="auth-form" onSubmit={event => void submit(event)}>
          <label htmlFor="invite-name">Your name</label>
          <input id="invite-name" type="text" autoComplete="name" maxLength={80} required value={name} onChange={event => setName(event.target.value)} disabled={pending} />
          <label htmlFor="invite-password">Password (at least 12 characters)</label>
          <input id="invite-password" type="password" autoComplete="new-password" minLength={12} maxLength={128} required value={password} onChange={event => setPassword(event.target.value)} disabled={pending} />
          <label htmlFor="invite-confirmation">Confirm password</label>
          <input id="invite-confirmation" type="password" autoComplete="new-password" minLength={12} maxLength={128} required value={confirmation} onChange={event => setConfirmation(event.target.value)} disabled={pending} />
          <button className="button button-primary auth-button" disabled={pending}>{pending ? <><LoaderCircle className="spin" size={17} />Creating account…</> : "Set password"}</button>
        </form></>}
  </section></main>;
}
