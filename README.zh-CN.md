# Latch

[English](README.md)

Latch 是一个让 AI Agent 直接控制日常 Chromium 浏览器的工具，由本地后台服务与浏览器扩展组成。

浏览器扩展通过 Chrome 开发者协议（`chrome.debugger`）执行页面操作；Node.js 后台服务负责监听 HTTP 与 MCP（Model Context Protocol）请求，并通过 WebSocket 转发给扩展。

```
Agent（AI / 自动化脚本）
  MCP stdio | POST /run | POST /command
        │
        ▼
Latch 后台服务 (Node.js)  127.0.0.1:12580
        │  WebSocket
        ▼
Latch 浏览器扩展 (Chrome / Chromium)
        │  chrome.debugger (CDP)
        ▼
浏览器标签页
```

## 快速上手

### 1. 环境准备

- Node.js 22 或更高版本（或使用 Docker）
- pnpm
- Google Chrome 或基于 Chromium 的浏览器

### 2. 启动后台服务

**方式一：使用 npx 免克隆一键运行**
```bash
# 启动后台 HTTP 服务（监听 127.0.0.1:12580）
npx github:p3psi-boo/latch start

# 或启动带 MCP stdio 支持的服务（用于 AI 客户端接入）
npx github:p3psi-boo/latch mcp
```

**方式二：使用 Docker 运行**
```bash
docker run -d --name latch-server -p 12580:12580 ghcr.io/p3psi-boo/latch:latest
# 或通过 docker compose 启动：
docker compose up -d
```

**方式三：本地源码运行**
```bash
pnpm install
pnpm build
pnpm --filter @latch/daemon start # 默认监听 127.0.0.1:12580
```

### 3. 安装浏览器扩展

- **下载已打包文件**：直接在 GitHub Releases 或 Actions 构建产物中下载 `latch-extension.zip` 并解压。
- **或本地源码构建**：
  ```bash
  pnpm build:extension # 编译至 packages/extension/dist
  ```

在 Chrome / Chromium 浏览器中：
1. 打开 `chrome://extensions`。
2. 开启右上角的 **开发者模式** 开关。
3. 点击 **加载已解压的扩展程序**，选择解压后的目录（或源码中的 `packages/extension/dist`）。
4. 工具栏上的扩展图标会实时指示与后台服务的连接状态。

---

## 使用方式

### 方式一：接入 MCP 客户端

使用以下命令启动支持 MCP stdio 的服务：

```bash
pnpm --filter @latch/daemon mcp
```

#### 客户端配置示例

**Claude Code / Cursor / 其他 MCP 客户端：**

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

**固定使用特定浏览器（Browser ID）：**
如果同时打开了多个 Chrome 窗口 / Profile，并希望该 MCP 服务固定只操作特定浏览器，可加上 `--browser <id>` 参数：

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
*(固定后，AI 在调用任何工具时均会自动路由到该浏览器，且无需在每次请求中指定 `browser` 参数)*

*(如使用本地克隆代码，则为：`"command": "pnpm", "args": ["--filter", "@latch/daemon", "mcp", "--", "--browser", "work"]`)*

**Grok（`.grok/config.toml`）：**

```toml
[mcp_servers.latch]
command = "npx"
args = ["github:p3psi-boo/latch", "mcp", "--browser", "work"]
```

---

### 方式二：HTTP API 接口

后台服务默认提供以下接口（地址 `http://127.0.0.1:12580`）：

| 请求方式 | 路径 | 请求体 | 说明 |
|---|---|---|---|
| `POST` | `/run` | `{"session": "...", "source": "...", "browser"?: "..."}` | 将脚本转给 Latch 插件的隔离页面执行 |
| `POST` | `/command` | `{"session": "...", "action": "...", "args": {...}}` | 直接调用单个页面操作指令 |
| `POST` | `/mcp` | `{"jsonrpc": "2.0", "id": 1, ...}` | 远程 HTTP POST MCP 接口（自动寻址可用浏览器） |
| `POST` | `/mcp/{browser_id}` | `{"jsonrpc": "2.0", "id": 1, ...}` | 远程 HTTP POST MCP 接口（直接固定到指定浏览器） |
| `GET` | `/status` | 无 | 查看当前连接的浏览器与会话列表 |
| `GET` | `/ws` | 无 | 供浏览器扩展建立的 WebSocket 连接 |

