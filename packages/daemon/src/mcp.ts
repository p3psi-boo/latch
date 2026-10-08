import { TOOL_NAMES } from "@latch/protocol";
import { dispatchCommand } from "./dispatch.ts";
import type { Hub } from "./hub.ts";
import { bindHubDispatch, executeRun, parseTimeoutMs } from "./run.ts";
import { createInterface } from "node:readline";

type JsonRpc = {
  jsonrpc?: string;
  id?: number | string | null;
  method?: string;
  params?: Record<string, unknown>;
};

const TOOL_DESCRIPTIONS: Record<(typeof TOOL_NAMES)[number], string> = {
  navigate: "Open a URL in the current Latch session tab, or a new tab.",
  find_tab: "Select a tab this session opened, or borrow the user's active tab (active:true).",
  snapshot: "Accessibility tree of the current tab, with @e refs for click/fill.",
  click: "Move the real mouse along a timed path, then click. Sites see mousemove.",
  fill: "Click, then Input.insertText the whole string (DOM value fallback if verify fails).",
  scroll: "Wheel the page (deltaX/deltaY, smoothstep steps) or scroll a selector into view.",
  drag: "Drag from one selector to another. Real mouse path with the button held.",
  type: "Type text with keyDown/keyUp per character. Optional selector focuses first; delayMs is optional.",
  evaluate: "Run JavaScript in the page (async/await allowed).",
  cdp: "Raw Chrome DevTools Protocol method on the current tab.",
  screenshot: "Capture the viewport or an element. Returns a file path.",
  list_tabs: "List tabs owned or borrowed by this session.",
  close_tab: "Close the current tab in this session.",
  close_session: "Close every tab this session opened.",
  wait: "Wait until text or a selector appears (or until timeoutMs).",
};

const BROWSER_PROP = {
  type: "string",
  description:
    'User-defined browser id from the extension options. Required when more than one Chrome is connected. Omit when only one is connected.',
};

function toolList(fixedBrowserId?: string) {
  const chromeTools = TOOL_NAMES.map((name) => ({
    name,
    description: TOOL_DESCRIPTIONS[name],
    inputSchema: {
      type: "object",
      properties: {
        session: {
          type: "string",
          description: "Task id. One task = one session = one tab group. Required.",
        },
        ...(fixedBrowserId
          ? {}
          : { browser: BROWSER_PROP }),
      },
      additionalProperties: true,
      required: ["session"],
    },
  }));
  return [
    {
      name: "run",
      description:
        "Default browser workflow. Run a JavaScript source string with injected page/cliLog/task helpers. Snapshot, click/fill with @e refs, wait, snapshot again. One session per script.",
      inputSchema: {
        type: "object",
        properties: {
          source: {
            type: "string",
            description:
              'JavaScript body. Top-level await ok. Helpers: page.snapshot(), page.click("@e1"), page.fill(sel, value), page.scroll({deltaY}), page.drag(from, to), page.type(text, {selector?}), page.wait({text|selector}), page.goto(url), cliLog(...), task.page("p1").',
          },
          session: {
            type: "string",
            description: "Task id. One task = one session = one tab group. Required.",
          },
          ...(fixedBrowserId
            ? {}
            : { browser: BROWSER_PROP }),
          timeoutMs: { type: "number", description: "Abort the script after this many ms. Default 60000." },
        },
        required: ["source", "session"],
      },
    },
    {
      name: "list_browsers",
      description: fixedBrowserId
        ? `Pinned to browser "${fixedBrowserId}". List Latch browsers connected to this daemon.`
        : "List Latch browsers connected to this daemon (id, remark, connected). Use the id as the browser argument on other tools.",
      inputSchema: { type: "object", properties: {} },
    },
    ...chromeTools,
  ];
}

function reply(id: number | string | null | undefined, result: unknown): void {
  if (id === undefined || id === null) return;
  const payload = JSON.stringify({ jsonrpc: "2.0", id, result });
  process.stdout.write(payload + "\n");
}

function replyError(id: number | string | null | undefined, message: string): void {
  if (id === undefined || id === null) return;
  const payload = JSON.stringify({
    jsonrpc: "2.0",
    id,
    error: { code: -32000, message },
  });
  process.stdout.write(payload + "\n");
}

export function startMcp(hub: Hub, fixedBrowserId?: string): void {
  const rl = createInterface({ input: process.stdin });
  rl.on("line", (line) => {
    if (!line.trim()) return;
    void handleLine(line, hub, fixedBrowserId);
  });
  console.error(
    fixedBrowserId
      ? `[latch] MCP stdio listening (pinned to browser "${fixedBrowserId}")`
      : "[latch] MCP stdio listening",
  );
}

async function handleLine(line: string, hub: Hub, fixedBrowserId?: string): Promise<void> {
  let msg: JsonRpc;
  try {
    msg = JSON.parse(line) as JsonRpc;
  } catch {
    return;
  }
  const method = msg.method ?? "";
  try {
    if (method === "initialize") {
      reply(msg.id, {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "latch", version: "0.1.0" },
      });
      return;
    }
    if (method === "notifications/initialized" || method === "notifications/cancelled") return;
    if (method === "tools/list") {
      reply(msg.id, { tools: toolList(fixedBrowserId) });
      return;
    }
    if (method === "ping") {
      reply(msg.id, {});
      return;
    }
    if (method === "tools/call") {
      const params = msg.params ?? {};
      const name = String(params.name ?? "");
      const rawArgs =
        params.arguments && typeof params.arguments === "object" && !Array.isArray(params.arguments)
          ? (params.arguments as Record<string, unknown>)
          : {};
      if (name === "list_browsers") {
        reply(msg.id, {
          content: [{ type: "text", text: JSON.stringify(hub.list()) }],
        });
        return;
      }
      if (name === "run") {
        const session = typeof rawArgs.session === "string" ? rawArgs.session : "";
        const source = typeof rawArgs.source === "string" ? rawArgs.source : "";
        const browser =
          fixedBrowserId ?? (typeof rawArgs.browser === "string" ? rawArgs.browser : undefined);
        if (!session.trim()) throw new Error("session is required");
        const outcome = await executeRun({
          source,
          timeoutMs: parseTimeoutMs(rawArgs.timeoutMs),
          dispatch: bindHubDispatch(hub, session, browser),
        });
        reply(msg.id, {
          content: [{ type: "text", text: JSON.stringify(outcome) }],
          ...(outcome.ok ? {} : { isError: true }),
        });
        return;
      }
      const session = typeof rawArgs.session === "string" ? rawArgs.session : "";
      const browser =
        fixedBrowserId ?? (typeof rawArgs.browser === "string" ? rawArgs.browser : undefined);
      const { session: _ignored, browser: _browser, ...args } = rawArgs;
      const slot = hub.resolve(browser);
      const data = await dispatchCommand(slot.bridge, slot.store, name, args, session);
      reply(msg.id, {
        content: [{ type: "text", text: JSON.stringify(data) }],
      });
      return;
    }
    if (msg.id !== undefined) replyError(msg.id, `unknown method: ${method}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    reply(msg.id, {
      content: [{ type: "text", text: message }],
      isError: true,
    });
  }
}
