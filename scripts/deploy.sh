#!/usr/bin/env bash
# 上传 agent-server 二进制、前端 dist、systemd/nginx 文件到服务器并重启服务。
#
# 用法（参数化，不留真 key）：
#   SERVER_HOST=root@<SERVER_IP> \
#   SERVER_REMOTE_DIR=/opt/aiall \
#   AGENT_BIN=src-tauri/target/x86_64-unknown-linux-musl/release/agent-server \
#   DIST_DIR=dist \
#   ./scripts/deploy.sh
#
# 环境变量（均为可选，有默认值）：
#   SERVER_HOST        默认 root@<SERVER_IP>
#   SERVER_REMOTE_DIR  默认 /opt/aiall
#   AGENT_BIN          二进制路径；为空则跳过二进制上传
#   DIST_DIR           前端 dist 目录；为空则跳过前端上传
set -euo pipefail

SERVER_HOST="${SERVER_HOST:-root@<SERVER_IP>}"
REMOTE_DIR="${SERVER_REMOTE_DIR:-/opt/aiall}"
AGENT_BIN="${AGENT_BIN:-}"
DIST_DIR="${DIST_DIR:-}"
REMOTE_SERVICE="${REMOTE_SERVICE:-agent-server}"

cd "$(dirname "$0")/.."

echo "[deploy] 目标: ${SERVER_HOST}:${REMOTE_DIR}"

# 1. 远端目录
ssh "${SERVER_HOST}" "mkdir -p ${REMOTE_DIR}"

# 2. systemd + nginx 模板（不含真实 key，仅占位；服务器上替换 __CHANGE_ME__）
scp deploy/agent-server.service "${SERVER_HOST}:${REMOTE_DIR}/agent-server.service"
scp deploy/server.env.example "${SERVER_HOST}:${REMOTE_DIR}/server.env.example"

# 3. agent-server 二进制（可选）
if [ -n "${AGENT_BIN}" ]; then
  echo "[deploy] 上传二进制: ${AGENT_BIN}"
  scp "${AGENT_BIN}" "${SERVER_HOST}:${REMOTE_DIR}/agent-server"
  ssh "${SERVER_HOST}" "chmod +x ${REMOTE_DIR}/agent-server"
fi

# 4. 前端 dist（可选）
if [ -n "${DIST_DIR}" ]; then
  echo "[deploy] 上传前端 dist: ${DIST_DIR}"
  scp -r "${DIST_DIR}" "${SERVER_HOST}:${REMOTE_DIR}/dist"
fi

# 5. 安装 systemd 并重启
ssh "${SERVER_HOST}" <<EOF
  if [ -f "${REMOTE_DIR}/agent-server.service" ]; then
    cp "${REMOTE_DIR}/agent-server.service" /etc/systemd/system/${REMOTE_SERVICE}.service
    systemctl daemon-reload
    systemctl restart ${REMOTE_SERVICE} || true
  fi
EOF

echo "[deploy] 完成。服务器上需先编辑 ${REMOTE_DIR}/server.env.example（替换 __CHANGE_ME__）再重启服务。"
echo "[deploy] 验证: curl http://127.0.0.1:8088/healthz"
