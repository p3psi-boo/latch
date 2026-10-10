import assert from "node:assert/strict";
import test from "node:test";
import { once } from "node:events";
import { PassThrough } from "node:stream";
import { WebSocket } from "ws";
import { PROTOCOL_VERSION, type ToolDefinition } from "@latch/protocol";
import { startHttp } from "./http.ts";
import { Hub } from "./hub.ts";
import { ExtensionBridge } from "./bridge.ts";
import { handleMcpMessage, startMcp } from "./mcp.ts";

const definition = (name: string): ToolDefinition => ({ name, description: `Plugin defines ${name}`, inputSchema: { type: "object", properties: { payload: { type: "string" } }, required: ["payload"] } });

test("MCP has no browser definitions before a plugin connects", async () => {
  const response = await handleMcpMessage({ method: "tools/list" }, new Hub());
  assert.deepEqual(response?.result, { tools: [] });
});

test("real HTTP/WS relay accepts plugin definitions and updates without daemon restart", async () => {
  const hub = new Hub();
  const server = startHttp({ hub, host: "127.0.0.1", port: 0 });
  const port = await server.ready;
  const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  const received: unknown[] = [];
  try {
    const ack = new Promise<void>((resolve) => {
      socket.on("message", (raw) => {
        const message = JSON.parse(String(raw));
        if (message.type === "hello_ack") resolve();
        if (message.type === "tool_call") {
          received.push(message.payload);
          socket.send(JSON.stringify({ type: "tool_result", responseToRequestId: message.requestId, payload: { data: message.payload.format === "mcp" ? { content: [{ type: "text", text: JSON.stringify({ name: message.payload.name, echo: message.payload.args }) }], structuredContent: { pluginOwned: true } } : { name: message.payload.name, echo: message.payload.args } } }));
        }
      });
    });
    await once(socket, "open");
    socket.send(JSON.stringify({ type: "hello", payload: { browserId: "fixture", extensionVersion: "1", protocolVersion: PROTOCOL_VERSION, tools: [definition("plugin_first")] } }));
    await ack;
    const request = async (method: string, params?: unknown) => {
      const response = await fetch(`http://127.0.0.1:${port}/mcp/fixture`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
      assert.equal(response.status, 200);
      return await response.json() as any;
    };
    assert.deepEqual((await request("tools/list")).result.tools, [definition("plugin_first")]);
    const streamAbort = new AbortController();
    const stream = await fetch(`http://127.0.0.1:${port}/mcp/fixture`, { signal: streamAbort.signal });
    assert.match(stream.headers.get("content-type")!, /text\/event-stream/);
    const reader = stream.body!.getReader();
    const notification = reader.read();
    const changed = new Promise<void>((resolve) => { const unsubscribe = hub.subscribe(() => { unsubscribe(); resolve(); }); });
    socket.send(JSON.stringify({ type: "tools_changed", payload: { tools: [definition("plugin_first"), definition("plugin_added")] } }));
    await changed;
    const chunk = await notification;
    assert.match(new TextDecoder().decode(chunk.value), /notifications\/tools\/list_changed/);
    await reader.cancel();
    streamAbort.abort();
    assert.deepEqual((await request("tools/list")).result.tools, [definition("plugin_first"), definition("plugin_added")]);
    const called = await request("tools/call", { name: "plugin_added", arguments: { session: "task", payload: "unchanged" } });
    assert.deepEqual(called.result.structuredContent, { pluginOwned: true });
    assert.deepEqual(JSON.parse(called.result.content[0].text), { name: "plugin_added", echo: { payload: "unchanged" } });
    assert.deepEqual(received, [{ name: "plugin_added", args: { payload: "unchanged" }, session: "task", format: "mcp", browsers: [{ id: "fixture", connected: true, extensionVersion: "1" }] }]);
    assert.equal((await request("tools/call", { name: "not_advertised", arguments: {} })).error.code, -32602);
    assert.equal(received.length, 1);
    // HTTP compatibility endpoint forwards run to the plugin; it never evaluates source.
    const run = await fetch(`http://127.0.0.1:${port}/run`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ browser: "fixture", session: "task", source: "throw new Error('daemon must not execute')" }) });
    assert.equal((await run.json() as any).name, "run");
    assert.equal(received.length, 2);
  } finally { socket.terminate(); await server.close(); }
});

test("conflicting definitions require a browser-specific endpoint", async () => {
  class Bridge extends ExtensionBridge {
    constructor(private readonly catalog: ToolDefinition[]) { super(); }
    override get connected() { return true; }
    override get tools() { return this.catalog; }
  }
  const hub = new Hub();
  hub.claim("a", undefined, new Bridge([definition("same")]));
  hub.claim("b", undefined, new Bridge([{ ...definition("same"), description: "different plugin" }]));
  await assert.rejects(handleMcpMessage({ method: "tools/list" }, hub), /definitions differ/);
  assert.deepEqual((await handleMcpMessage({ method: "tools/list" }, hub, "a"))?.result, { tools: [definition("same")] });
});


test("stdio tool-list notifications begin after client initialization", async () => {
  let notify: (() => void) | undefined;
  class ObservableHub extends Hub {
    override subscribe(callback: () => void) { notify = callback; return () => { notify = undefined; }; }
  }
  const input = new PassThrough();
  const output = new PassThrough();
  const messages: string[] = [];
  output.on("data", (chunk) => messages.push(String(chunk)));
  startMcp(new ObservableHub(), undefined, { input, output });
  notify!();
  assert.deepEqual(messages, []);
  input.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
  notify!();
  assert.deepEqual(JSON.parse(messages[0]!), { jsonrpc: "2.0", method: "notifications/tools/list_changed" });
  input.end();
  output.end();
});
