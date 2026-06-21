import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { WebSocketServer } from "ws";
import { loadConfig } from "./config.js";
import { handleChatConnection, handleAgentMessage, handleHandoffJoin } from "./routes/chat-widget.js";
import { handleTwilioStreamConnection } from "./routes/twilio-stream.js";

const config = loadConfig();

const server = createServer((req, res) => {
  const url = req.url ?? "/";

  if (url === "/health" && req.method === "GET") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok", service: "realtime-bridge" }));
    return;
  }

  if (url === "/widget.js" && req.method === "GET") {
    const paths = [
      config.widgetPath,
      new URL("../public/widget.js", import.meta.url).pathname,
    ];
    const file = paths.find((p) => existsSync(p));
    if (file) {
      res.writeHead(200, { "Content-Type": "application/javascript" });
      res.end(readFileSync(file));
      return;
    }
    res.writeHead(404);
    res.end("Widget not built");
    return;
  }

  if (url === "/internal/handoff-join" && req.method === "POST") {
    void handleInternal(req, res, config.internalSecret, (body) => {
      const ok = handleHandoffJoin(body as Parameters<typeof handleHandoffJoin>[0]);
      return { ok };
    });
    return;
  }

  if (url === "/internal/agent-message" && req.method === "POST") {
    void handleInternal(req, res, config.internalSecret, (body) => {
      const ok = handleAgentMessage(body as Parameters<typeof handleAgentMessage>[0]);
      return { ok };
    });
    return;
  }

  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "Not found" }));
});

const wss = new WebSocketServer({ noServer: true });

wss.on("connection", (ws, request) => {
  const path = request.url ?? "";

  if (path === "/chat" || path.startsWith("/chat?")) {
    handleChatConnection(ws, config);
    return;
  }

  if (path === "/stream" || path.startsWith("/stream?")) {
    handleTwilioStreamConnection(ws, config);
    return;
  }

  ws.close();
});

server.on("upgrade", (request, socket, head) => {
  const path = request.url ?? "";

  if (
    path === "/chat" ||
    path.startsWith("/chat?") ||
    path === "/stream" ||
    path.startsWith("/stream?")
  ) {
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit("connection", ws, request);
    });
    return;
  }

  socket.destroy();
});

server.listen(config.port, () => {
  console.log(`realtime-bridge listening on http://localhost:${config.port}`);
});

async function handleInternal(
  req: import("node:http").IncomingMessage,
  res: import("node:http").ServerResponse,
  secret: string,
  handler: (body: unknown) => { ok: boolean },
) {
  if (secret && req.headers["x-internal-secret"] !== secret) {
    res.writeHead(401);
    res.end("Unauthorized");
    return;
  }

  const body = await readJson(req);
  const result = handler(body);
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify(result));
}

function readJson(req: import("node:http").IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });
}
