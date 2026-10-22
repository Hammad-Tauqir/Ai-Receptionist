import { headers } from "next/headers";
import { ShieldX } from "lucide-react";
import { AccountMenu } from "@/components/account-menu";
import { Brand } from "@/components/brand";
import { sessionState } from "@/lib/auth";
export const dynamic = "force-dynamic";
export default async function AccessDeniedPage() { const state = await sessionState(await headers()); return <><header className="site-header"><div className="shell nav"><Brand />{state.authenticated && <AccountMenu email="Signed-in account" owner={false} />}</div></header><main className="auth-page"><section className="auth-card"><span className="auth-icon denied"><ShieldX size={28} /></span><p className="eyebrow">ACCESS DENIED</p><h1>This account isn’t approved<span>.</span></h1><p>Ask the owner to approve your account, then try logging in again.</p><a className="button button-primary auth-button" href="/login">Back to login</a></section></main></>; }
