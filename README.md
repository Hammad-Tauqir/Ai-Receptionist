# Nova Digital — AI Voice Receptionist

A responsive Next.js App Router website using TypeScript and Tailwind CSS. The website handles the visitor interface; all service answers, consent, lead saving, availability checks and booking decisions belong to the existing n8n workflow.

## Invite-only authentication

The receptionist uses Better Auth email/password sessions. It keeps the existing SQLite database for local development and uses Supabase PostgreSQL when `DATABASE_URL` is set. Public registration is disabled. The owner creates a password privately in the terminal, then generates personal invitation links at `/admin`. The owner emails each link manually; recipients set their own passwords. No transactional email provider is configured or used. The receptionist page and `/api/chat` re-check the current allowlist on every request.

Add these server-only values to `.env.local` (never prefix them with `NEXT_PUBLIC_`):

```env
BETTER_AUTH_SECRET=
BETTER_AUTH_URL=http://localhost:3000
OWNER_EMAIL=
DATABASE_URL=
DATABASE_SSL_CA=
AUTH_DATABASE_PATH=./data/auth.db
```

- Set `OWNER_EMAIL` to the email that manages access. The owner is always approved and cannot be removed in the UI.
- Run `npm run auth:setup-owner` in an interactive terminal. It privately prompts for a password of at least 12 characters, runs the database migration, and creates the owner account. It also generates and saves `BETTER_AUTH_SECRET` locally if missing and defaults `BETTER_AUTH_URL` to `http://localhost:3000`. It never prints the password or secret.
- Set `BETTER_AUTH_URL` to the exact public site origin (HTTPS in production), and keep `BETTER_AUTH_SECRET` unchanged once accounts exist.
- Leave `DATABASE_URL` blank for the existing local SQLite file at `AUTH_DATABASE_PATH`. Set `DATABASE_URL` on Vercel to use Supabase PostgreSQL; `AUTH_DATABASE_PATH` is ignored then. Never put the database URL in client code or Git.

For later schema updates, run:

```sh
npm run auth:migrate
```

### Supabase PostgreSQL for Vercel

For Supabase's database certificate authority, open **Database > Settings > SSL** in the Supabase dashboard and download the **server root certificate**. Set the complete PEM contents (including `-----BEGIN CERTIFICATE-----` and `-----END CERTIFICATE-----`) as the server-only `DATABASE_SSL_CA` in Vercel's Production environment and locally before migrating. In Vercel paste the multiline value without surrounding quotes; in `.env.local` put double quotes around the multiline value. Literal `\n` line separators are also supported. This is a public CA certificate, not the database password, an API key, or a private key. Use only the certificate downloaded from your project's dashboard; never trust a certificate copied from a failed TLS connection.

