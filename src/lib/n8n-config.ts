import "server-only";

export type N8nConfig = {
  url?: string;
  username?: string;
  password?: string;
};

export function getN8nConfig(): N8nConfig {
  return {
    url: process.env.N8N_CHAT_URL,
    username: process.env.N8N_BASIC_AUTH_USERNAME,
    password: process.env.N8N_BASIC_AUTH_PASSWORD,
  };
}

export function isN8nConfigured(config: N8nConfig): boolean {
  if (!config.url?.trim() || !config.username?.trim() || !config.password?.trim()) return false;
  // A colon cannot appear in a Basic Auth username. Preserve the exact password.
  if (/[:\x00-\x1f\x7f]/.test(config.username) || /[\x00-\x1f\x7f]/.test(config.password)) return false;
  try {
    const url = new URL(config.url);
    const localHttp = url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    return (url.protocol === "https:" || localHttp) && !url.username && !url.password;
  } catch { return false; }
}
