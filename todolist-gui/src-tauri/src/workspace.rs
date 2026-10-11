//! 工作区与数据文件层。
//!
//! 取代两样东西：
//!   1. 浏览器的 File System Access API（目录授权、目录句柄持久化、读写、每日备份）
//!   2. Python 启动器里的路径与进程约定（pid 文件 / 端口文件 / 目录反查）
//!
//! 三条设计约束（与既有实现保持语义一致，同时把之前落不了地的事做实）：
//!   * **原子写**：临时文件 + `fs::rename`。Rust 的 rename 在 Windows 上走
//!     `MOVEFILE_REPLACE_EXISTING`，可以直接覆盖已有文件——此前浏览器侧只能依赖
//!     Chromium 的 `createWritable()` 内部实现，现在是明确的、我们自己能保证的行为。
//!   * **进程内串行**：所有写入过一把 `Mutex`。原先 todo.txt 的保存与 session-*.ndjson
//!     的「读-改-写」是两条互不知情的异步链，靠时序侥幸不撞车。
//!   * **对外部编辑器只能"检测"，不能"上锁"**：记事本 / topydo 不会理会我们的锁。
//!     所以这里不假装能做排他锁——真正兜底的是原子写（不产生半个文件）+ 前端的
//!     内容比对冲突提示（useTodoStore 的 external change 分支）。这是唯一诚实的做法。

use std::fs::{self, File};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, State};
use tauri_plugin_dialog::DialogExt;

/// 全局工作区状态。放在 Tauri 的 managed state 里。
#[derive(Default)]
pub struct Workspace {
    /// 当前数据目录（放 todo.txt 的那个文件夹）。
    pub dir: Mutex<Option<PathBuf>>,
    /// 写入串行化闸门。注意：**只对本进程内的写入生效**，见文件头注释。
    pub write_lock: Mutex<()>,
}

#[derive(Serialize, Deserialize, Default)]
struct Prefs {
    /// 缺 key 时要能反序列化成功。否则一个只写了 git_commit_on_save 的旧文件
    /// （或手工编辑过的文件）会让整个解析失败，read_prefs 静默回落默认值 ——
    /// 表现就是"用户选的目录莫名其妙丢了"，而且完全没有痕迹。
    #[serde(default)]
    workspace: Option<String>,
    /// 是否在数据变更后由前端触发一次 git 提交（默认关，与既有行为一致）。
    #[serde(default)]
    git_commit_on_save: bool,
}

// ---------------------------------------------------------------------------
// 路径与偏好
// ---------------------------------------------------------------------------

fn prefs_file(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("取不到配置目录：{e}"))?;
    fs::create_dir_all(&dir).map_err(|e| format!("创建配置目录失败：{e}"))?;
    Ok(dir.join("workspace.json"))
}

