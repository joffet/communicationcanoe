// Health check for Railway's deploy healthcheck (healthcheckPath=/api/health)
// - mirrors realtime-bridge's GET /health shape for consistency.
export async function GET() {
  return Response.json({ status: "ok", service: "web" });
}
