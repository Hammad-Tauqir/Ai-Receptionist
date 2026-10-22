import { Suspense } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { Brand } from "@/components/brand";
import { LoginCard } from "@/components/login-card";
import { sessionState } from "@/lib/auth";
export const dynamic = "force-dynamic";
export default async function LoginPage() { const state = await sessionState(await headers()); if (state.user) redirect("/"); return <><header className="site-header"><div className="shell nav"><Brand /></div></header><Suspense fallback={<main className="auth-page"><p className="loading-state">Loading login…</p></main>}><LoginCard /></Suspense></>; }
