import { currentUser, type AuthorizedUser } from "@/lib/auth";
import { listApprovedUsers, type ApprovedUser } from "@/lib/access";
import { inviteOrApprove, listPendingInvitations, revokeEmailAndInvitations, type PendingInvitation } from "@/lib/invitations";
import { readLimitedBody } from "@/lib/n8n";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const responseHeaders = { "Cache-Control": "no-store" };

function sameOrigin(request: Request): boolean {
  if (request.headers.get("sec-fetch-site") === "cross-site") return false;
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try { return new URL(origin).host === (request.headers.get("host") || new URL(request.url).host); }
  catch { return false; }
}

type AdminDependencies = {
  authorize: (headers: Headers) => Promise<AuthorizedUser | null>;
  list: () => ApprovedUser[];
  listPending: () => PendingInvitation[];
  invite: typeof inviteOrApprove;
  revoke: (email: string) => boolean;
};

export function createAdminHandlers(dependencies: AdminDependencies = { authorize: currentUser, list: listApprovedUsers, listPending: listPendingInvitations, invite: inviteOrApprove, revoke: revokeEmailAndInvitations }) {
  async function requireOwner(request: Request) { const user = await dependencies.authorize(request.headers); return user?.owner ? user : null; }
  async function GET(request: Request) {
    if (!await requireOwner(request)) return Response.json({ error: "Owner access required." }, { status: 403, headers: responseHeaders });
    return Response.json({ users: dependencies.list(), pending: dependencies.listPending() }, { headers: responseHeaders });
  }
  async function POST(request: Request) {
    const owner = await requireOwner(request);
    if (!owner) return Response.json({ error: "Owner access required." }, { status: 403, headers: responseHeaders });
    if (!sameOrigin(request)) return Response.json({ error: "Request origin not allowed." }, { status: 403, headers: responseHeaders });
    if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) return Response.json({ error: "Send JSON." }, { status: 415, headers: responseHeaders });
    try {
      const body: unknown = JSON.parse(await readLimitedBody(request.body, 2_048));
      const email = body && typeof body === "object" && "email" in body ? (body as { email?: unknown }).email : null;
      if (typeof email !== "string") throw new Error("invalid_email");
      const result = dependencies.invite(email, owner.email);
      return Response.json(result, { status: 201, headers: responseHeaders });
    } catch (error) {
      const configuration = error instanceof Error && error.message === "base_url_missing";
      return Response.json({ error: configuration ? "The site URL is not configured." : "Enter a valid email address." }, { status: configuration ? 503 : 400, headers: responseHeaders });
    }
  }

  async function DELETE(request: Request) {
    if (!await requireOwner(request)) return Response.json({ error: "Owner access required." }, { status: 403, headers: responseHeaders });
    if (!sameOrigin(request)) return Response.json({ error: "Request origin not allowed." }, { status: 403, headers: responseHeaders });
    if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) return Response.json({ error: "Send JSON." }, { status: 415, headers: responseHeaders });
    try {
      const body: unknown = JSON.parse(await readLimitedBody(request.body, 2_048));
      const email = body && typeof body === "object" && "email" in body ? (body as { email?: unknown }).email : null;
      if (typeof email !== "string") throw new Error("invalid_email");
      dependencies.revoke(email);
      return Response.json({ ok: true }, { headers: responseHeaders });
    } catch (error) {
      const owner = error instanceof Error && error.message === "owner_cannot_be_revoked";
      return Response.json({ error: owner ? "The owner cannot be revoked here." : "Enter a valid email address." }, { status: 400, headers: responseHeaders });
    }
  }
  return { GET, POST, DELETE };
}

export const { GET, POST, DELETE } = createAdminHandlers();
