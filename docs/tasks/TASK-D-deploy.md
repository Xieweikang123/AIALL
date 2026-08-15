# TASK-D · 部署物（负责方：AI-C，文件域 `deploy/`、`scripts/`）

> 先读 `docs/WEB_SERVER_MIGRATION.md`、`docs/DEPLOYMENT_REQUIREMENTS.md`。依赖任务 B、C 交付后执行。

## 服务器情况（摘自 DEPLOYMENT_REQUIREMENTS.md）

- IP `<SERVER_IP>`，SSH `root@<SERVER_IP>`（密钥免密已通，端口 22）。
- 访问地址 `http://<SERVER_IP>:8088`；8088 已在阿里云安全组放行；80 被 nginx 占用。
- **Alibaba Cloud Linux 3，可用内存约 880M**，磁盘剩约 22G。已装 Docker / Node 20 / Nginx。
- **勿在服务器上 cargo build**（内存不够）。Rust 后端在本地/CI 交叉编译后上传。
- 避开端口：80(nginx)、5432(postgres)、10086(xray)、docker 容器各端口。

## 交付物

### 1. `deploy/` 目录（新建）

- **`agent-server.service`**（systemd unit）：`[Unit] After=network.target`；`[Service] ExecStart=<安装路径>/agent-server`，`Environment=` 配 `AIALL_SERVER_BIND=0.0.0.0`、`AIALL_SERVER_PORT=8088`、`AIALL_SERVER_TOKEN=<占位>`、`AIALL_SERVER_ALLOWED_PROJECTS=<占位>`、`AIALL_SERVER_RESTRICT_COMMANDS=1`；`Restart=always`；`User=` 建议非 root（如 `aiall`）。附安装说明（放哪个目录、`systemctl enable --now`）。
- **`nginx.conf` 片段**：把 `:8088` 的流量经 nginx 反代到 `127.0.0.1:8088`，或说明直接暴露 8088 的做法（需求文档说暂用 `http://IP:8088` 直连）。**注意 `text/event-stream`（SSE）需 `proxy_buffering off`**。
- **`server.env.example`**：全部环境变量清单与说明。
- **`README.md`**：部署步骤（上传 → 权限 → systemd → 防火墙 → 验证）。

### 2. `scripts/` 下（新建，或扩展现有）

- **`build-linux-agent-server.sh`**：在**本地/CI** 上做 Rust 交叉编译（目标 `x86_64-unknown-linux-musl` 或 gnu，按你本地可用工具链定），产物 `agent-server` 上传到服务器。服务器端**不**执行 cargo。
  - 若本地没有 `rustup target add x86_64-unknown-linux-*` 的 target，先 `rustup target add` 再 `cargo build --release --target ... --bin agent-server`。
  - 注意：musl 需要 `musl-cross` 等工具链；若用 gnu 目标则需在 Linux 环境或 CI（GitHub Actions `ubuntu-latest`）上构建再拉取。
  - **给出可直接跑的 CI 工作流文件**（如 `.github/workflows/build-agent-server.yml`）：`ubuntu-latest` 上 `rustup target add x86_64-unknown-linux-musl` + build + artifact，因为本机是 Windows，交叉编译 musl 未必可行，CI 更稳。可二选一，文档里写清。
- **`deploy.sh`**：`scp`/`rsync` 上传二进制 + systemd 文件 + 远程执行 `systemctl restart`。占位密码/路径参数化，不留真 key。

### 3. 前端生产构建说明

- web 版前端最终由 nginx/直连服务器托管（`dist/`）。确认「生产模式下前端如何找到后端」：现在 vite 代理只在 dev 模式；生产 `dist/` 需由 nginx 把 `/backend/vibe`、`/api` 反代到 `agent-server`（在 `nginx.conf` 片段里给）。若选择直连 8088 而不走 nginx，则需要前端 `VITE_BACKEND_URL=http://<IP>:8088` 的构建产物（见任务 E），在部署文档里写清二选一。

## 验收标准

1. 文档齐全：systemd、nginx（含 SSE buffering 关闭）、env 模板、部署步骤、交叉编译/CI。
2. 在 `docs/WEB_SERVER_MIGRATION.md` 或部署 README 中给出「模拟部署到服务器」的可执行清单（可先在本地 8088 起一个验证 systemd 等价启动方式）。
3. 不包含任何真实 key / token（用占位符）。
4. 若需要动 `package.json` 加构建脚本，先与任务 E 的 AI-B 协调，避免撞车（见总纲第五、六节）。

## 注意

- 你的文件域是 `deploy/`、`scripts/`、`.github/`（CI）与 `docs/`。**不要改 `src-tauri/` 与 `src/` 代码**；如需改 `package.json`（如加 build 脚本）先登记总纲。
- 服务器内存小，任何「在服务器上编译」的念头都打住。
