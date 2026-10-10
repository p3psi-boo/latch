# Latch

[简体中文](README.zh-CN.md)

Latch lets AI agents control an existing Chromium browser profile through a local background service and a browser extension.

The browser extension executes commands via Chrome DevTools Protocol (`chrome.debugger`), and the Node.js background service routes requests from HTTP and MCP (Model Context Protocol) over a WebSocket connection.

```
Agent (AI / Script)
  MCP stdio | POST /run | POST /command
        │
        ▼
Latch Service (Node.js)  127.0.0.1:12580
        │  WebSocket
        ▼
Latch Extension (Chrome / Chromium)
        │  chrome.debugger (CDP)
        ▼
Browser Tabs
```

## Quick Start

### 1. Requirements

- Node.js 22 or later (or Docker)
- pnpm
- Google Chrome or any Chromium-based browser

### 2. Start the Background Service

**Option 1: Run instantly with npx (zero clone/install)**
```bash
# Start background HTTP service on 127.0.0.1:12580
npx github:p3psi-boo/latch start

# Or start with MCP stdio support (e.g. for AI agent clients)
npx github:p3psi-boo/latch mcp
```

**Option 2: Using Docker**
```bash
docker run -d --name latch-server -p 12580:12580 ghcr.io/p3psi-boo/latch:latest
# or with docker compose:
docker compose up -d
```

**Option 3: Run from source**
```bash
pnpm install
pnpm build
pnpm --filter @latch/daemon start # Listens on 127.0.0.1:12580
```

### 3. Install the Browser Extension

- **From GitHub Release / Artifact**: Download `latch-extension.zip` from Releases or CI artifacts, and unzip it.
- **Or build from source**:
  ```bash
  pnpm build:extension # builds to packages/extension/dist
  ```

In Chrome / Chromium:
1. Open `chrome://extensions` in your browser.
2. Enable **Developer mode** in the top right.
3. Click **Load unpacked** and select the unzipped directory (or `packages/extension/dist`).
4. The extension icon in the toolbar indicates connection to the background service.

---

## Usage

### Option A: Model Context Protocol (MCP)

Start the service with MCP stdio support:

```bash
pnpm --filter @latch/daemon mcp
```

#### Example Configuration

**Claude Code / Cursor / Other MCP Clients:**

```json
{
  "mcpServers": {
    "latch": {
      "command": "npx",
      "args": ["github:p3psi-boo/latch", "mcp"]
    }
  }
}
```

**Pin to a specific Browser ID:**
If you run multiple Chrome profiles and want this MCP server to only interact with a specific browser, add `--browser <id>`:

```json
{
  "mcpServers": {
    "latch": {
      "command": "npx",
      "args": ["github:p3psi-boo/latch", "mcp", "--browser", "work"]
    }
  }
}
```
*(When pinned, the AI will automatically use this browser profile without needing to pass the `browser` argument in every tool call).*

*(Or use local repository command: `"command": "pnpm", "args": ["--filter", "@latch/daemon", "mcp", "--", "--browser", "work"]`)*

**Grok (`.grok/config.toml`):**

```toml
[mcp_servers.latch]
command = "npx"
args = ["github:p3psi-boo/latch", "mcp", "--browser", "work"]
```

---

### Option B: HTTP API

The background service exposes the following endpoints on `http://127.0.0.1:12580`:

| Method | Endpoint | Request Body | Description |
|---|---|---|---|
| `POST` | `/run` | `{"session": "...", "source": "...", "browser"?: "..."}` | Forwards a script to the plugin sandbox |
| `POST` | `/command` | `{"session": "...", "action": "...", "args": {...}}` | Executes a single browser command directly |
| `POST` | `/mcp` | `{"jsonrpc": "2.0", "id": 1, ...}` | Remote MCP endpoint over HTTP POST (auto-resolves browser) |
| `POST` | `/mcp/{browser_id}` | `{"jsonrpc": "2.0", "id": 1, ...}` | Remote MCP endpoint pinned directly to `{browser_id}` |
| `GET` | `/status` | None | Returns connected browsers and active sessions |
| `GET` | `/ws` | None | WebSocket connection used by the browser extension |

> **Authentication & Remote MCP Tips:**
> - **Pin Browser via Path:** Connect directly to `http://127.0.0.1:12580/mcp/work` to lock interactions to the `work` browser.
> - **Token Protection:** Start the daemon with `--token <secret>` (or `LATCH_TOKEN=<secret>`). Then authenticate via query param `?token=<secret>` or header `Authorization: Bearer <secret>`.
> - Example URL: `http://127.0.0.1:12580/mcp/work?token=your_secret_here`

#### Example: Running an automation script (`POST /run`)

The script runs in an isolated plugin page with a separate Web Worker per invocation. The daemon only forwards requests; the plugin provides `page` and `cliLog`:

```bash
curl -s -X POST http://127.0.0.1:12580/run \
  -H 'Content-Type: application/json' \
  -d '{
    "session": "search-task",
    "source": "await page.goto(\"https://example.com\", { newTab: true, group_title: \"Latch Demo\" });\ncliLog(await page.snapshot());"
  }'
```

Available `page` helper methods:
- Navigation & Tabs: `goto`, `findTab`, `listTabs`, `closeTab`, `closeSession`
- Inspection: `snapshot` (accessibility tree), `screenshot`, `evaluate`
- Interactions: `click`, `fill`, `selectOption`, `type`, `scroll`, `drag`, `wait`
- Low-level: `cdp`

