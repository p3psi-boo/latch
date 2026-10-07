export const PROTOCOL_VERSION = 1;
export const DEFAULT_PORT = 12580;
export const DEFAULT_HOST = "127.0.0.1";

export const TOOL_NAMES = [
  "navigate",
  "find_tab",
  "snapshot",
  "click",
  "fill",
  "scroll",
  "drag",
  "type",
  "evaluate",
  "cdp",
  "screenshot",
  "list_tabs",
  "close_tab",
  "close_session",
  "wait",
] as const;

export type ToolName = (typeof TOOL_NAMES)[number];

export function isToolName(value: string): value is ToolName {
  return (TOOL_NAMES as readonly string[]).includes(value);
}

/** Agent-facing request. Internal _ fields are injected by the daemon. */
export type CommandRequest = {
  action: ToolName;
  args?: Record<string, unknown>;
  session: string;
  /**
   * User-defined browser id from the extension options.
   * Required when more than one browser is connected.
   */
  browser?: string;
};

/** Agent-facing script run. Helpers call the same tools as CommandRequest. */
export type RunRequest = {
  source: string;
  session: string;
  browser?: string;
  timeoutMs?: number;
};

export type RunSuccess = {
  ok: true;
  logs: unknown[];
  result: unknown;
};

export type RunFailure = {
  ok: false;
  logs: unknown[];
  error: string;
  step?: string;
};

export type RunResponse = RunSuccess | RunFailure;

export type CommandSuccess = {
  ok: true;
  data: unknown;
};

export type CommandFailure = {
  ok: false;
  error: string;
};

export type CommandResponse = CommandSuccess | CommandFailure;

export type BrowserInfo = {
  id: string;
  remark?: string;
  connected: boolean;
  extensionVersion?: string;
};

export type StatusResponse = {
  ok: true;
  protocolVersion: number;
  daemonVersion: string;
  extensionConnected: boolean;
  extensionVersion?: string;
  port: number;
  browsers: BrowserInfo[];
};

export const BROWSER_ID_MAX = 64;
export const BROWSER_REMARK_MAX = 200;

export function mintBrowserId(): string {
  return crypto.randomUUID();
}

export function parseBrowserId(raw: unknown): { ok: true; id: string } | { ok: false; error: string } {
  if (typeof raw !== "string") {
    return {
      ok: false,
      error: raw === undefined || raw === null ? "browser id is required" : "browser id must be a string",
    };
  }
  const id = raw.trim();
  if (!id) return { ok: false, error: "browser id is required" };
  if (id.length > BROWSER_ID_MAX) {
    return { ok: false, error: `browser id longer than ${BROWSER_ID_MAX} characters` };
  }
  if (/[\u0000-\u001f]/.test(id)) {
    return { ok: false, error: "browser id contains control characters" };
  }
  return { ok: true, id };
}

export function normalizeRemark(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const remark = raw.trim();
  if (!remark) return undefined;
  return remark.length > BROWSER_REMARK_MAX ? remark.slice(0, BROWSER_REMARK_MAX) : remark;
}

export type HelloPayload = {
  extensionVersion: string;
  protocolVersion: number;
  /** User-defined. The extension mints a UUID v4 when the field is left blank. */
  browserId?: string;
  remark?: string;
};

export type HelloAckPayload = {
  daemonVersion: string;
  protocolVersion: number;
};

export type ToolCallPayload = {
  name: string;
  args: Record<string, unknown>;
};

export type ToolResultPayload =
  | { data: unknown; error?: undefined }
  | { data?: undefined; error: string };

export type WireMessage =
  | { type: "hello"; payload: HelloPayload }
  | { type: "hello_ack"; payload: HelloAckPayload }
  | { type: "ping" }
  | { type: "pong" }
  | { type: "tool_call"; requestId: string; payload: ToolCallPayload }
  | { type: "tool_result"; responseToRequestId: string; payload: ToolResultPayload };

export function parseWireMessage(raw: string): WireMessage {
  const value = JSON.parse(raw) as unknown;
  if (!value || typeof value !== "object" || !("type" in value)) {
    throw new Error("wire message missing type");
  }
  const type = (value as { type: unknown }).type;
  if (typeof type !== "string") throw new Error("wire message type must be a string");
  return value as WireMessage;
}

export function encodeWireMessage(message: WireMessage): string {
  return JSON.stringify(message);
}

/** Fields the daemon injects before forwarding to the extension. */
export type InternalToolArgs = {
  _tabId?: number;
  _session?: string;
  _tabIds?: number[];
  _ownedTabIds?: number[];
};

export const CLOSE_CODES = {
  badHello: 4400,
  replaced: 4410,
} as const;
