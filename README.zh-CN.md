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

**方式一：直接运行（Node / pnpm）**
```bash
pnpm install
pnpm --filter @latch/daemon start # 默认监听 127.0.0.1:12580
```

**方式二：使用 Docker 运行**
```bash
docker run -d --name latch-server -p 12580:12580 ghcr.io/p3psi-boo/latch:latest
# 或通过 docker compose 启动：
docker compose up -d
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
      "command": "pnpm",
      "args": ["--filter", "@latch/daemon", "mcp"],
      "cwd": "/path/to/my-kimi-webbridge"
    }
  }
}
```

**Grok（项目根目录 `.grok/config.toml`）：**

```toml
[mcp_servers.latch]
command = "pnpm"
args = ["--filter", "@latch/daemon", "mcp"]
```

---

### 方式二：HTTP API 接口

后台服务默认提供以下接口（地址 `http://127.0.0.1:12580`）：

| 请求方式 | 路径 | 请求体 | 说明 |
|---|---|---|---|
| `POST` | `/run` | `{"session": "...", "source": "...", "browser"?: "..."}` | 在 Node.js 环境中执行自动化脚本 |
| `POST` | `/command` | `{"session": "...", "action": "...", "args": {...}}` | 直接调用单个页面操作指令 |
| `GET` | `/status` | 无 | 查看当前连接的浏览器与会话列表 |
| `GET` | `/ws` | 无 | 供浏览器扩展建立的 WebSocket 连接 |

#### 示例 1：执行自动化脚本 (`POST /run`)

脚本运行在独立的 Node.js 沙箱中，提供内置的 `page` 操作对象与 `cliLog` 输出函数：

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
- 用户交互：`click`、`fill`、`type`、`scroll`、`drag`、`wait`
- 底层控制：`cdp`

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
`navigate`, `find_tab`, `list_tabs`, `close_tab`, `close_session`, `snapshot`, `click`, `fill`, `type`, `scroll`, `drag`, `wait`, `screenshot`, `evaluate`, `cdp`。

---

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

1. 启动服务并限制监听在本地回环地址：
   ```bash
   pnpm --filter @latch/daemon start -- --host 127.0.0.1 --port 12580
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
