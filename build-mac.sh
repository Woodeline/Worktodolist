#!/bin/sh
# macOS 原生构建脚本
#
# 为什么需要它：仓库的 Tauri 配置是 Windows 专用的，直接 `npm run tauri:build`
# 在 macOS 上会失败。三处硬编码及本脚本的应对：
#
#   1. src-tauri/rust-toolchain.toml 钉在 stable-x86_64-pc-windows-msvc
#      → 用 RUSTUP_TOOLCHAIN 环境变量覆盖（rustup 中环境变量优先级高于工具链文件），
#        不改仓库里的文件，Windows 上的构建行为完全不受影响。
#   2. tauri.conf.json 的 bundle.targets = ["nsis"]、图标只有 .ico
#      → 由 src-tauri/tauri.macos.conf.json 覆盖为 app + icon.icns，
#        Tauri 2 在 macOS 上会自动合并这个平台配置。
#   3. 本机 sandbox 不允许写系统临时目录
#      → TMPDIR 指到项目内 .tmp（已 gitignore）。
#
# 用法：
#   sh build-mac.sh             # 只构建（前端 vite build + Rust release）
#   sh build-mac.sh --install   # 构建后覆盖安装到 /Applications 并重启
#   sh build-mac.sh --debug     # 调试构建，编译快很多
#
# 产物：todolist-gui/src-tauri/target/release/bundle/macos/Worktodolist.app

set -e

ROOT="$(cd "$(dirname "$0")" && pwd)"
GUI="$ROOT/todolist-gui"
NODE_BIN="/Users/wangzuocheng/.workbuddy/binaries/node/versions/22.22.2-6/bin"
APP="$GUI/src-tauri/target/release/bundle/macos/Worktodolist.app"
DEST="/Applications/Worktodolist.app"

INSTALL=0
if [ "$1" = "--install" ]; then
  INSTALL=1
  shift
fi

export PATH="$HOME/.cargo/bin:$NODE_BIN:$GUI/node_modules/.bin:$PATH"
export TMPDIR="$ROOT/.tmp"
export RUSTUP_TOOLCHAIN="stable-aarch64-apple-darwin"

mkdir -p "$TMPDIR"

if ! command -v cargo >/dev/null 2>&1; then
  echo "找不到 cargo，请先安装 Rust 工具链（rustup）" >&2
  exit 1
fi

cd "$GUI"
node node_modules/@tauri-apps/cli/tauri.js build "$@"

if [ "$INSTALL" = "1" ]; then
  echo ""
  echo "安装到 $DEST ..."
  # 优雅退出，让壳的关窗握手有机会把内存里的改动刷盘
  osascript -e 'quit app "Worktodolist"' 2>/dev/null || true
  sleep 2
  pkill -TERM -f "Worktodolist.app/Contents/MacOS/worktodolist" 2>/dev/null || true
  sleep 1
  # 只删这一个已知的 .app 包，删前确认路径形状，避免变量意外为空时误伤
  case "$DEST" in
    /Applications/*.app) rm -rf "$DEST" ;;
    *) echo "路径异常，拒绝删除：$DEST" >&2; exit 1 ;;
  esac
  ditto "$APP" "$DEST"
  echo "已安装：$DEST"
  open -a "$DEST"
fi
