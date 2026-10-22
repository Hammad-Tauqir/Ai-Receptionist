export const MAX_MESSAGE_LENGTH = 4000;
export const SESSION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export type ChatInput = { message: string; sessionId: string };

export function validateChatInput(value: unknown): ChatInput | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  if (typeof input.message !== "string" || typeof input.sessionId !== "string") return null;
  const message = input.message.trim();
  if (!message || message.length > MAX_MESSAGE_LENGTH || !SESSION_ID_PATTERN.test(input.sessionId)) return null;
  return { message, sessionId: input.sessionId };
}
