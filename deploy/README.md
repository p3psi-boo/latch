# VPS 部署

自用部署就是同一份 `latch start`。前面用 Caddy（或 nginx）做 HTTPS/WSS。扩展出站连你的域名；Agent POST `/command`，用 `browser` 区分 Chrome。没有配对码。

不要把 Node 直接暴露在 443。TLS 交给 Caddy。能打到这个 HTTP 的人就能开已连接的浏览器，所以 12580 只听 loopback。

## 1. 机器上跑 daemon

Node 22+。把仓库放到 `/opt/latch` 后：

```bash
cd /opt/latch
pnpm install
pnpm --filter @latch/daemon start -- --host 127.0.0.1 --port 12580
```

生产用 `deploy/latch.service`。按你的 node/tsx 路径改 `ExecStart`。

## 2. Caddy

把 `deploy/Caddyfile` 里的域名改成你的，Caddy 自动签证书，并反代到 loopback。

WebSocket 路径是 `/ws`，Caddy 的 `reverse_proxy` 会升级。

## 3. 连上浏览器

1. 扩展 Options 里填 `wss://latch.example.com/ws`
2. 给这台 Chrome 起一个 **browser id**（可选备注）。不填则生成 UUID 并记住。多台浏览器共用一个 daemon 时 id 不要重复。
3. Agent：

```bash
curl -s -X POST https://latch.example.com/command \
  -H 'Content-Type: application/json' \
  -d '{"action":"navigate","args":{"url":"https://example.com","newTab":true},"session":"demo","browser":"work"}'
```

只连了一台时可以省略 `browser`。

## 4. 防火墙

只开 80/443。12580 只听 loopback。
