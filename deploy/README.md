# AIALL 部署指南（公网服务器）

> 目标服务器：`<SERVER_IP>`（Alibaba Cloud Linux 3，内存约 880M，磁盘剩 ~22G）。
> 访问地址：`http://<SERVER_IP>:8088`（8088 已在安全组放行；80 被 nginx 占用）。
> **禁止在服务器上 `cargo build`**（内存不够）；二进制一律本地/CI 交叉编译后上传。

## 架构

```
浏览器 → :8088（nginx 反代）→ agent-server(127.0.0.1:8088)
            │
            └─ 托管前端 dist/（静态文件）
```

agent-server 复用桌面版 Agent 循环（`agent_run_headless`），无头运行：
- 读/写服务器上的项目文件、执行 Git
- SSE 流式返回事件（`/api/agent/run`）
- 全部受保护接口要求 `Authorization: Bearer <token>` 或登录 session

## 前置

1. 本地/CI 构建产物（见「构建 agent-server」）：
   - `agent-server`（Linux x86_64 可执行文件）
   - 前端 `dist/`
2. 服务器上准备项目目录，如 `/srv/aiall/projects/<你的项目>`（agent-server 用户需可读写）。

## 构建 agent-server

本机若为 Windows / macOS，建议用 GitHub Actions CI（`scripts/build-linux-agent-server.yml` 同步到
`.github/workflows/`），在 `ubuntu-latest` 上交叉编译：

```bash
# 本地 Linux 亦可直接：
rustup target add x86_64-unknown-linux-musl   # 或 gnu
cd src-tauri
cargo build --release --target x86_64-unknown-linux-musl --bin agent-server
# 产物：src-tauri/target/x86_64-unknown-linux-musl/release/agent-server
```

> musl 静态链接可省去 glibc 版本兼容问题，推荐；若 musl 工具链装不上，用 gnu 目标在
> `ubuntu-latest` 上构建后直接上传（同 glibc 系可跑）。

## 部署步骤

```bash
# 1. 上传二进制 + 前端产物 + systemd/nginx 文件
./scripts/deploy.sh

# 2. 服务器上：配置（先编辑 deploy/server.env 或 systemd 里的 Environment）
#    - AIALL_SERVER_TOKEN=<至少32字节随机>
#    - AIALL_SERVER_ALLOWED_PROJECTS=/srv/aiall/projects
#    - AIALL_SERVER_RESTRICT_COMMANDS=1

# 3. systemd
sudo cp deploy/agent-server.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now agent-server
systemctl status agent-server

# 4. 验证后端
curl http://127.0.0.1:8088/healthz          # → ok
curl -X POST http://127.0.0.1:8088/api/server/login \
  -H 'Content-Type: application/json' \
  -d "{\"password\":\"<AIALL_SERVER_TOKEN>\"}"          # → {ok:true, token,...}

# 5. 前端托管（方案 A：nginx 反代）
#    把 dist/ 放到 /opt/aiall/dist，nginx conf 见 deploy/nginx.conf
sudo cp deploy/nginx.conf /etc/nginx/conf.d/aiall.conf
sudo nginx -t && sudo systemctl reload nginx

# 浏览器访问 http://<IP>:8088  → /vibe-coding
```

> 服务器上建独立用户：`sudo useradd -r -s /usr/sbin/nologin -d /opt/aiall aiall`，
> 并把项目目录、`/opt/aiall` 的属主改为 `aiall`。勿用 root 跑 agent-server。

## 前端两种托管方式（二选一）

| 方案 | 说明 |
|---|---|
| A. nginx 反代（推荐） | `dist/` 由 nginx 托管，`/backend/*`、`/api/*` 反代到 agent-server；前端无需 `VITE_BACKEND_URL`，用相对路径。SSE 已 `proxy_buffering off` |
| B. 直连 8088 | 前端构建时带 `VITE_BACKEND_URL=http://<SERVER_IP>:8088`（见任务 E 的 `build:web-server` 脚本）；不走 nginx |

## 验证清单（模拟部署 / 真实部署）

1. `systemctl status agent-server` 显示 active (running)
2. `curl :8088/healthz` → `ok`
3. 未带 token 访问 `/backend/vibe/git/status` → `401 Unauthorized`
4. 登录拿到 session token 后带 `Authorization: Bearer <token>` 访问同一接口 → 200
5. 带 token POST `/api/agent/run`（SSE）→ 能看到 `data:` 事件流、Agent 能读写项目内文件
6. 传入白名单外路径（如 `/etc/passwd`）→ `403`
7. `AIALL_SERVER_RESTRICT_COMMANDS=1` 下 Agent 执行 `rm -rf /` → 被拒

## 安全要点

- `AIALL_SERVER_TOKEN` 是唯一认证凭证，务必设强随机值并保管好（不提交仓库）。
- `AIALL_SERVER_ALLOWED_PROJECTS` 只放允许 agent 操作的项目目录。
- key（`AIALL_SERVER_AI_KEY` / `server-config.json`）只存在于服务器，浏览器不下发。
- 内存 880M：不要同时开多个 Agent 长任务；必要时调低 Agent `maxTurns`。
- 数据库/其它服务端口（5432 / 10086 / docker）未被本部署占用。
