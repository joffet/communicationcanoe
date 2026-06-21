import { createServer } from "node:http";

const port = Number(process.env.VOICE_BRIDGE_PORT ?? 3001);

const server = createServer((req, res) => {
  if (req.url === "/health" && req.method === "GET") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok", service: "voice-bridge" }));
    return;
  }

  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "Not found" }));
});

server.listen(port, () => {
  console.log(`voice-bridge listening on http://localhost:${port}`);
});
