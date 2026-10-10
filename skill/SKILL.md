---
name: latch
description: >
  Latch lets an AI drive the user's real Chrome (logins included) through a daemon
  at http://127.0.0.1:12580 (or a self-hosted URL). Use when the user wants to
  open a page, click, type, snapshot, or screenshot in their actual browser.
---

# Latch

Control the user's real browser via the Latch daemon.

Local default: `http://127.0.0.1:12580`. The default workflow is **one `run` script per task slice**: snapshot, act on `@e` refs, wait, snapshot again. Every request needs `session` (one task = one tab group). When more than one Chrome is connected, also pass `browser`. Call `list_browsers` or `GET /status` to see ids and remarks.

## Default: `run`

POST `/run` or MCP tool `run` with `source` + `session`. The daemon forwards the source to the plugin sandbox, which provides `page`, `task.page()`, and `cliLog`. Helpers call the existing tools; they do not run inside the page.

```bash
curl -s -X POST http://127.0.0.1:12580/run \
  -H 'Content-Type: application/json' \
  -d '{"session":"my-task","source":"await page.goto(\"https://example.com\", { newTab: true, group_title: \"My task\" });\ncliLog(await page.snapshot());"}'
```

If the shell mangles JSON, write a unique temp file and POST `--data-binary @file`.

```js
const page = task.page("p1");
await page.goto("https://example.com", { newTab: true, group_title: "My task" });
cliLog(await page.snapshot());
await page.fill("@e3", "user@test.com");
await page.click("@e4");
await page.scroll({ deltaY: 800 });
await page.wait({ text: "欢迎" });
cliLog(await page.snapshot());
```

Use `page.call("tool_name", {arguments})` for newly added tools. Read the connected plugin’s MCP tool list for its current parameters. Helpers: `page.goto` `snapshot` `click` `fill` `selectOption` `scroll` `drag` `type` `wait` `screenshot` `evaluate` `cdp` `findTab` `listTabs` `closeTab` `closeSession`. Click flies the real mouse then press/release (`@e` ref or CSS). Its `success` and `dispatched` fields confirm dispatch, not the page's business outcome; a target with no usable layout box produces an error. `page.scroll({ deltaY })` wheels; `page.scroll({ selector })` brings an element into view. `page.drag(from, to)` holds the button during the second flight. `page.fill` uses `Input.insertText`; `page.type(text, { selector?, delayMs? })` sends keyDown/keyUp. `cliLog` is the output the model should read. A helper error stops the rest of the script; the response includes `logs`, `error`, and `step`.

`page.selectOption(selector, {value:"2"})` targets a native `SELECT`, not its `OPTION`. Each match specifies exactly one of `value`, exact `label`, or zero-based `index`. For a multiple select, pass an array of matches to replace the selection, or `[]` to clear it. Disabled or ambiguous options produce an error before selection changes. The extension changes DOM selection and dispatches untrusted `input` and `change` events only when selection changes. It checks the selection after synchronous event handlers and returns `verified`, `mode:"dom"`, `changed`, `values`, and `labels`. This does not verify later asynchronous updates or form submission. Custom dropdown widgets use their own click or keyboard interaction sequence.

If several browsers are connected, add `"browser":"<id>"` next to `session`.

Self-hosted daemon: same body against `https://your.domain/run`. No pairing code.

## Debug: one-shot `/command`

`POST /command` `{ action, args, session }` still exists for a single tool (curl, stepping). Do not use it as the main agent loop.

| Tool | Args | Notes |
|------|------|--------|
| `navigate` | `url`, `newTab?`, `group_title?` | `page.goto` |
| `find_tab` | `url`, `active?` | `page.findTab`. `active:true` borrows the tab the user is viewing |
| `snapshot` | — | Accessibility tree with `@e` refs |
| `click` | `selector` | Real mouse path, then 25ms press/release |
| `fill` | `selector`, `value` | `Input.insertText`, DOM fallback |
| `select_option` | `selector`, `option` | Native SELECT; same implementation as `page.selectOption` |
| `scroll` | `deltaX?`, `deltaY?`, `selector?` | Wheel, or into-view when only `selector` |
| `drag` | `from`, `to` | Pressed flight between two selectors |
| `type` | `text`, `selector?`, `delayMs?` | Per-character keyDown/keyUp |
| `evaluate` | `code` | Page JS. Compact `JSON.stringify` |
| `cdp` | `method`, `params?` | Do not call `Target.activateTarget` |
| `screenshot` | `format?`, `quality?`, `selector?` | MCP returns image content; HTTP/run returns `mimeType` and `base64`. The client saves the image |
| `wait` | `text?`, `selector?`, `timeoutMs?` | |
| `list_tabs` | — | |
| `close_tab` | — | Current tab |
| `close_session` | — | All tabs this session opened |
| `list_browsers` | — | MCP only |
| `run` | `source`, `session`, `browser?` | Default workflow |

## Sessions

Pick one session name at the start of a task. Put it on every `run`. Name the task, not the site.

`close_session` only when the user asks to close those tabs.

## If the daemon is down

```bash
pnpm --filter @latch/daemon start
```

Do not run stop/restart unless the user asks.
