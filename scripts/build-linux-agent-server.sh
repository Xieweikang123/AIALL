#!/usr/bin/env bash
# 本地（Linux）构建 agent-server release 二进制（不依赖服务器）。
# Windows / macOS 请改用 scripts/build-linux-agent-server.yml（GitHub Actions）。
set -euo pipefail

cd "$(dirname "$0")/../src-tauri"

TARGET="${1:-x86_64-unknown-linux-musl}"

echo "[build-linux-agent-server] target=${TARGET}"

if ! rustup target list --installed 2>/dev/null | grep -q "^${TARGET}$"; then
  echo "[build-linux-agent-server] 添加 target ${TARGET} ..."
  rustup target add "${TARGET}"
fi

echo "[build-linux-agent-server] cargo build --release --target ${TARGET} --bin agent-server ..."
cargo build --release --target "${TARGET}" --bin agent-server

BIN="target/${TARGET}/release/agent-server"
echo "[build-linux-agent-server] 产物: ${BIN}"
ls -lh "${BIN}"
echo "上传到服务器后执行: systemctl restart agent-server"
