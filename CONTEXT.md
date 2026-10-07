# Latch — 方向与契约

开源浏览器手（hands）：任意 Agent 驱动用户正在用的、带登录态的 Chrome。

## 一句话

扩展是唯一执行器。daemon 只转发 `tool_call`。Agent 用 browser id 区分连上的 Chrome。没有第二套 CDP，没有配对码。

## 非谈判原则

1. **手只有一双。** `chrome.debugger` 只存在于扩展里。daemon 只转发 `tool_call`。
2. **本机默认 loopback。** 默认绑 `127.0.0.1`。自用 VPS 也把 Node 放在 loopback，前面用 Caddy 做 TLS。没有应用层鉴权：能打到 HTTP 就能开已连接的浏览器。
3. **一个任务一个 session 一个 tab group。** session 名跟任务走，不跟网站走。
4. **不做侧边栏产品。** 不内置 LLM 对话、录制蒸馏、会员登录。那些是 Agent 宿主的事。

## 两件套

| 件 | 职责 | 不负责 |
|----|------|--------|
| `packages/extension` | CDP 工具、tab group、连 WS | Agent 循环、鉴权产品 |
| `packages/daemon` | `latch start`：HTTP + WS 转发。`latch mcp` 再加 stdio | 执行页面动作、终止 TLS |

VPS 上前面加 Caddy / nginx 做 HTTPS/WSS，daemon 仍是同一份 `latch start`。

线协议在 `packages/protocol`。HTTP 和 MCP 共用 `action` + `args` + `session`，多浏览器时再加 `browser`。

## 线协议（v1）

扩展 ↔ daemon：

```
hello / hello_ack / ping / pong
tool_call    { requestId, payload: { name, args } }
tool_result  { responseToRequestId, payload: { data } | { error } }
```

Agent → daemon：

```
POST /run       { source, session, browser?, timeoutMs? }   默认编排
POST /command   { action, args, session, browser? }        单步调试
GET  /status
GET  /ws
```

`POST /run` 在 daemon 沙箱里跑 JS，注入 `page` / `cliLog` / `task.page()`。helpers 走同一套 `dispatchCommand`，不把脚本丢进页面。

`browser` 是扩展 Options 里用户起的 id。一个 daemon 可以挂多台 Chrome；只连了一台时可以省略。备注（`remark`）只出现在 `GET /status` 和 MCP `list_browsers`，不参与路由。同一 id 重连会顶掉旧 socket，并保留该浏览器上的 session。

内部字段（Agent 不要填，由 daemon 注入）：`_tabId` `_session` `_tabIds` `_ownedTabIds`。

指针和输入走 CDP，给页面看，没有视觉 overlay。

- 移动：直线插值，时长 `clamp(round(2d), 120, 420)` ms，超过 5000 px/s 再拉长；缓动 `cubic-bezier(0.2, 0, 0, 1)`。
- 点击：飞到目标后 press / release 各隔 25ms。
- 滚轮：`≤120px` 一帧，否则 `min(12, ceil(d/80))` 步，smoothstep，步间隔 8ms。后台 tab 先 `Page.setWebLifecycleState(active)` 并 `Emulation.setFocusEmulationEnabled`，否则 `mouseWheel` 会卡在 renderer ACK 上。
- 拖拽：飞到起点、按下、带着 `buttons:1` 飞到终点、抬起，事件间隔 25ms。
- 点/填之前最多 6 次同一套滚轮把元素滚进视野，再 `scrollIntoView` 兜底。
- `fill` 先 `Input.insertText` 整段灌字，校验失败再 DOM 赋值。`type` 是逐键 keyDown/keyUp。

## 多浏览器

- 标识是用户字符串。扩展 `hello` 带 `browserId` + 可选 `remark`。Options 里没填 id 时生成 UUID v4 并持久化，重连沿用。
- 每个 id 有自己的 `ExtensionBridge` 和 `SessionStore`。
- Hub 按 id 分槽，没有房间、没有配对码。

## 刻意杀掉的东西

- 在云端再写一套 Playwright/CDP「云 daemon」
- 把 Kimi 侧边栏、rrweb、IndexedDB 会话、会员墙搬过来
- 为了兼容 Kimi 而复制 `/command` 的每个历史边角（我们只保留「session + action + args」这个形状）
- 配对码、多租户房间
- 用 Cloudflare Workers / Durable Objects 当云端。自用部署就是 `latch start` + Caddy

## 第一证明点

本机：`latch start` → 加载扩展 → `POST /run`（navigate + snapshot），用户 Chrome 里出现分组标签页，snapshot 带回 `@e` ref。

证伪：如果 Agent 必须先开无头浏览器、或扩展里出现第二套工具实现，方向就错了。
