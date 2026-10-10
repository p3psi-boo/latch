import {
  DEFAULT_PORT,
  PROTOCOL_VERSION,
  encodeWireMessage,
  mintBrowserId,
  normalizeRemark,
  parseBrowserId,
  parseWireMessage,
  type WireMessage,
} from "@latch/protocol";
import { executeCommand } from "./executor.ts";
import { TOOL_DEFINITIONS } from "./tool-definitions.ts";
import { toolSuccess, toolFailure } from "./mcp-result.ts";

const URL_KEY = "latch_ws_url";
const ID_KEY = "latch_browser_id";
const REMARK_KEY = "latch_browser_remark";
const ALARM = "latch-reconnect";
const CONNECT_TIMEOUT_MS = 10_000;
const IDLE_MS = 45_000;

export type BrowserIdentity = {
  browserId: string;
  remark?: string;
};

function defaultUrl(): string {
  return `ws://127.0.0.1:${DEFAULT_PORT}/ws`;
}

export async function getServerUrl(): Promise<string> {
  const stored = await chrome.storage.local.get(URL_KEY);
  const value = stored[URL_KEY];
  return typeof value === "string" && value.trim() ? value.trim() : defaultUrl();
}

export async function setServerUrl(url: string): Promise<void> {
  await chrome.storage.local.set({ [URL_KEY]: url });
}

export async function getIdentity(): Promise<BrowserIdentity> {
  const stored = await chrome.storage.local.get([ID_KEY, REMARK_KEY]);
  const parsed = parseBrowserId(stored[ID_KEY]);
  if (parsed.ok) {
    return { browserId: parsed.id, remark: normalizeRemark(stored[REMARK_KEY]) };
  }
  return persistIdentity(mintBrowserId(), stored[REMARK_KEY]);
}

export async function setIdentity(browserId: string, remark: string): Promise<BrowserIdentity> {
  const parsed = parseBrowserId(browserId);
  return persistIdentity(parsed.ok ? parsed.id : mintBrowserId(), remark);
}

async function persistIdentity(browserId: string, remark: unknown): Promise<BrowserIdentity> {
  const note = normalizeRemark(remark);
  await chrome.storage.local.set({
    [ID_KEY]: browserId,
    [REMARK_KEY]: note ?? "",
  });
  return { browserId, remark: note };
}

export class DaemonSocket {
  private socket: WebSocket | null = null;
  private url = defaultUrl();
  private identity: BrowserIdentity = { browserId: "" };
  private lastActivity = 0;
  private connectingTimer: ReturnType<typeof setTimeout> | null = null;
  state: "disconnected" | "connecting" | "connected" = "disconnected";

  async start(): Promise<void> {
    await chrome.alarms.create(ALARM, { periodInMinutes: 0.5 });
    await this.reconnect();
  }

  isAlarm(name: string): boolean {
    return name === ALARM;
  }

  async reconnect(force = false): Promise<void> {
    this.url = await getServerUrl();
    this.identity = await getIdentity();
    if (!force && this.state === "connected" && Date.now() - this.lastActivity <= IDLE_MS) {
      this.send({ type: "ping" });
      return;
    }
    this.teardown();
    this.open(this.url);
  }

  getServerUrl(): string {
    return this.url;
  }

  isConnected(): boolean {
    return this.state === "connected";
  }

  private open(url: string): void {
    this.setState("connecting");
    let socket: WebSocket;
    try {
      socket = new WebSocket(withClient(url));
    } catch (error) {
      console.warn("[latch] bad ws url", error);
      this.setState("disconnected");
      return;
    }
    this.socket = socket;
    this.connectingTimer = setTimeout(() => {
      if (this.socket === socket && this.state === "connecting") socket.close();
    }, CONNECT_TIMEOUT_MS);
    socket.addEventListener("open", () => {
      if (this.socket !== socket) {
        socket.close();
        return;
      }
      this.clearConnecting();
      this.mark();
      this.setState("connected");
      this.send({
        type: "hello",
        payload: {
          tools: TOOL_DEFINITIONS,
          extensionVersion: chrome.runtime.getManifest().version,
          protocolVersion: PROTOCOL_VERSION,
          browserId: this.identity.browserId,
          remark: this.identity.remark,
        },
      });
    });
    socket.addEventListener("message", (event) => {
      if (this.socket !== socket) return;
      this.mark();
      try {
        void this.handle(parseWireMessage(String(event.data)));
      } catch (error) {
        console.error("[latch] invalid message", error);
      }
    });
    socket.addEventListener("close", () => {
      if (this.socket === socket) {
        this.socket = null;
        this.clearConnecting();
        this.setState("disconnected");
      }
    });
    socket.addEventListener("error", () => {
      /* close handler will run */
    });
  }

  private async handle(message: WireMessage): Promise<void> {
    switch (message.type) {
      case "ping":
        this.send({ type: "pong" });
        return;
      case "pong":
      case "hello_ack":
        return;
      case "tool_call": {
        const { name, args, session, browsers, format } = message.payload;
        try {
          const data = name === "list_browsers" ? browsers ?? [] : await executeCommand(name, args ?? {}, session);
          this.send({
            type: "tool_result",
            responseToRequestId: message.requestId,
            payload: { data: format === "mcp" ? toolSuccess(name, data) : data },
          });
        } catch (error) {
          this.send({
            type: "tool_result",
            responseToRequestId: message.requestId,
            payload: format === "mcp" ? { data: toolFailure(error) } : { error: error instanceof Error ? error.message : String(error) },
          });
        }
        return;
      }
      default:
        return;
    }
  }

  private send(message: WireMessage): void {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(encodeWireMessage(message));
    }
  }

  private teardown(): void {
    this.clearConnecting();
    if (this.socket) {
      const socket = this.socket;
      this.socket = null;
      try {
        socket.close();
      } catch {
        /* ignore */
      }
    }
    this.setState("disconnected");
  }

  private setState(state: DaemonSocket["state"]): void {
    if (this.state === state) return;
    this.state = state;
    void chrome.action.setBadgeText({ text: state === "connected" ? "" : "•" });
    void chrome.action.setBadgeBackgroundColor({
      color: state === "connected" ? "#3c6" : "#c33",
    });
    void chrome.runtime.sendMessage({ type: "LATCH_STATUS", state, url: this.url }).catch(() => undefined);
  }

  private mark(): void {
    this.lastActivity = Date.now();
  }

  private clearConnecting(): void {
    if (this.connectingTimer) {
      clearTimeout(this.connectingTimer);
      this.connectingTimer = null;
    }
  }
}

function withClient(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.searchParams.set("client", chrome.runtime.id);
    return parsed.toString();
  } catch {
    return url;
  }
}
