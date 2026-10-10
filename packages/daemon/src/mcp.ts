import { createInterface } from "node:readline";
import type { Readable, Writable } from "node:stream";
import type { ToolDefinition } from "@latch/protocol";
import type { Hub } from "./hub.ts";

type JsonRpc = { jsonrpc?: string; id?: number | string | null; method?: string; params?: Record<string, unknown> };
export function toolList(hub: Hub, browser?: string): readonly ToolDefinition[] {
  if (browser) return hub.resolve(browser).bridge.tools;
  const tools = new Map<string, ToolDefinition>();
  for (const slot of hub.connectedSlots()) for (const tool of slot.bridge.tools) {
    const previous = tools.get(tool.name);
    if (previous && JSON.stringify(previous) !== JSON.stringify(tool)) throw new Error(`Tool definitions differ for ${tool.name}; use /mcp/<browser-id>`);
    tools.set(tool.name, tool);
  }
  return [...tools.values()];
}
export async function handleMcpMessage(msg: JsonRpc, hub: Hub, fixedBrowserId?: string): Promise<{ result?: unknown; error?: { code: number; message: string } } | null> {
  const method = msg.method ?? "";
  if (method === "initialize") return { result: { protocolVersion: "2024-11-05", capabilities: { tools: { listChanged: true } }, serverInfo: { name: "latch", version: "0.1.0" } } };
  if (method.startsWith("notifications/")) return null;
  if (method === "tools/list") return { result: { tools: toolList(hub, fixedBrowserId) } };
  if (method === "ping") return { result: {} };
  if (method === "tools/call") {
    const params = msg.params ?? {};
    const name = String(params.name ?? "");
    const raw = params.arguments && typeof params.arguments === "object" && !Array.isArray(params.arguments) ? params.arguments as Record<string, unknown> : {};
    const browser = fixedBrowserId ?? (typeof raw.browser === "string" ? raw.browser : undefined);
    const slot = hub.resolve(browser);
    if (!slot.bridge.tools.some((tool) => tool.name === name)) return { error: { code: -32602, message: `Tool not advertised by browser ${slot.id}: ${name}` } };
    const { session, browser: _browser, ...args } = raw;
    try {
      const result = await slot.bridge.call(name, args, typeof session === "string" ? session : "", hub.list(), "mcp");
      return { result };
    } catch (error) { return { result: { content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }], isError: true } }; }
  }
  return { error: { code: -32601, message: `Method not found: ${method}` } };
}
export function startMcp(hub: Hub, fixedBrowserId?: string, io: { input: Readable; output: Writable } = { input: process.stdin, output: process.stdout }): void {
  let initialized = false;
  const rl = createInterface({ input: io.input });
  const unsubscribe = hub.subscribe(() => { if (initialized) io.output.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/tools/list_changed" }) + "\n"); });
  rl.on("close", unsubscribe);
  rl.on("line", (line) => { if (line.trim()) void handleLine(line); });
  async function handleLine(line: string) {
    let msg: JsonRpc;
    try { msg = JSON.parse(line); } catch { return; }
    if (msg.method === "notifications/initialized") initialized = true;
    if (msg.id == null) { await handleMcpMessage(msg, hub, fixedBrowserId).catch(() => null); return; }
    try {
      const response = await handleMcpMessage(msg, hub, fixedBrowserId);
      if (response) io.output.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, ...response }) + "\n");
    } catch (error) { io.output.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, error: { code: -32000, message: String(error) } }) + "\n"); }
  }
}