> **鉴权保护与远程 MCP 接入提示：**
> - **路径绑定浏览器：** 直接请求 `http://127.0.0.1:12580/mcp/work`，即可固定仅控制名为 `work` 的浏览器。
> - **Token 鉴权：** 启动 daemon 时传入 `--token <secret>`（或配置环境变量 `LATCH_TOKEN=<secret>`）。调用时在 URL 查询参数中带上 `?token=<secret>`，或通过 Header `Authorization: Bearer <secret>` 验证。
> - 完整请求地址示例：`http://127.0.0.1:12580/mcp/work?token=your_secret_here`

#### 示例 1：执行自动化脚本 (`POST /run`)

脚本运行在 Latch 插件的隔离页面内，每次调用使用独立的 Web Worker。daemon 只转发请求，提供给脚本的 `page` 操作对象与 `cliLog` 输出函数由插件定义：

```bash
curl -s -X POST http://127.0.0.1:12580/run \
  -H 'Content-Type: application/json' \
  -d '{
    "session": "search-task",
    "source": "await page.goto(\"https://example.com\", { newTab: true, group_title: \"演示任务\" });\ncliLog(await page.snapshot());"
  }'
```

`page` 支持的常用方法：
- 导航与标签页：`goto`、`findTab`、`listTabs`、`closeTab`、`closeSession`
- 页面分析：`snapshot`（无障碍快照树）、`screenshot`、`evaluate`
- 用户交互：`click`、`fill`、`selectOption`、`type`、`scroll`、`drag`、`wait`
- 底层控制：`cdp`

原生下拉框使用 `await page.selectOption('select[name="my-select"]', {label:"Two"})`。每个匹配条件只指定 `value`、完整的 `label` 或从零开始的 `index` 中的一项。多选下拉框接受匹配条件数组，数组会替换原有选择；空数组 `[]` 会清空选择。扩展会检查选项是否存在、是否重复匹配、是否被禁用，然后设置 DOM 中的选中状态。选择发生变化时，扩展会触发 `isTrusted` 为 `false` 的 `input` 和 `change` 事件，并在同步事件处理结束后核对选中选项。结果包含 `verified`、`mode:"dom"`、`changed`、`values` 和 `labels`；页面后续的异步更新与表单提交需要另外检查。自定义下拉组件仍按组件的点击或键盘操作流程处理。单个 MCP 工具 `select_option` 接受 `selector` 和 `option` 参数，使用同一份扩展实现。

`click` 会检查目标是否有有效的页面尺寸。返回的 `success` 和 `dispatched` 表示鼠标事件已发送，页面的业务结果需要另外检查。

#### 示例 2：执行单个操作指令 (`POST /command`)

适合调试与单步调用：

```bash
curl -s -X POST http://127.0.0.1:12580/command \
  -H 'Content-Type: application/json' \
  -d '{
    "session": "search-task",
    "action": "navigate",
    "args": { "url": "https://example.com" }
  }'
```

支持的操作列表（`action`）：
`navigate`, `find_tab`, `list_tabs`, `close_tab`, `close_session`, `snapshot`, `click`, `fill`, `select_option`, `type`, `scroll`, `drag`, `wait`, `screenshot`, `evaluate`, `cdp`。

---

## Latch 插件提供工具定义，daemon 转发请求。

`packages/extension/src/tool-definitions.ts` 和 `tool-schemas.ts` 定义 MCP 工具的名称、说明及参数；`tools.ts` 执行浏览器操作。插件连接时发送工具定义，daemon 使用这些定义回答 `tools/list`，并将 `tools/call` 转给选定的插件。插件重连或更新定义时，daemon 会发送 `notifications/tools/list_changed`。HTTP 客户端可以通过 MCP 端点的 GET 事件流接收通知；客户端仍需重新读取工具列表。

