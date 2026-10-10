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
| `packages/extension` | MCP 工具定义、CDP 操作、任务标签页状态、脚本执行、连 WS | Agent 循环、鉴权产品 |
| `packages/daemon` | `latch start`：HTTP + WS 转发。`latch mcp` 再加 stdio | 执行页面动作、终止 TLS |

VPS 上前面加 Caddy / nginx 做 HTTPS/WSS，daemon 仍是同一份 `latch start`。

线协议在 `packages/protocol`。HTTP 和 MCP 共用 `action` + `args` + `session`，多浏览器时再加 `browser`。

## 插件定义工具，线协议使用 v2。

扩展 ↔ daemon：

```
hello { tools: MCP工具定义列表, ...身份与版本 } / hello_ack / ping / pong
tools_changed { payload: { tools: MCP工具定义列表 } }
tool_call    { requestId, payload: { name, args, session, browsers?, format? } }
tool_result  { responseToRequestId, payload: { data } | { error } }
```

Agent → daemon：

```
POST /run       { source, session, browser?, timeoutMs? }   默认编排
POST /command   { action, args, session, browser? }        单步调试
GET  /status
GET  /ws
```

`POST /run` 由 daemon 转给插件。插件在隔离页面的独立 Worker 中执行 JS，提供 `page` / `cliLog` / `task.page()`；`page.call(name,args)` 可以调用插件新增的工具。浏览器操作仍由插件后台执行，不在目标网站中执行脚本编排代码。

`browser` 是扩展 Options 里用户起的 id。一个 daemon 可以挂多台 Chrome；只连了一台时可以省略。备注（`remark`）只出现在 `GET /status` 和 MCP `list_browsers`，不参与路由。同一 id 重连会顶掉旧 socket，并保留该浏览器上的 session。

内部字段（Agent 不要填，由插件注入）：`_tabId` `_session` `_tabIds` `_ownedTabIds`。

指针和输入走 CDP，给页面看，没有视觉 overlay。

- 移动：直线插值，时长 `clamp(round(2d), 120, 420)` ms，超过 5000 px/s 再拉长；缓动 `cubic-bezier(0.2, 0, 0, 1)`。
- 点击：飞到目标后 press / release 各隔 25ms。
- 滚轮：`≤120px` 一帧，否则 `min(12, ceil(d/80))` 步，smoothstep，步间隔 8ms。后台 tab 先 `Page.setWebLifecycleState(active)` 并 `Emulation.setFocusEmulationEnabled`，否则 `mouseWheel` 会卡在 renderer ACK 上。
- 拖拽：飞到起点、按下、带着 `buttons:1` 飞到终点、抬起，事件间隔 25ms。
- 点/填之前最多 6 次同一套滚轮把元素滚进视野，再 `scrollIntoView` 兜底。
- `fill` 先 `Input.insertText` 整段灌字，校验失败再 DOM 赋值。`type` 是逐键 keyDown/keyUp。

## 多浏览器

- 标识是用户字符串。扩展 `hello` 带 `browserId` + 可选 `remark`。Options 里没填 id 时生成 UUID v4 并持久化，重连沿用。
- 每个 id 有自己的 `ExtensionBridge`；`SessionStore` 位于插件，使用 `chrome.storage.session` 保存。
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

## 浏览器工具只在插件中定义。

插件的 `tool-definitions.ts` 和 `tool-schemas.ts` 声明工具定义，`tools.ts` 执行浏览器操作。daemon 使用插件发布的定义回答 MCP 工具列表，并转发请求和结果；daemon 没有固定的浏览器工具名称检查，也不执行脚本或写入截图文件。首次迁移需要同时升级 daemon 与插件；传输协议不变时，新工具只更新插件。

截图以图像字节返回，客户端负责保存。未绑定端点要求不同浏览器的同名工具定义相同；定义有差异时使用绑定浏览器的 MCP 端点。HTTP GET 事件流及 stdio 连接提供工具列表变化通知。插件未连接时，未绑定 MCP 工具列表为空。

MCP 调用使用 `format:"mcp"`，插件生成完整的 MCP 调用结果，daemon 原样返回；HTTP 单步接口仍返回插件的原始数据。
