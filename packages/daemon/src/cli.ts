#!/usr/bin/env node
import { DEFAULT_HOST, DEFAULT_PORT } from "@latch/protocol";
import { startHttp } from "./http.ts";
import { Hub } from "./hub.ts";
import { startMcp } from "./mcp.ts";

function usage(): never {
  console.error(`latch — browser-hands daemon

Usage:
  latch start  [--port 12580] [--host 127.0.0.1]
  latch mcp    [--port 12580] [--host 127.0.0.1]   also MCP on stdio

Agents POST /run (or MCP tool run) with a JavaScript source string. Helpers
call the same tools as POST /command. Each extension sets a browser id in
Options. Pass "browser" when more than one is connected.

Default bind is loopback. On a VPS, keep --host 127.0.0.1 and put Caddy in front.
Whoever can reach this HTTP can drive the connected browsers.

The Chrome extension is the only executor. This process only forwards.
`);
  process.exit(2);
}

function flag(argv: string[], name: string): string | undefined {
  const index = argv.indexOf(name);
  if (index >= 0 && argv[index + 1]) return argv[index + 1];
  return undefined;
}

function portFromArgs(argv: string[]): number {
  const value = flag(argv, "--port") ?? process.env.LATCH_PORT;
  return value ? Number(value) : DEFAULT_PORT;
}

function hostFromArgs(argv: string[]): string {
  return flag(argv, "--host") ?? process.env.LATCH_HOST ?? DEFAULT_HOST;
}

const argv = process.argv.slice(2);
const command = argv[0] ?? "start";
if (command === "-h" || command === "--help") usage();
if (command !== "start" && command !== "mcp") usage();

const host = hostFromArgs(argv);
if (host !== "127.0.0.1" && host !== "localhost") {
  console.error(
    `[latch] warning: binding ${host} with no auth. Put this behind Caddy/nginx on loopback, or pass --host 127.0.0.1.`,
  );
}

const hub = new Hub();
startHttp({ hub, host, port: portFromArgs(argv) });
if (command === "mcp") startMcp(hub);
