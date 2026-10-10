import type { ToolDefinition } from "@latch/protocol";
import { TOOL_SCHEMAS } from "./tool-schemas.ts";

const TOOL_DESCRIPTIONS: Record<string, string> = {
  navigate: "Open a URL in the current Latch session tab, or a new tab.",
  find_tab: "Select a tab this session opened, or borrow the user's active tab (active:true).",
  snapshot: "Accessibility tree of the current tab, with @e refs for click/fill.",
  click: "Dispatch a mouse click on an element with a usable layout box. Success confirms dispatch, not a business outcome. Use select_option for native SELECT options.",
  fill: "Click, then Input.insertText the whole string (DOM value fallback if verify fails).",
  select_option: "Select native SELECT options by value, exact label, or index. Sets DOM selection, emits untrusted input/change events only on change, and verifies selected values. Use click/press keys for custom widgets.",
  scroll: "Wheel the page (deltaX/deltaY, smoothstep steps) or scroll a selector into view.",
  drag: "Drag from one selector to another. Real mouse path with the button held.",
  type: "Type text with keyDown/keyUp per character. Optional selector focuses first; delayMs is optional.",
  evaluate: "Run JavaScript in the page (async/await allowed).",
  cdp: "Raw Chrome DevTools Protocol method on the current tab.",
  screenshot: "Capture the viewport or an element. Returns image bytes; the client decides where to save them.",
  list_tabs: "List tabs owned or borrowed by this session.",
  close_tab: "Close the current tab in this session.",
  close_session: "Close every tab this session opened.",
  wait: "Wait until text or a selector appears (or until timeoutMs).",
};


export const TOOL_DEFINITIONS: ToolDefinition[] = [
  ...Object.entries(TOOL_SCHEMAS).map(([name, schema]) => ({
    name, description: TOOL_DESCRIPTIONS[name],
    inputSchema: {
      type: "object", ...(schema.anyOf ? { anyOf: schema.anyOf } : {}),
      properties: { ...schema.properties, session: { type: "string", description: "Task session id." }, browser: { type: "string", description: "Browser id; unnecessary on a pinned MCP endpoint." } },
      required: ["session", ...(schema.required ?? [])], additionalProperties: false,
    },
  })),
  {
    name: "run", description: "Run JavaScript in the plugin sandbox. Use page.call(toolName,args), page.selectOption(selector,option), page.goto(url), cliLog(value), or task.page(). Browser actions execute in this plugin.",
    inputSchema: { type: "object", properties: { source: { type: "string" }, session: { type: "string" }, browser: { type: "string" }, timeoutMs: { type: "number", description: "Script deadline in milliseconds; default 60000, existing maximum 300000." } }, required: ["source", "session"], additionalProperties: false },
  },
  { name: "list_browsers", description: "List browser connections reported by the relay.", inputSchema: { type: "object", properties: { browser: { type: "string" } }, additionalProperties: false } },
];
