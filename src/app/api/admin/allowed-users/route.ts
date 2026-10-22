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
  list: () => Promise<ApprovedUser[]>;
  listPending: () => Promise<PendingInvitation[]>;
  invite: typeof inviteOrApprove;
  revoke: (email: string) => Promise<boolean>;
};

export function createAdminHandlers(dependencies: AdminDependencies = { authorize: currentUser, list: listApprovedUsers, listPending: listPendingInvitations, invite: inviteOrApprove, revoke: revokeEmailAndInvitations }) {
  async function requireOwner(request: Request) { const user = await dependencies.authorize(request.headers); return user?.owner ? user : null; }
  async function GET(request: Request) {
    if (!await requireOwner(request)) return Response.json({ error: "Owner access required." }, { status: 403, headers: responseHeaders });
    const [users, pending] = await Promise.all([dependencies.list(), dependencies.listPending()]);
    return Response.json({ users, pending }, { headers: responseHeaders });
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
      const result = await dependencies.invite(email, owner.email);
      return Response.json(result, { status: 201, headers: responseHeaders });
    } catch (error) {
      const code = error instanceof Error ? error.message : "";
      const badInput = code === "invalid_email";
      return Response.json({ error: badInput ? "Enter a valid email address." : code === "base_url_missing" ? "The site URL is not configured." : "Could not update access. Please try again." }, { status: badInput ? 400 : 503, headers: responseHeaders });
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
      await dependencies.revoke(email);
      return Response.json({ ok: true }, { headers: responseHeaders });
    } catch (error) {
      const code = error instanceof Error ? error.message : "";
      const badInput = code === "invalid_email" || code === "owner_cannot_be_revoked";
      return Response.json({ error: code === "owner_cannot_be_revoked" ? "The owner cannot be revoked here." : badInput ? "Enter a valid email address." : "Could not update access. Please try again." }, { status: badInput ? 400 : 503, headers: responseHeaders });
    }
  }
  return { GET, POST, DELETE };
}

export const { GET, POST, DELETE } = createAdminHandlers();
