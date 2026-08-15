export function loadConfig() {
  // Railway (and most PaaS hosts) inject PORT and expect the process to bind
  // to it - checked first so a hosted deploy works without needing a manual
  // REALTIME_BRIDGE_PORT=${{PORT}} variable reference. Local dev has no PORT
  // set, so REALTIME_BRIDGE_PORT/VOICE_BRIDGE_PORT (or the 3001 default)
  // still apply unchanged.
  const port = Number(
    process.env.PORT ?? process.env.REALTIME_BRIDGE_PORT ?? process.env.VOICE_BRIDGE_PORT ?? 3001,
  );
  const apiKey = process.env.OPENAI_API_KEY ?? "";
  const handoffTimeoutMs = Number(process.env.CHAT_HANDOFF_TIMEOUT_MS ?? 90_000);
  const sessionTtlMs = Number(process.env.CHAT_SESSION_TTL_MS ?? 604_800_000);
  const internalSecret = process.env.INTERNAL_API_SECRET ?? "";
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const widgetPath =
    process.env.CHAT_WIDGET_STATIC_PATH ??
    new URL("../../public/widget.js", import.meta.url).pathname;

  return {
    port,
    apiKey,
    handoffTimeoutMs,
    sessionTtlMs,
    internalSecret,
    appUrl,
    widgetPath,
    twilioAccountSid: process.env.TWILIO_ACCOUNT_SID ?? "",
    twilioAuthToken: process.env.TWILIO_AUTH_TOKEN ?? "",
  };
}

export type BridgeConfig = ReturnType<typeof loadConfig>;