本次迁移使用传输协议 2，首次需要同时更新 daemon 和插件。执行 `pnpm build` 后，新 daemon 位于 `bin/latch.cjs`，插件位于 `packages/extension/dist`。启动命令为 `node bin/latch.cjs start`；在浏览器中开启开发者模式并加载插件目录；更新未打包插件后，在扩展程序页面点击「重新加载」。将插件连接地址设为 daemon 的 `/ws`，MCP 客户端使用 `/mcp/<browser-id>`。旧协议插件会被新版 daemon 拒绝；本次迁移之后，在传输协议不变时新增浏览器工具只需更新插件。

脚本可以使用 `await page.call("工具名称", {参数})` 调用插件新增的工具，已有 `page.selectOption(...)` 等方法保留。daemon 不再执行 JavaScript，也不保存任务的标签页状态。插件把标签页状态存入 `chrome.storage.session`，插件后台执行环境重启或 daemon 重连后可以继续读取；插件重新加载或浏览器退出时，Chrome 会清除这份存储。插件需要 Chrome 116 或更新版本，并使用 `offscreen` 权限创建脚本执行页面。每次脚本执行完成或超过原有执行时限后，插件终止对应 Worker 并移除对应隔离页面。

MCP 截图返回图片内容；HTTP 单步调用和插件脚本返回 `mimeType` 与 `base64` 图像数据。daemon 不再向本机写入截图文件，客户端负责保存图像。多台插件提供同名工具时，未绑定浏览器的 MCP 端点要求工具定义相同；定义不同时使用 `/mcp/<browser-id>` 分别访问。插件未连接时，未绑定端点返回空工具列表，绑定端点报告连接错误。

## 连接多个浏览器

如果需要同时连接多个 Chrome 配置文件（Profile）：

1. 右键点击 Latch 扩展图标，进入 **选项**（Options）。
2. 配置参数：
   - **Browser ID**：当前浏览器的唯一标识（选填，留空时会自动生成并保存）。
   - **Remark**：备注名称（如 `work`、`personal`），仅用于区分，显示在 `/status` 和 MCP 中。
   - **WebSocket URL**：默认 `ws://127.0.0.1:12580/ws`。
3. 调用 API 时，传入对应的 `"browser": "<浏览器ID>"` 即可操作指定浏览器。若只连接了一台浏览器，该参数可省略。

查看当前连接的浏览器状态：

```bash
curl -s http://127.0.0.1:12580/status
```

---

## 注意事项

- **网络与安全**：服务默认监听 `127.0.0.1:12580`，无内置登录校验。本地能访问该端口的任何进程均可控制已连接的浏览器。
- **Session 概念**：一个 `session` 名称会自动对应一个 Chrome 标签页分组。建议以任务名称命名（例如 `ticket-query`、`data-fetch`）。
- **用户交互模拟**：点击与滚动等交互直接向页面发送标准指针及键盘事件，不包含虚构的光标动画层。

---

## 远程部署

如需将后台服务部署到远程服务器：

1. 启动服务并指定监听地址（可配置 Token）：
   ```bash
   # 单个地址（默认：127.0.0.1）
   latch start --host 127.0.0.1 --port 12580

   # 或同时精准监听多个指定的 IPv4 / IPv6 地址（以逗号分隔）：
   latch start --host "127.0.0.1, ::1, 2409:xxxx:xxxx::1" --port 12580 --token <secret>
   ```
2. 前端通过 Caddy 或 Nginx 配置反向代理与 TLS（443 端口），配置文件参考 `deploy/` 目录。
3. 将本地浏览器扩展选项中的 WebSocket URL 修改为 `wss://<你的域名>/ws`。

---

## 代码目录

| 目录 | 说明 |
|---|---|
| `packages/protocol` | 基础协议定义、操作指令名称与 TypeScript 类型 |
| `packages/daemon` | 本地后台服务（HTTP 服务、WebSocket 服务、MCP 服务） |
| `packages/extension` | Chrome MV3 浏览器扩展（负责页面操作执行） |
| `deploy/` | 生产部署参考配置（systemd 服务文件、Caddyfile） |
| `skill/` | 面向 Agent 的系统提示词规范与操作指引 |

---

## 本地开发

```bash
# 运行单元测试
pnpm test

# 构建扩展
pnpm --filter @latch/extension build
```

---

## 开源协议

[WTFPL](http://www.wtfpl.net/about/)，详见 [LICENSE](LICENSE)。
