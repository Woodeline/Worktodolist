//! Worktodolist · Tauri 2 桌面壳。
//!
//! 这一层取代的是原来「Python 启动器 + Node/vite 服务 + 浏览器」三件套：
//!   * 不再有端口：页面由 WebView 直接从内嵌资源加载，`tauri://localhost` 是固定来源。
//!     顺带解决了「端口变化导致 localStorage/IndexedDB 配置丢失」这个老问题。
//!   * 不再有 `--app` 模式的浏览器窗口，也不再有 pid 文件与孤儿 node 进程。
//!   * 单实例由插件负责，第二个实例只是把已有窗口提到前台——不再是「pid 残留误判」。
//!
//! 前端侧保持双模式：`isTauri()` 为真时走这里的命令，为假时走浏览器侧的 FSA。
//! 保留双模式不是为了「还要发浏览器版」，而是 `npm run dev` 与 vitest 需要一个浏览器
//! 环境；仓库已经不再提供独立的浏览器版启动器与打包链路。
//!
//! 托盘（桌面端）：点窗口的 X 只把窗口隐藏到通知区，不退出进程；左键点托盘图标唤回窗口，
//! 右键菜单里「退出」才真正结束。托盘图标在 `setup` 里**只创建一次**——通知区里出现多个
//! 图标，或图标闪烁，几乎都来自「重复 build / 反复 set_icon / 反复 set_visible」，
//! 这里三条都不做。

mod git;
mod reminder;
mod workspace;

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

use tauri::{Emitter, Manager, WindowEvent};
use workspace::Workspace;

/// 壳级运行状态。有两件事必须比「某一次关窗请求」活得更久：
///
///   * `quitting` —— 托盘菜单「退出」与 `app_quit` 都会先置真。它决定一次关窗收尾是
///     「隐藏到托盘」还是「真的退出」。
///   * `closing`  —— 一次关窗握手是否正在进行中。窗口是隐藏而不是销毁，用户完全可能在
///     握手期间连点几次 X；这里拦掉重复请求，避免同一份改动被刷盘多次。
#[derive(Default)]
pub struct ShellState {
    pub quitting: AtomicBool,
    pub closing: Mutex<bool>,
}

/// 托盘菜单里「窗口置顶」那一项的句柄。置顶状态可能从前端按钮或托盘菜单任一处改变，
/// 两处必须同步勾选态，所以把菜单项存进托管状态。
#[cfg(desktop)]
pub struct TrayMenuState {
    pub always_on_top: Mutex<Option<tauri::menu::CheckMenuItem<tauri::Wry>>>,
}

/// 关窗握手的收尾：要退出就 `exit`，否则隐藏到托盘。一次关窗周期只落地一次。
///
/// 「只落地一次」由 `closing` 保证：`app_confirm_close`（前端刷盘完）与 3 秒兜底线程
/// 都会调用它，先到的那次把 `closing` 置回 false，后到的那次直接返回。
fn complete_close(app: &tauri::AppHandle) {
    let state = app.state::<ShellState>();
    {
        let mut closing = state.closing.lock().unwrap_or_else(|e| e.into_inner());
        if !*closing {
            return; // 这次关窗已经收尾过了
        }
        *closing = false;
    }
    if state.quitting.load(Ordering::SeqCst) {
        app.exit(0);
    } else if let Some(win) = app.get_webview_window("main") {
        let _ = win.hide();
    }
}

/// 发起一次关窗握手：通知前端把 200ms 防抖窗口内的改动刷盘，再收尾。
/// 3 秒收不到回应就强制收尾，绝不让应用卡住（沿用旧的超时约定）。
fn begin_close(app: &tauri::AppHandle) {
    let state = app.state::<ShellState>();
    {
        let mut closing = state.closing.lock().unwrap_or_else(|e| e.into_inner());
        if *closing {
            return; // 已在握手中，忽略重复触发
        }
        *closing = true;
    }
    let _ = app.emit("shell://before-close", ());
    let handle = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_secs(3));
        complete_close(&handle);
    });
}

/// 前端刷盘完成后调用：执行收尾（隐藏到托盘或退出）。
#[tauri::command]
fn app_confirm_close(app: tauri::AppHandle) {
    complete_close(&app);
}

/// 直接退出应用（供菜单/快捷键使用）。先置退出标志，避免又被当成「关窗到托盘」。
#[tauri::command]
fn app_quit(app: tauri::AppHandle) {
    app.state::<ShellState>().quitting.store(true, Ordering::SeqCst);
    app.exit(0);
}

/// 恢复主窗口：显示、取消最小化、切到前台。托盘左键与单实例回调共用。
fn show_main_window(app: &tauri::AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.show();
        let _ = win.unminimize();
        let _ = win.set_focus();
    }
}

