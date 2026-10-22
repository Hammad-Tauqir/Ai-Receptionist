import "server-only";
import { isN8nConfigured, type N8nConfig } from "./n8n-config";
import type { ChatInput } from "./chat-contract";

// Server-only adapter: imported exclusively by the API route. No workflow logic lives here.
export const UPSTREAM_TIMEOUT_MS = 25_000;
const MAX_RESPONSE_BYTES = 128_000;
export class ChatError extends Error {
  constructor(public code: string, public status: number, message: string) {
    super(message);
  }
}
export function toN8nPayload(input: ChatInput) {
  return { action: "sendMessage", sessionId: input.sessionId, chatInput: input.message };
}
export function parseN8nReply(data: unknown): string {
  // Last-node responses use output (Agent) or text (Chain). Accept a single-item
  // JSON array as well, but never guess among multiple items or stringify data.
  const item: unknown = Array.isArray(data) && data.length === 1 ? data[0] : data;
  if (item && typeof item === "object" && !Array.isArray(item) && !("error" in item)) {
    const reply = "output" in item ? item.output : "text" in item ? item.text : undefined;
    if (typeof reply === "string" && reply.trim() && reply.length <= 32_000) return reply.trim();
  }
  throw new ChatError("invalid_response", 502, "The receptionist returned an unreadable reply. Any booking or lead action could not be confirmed. Please check before submitting the same request again.");
}
export async function readLimitedBody(stream: ReadableStream<Uint8Array> | null, limit: number): Promise<string> {
  if (!stream) return "";
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let result = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > limit) {
        await reader.cancel();
        throw new Error("Body exceeds limit");
      }
      result += decoder.decode(value, { stream: true });
    }
    return result + decoder.decode();
  } finally { reader.releaseLock(); }
}
type AdapterOptions = N8nConfig & {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
};
export async function sendToN8n(input: ChatInput, options: AdapterOptions): Promise<string> {
  if (!options.url?.trim() || !options.username?.trim() || !options.password?.trim()) {
    throw new ChatError("not_connected", 503, "Demo preview — receptionist not connected. Your message was not sent to n8n. No booking or lead was created.");
  }
  if (!isN8nConfigured(options)) {
    throw new ChatError("configuration", 503, "The receptionist connection is not configured correctly. Your message was not sent.");
  }
  const url = new URL(options.url);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? UPSTREAM_TIMEOUT_MS);
  const authorization = `Basic ${Buffer.from(`${options.username}:${options.password}`, "utf8").toString("base64")}`;
  try {
    const response = await (options.fetchImpl ?? fetch)(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json", Authorization: authorization },
      body: JSON.stringify(toN8nPayload(input)),
      signal: controller.signal,
      cache: "no-store",
      redirect: "error",
    });
    if (!response.ok) {
      await response.body?.cancel();
      if (response.status === 401) {
        throw new ChatError("authentication", 502, "n8n did not accept the Basic Auth header (HTTP 401). Check the Chat Trigger credentials. Your message will not be retried automatically.");
      }
      if (response.status === 403) {
        throw new ChatError("authentication", 502, "n8n rejected the Basic Auth username or password (HTTP 403). Check the credential attached to the Chat Trigger. Your message will not be retried automatically.");
      }
      if (response.status === 429 || response.status === 402) {
        throw new ChatError("rate_limited", 429, "The receptionist is temporarily at capacity. Any booking or lead action could not be confirmed. Please check before submitting the same request again.");
      }
      throw new ChatError("upstream_error", 502, "The receptionist could not complete the reply. Any booking or lead action could not be confirmed. Please check before submitting the same request again.");
    }
    let data: unknown;
    try { data = JSON.parse(await readLimitedBody(response.body, MAX_RESPONSE_BYTES)); }
    catch (error) {
      if (controller.signal.aborted) throw error;
      throw new ChatError("invalid_response", 502, "The receptionist returned an unreadable reply. Any booking or lead action could not be confirmed. Please check before submitting the same request again.");
    }
    return parseN8nReply(data);
  } catch (error) {
    if (error instanceof ChatError) throw error;
    throw new ChatError(controller.signal.aborted ? "timeout" : "unreachable", controller.signal.aborted ? 504 : 502,
      "The reply could not be received. Any booking or lead action could not be confirmed. This message will not be retried automatically; please check before submitting it again.");
  } finally { clearTimeout(timer); }
}