For native dropdowns, use `await page.selectOption('select[name="my-select"]', {label:"Two"})`. Each match specifies exactly one of `value`, exact `label`, or zero-based `index`. An array replaces a multiple select's selection; `[]` clears it. The extension rejects missing, ambiguous, or disabled options, sets DOM selection, dispatches untrusted `input`/`change` events when the selection changes, and verifies the selected options after synchronous handlers. The result includes `verified`, `mode:"dom"`, `changed`, `values`, and `labels`; asynchronous page updates and form submission require separate checks. Custom dropdown widgets retain their own click or keyboard sequence. The single MCP tool `select_option` uses the same implementation with `selector` and `option` parameters.

`click` rejects targets without a usable layout box. Its `success` and `dispatched` fields confirm mouse event dispatch, not the page's business outcome.

#### Example: Running a single command (`POST /command`)

Useful for quick testing and debugging:

```bash
curl -s -X POST http://127.0.0.1:12580/command \
  -H 'Content-Type: application/json' \
  -d '{
    "session": "search-task",
    "action": "navigate",
    "args": { "url": "https://example.com" }
  }'
```

Supported actions:
`navigate`, `find_tab`, `list_tabs`, `close_tab`, `close_session`, `snapshot`, `click`, `fill`, `select_option`, `type`, `scroll`, `drag`, `wait`, `screenshot`, `evaluate`, `cdp`.

---

## The plugin defines tools and the daemon relays requests.

`packages/extension/src/tool-definitions.ts` and `tool-schemas.ts` own MCP names, descriptions, and input schemas; `tools.ts` owns browser actions. The plugin publishes its definitions on connection. The daemon answers `tools/list` from those definitions and forwards calls to the selected plugin. Reconnects and definition updates generate `notifications/tools/list_changed`; HTTP clients can receive notifications through a GET SSE stream on the MCP endpoint and must refresh their tool list.

This migration uses wire protocol 2 and initially requires updating both packages. Run `pnpm build`, start the daemon with `node bin/latch.cjs start`, and load `packages/extension/dist` in Chrome with developer mode enabled. After replacing an unpacked plugin, click Reload on the extensions page. Set the plugin WebSocket URL to the daemon's `/ws` endpoint and connect MCP clients to `/mcp/<browser-id>`. Old-wire plugins are rejected. After this initial migration, browser tools can be added by upgrading only the plugin while the wire protocol remains compatible.

Scripts can invoke newly added tools with `await page.call("tool_name", {arguments})`; existing helpers such as `page.selectOption(...)` remain. The daemon no longer executes source or stores tab ownership. Plugin sessions use `chrome.storage.session`, surviving service worker restarts and daemon reconnects but not plugin reloads or browser shutdown. Chrome 116+ and the `offscreen` permission are required. Each script worker and its sandbox iframe are removed on completion or at the existing script deadline.

MCP screenshots return image content. HTTP commands and plugin scripts return `mimeType` and `base64` image bytes instead of host file paths; clients save the image. On an unpinned endpoint, same-name tools from different plugins must have identical definitions. Use `/mcp/<browser-id>` when definitions differ. An unpinned endpoint lists no tools without a connected plugin; a pinned endpoint reports a connection error.

## Working with Multiple Browsers

If you run multiple browser profiles simultaneously:

1. Right-click the Latch extension icon and open **Options**.
2. Configure the settings:
   - **Browser ID**: Unique identifier for this profile (optional, defaults to an auto-generated ID).
   - **Remark**: A readable description (e.g. `work` or `personal`) shown in `/status` and MCP.
   - **WebSocket URL**: Defaults to `ws://127.0.0.1:12580/ws`.
3. In your API requests, pass `"browser": "<browser-id>"` when targeting a specific browser profile. If only one browser is connected, this field can be omitted.

Check connected browsers anytime:

```bash
curl -s http://127.0.0.1:12580/status
```

---

## Important Notes & Security

- **Network Access**: By default, the service listens on `127.0.0.1:12580` without authentication. Any program that can access this port can control connected browsers.
- **Session Mapping**: Each `session` name corresponds to a Chrome tab group. Give sessions task-based names (such as `research-topic` or `order-ticket`).
- **Input Simulation**: Click and scroll actions dispatch standard pointer and keyboard events directly to the target page without rendering an artificial visual cursor.

---

## Self-Hosting & Remote Access

To host the service on a remote machine:

1. Start the service with host binding and optional token:
   ```bash
   # Single host (default: 127.0.0.1)
   latch start --host 127.0.0.1 --port 12580

   # Or bind multiple specific IPv4 / IPv6 addresses:
   latch start --host "127.0.0.1, ::1, 2409:xxxx:xxxx::1" --port 12580 --token <secret>
   ```
2. Put a reverse proxy with TLS (such as Caddy or Nginx) in front of it on port 443. Configuration templates are available in the `deploy/` directory.
3. In the extension settings, update the WebSocket URL to `wss://<your-domain>/ws`.

---

## Project Structure

| Directory | Description |
|---|---|
| `packages/protocol` | Shared message definitions, action names, and TypeScript interfaces |
| `packages/daemon` | Background service implementation (HTTP API, WebSocket server, MCP server) |
| `packages/extension` | Manifest V3 Chrome extension executing browser actions |
| `deploy/` | Production deployment configurations (systemd service, Caddyfile) |
| `skill/` | Prompting guidelines and tool usage reference for AI agents |

---

## Development

```bash
# Run unit tests
pnpm test

# Rebuild extension
pnpm --filter @latch/extension build
```

---

## License

[WTFPL](http://www.wtfpl.net/about/). See [LICENSE](LICENSE).
