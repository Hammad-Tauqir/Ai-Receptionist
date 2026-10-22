import "server-only";

import { betterAuth, type BetterAuthOptions } from "better-auth";
import { nextCookies } from "better-auth/next-js";
import { isApproved, isOwner, normalizeEmail } from "./access";
import { database } from "./database";

export const authOptions = {
  appName: "Nova Digital Receptionist",
  database,
  secret: process.env.BETTER_AUTH_SECRET,
  baseURL: process.env.BETTER_AUTH_URL,
  emailAndPassword: { enabled: true, autoSignIn: false, minPasswordLength: 12, maxPasswordLength: 128 },
  user: {
    changeEmail: { enabled: false },
    deleteUser: { enabled: false },
    validateUserInfo: ({ user }) => {
      if (!user.email || (!isApproved(user.email) && !database.prepare(
        "SELECT 1 FROM invitation WHERE email = ? AND claimed_at IS NOT NULL AND used_at IS NULL AND expires_at > ?",
      ).get(normalizeEmail(user.email), Date.now()))) {
        return { error: "This email has not been approved by the owner." };
      }
    },
  },
  databaseHooks: {
    session: { create: { before: async session => {
      const user = database.prepare("SELECT email FROM user WHERE id = ?").get(session.userId) as { email: string } | undefined;
      return Boolean(user && isApproved(user.email));
    } } },
  },
  session: { cookieCache: { enabled: false } },
  account: { accountLinking: { enabled: false } },
  rateLimit: { enabled: true, window: 60, max: 20 },
  onAPIError: { errorURL: "/access-denied" },
  plugins: [nextCookies()],
} satisfies BetterAuthOptions;

export const auth = betterAuth(authOptions);

export type AuthorizedUser = { id: string; email: string; name: string; owner: boolean };

export async function currentUser(headers: Headers): Promise<AuthorizedUser | null> {
  const session = await auth.api.getSession({ headers });
  if (!session?.user.email || !isApproved(session.user.email)) return null;
  return { id: session.user.id, email: session.user.email, name: session.user.name, owner: isOwner(session.user.email) };
}

export async function sessionState(headers: Headers): Promise<{ authenticated: boolean; user: AuthorizedUser | null }> {
  const session = await auth.api.getSession({ headers });
  if (!session?.user.email) return { authenticated: false, user: null };
  if (!isApproved(session.user.email)) return { authenticated: true, user: null };
  return { authenticated: true, user: { id: session.user.id, email: session.user.email, name: session.user.name, owner: isOwner(session.user.email) } };
}
