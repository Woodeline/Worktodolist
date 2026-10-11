//! Worktodolist · Tauri 2 桌面壳。
//!
//! 这一层取代的是原来「Python 启动器 + Node/vite 服务 + 浏览器」三件套：
//!   * 不再有端口：页面由 WebView 直接从内嵌资源加载，`tauri://localhost` 是固定来源。
//!     顺带解决了「端口变化导致 localStorage/IndexedDB 配置丢失」这个老问题。
//!   * 不再有 `--app` 模式的浏览器窗口，也不再有 pid 文件与孤儿 node 进程。
//!   * 单实例由插件负责，第二个实例只是把已有窗口提到前台——不再是「pid 残留误判」。
//!
//! 前端侧保持双模式：`isTauri()` 为真时走这里的命令，为假时走浏览器侧的 FSA + AI 代理。
//! 保留双模式不是为了「还要发浏览器版」，而是 `npm run dev` 与 vitest 需要一个浏览器
//! 环境；仓库已经不再提供独立的浏览器版启动器与打包链路。

mod ai_proxy;
mod git;
mod reminder;
mod workspace;

use std::sync::Mutex;

use tauri::{Emitter, Manager, WindowEvent};
use workspace::Workspace;

/// 关闭窗口的确认闸门。
///
/// 关窗时前端可能还有 200ms 防抖窗口内没落盘的改动。浏览器版靠
/// `visibilitychange` / `pagehide` 兜住；WebView 里这两个事件的触发时机不保证，
/// 所以这里显式做一次握手：拦下第一次关闭请求 → 通知前端刷盘 → 前端调
/// `app_confirm_close` 才真正销毁。3 秒收不到回应就强制关闭，绝不让应用卡住。
#[derive(Default)]
pub struct CloseGuard(pub Mutex<bool>);

/// 前端刷盘完成后调用，真正关闭窗口。
#[tauri::command]
fn app_confirm_close(window: tauri::Window) {
    let _ = window.destroy();
}

/// 直接退出应用（供菜单/快捷键使用）。
#[tauri::command]
fn app_quit(app: tauri::AppHandle) {
    app.exit(0);
}

pub fn run() {
    // 计划任务用 `Worktodolist.exe --reminder` 拉起一个隐藏实例：算完提醒就退出。
    // 这样「应用没打开也会提醒」这条承诺不丢，而且不再依赖 Python。
    let headless_reminder = std::env::args().any(|a| a == "--reminder");

    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            if let Some(win) = app.get_webview_window("main") {
                let _ = win.show();
                let _ = win.unminimize();
                let _ = win.set_focus();
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .manage(Workspace::default())
        .manage(CloseGuard::default())
        .invoke_handler(tauri::generate_handler![
            workspace::ws_pick,
            workspace::ws_restore,
            workspace::ws_verify,
            workspace::ws_path,
            workspace::ws_get_git_on_save,
            workspace::ws_set_git_on_save,
            workspace::fs_read,
            workspace::fs_write,
            workspace::fs_backup,
            ai_proxy::ai_chat,
            git::git_autocommit,
            reminder::reminder_check,
            reminder::notify,
            app_confirm_close,
            app_quit,
        ])
        .setup(move |app| {
            if headless_reminder {
                let handle = app.handle().clone();
                std::thread::spawn(move || {
                    if let Some(dir) = workspace::saved_dir(&handle) {
                        // 失败也静默：提醒是增强，不该在后台任务里留下错误窗口
                        let _ = reminder::headless_reminder(&handle, &dir);
                    }
                    handle.exit(0);
                });
                return Ok(());
            }
            // 正常启动：窗口在配置里是隐藏的，这里显式显示，避免 headless 模式闪一下白窗
            if let Some(win) = app.get_webview_window("main") {
                let _ = win.show();
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                let guard = window.state::<CloseGuard>();
                let mut confirmed = guard.0.lock().unwrap_or_else(|e| e.into_inner());
                if !*confirmed {
                    *confirmed = true;
                    api.prevent_close();
                    let _ = window.emit("shell://before-close", ());
                    let win = window.clone();
                    std::thread::spawn(move || {
                        std::thread::sleep(std::time::Duration::from_secs(3));
                        let _ = win.destroy();
                    });
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("Worktodolist 启动失败");
}
