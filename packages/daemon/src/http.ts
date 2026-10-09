import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import {
  DEFAULT_HOST,
  DEFAULT_PORT,
  PROTOCOL_VERSION,
  type CommandRequest,
} from "@latch/protocol";
import { WebSocketServer } from "ws";
import { dispatchCommand } from "./dispatch.ts";
import type { Hub } from "./hub.ts";
import { handleMcpMessage } from "./mcp.ts";
import { bindHubDispatch, executeRun, parseTimeoutMs } from "./run.ts";

const MAX_BODY = 12 * 1024 * 1024;
const DAEMON_VERSION = "0.1.0";

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buf.length;
    if (size > MAX_BODY) throw new Error("request body too large");
    chunks.push(buf);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

function parseCommand(raw: string): CommandRequest {
  const value = JSON.parse(raw) as Partial<CommandRequest>;
  if (!value || typeof value !== "object") throw new Error("body must be a JSON object");
  if (typeof value.action !== "string") throw new Error("action is required");
  if (typeof value.session !== "string" || !value.session.trim()) {
    throw new Error("session is required");
  }
  const args =
    value.args && typeof value.args === "object" && !Array.isArray(value.args)
      ? (value.args as Record<string, unknown>)
      : {};
  const browser = typeof value.browser === "string" ? value.browser : undefined;
  return {
    action: value.action as CommandRequest["action"],
    args,
    session: value.session,
    browser,
  };
}

