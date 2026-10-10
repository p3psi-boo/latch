
const selector = { type: "string", description: "Element @e ref from snapshot, or CSS selector." };
const option = {
  oneOf: [
    { type: "object", properties: { value: { type: "string" } }, required: ["value"], additionalProperties: false },
    { type: "object", properties: { label: { type: "string" } }, required: ["label"], additionalProperties: false },
    { type: "object", properties: { index: { type: "integer", minimum: 0 } }, required: ["index"], additionalProperties: false },
  ],
};

type ToolSchema = {
  properties: Record<string, unknown>;
  required?: string[];
  anyOf?: Array<{ required: string[] }>;
};

export const TOOL_SCHEMAS: Record<string, ToolSchema> = {
  navigate: {
    properties: { url: { type: "string" }, newTab: { type: "boolean" }, group_title: { type: "string" } },
    required: ["url"],
  },
  find_tab: { properties: { url: { type: "string" }, active: { type: "boolean" } }, required: ["url"] },
  snapshot: { properties: {} },
  click: { properties: { selector }, required: ["selector"] },
  fill: { properties: { selector, value: { type: "string" } }, required: ["selector", "value"] },
  select_option: {
    properties: {
      selector,
      option: {
        description: "Match by exactly one of value, exact label, or zero-based index. An array replaces the selection of a multiple SELECT; [] clears it.",
        oneOf: [option, { type: "array", items: option }],
      },
    },
    required: ["selector", "option"],
  },
  scroll: {
    properties: { selector, deltaX: { type: "number" }, deltaY: { type: "number" } },
    anyOf: [{ required: ["selector"] }, { required: ["deltaX"] }, { required: ["deltaY"] }],
  },
  drag: { properties: { from: selector, to: selector }, required: ["from", "to"] },
  type: { properties: { text: { type: "string" }, selector, delayMs: { type: "number" } }, required: ["text"] },
  evaluate: { properties: { code: { type: "string" } }, required: ["code"] },
  cdp: { properties: { method: { type: "string" }, params: { type: "object" } }, required: ["method"] },
  screenshot: {
    properties: { format: { type: "string", enum: ["png", "jpeg"] }, quality: { type: "number" }, selector },
  },
  list_tabs: { properties: {} },
  close_tab: { properties: {} },
  close_session: { properties: {} },
  wait: {
    properties: { text: { type: "string" }, selector, timeoutMs: { type: "number" } },
    anyOf: [{ required: ["text"] }, { required: ["selector"] }],
  },
};