`SELF_SIGNED_CERT_IN_CHAIN` indicates that the database certificate chain is not trusted by the runtime. `DATABASE_SSL_CA` adds the supplied CA to the driver's trust store while preserving TLS certificate and hostname verification. Malformed certificates fail with `database_ssl_ca_invalid`. Do not disable verification with `NODE_TLS_REJECT_UNAUTHORIZED=0` or `rejectUnauthorized: false`. URL SSL flags cannot override the app's verification settings; filesystem certificate options in the URL are rejected. Redeploy after adding the environment variable. A successful TLS connection still requires the auth schema migration below; adding a CA does not create tables. See [Supabase SSL documentation](https://supabase.com/docs/guides/platform/ssl-enforcement).

Create a Supabase project. In its **Connect** dialog, copy the **Transaction pooler** URI (port 6543), replace its password placeholder locally, and set the result as the server-only `DATABASE_URL` in Vercel and in your local `.env.local` when running migrations. Percent-encode reserved password characters in the URI. This app uses one TLS-verified connection per warm serverless instance and unnamed queries, which are compatible with transaction pooling. Do not use Supabase's anon key or service-role key for this connection. The app creates its tables in a private `nova_auth` schema; **do not add that schema to Supabase's Exposed schemas**. See [Supabase's connection guide](https://supabase.com/docs/guides/database/connecting-to-postgres) and [private-schema guidance](https://supabase.com/docs/guides/api/using-custom-schemas).

To keep existing local password accounts and approved emails, first run `npm run auth:import-sqlite` with `AUTH_DATABASE_PATH` still pointing at the old local file. This is a read-only dry run. Set `DATABASE_URL` to the new, empty Supabase database and run `npm run auth:import-sqlite -- --apply` in your own terminal. The importer creates the auth schema, refuses a non-empty target, preserves password hashes and approvals, and never prints them. Existing login sessions and pending invite links are not copied; users log in again, and the owner issues fresh links if needed. Do not run `auth:setup-owner` on the new target before this import. If there are no existing accounts to preserve, skip the importer and run `npm run auth:setup-owner` with `DATABASE_URL` set instead.

Set `BETTER_AUTH_URL` to the final HTTPS site origin and set the same stable `BETTER_AUTH_SECRET`, `OWNER_EMAIL`, `DATABASE_URL`, and n8n settings as server-only Vercel environment variables before deploying. A GitHub push alone does not configure Vercel or migrate the database. Restart/redeploy after changing environment variables; do not leave SQLite as the Vercel database.

Then log in as the owner, open `/admin`, enter an email, and copy the one-time link. Send that link to the person's email using your own email account. The link expires after 48 hours. The recipient opens it, sets a password, and logs in. A new invite for the same email cancels the previous link. **Revoke** removes access and pending invitations; a revoked login session may still exist, but the next protected page or API request is denied because approval is read live from the database. Reapproving an existing account restores access to its existing password.

Better Auth handles password hashing and sessions. There is no self-service forgotten-password email flow until a transactional email provider is configured. Invitation links are shown only once to the owner and are stored as hashes. Keep the links private.

## Local setup

Use Node.js 22+ and npm.

For a fresh checkout, copy `.env.example` to `.env.local` (`Copy-Item .env.example .env.local` in PowerShell), then set `OWNER_EMAIL`. Do not overwrite an existing credential file. In this workspace the owner email is already set locally. Run the owner setup command yourself so the password is entered privately:

```sh
npm ci
npm run auth:setup-owner
npm run dev
```

Open http://localhost:3000/login. This workspace already has an ignored `.env.local` with the n8n Chat URL and empty n8n credential fields. Fill those locally as described below. Missing or invalid n8n URL/Basic Auth configuration keeps the clearly labeled disconnected preview. Sending in that preview preserves the draft and explains that nothing was sent. The initial greeting is labeled as an example; no business reply, saved lead or booking is simulated.

```sh
npm run build
npm run typecheck
npm test
npm run start
```

No deployment is configured or performed. A Node.js server is required for `/api/chat`; this project cannot be hosted as a static export.

## Connect the existing n8n endpoint

The published Chat Trigger uses **Basic Auth** and **When Last Node Finishes**, with a non-streaming response. The production URL is already set in `.env.local`. Fill the other two values with the username and password from the **HTTP Basic Auth credential attached to that Chat Trigger**. These are not necessarily your n8n account login. Enter them in the local file, not in chat.

```dotenv
N8N_CHAT_URL="https://YOUR-N8N-HOST/webhook/YOUR-CHAT-PATH"
N8N_BASIC_AUTH_USERNAME="your-chat-trigger-basic-auth-username"
N8N_BASIC_AUTH_PASSWORD="your-chat-trigger-basic-auth-password"
```

Replace both credential placeholders, save the file, and restart `npm run dev` (or the production Node process). Quote values containing `#` or whitespace, and escape a literal `$` as `\$` because Next.js expands environment variable references. The adapter preserves credential characters without trimming them; Basic Auth usernames cannot contain a colon. `.env.local` is ignored by Git. `.env.example` contains empty placeholders only.

Never use `NEXT_PUBLIC_` for these values. The server constructs `Authorization: Basic <base64(username:password)>` using UTF-8. No manual base64 conversion is needed. The former `N8N_CHAT_AUTH_TOKEN` setting is no longer used. Both the configuration module and adapter have `server-only` guards, so importing them into a Client Component fails the build. Browser code receives only a configured/not-configured boolean, never the URL or credentials. The demo label disappears only with a valid URL and both nonempty, valid credential fields; this indicates configuration, not a verified backend health check. Remote connections require HTTPS; loopback HTTP is allowed for local mocked tests.

The browser POSTs this shape to `/api/chat`:

```json
{
  "message": "I would like to discuss a website.",
  "sessionId": "e4527328-b830-4d56-bdaf-e1aedeb039b1"
}
```

The isolated adapter maps it to the standard Chat Trigger request:

```json
{
  "action": "sendMessage",
  "sessionId": "e4527328-b830-4d56-bdaf-e1aedeb039b1",
  "chatInput": "I would like to discuss a website."
}
```

The adapter accepts `{ "output": "The assistant’s reply." }` (Agent) or `{ "text": "The assistant’s reply." }` (Chain), including a single-item array containing either shape. It always returns `{ "reply": "The assistant’s reply." }` to the browser. Empty replies, error objects, ambiguous multi-item arrays, arbitrary objects, plain text/HTML and streaming responses are rejected safely, rather than displayed as conversation content. These fields match the [Chat Trigger reference](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-langchain.chattrigger/) and [last-node implementation](https://github.com/n8n-io/n8n/blob/master/packages/%40n8n/nodes-langchain/nodes/trigger/ChatTrigger/ChatTrigger.node.ts). No authenticated live request was made; this particular workflow's response remains unverified until local credentials are entered and a live test is authorized.

Authentication errors (401/403) produce a sanitized message identifying n8n's HTTP status. For the Chat Trigger, 401 means no Basic credentials were accepted and 403 means the username or password does not match the HTTP Basic Auth credential attached to the node. Upstream error bodies, credentials and URLs are never forwarded to the browser or logged. There are no automatic retries, including for authentication, rate, timeout and malformed-response failures.

The existing workflow must enforce consent before saving leads and explicit confirmation before booking a 30-minute discovery call. Its calendar default must be **Asia/Karachi**. The interface displays this default but does not calculate availability, book appointments, save leads or generate FAQ answers. No n8n workflow was modified.

## Voice and privacy

- Microphone capture starts only with an explicit click on **Speak**. The hero buttons focus the composer; they do not activate recording.
- Speech recognition uses `SpeechRecognition` or `webkitSpeechRecognition` with English (`en-PK`) and Urdu (`ur-PK`) options. Text entry accepts English, Urdu and Roman Urdu.
- This is turn-by-turn interaction, not a continuous call. Stop recording, review/edit the final transcript, then explicitly press Send. Interim recognition text is never submitted. Existing typed text is preserved when a transcript is added.
- **Read aloud** is off by default. Speech synthesis chooses an installed matching language voice when available, otherwise lets the browser fall back. A **Stop speaking** control appears during playback. Starting the microphone stops playback first.
- Microphone access requires HTTPS in production; localhost is generally treated as a secure context. The browser must have permission, a working microphone and recognition support. Unsupported browsers retain usable text chat. Permission denial, missing devices, no speech, language and service errors are explained inline.
- Recognition may use the browser provider’s online speech service. Voice quality and language availability depend on the browser/device; natural Urdu or Roman Urdu pronunciation is not guaranteed. This app never records or stores raw audio.
- Browser voice avoids a separate paid voice API. n8n hosting and AI model usage may still incur costs, and each message can consume a workflow execution.
- Only a random conversation UUID is stored in `sessionStorage`. Names, emails, messages and transcripts stay in component memory and are not stored in localStorage or browser databases. Reloading clears the visible transcript but reuses the session ID; n8n may retain its own context. **New conversation** creates a new UUID and clears the UI; it does not delete upstream records. If sessionStorage is blocked, the UUID lasts only until reload.
- The server does not log conversation content, contact information, upstream response bodies or credentials. Review n8n execution history, hosting/request logs and browser-provider retention separately when operating the integration.

## Reliability and verification

Requests require JSON, a 1–4,000 character message and a UUID v4 session ID. Request and upstream response sizes are bounded. Upstream calls time out after 25 seconds; the browser has a 35-second safeguard. Credentials are sent only server-to-server, and redirects are rejected. Replies are rendered with React Markdown without raw HTML; remote images are not loaded and links allow only HTTP(S), opened with `noopener noreferrer`.

The server rejects messages over 4,000 characters with HTTP 413. `/api/chat` allows 8 requests per minute per authenticated user and 100 requests per minute overall. HTTP 429 includes a friendly explanation and `Retry-After`; the browser never retries automatically. Authentication and the live approval check run before parsing the request body or calling n8n. SQLite development uses an in-memory limit; Supabase PostgreSQL uses atomic shared counters across Vercel instances.

The UI allows one pending request and disables duplicate sends, new-conversation changes and recording while waiting. No failure is automatically retried. Timeout, network, quota and malformed-response messages explain that a booking or lead action could not be confirmed. This is not a distributed idempotency guarantee: a workflow might complete after the reply is lost, and manual resubmission may duplicate an action. Confirm the outcome in the existing workflow before repeating a request.

Tests use mocked authorization and upstream functions. They never call the live workflow:

```sh
npm test
npm run build
npm run test:e2e
```

Playwright uses the installed Chrome browser by default. Override `PLAYWRIGHT_CHANNEL` to `msedge` if needed. It starts the built website at `127.0.0.1:3100` with test-only auth configuration. Its chat request is deliberately unauthenticated and must be rejected before any n8n adapter call.

Browser checks cover unauthenticated redirect, invite-only login UI, disabled public registration, protected chat/admin APIs, errors, and desktop/mobile overflow. Unit/API tests cover owner creation, one-time invitations, password login, approved and denied users, immediate revocation, owner-only administration, per-user limits, input validation, exact n8n credential encoding, safe upstream authentication errors, reply formats, timeouts, quota errors and malformed responses. An in-memory PostgreSQL test covers the Supabase code path without contacting a real project. Real Supabase connectivity and import, email delivery by the owner, microphone hardware, browser recognition, installed voice quality, and the live n8n workflow still require manual checks. No live workflow requests, calendar bookings, lead saves or Vercel deployment were performed.

Main files: `src/app/page.tsx` (agency page), `src/app/globals.css` (responsive styling), `src/components/receptionist.tsx` (conversation UI), `src/hooks/use-browser-voice.ts` (voice lifecycle), `src/app/api/chat/route.ts` (server boundary), `src/lib/n8n.ts` (integration adapter).
