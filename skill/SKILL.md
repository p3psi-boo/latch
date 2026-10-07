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

POST `/run` or MCP tool `run` with `source` + `session`. The daemon executes the source in a sandbox with `page`, `task.page()`, and `cliLog`. Helpers call the existing tools; they do not run inside the page.

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

Helpers: `page.goto` `snapshot` `click` `fill` `scroll` `drag` `type` `wait` `screenshot` `evaluate` `cdp` `findTab` `listTabs` `closeTab` `closeSession`. Click flies the real mouse then press/release (`@e` ref or CSS). `page.scroll({ deltaY })` wheels; `page.scroll({ selector })` brings an element into view. `page.drag(from, to)` holds the button during the second flight. `page.fill` uses `Input.insertText`; `page.type(text, { selector?, delayMs? })` sends keyDown/keyUp. `cliLog` is the output the model should read. A helper error stops the rest of the script; the response includes `logs`, `error`, and `step`.

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
| `scroll` | `deltaX?`, `deltaY?`, `selector?` | Wheel, or into-view when only `selector` |
| `drag` | `from`, `to` | Pressed flight between two selectors |
| `type` | `text`, `selector?`, `delayMs?` | Per-character keyDown/keyUp |
| `evaluate` | `code` | Page JS. Compact `JSON.stringify` |
| `cdp` | `method`, `params?` | Do not call `Target.activateTarget` |
| `screenshot` | `format?`, `quality?`, `selector?`, `path?` | Returns a file `path` |
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
