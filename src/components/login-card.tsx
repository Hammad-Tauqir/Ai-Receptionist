"use client";

import { LoaderCircle, LogIn, ShieldCheck } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useState, type FormEvent } from "react";
import { authClient } from "@/lib/auth-client";

export function LoginCard() {
  const params = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(params.has("error") ? "Login could not be completed. Please try again." : "");

  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError("");
    try {
      const result = await authClient.signIn.email({ email: email.trim(), password });
      if (result.error) {
        setError("Email or password is incorrect, or this account is not approved.");
        return;
      }
      window.location.assign("/");
    } catch {
      setError("Login is unavailable right now. Please try again.");
    } finally {
      setPending(false);
    }
  }

  return <main className="auth-page"><section className="auth-card" aria-labelledby="login-title">
    <span className="auth-icon"><ShieldCheck size={28} /></span>
    <p className="eyebrow">INVITE-ONLY ACCESS</p>
    <h1 id="login-title">Welcome to Nova<span>.</span></h1>
    <p>Sign in with the email and password you set through your invitation.</p>
    {params.has("invited") && <p className="auth-success" role="status">Password set. You can log in now.</p>}
    {error && <p className="auth-error" role="alert">{error}</p>}
    <form className="auth-form" onSubmit={event => void login(event)}>
      <label htmlFor="login-email">Email</label>
      <input id="login-email" type="email" autoComplete="email" required value={email} onChange={event => setEmail(event.target.value)} disabled={pending} />
      <label htmlFor="login-password">Password</label>
      <input id="login-password" type="password" autoComplete="current-password" required value={password} onChange={event => setPassword(event.target.value)} disabled={pending} />
      <button className="button button-primary auth-button" disabled={pending}>
        {pending ? <><LoaderCircle className="spin" size={17} />Signing in…</> : <><LogIn size={17} />Log in</>}
      </button>
    </form>
    <p className="auth-note">There is no public registration. Ask the owner for a personal invitation link.</p>
  </section></main>;
}
