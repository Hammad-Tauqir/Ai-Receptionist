"use client";
import { LogOut, Settings } from "lucide-react";
import { useState } from "react";
import { authClient } from "@/lib/auth-client";
export function AccountMenu({ email, owner }: { email: string; owner: boolean }) {
  const [pending, setPending] = useState(false); const [error, setError] = useState("");
  async function logout() { setPending(true); setError(""); const result = await authClient.signOut(); if (result.error) { setError("Could not log out. Please try again."); setPending(false); return; } window.location.assign("/login"); }
  return <div className="account-menu"><span className="account-email" title={email}>{email}</span>{owner && <a className="account-link" href="/admin"><Settings size={14} />Access</a>}<button className="account-link" onClick={() => void logout()} disabled={pending}><LogOut size={14} />{pending ? "Logging out…" : "Log out"}</button>{error && <span role="alert" className="account-error">{error}</span>}</div>;
}
