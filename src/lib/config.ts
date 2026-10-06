/** Runtime-only settings: one built image can be used on different servers. */
export function resolveAppOrigin(env: Record<string, string | undefined> = process.env): string {
  const configured = env.APP_ORIGIN?.trim();
  if (!configured) {
    if (env.NODE_ENV === "production") {
      throw new Error("Set APP_ORIGIN to the HTTP or HTTPS address used by scanning devices.");
    }
    return "http://localhost:3000";
  }
  let url: URL;
  try { url = new URL(configured); }
  catch { throw new Error("APP_ORIGIN must be a complete HTTP or HTTPS origin."); }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password ||
      url.pathname !== "/" || url.search || url.hash) {
    throw new Error("APP_ORIGIN must be an HTTP or HTTPS origin without credentials, a path, query, or fragment.");
  }
  return url.origin;
}

export const DEFAULT_AI_MODEL = "qwen3-vl:2b-instruct-q4_K_M";
export function resolveAIModel(env: Record<string, string | undefined> = process.env): string {
  return env.AI_MODEL?.trim() || DEFAULT_AI_MODEL;
}