/// 应用「窗口置顶」：同步窗口、托盘菜单勾选态、以及前端按钮状态。唯一入口，
/// 因此三处状态不会各说各话。
fn apply_always_on_top(app: &tauri::AppHandle, enabled: bool) {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.set_always_on_top(enabled);
    }
    #[cfg(desktop)]
    if let Some(menu) = app.try_state::<TrayMenuState>() {
        if let Some(item) = menu
            .always_on_top
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .as_ref()
        {
            let _ = item.set_checked(enabled);
        }
    }
    let _ = app.emit("shell://always-on-top", enabled);
}

/// 前端设置「窗口置顶」。
#[tauri::command]
fn app_set_always_on_top(app: tauri::AppHandle, enabled: bool) {
    apply_always_on_top(&app, enabled);
}

/// 建托盘图标。**只在 `setup` 里调用一次**。
///
/// 关于「不要出现多个图标 / 闪烁」：通知区的重复图标来自重复创建托盘，闪烁则来自对
/// 同一个图标反复 `set_icon` / `set_visible`。这里只 build 一次，之后全程不动图标本身，
/// 菜单事件只去显示/隐藏**窗口**，不碰托盘图标，所以两条都不会发生。
#[cfg(desktop)]
fn setup_tray(app: &tauri::AppHandle) -> tauri::Result<()> {
    use tauri::menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem};
    use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};

    let show_item = MenuItem::with_id(app, "tray_show", "显示主窗口", true, None::<&str>)?;
    let top_item =
        CheckMenuItem::with_id(app, "tray_always_on_top", "窗口置顶", true, false, None::<&str>)?;
    let sep = PredefinedMenuItem::separator(app)?;
    let quit_item = MenuItem::with_id(app, "tray_quit", "退出", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show_item, &top_item, &sep, &quit_item])?;

    // 存下勾选项句柄，供「置顶」命令同步勾选态（托盘与前端按钮共用一个真相）
    app.manage(TrayMenuState {
        always_on_top: Mutex::new(Some(top_item.clone())),
    });

    let mut builder = TrayIconBuilder::with_id("worktodolist")
        .tooltip("待办清单 · todo.txt")
        .menu(&menu)
        // 左键直接唤回窗口，菜单只在右键弹出 —— 通知区里最符合直觉的分工
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "tray_show" => show_main_window(app),
            "tray_always_on_top" => {
                let next = app
                    .get_webview_window("main")
                    .and_then(|w| w.is_always_on_top().ok())
                    .map(|v| !v)
                    .unwrap_or(true);
                apply_always_on_top(app, next);
            }
            "tray_quit" => {
                // 先置退出标志，再走与关窗完全相同的刷盘握手：
                // 前端存盘后调用 app_confirm_close → complete_close 看到 quitting 就退出
                app.state::<ShellState>().quitting.store(true, Ordering::SeqCst);
                begin_close(app);
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main_window(tray.app_handle());
            }
        });

    // Windows 上默认窗口图标来自打包时嵌入的图标资源，正好是通知区要的那一个。
    if let Some(icon) = app.default_window_icon().cloned() {
        builder = builder.icon(icon);
    }

    builder.build(app)?;
    Ok(())
}

pub fn run() {
    // 计划任务用 `Worktodolist.exe --reminder` 拉起一个隐藏实例：算完提醒就退出。
    // 这样「应用没打开也会提醒」这条承诺不丢，而且不再依赖 Python。
    let headless_reminder = std::env::args().any(|a| a == "--reminder");

    let app = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            // 第二个实例：把已有窗口从托盘唤回前台（窗口可能正隐藏着）
            show_main_window(app);
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .manage(Workspace::default())
        .manage(ShellState::default())
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
            workspace::fs_save_as,
            git::git_autocommit,
            reminder::reminder_check,
            reminder::reminder_tick,
            reminder::notify,
            app_confirm_close,
            app_quit,
            app_set_always_on_top,
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
            // 正常启动才建托盘：`--reminder` 实例不该往通知区插一个图标
            #[cfg(desktop)]
            setup_tray(app.handle())?;
            // 窗口在配置里是隐藏的，这里显式显示，避免 headless 模式闪一下白窗
            if let Some(win) = app.get_webview_window("main") {
                let _ = win.show();
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                let app = window.app_handle().clone();
                if app.state::<ShellState>().quitting.load(Ordering::SeqCst) {
                    return; // 真正退出，放行关闭
                }
                // 点 X = 隐藏到托盘，不销毁窗口（销毁会连带结束进程）
                api.prevent_close();
                begin_close(&app);
            }
        })
        .build(tauri::generate_context!())
        .expect("Worktodolist 启动失败");

    app.run(|app_handle, event| {
        // macOS 专属：点 Dock 图标 / 再次双击 .app 时，LaunchServices 发现同 bundle id
        // 已有进程，**不会**拉起新实例，而是走 applicationShouldHandleReopen。
        // 不接这个事件，窗口 hide 到托盘后就永远唤不回来（点了没反应）。
        // Windows/Linux 走的是单实例插件那条路（第二个进程 → show_main_window）。
        #[cfg(target_os = "macos")]
        if let tauri::RunEvent::Reopen { .. } = event {
            show_main_window(app_handle);
        }
        #[cfg(not(target_os = "macos"))]
        let _ = (app_handle, event);
    });
}