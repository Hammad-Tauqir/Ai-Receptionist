import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { AccountMenu } from "@/components/account-menu";
import { AdminAccess } from "@/components/admin-access";
import { Brand } from "@/components/brand";
import { sessionState } from "@/lib/auth";
export const dynamic = "force-dynamic";
export default async function AdminPage() { const state = await sessionState(await headers()); if (!state.authenticated) redirect("/login"); if (!state.user) redirect("/access-denied"); if (!state.user.owner) redirect("/"); return <><header className="site-header"><div className="shell nav"><Brand /><a className="account-link" href="/">Receptionist</a><AccountMenu email={state.user.email} owner /></div></header><main className="admin-page shell"><p className="eyebrow">OWNER ADMINISTRATION</p><h1>Manage access<span>.</span></h1><p className="admin-intro">Create a personal invitation link, send it to the recipient's email yourself, or revoke an existing account. Approval is checked again on every chat request.</p><AdminAccess /></main></>; }
