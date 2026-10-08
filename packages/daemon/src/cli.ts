#!/usr/bin/env node
import { DEFAULT_HOST, DEFAULT_PORT } from "@latch/protocol";
import { startHttp } from "./http.ts";
import { Hub } from "./hub.ts";
import { startMcp } from "./mcp.ts";

function usage(): never {
  console.error(`latch — browser-hands daemon

Usage:
  latch start  [--port 12580] [--host 127.0.0.1] [--token <secret>]
  latch mcp    [--port 12580] [--host 127.0.0.1] [--token <secret>] [--browser <id>]

Options:
  --port <number>     Port to listen on (default: 12580, or LATCH_PORT)
  --host <ip>         Host to bind on (default: 127.0.0.1, or LATCH_HOST)
  --token <secret>    Require Bearer token or ?token= query parameter (or LATCH_TOKEN)
  --browser <id>      (MCP only) Pin this MCP server session to a specific browser id

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

function tokenFromArgs(argv: string[]): string | undefined {
  return flag(argv, "--token") ?? process.env.LATCH_TOKEN;
}

function browserFromArgs(argv: string[]): string | undefined {
  return flag(argv, "--browser") ?? process.env.LATCH_BROWSER;
}

const argv = process.argv.slice(2);
const command = argv[0] ?? "start";
if (command === "-h" || command === "--help") usage();
if (command !== "start" && command !== "mcp") usage();

const host = hostFromArgs(argv);
const token = tokenFromArgs(argv);
if (host !== "127.0.0.1" && host !== "localhost" && !token) {
  console.error(
    `[latch] warning: binding ${host} with no auth. Pass --token <secret> or put this behind Caddy/nginx on loopback.`,
  );
}

const hub = new Hub();
startHttp({ hub, host, port: portFromArgs(argv), token });
if (command === "mcp") {
  const fixedBrowserId = browserFromArgs(argv);
  startMcp(hub, fixedBrowserId);
}