fn read_prefs(app: &AppHandle) -> Prefs {
    prefs_file(app)
        .ok()
        .and_then(|p| fs::read_to_string(p).ok())
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn write_prefs(app: &AppHandle, prefs: &Prefs) -> Result<(), String> {
    let path = prefs_file(app)?;
    let text = serde_json::to_string_pretty(prefs).map_err(|e| e.to_string())?;
    atomic_write(&path, &text)
}

/// 锁定当前数据目录；未选择时报错（前端会据此回到欢迎页）。
fn current_dir(state: &Workspace) -> Result<PathBuf, String> {
    state
        .dir
        .lock()
        .map_err(|_| "工作区状态损坏".to_string())?
        .clone()
        .ok_or_else(|| "尚未选择数据目录".to_string())
}

/// 文件名白名单：只接受纯文件名，堵住 `..` / 路径分隔符穿越。
fn safe_name(name: &str) -> Result<&str, String> {
    let n = name.trim();
    if n.is_empty() || n.contains('/') || n.contains('\\') || n.contains("..") {
        return Err(format!("非法文件名：{name}"));
    }
    Ok(n)
}

fn is_iso_date(s: &str) -> bool {
    let b = s.as_bytes();
    b.len() == 10
        && b[4] == b'-'
        && b[7] == b'-'
        && b.iter().enumerate().all(|(i, c)| {
            if i == 4 || i == 7 {
                true
            } else {
                c.is_ascii_digit()
            }
        })
}

// ---------------------------------------------------------------------------
// 原子写
// ---------------------------------------------------------------------------

/// 临时文件 + rename 覆盖。任何一步失败都保证原文件仍是完整的旧内容。
pub fn atomic_write(path: &Path, text: &str) -> Result<(), String> {
    let dir = path.parent().ok_or_else(|| "非法路径".to_string())?;
    fs::create_dir_all(dir).map_err(|e| format!("创建目录失败：{e}"))?;
    let name = path
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("data");
    let tmp = dir.join(format!(".{}.{}.tmp", name, std::process::id()));
    {
        let mut f = File::create(&tmp).map_err(|e| format!("创建临时文件失败：{e}"))?;
        f.write_all(text.as_bytes())
            .map_err(|e| format!("写入临时文件失败：{e}"))?;
        f.sync_all().map_err(|e| format!("落盘失败：{e}"))?;
    }
    fs::rename(&tmp, path).map_err(|e| {
        let _ = fs::remove_file(&tmp);
        format!("替换目标文件失败：{e}")
    })
}

// ---------------------------------------------------------------------------
// 命令：工作区
// ---------------------------------------------------------------------------

/// 弹出目录选择框。返回选中的路径；用户取消时返回 None
/// （前端据此判定"用户放弃"，不当作错误）。
#[tauri::command]
pub async fn ws_pick(app: AppHandle, state: State<'_, Workspace>) -> Result<Option<String>, String> {
    let picked = app
        .dialog()
        .file()
        .set_title("选择数据目录（存放 todo.txt 的文件夹）")
        .blocking_pick_folder();

    let Some(file_path) = picked else {
        return Ok(None);
    };
    let dir = PathBuf::from(file_path.to_string());
    if !dir.is_dir() {
        return Err("选中的不是一个文件夹".to_string());
    }

    {
        let mut slot = state
            .dir
            .lock()
            .map_err(|_| "工作区状态损坏".to_string())?;
        *slot = Some(dir.clone());
    }
    write_prefs(
        &app,
        &Prefs {
            workspace: Some(dir.to_string_lossy().to_string()),
            git_commit_on_save: read_prefs(&app).git_commit_on_save,
        },
    )?;
    Ok(Some(dir.to_string_lossy().to_string()))
}

/// 只读地取出上次保存的数据目录（不依赖 managed state，供 `--reminder` 隐藏实例使用）。
pub fn saved_dir(app: &AppHandle) -> Option<PathBuf> {
    let saved = read_prefs(app).workspace?;
    let dir = PathBuf::from(saved);
    if dir.is_dir() {
        Some(dir)
    } else {
        None
    }
}

/// 启动时恢复上次选定的数据目录。目录已被删/改名时返回 None。
#[tauri::command]
pub fn ws_restore(app: AppHandle, state: State<'_, Workspace>) -> Option<String> {
    let dir = saved_dir(&app)?;
    if let Ok(mut slot) = state.dir.lock() {
        *slot = Some(dir.clone());
    }
    Some(dir.to_string_lossy().to_string())
}

/// 目录是否仍然可用且可写。等价于浏览器里的 queryPermission。
#[tauri::command]
pub fn ws_verify(state: State<'_, Workspace>) -> bool {
    let Ok(dir) = current_dir(&state) else {
        return false;
    };
    let probe = dir.join(format!(".todolist-write-probe-{}", std::process::id()));
    match File::create(&probe) {
        Ok(_) => {
            let _ = fs::remove_file(&probe);
            true
        }
        Err(_) => false,
    }
}

#[tauri::command]
pub fn ws_path(state: State<'_, Workspace>) -> Option<String> {
    current_dir(&state)
        .ok()
        .map(|p| p.to_string_lossy().to_string())
}

/// 是否开启"保存后自动 git 提交"。
#[tauri::command]
pub fn ws_get_git_on_save(app: AppHandle) -> bool {
    read_prefs(&app).git_commit_on_save
}

#[tauri::command]
pub fn ws_set_git_on_save(app: AppHandle, enabled: bool) -> Result<(), String> {
    let mut prefs = read_prefs(&app);
    prefs.git_commit_on_save = enabled;
    write_prefs(&app, &prefs)
}

// ---------------------------------------------------------------------------
// 命令：数据文件
// ---------------------------------------------------------------------------

/// 读文本文件；文件不存在返回空串（与浏览器侧 readFileText 的语义一致）。
#[tauri::command]
pub fn fs_read(state: State<'_, Workspace>, name: String) -> Result<String, String> {
    let name = safe_name(&name)?;
    let dir = current_dir(&state)?;
    match fs::read_to_string(dir.join(name)) {
        Ok(text) => Ok(text),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(String::new()),
        Err(e) => Err(format!("读取 {name} 失败：{e}")),
    }
}

/// 写入文本文件（原子写 + 进程内串行）。
#[tauri::command]
pub fn fs_write(state: State<'_, Workspace>, name: String, text: String) -> Result<(), String> {
    let name = safe_name(&name)?;
    let dir = current_dir(&state)?;
    let _gate = state
        .write_lock
        .lock()
        .map_err(|_| "写入闸门损坏".to_string())?;
    atomic_write(&dir.join(name), &text)
}

/// 当日首次调用时把 todo.txt 复制到 backup/todo-YYYY-MM-DD.txt，并保留最近 30 份。
/// 返回是否真的新建了一份（与浏览器侧 ensureDailyBackup 一致）。
#[tauri::command]
pub fn fs_backup(state: State<'_, Workspace>, today: String) -> Result<bool, String> {
    if !is_iso_date(&today) {
        return Err(format!("非法日期：{today}"));
    }
    let dir = current_dir(&state)?;
    let backup_dir = dir.join("backup");
    fs::create_dir_all(&backup_dir).map_err(|e| format!("创建 backup 目录失败：{e}"))?;

    let target = backup_dir.join(format!("todo-{today}.txt"));
    if target.exists() {
        return Ok(false);
    }
    let source = fs::read_to_string(dir.join("todo.txt")).unwrap_or_default();
    {
        let _gate = state
            .write_lock
            .lock()
            .map_err(|_| "写入闸门损坏".to_string())?;
        atomic_write(&target, &source)?;
    }
    prune_backups(&backup_dir, 30)?;
    Ok(true)
}

/// 备份文件名必须严格是 `todo-YYYY-MM-DD.txt`。
/// 与浏览器版 `pruneBackups` 里的正则 `^todo-\d{4}-\d{2}-\d{2}\.txt$` 逐字对齐 ——
/// 光比长度会把 `todo-abcdefgh-1.txt` 也算进来，那就不是"完全不变"了。
fn is_backup_name(name: &str) -> bool {
    name.starts_with("todo-")
        && name.ends_with(".txt")
        && name.len() == 18
        // get 而不是 [4..14]：先切片后校验会在非法 UTF-8 边界上 panic
        && name.get(4..14).is_some_and(is_iso_date)
}

fn prune_backups(dir: &Path, keep: usize) -> Result<(), String> {
    let mut names: Vec<String> = Vec::new();
    let entries = match fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return Ok(()),
    };
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        if is_backup_name(&name) {
            names.push(name);
        }
    }
    names.sort();
    while names.len() > keep {
        let oldest = names.remove(0);
        // 逐个删除；失败即停，不动其余文件
        if fs::remove_file(dir.join(&oldest)).is_err() {
            break;
        }
    }
    Ok(())
}