export function startHttp(options: {
  hub: Hub;
  host?: string;
  port?: number;
  token?: string;
}): { port: number; ready: Promise<number>; close: () => Promise<void> } {
  const host = options.host ?? DEFAULT_HOST;
  const requested = options.port ?? DEFAULT_PORT;
  const hub = options.hub;
  const token = options.token;
  const server = createServer((req, res) => {
    void handle(req, res, hub, boundPort, token);
  });
  const wss = new WebSocketServer({ noServer: true });
  server.on("upgrade", (req, socket, head) => {
    const formattedHost = host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
    const url = new URL(req.url ?? "/", `http://${formattedHost}`);
    if (url.pathname !== "/ws") {
      socket.destroy();
      return;
    }
    if (token) {
      const clientToken =
        url.searchParams.get("token") ??
        (req.headers.authorization?.startsWith("Bearer ")
          ? req.headers.authorization.slice(7).trim()
          : undefined);
      if (clientToken !== token) {
        socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
        socket.destroy();
        return;
      }
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      hub.accept(ws);
    });
  });
  let boundPort = requested;
  const ready = new Promise<number>((resolve, reject) => {
    server.once("error", reject);
    server.listen(requested, host, () => {
      const address = server.address();
      boundPort = typeof address === "object" && address ? address.port : requested;
      console.error(`[latch] listening http://${host}:${boundPort}`);
      resolve(boundPort);
    });
  });
  return {
    get port() {
      return boundPort;
    },
    ready,
    close: () =>
      new Promise((resolve, reject) => {
        wss.close();
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

async function handle(
  req: IncomingMessage,
  res: ServerResponse,
  hub: Hub,
  port: number,
  token?: string,
): Promise<void> {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");

  // Authentication check if token is configured
  if (token && req.method !== "OPTIONS") {
    const clientToken =
      url.searchParams.get("token") ??
      (req.headers.authorization?.startsWith("Bearer ")
        ? req.headers.authorization.slice(7).trim()
        : undefined);
    if (clientToken !== token) {
      sendJson(res, 401, { ok: false, error: "unauthorized: invalid or missing token" });
      return;
    }
  }

  try {
    if (req.method === "GET" && url.pathname === "/status") {
      const browsers = hub.list();
      sendJson(res, 200, {
        ok: true,
        protocolVersion: PROTOCOL_VERSION,
        daemonVersion: DAEMON_VERSION,
        port,
        browsers,
        extensionConnected: browsers.some((item) => item.connected),
        extensionVersion: uniqueVersion(browsers),
      });
      return;
    }
    if (req.method === "POST" && url.pathname === "/command") {
      const body = await readBody(req);
      const command = parseCommand(body);
      const targetBrowser = command.browser ?? (url.searchParams.get("browser") || undefined);
      try {
        const slot = hub.resolve(targetBrowser);
        const data = await dispatchCommand(
          slot.bridge,
          slot.store,
          command.action,
          command.args ?? {},
          command.session,
        );
        sendJson(res, 200, { ok: true, data });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        sendJson(res, 200, { ok: false, error: message });
      }
      return;
    }
    if (req.method === "POST" && url.pathname === "/run") {
      const body = await readBody(req);
      const request = parseRun(body);
      const targetBrowser = request.browser ?? (url.searchParams.get("browser") || undefined);
      const outcome = await executeRun({
        source: request.source,
        timeoutMs: request.timeoutMs,
        dispatch: bindHubDispatch(hub, request.session, targetBrowser),
      });
      sendJson(res, 200, outcome);
      return;
    }

    // Match /mcp or /mcp/:browser_id
    const mcpMatch = url.pathname.match(/^\/mcp(?:\/([^/]+))?$/);
    if (mcpMatch) {
      if (req.method === "OPTIONS") {
        res.writeHead(204, {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, Authorization",
        });
        res.end();
        return;
      }
      if (req.method === "POST") {
        const body = await readBody(req);
        let msg: Record<string, unknown>;
        try {
          msg = JSON.parse(body) as Record<string, unknown>;
        } catch {
          sendJson(res, 400, {
            jsonrpc: "2.0",
            id: null,
            error: { code: -32700, message: "Parse error" },
          });
          return;
        }
        const browserIdFromPath = mcpMatch[1] ? decodeURIComponent(mcpMatch[1]) : undefined;
        const targetBrowser = browserIdFromPath ?? (url.searchParams.get("browser") || undefined);
        try {
          const outcome = await handleMcpMessage(msg, hub, targetBrowser);
          if (!outcome) {
            // Notification: 202 Accepted
            res.writeHead(202, {
              "Access-Control-Allow-Origin": "*",
            });
            res.end();
            return;
          }
          res.writeHead(200, {
            "Content-Type": "application/json; charset=utf-8",
            "Access-Control-Allow-Origin": "*",
          });
          res.end(
            JSON.stringify({
              jsonrpc: "2.0",
              id: msg.id ?? null,
              ...(outcome.error ? { error: outcome.error } : { result: outcome.result }),
            }),
          );
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          res.writeHead(200, {
            "Content-Type": "application/json; charset=utf-8",
            "Access-Control-Allow-Origin": "*",
          });
          res.end(
            JSON.stringify({
              jsonrpc: "2.0",
              id: msg.id ?? null,
              error: { code: -32000, message },
            }),
          );
        }
        return;
      }
    }
    sendJson(res, 404, { ok: false, error: "not found" });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    sendJson(res, 400, { ok: false, error: message });
  }
}

function parseRun(raw: string): { source: string; session: string; browser?: string; timeoutMs: number } {
  const value = JSON.parse(raw) as Record<string, unknown>;
  if (!value || typeof value !== "object") throw new Error("body must be a JSON object");
  if (typeof value.source !== "string" || !value.source.trim()) throw new Error("source is required");
  if (typeof value.session !== "string" || !value.session.trim()) throw new Error("session is required");
  const browser = typeof value.browser === "string" ? value.browser : undefined;
  return {
    source: value.source,
    session: value.session,
    browser,
    timeoutMs: parseTimeoutMs(value.timeoutMs),
  };
}

function uniqueVersion(browsers: { connected: boolean; extensionVersion?: string }[]): string | undefined {
  const versions = browsers
    .filter((item) => item.connected && item.extensionVersion)
    .map((item) => item.extensionVersion!);
  return versions.length === 1 ? versions[0] : undefined;
}
