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

- Node.js 22 or later
- pnpm
- Google Chrome or any Chromium-based browser

### 2. Install and Build

```bash
pnpm install

# Start the background service (default: 127.0.0.1:12580)
pnpm --filter @latch/daemon start

# Build the browser extension (output: packages/extension/dist)
pnpm --filter @latch/extension build
```

### 3. Load the Browser Extension

1. Open `chrome://extensions` in your browser.
2. Enable **Developer mode** in the top right.
3. Click **Load unpacked** and select the `packages/extension/dist` directory.
4. The toolbar icon reflects whether the extension is connected to the background service.

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
      "command": "pnpm",
      "args": ["--filter", "@latch/daemon", "mcp"],
      "cwd": "/path/to/my-kimi-webbridge"
    }
  }
}
```

**Grok (`.grok/config.toml`):**

```toml
[mcp_servers.latch]
command = "pnpm"
args = ["--filter", "@latch/daemon", "mcp"]
```

---

### Option B: HTTP API

The background service exposes the following endpoints on `http://127.0.0.1:12580`:

| Method | Endpoint | Request Body | Description |
|---|---|---|---|
| `POST` | `/run` | `{"session": "...", "source": "...", "browser"?: "..."}` | Runs a JavaScript automation script in Node.js |
| `POST` | `/command` | `{"session": "...", "action": "...", "args": {...}}` | Executes a single browser command directly |
| `GET` | `/status` | None | Returns connected browsers and active sessions |
| `GET` | `/ws` | None | WebSocket connection used by the browser extension |

#### Example: Running an automation script (`POST /run`)

The script runs in a secure Node.js sandbox providing a `page` helper object and a `cliLog` function:

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
- Interactions: `click`, `fill`, `type`, `scroll`, `drag`, `wait`
- Low-level: `cdp`

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
`navigate`, `find_tab`, `list_tabs`, `close_tab`, `close_session`, `snapshot`, `click`, `fill`, `type`, `scroll`, `drag`, `wait`, `screenshot`, `evaluate`, `cdp`.

---

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

1. Start the service bound to localhost:
   ```bash
   pnpm --filter @latch/daemon start -- --host 127.0.0.1 --port 12580
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
