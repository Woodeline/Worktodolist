#!/bin/sh
# macOS 启动脚本（浏览器模式）
#
# 用途：只起前端 dev server，在浏览器里用 File System Access API 读写你选的目录。
# 适合改前端时热重载 —— 不编译 Rust，秒起。
#
# 注意：不要拿它当「macOS 只能用浏览器模式」的依据。Tauri 桌面版在 macOS 上
# 是能构建的，见 build-mac.sh（用 RUSTUP_TOOLCHAIN 覆盖 rust-toolchain.toml
# 里写死的 Windows-MSVC 通道，再由 tauri.macos.conf.json 覆盖 bundle 目标）。
# 想要真桌面应用就跑：sh build-mac.sh --install
#
# 用法：sh start-mac.sh
# 停止：Ctrl+C

set -e

ROOT="$(cd "$(dirname "$0")" && pwd)"
GUI="$ROOT/todolist-gui"
NODE="/Users/wangzuocheng/.workbuddy/binaries/node/versions/22.22.2-6/bin/node"
PORT=15181

# 本机 sandbox 不允许写系统临时目录，把 TMPDIR 指到项目内（已 gitignore）
export TMPDIR="$GUI/.tmp"
mkdir -p "$TMPDIR"

if [ ! -x "$NODE" ]; then
  echo "找不到 Node 解释器：$NODE" >&2
  exit 1
fi

if [ ! -d "$GUI/node_modules/vite" ]; then
  echo "依赖未安装，请先在 $GUI 下执行：npm install --force" >&2
  exit 1
fi

cd "$GUI"
echo "启动待办清单（浏览器模式）→ http://localhost:$PORT"
exec "$NODE" node_modules/vite/bin/vite.js --port "$PORT" --strictPort
