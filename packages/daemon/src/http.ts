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
}): { port: number; ready: Promise<number>; close: () => Promise<void> } {
  const host = options.host ?? DEFAULT_HOST;
  const requested = options.port ?? DEFAULT_PORT;
  const hub = options.hub;
  const server = createServer((req, res) => {
    void handle(req, res, hub, boundPort);
  });
  const wss = new WebSocketServer({ noServer: true });
  server.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url ?? "/", `http://${host}`);
    if (url.pathname !== "/ws") {
      socket.destroy();
      return;
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
): Promise<void> {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
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
      try {
        const slot = hub.resolve(command.browser);
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
      const outcome = await executeRun({
        source: request.source,
        timeoutMs: request.timeoutMs,
        dispatch: bindHubDispatch(hub, request.session, request.browser),
      });
      sendJson(res, 200, outcome);
      return;
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
