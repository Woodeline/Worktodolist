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
    atomic_write(&path, text.as_bytes())
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

/// 数据文件白名单：`fs_read` / `fs_write` 只认前端实际读写的这几个名字。
/// 比 safe_name 的防穿越更严一层 —— Windows 上 `C:foo` 是盘符相对路径，
/// `Path::join` 会替换掉目录前缀，光挡分隔符不够。导出（fs_save_as）的
/// 文件名由用户起，仍走 safe_name，不受此白名单约束。
fn data_file_name(name: &str) -> Result<&str, String> {
    let n = safe_name(name)?;
    let is_session_log = n.starts_with("session-")
        && n.ends_with(".ndjson")
        && n.len() == 25 // "session-" + YYYY-MM-DD + ".ndjson"
        && is_iso_date(&n[8..18]);
    if matches!(n, "todo.txt" | "done.txt" | "notes.md") || is_session_log {
        Ok(n)
    } else {
        Err(format!("非法数据文件名：{name}"))
    }
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

fn is_iso_month(s: &str) -> bool {
    let b = s.as_bytes();
    b.len() == 7
        && b[4] == b'-'
        && b.iter().enumerate().all(|(i, c)| {
            if i == 4 {
                true
            } else {
                c.is_ascii_digit()
            }
        })
}

/// 日会话文件（旧布局）：`session-YYYY-MM-DD.ndjson`。
fn is_daily_session_name(n: &str) -> bool {
    n.starts_with("session-")
        && n.ends_with(".ndjson")
        && n.len() == 25
        && is_iso_date(&n[8..18])
}

/// 月会话文件（新布局）：`session-YYYY-MM.ndjson`。
fn is_monthly_session_name(n: &str) -> bool {
    n.starts_with("session-")
        && n.ends_with(".ndjson")
        && n.len() == 22
        && is_iso_month(&n[8..15])
}

/// YYYY-MM 往前推 n 个月。只做年月进位，足以给保留窗口算截止月。
fn months_before(month: &str, n: i32) -> Option<String> {
    if !is_iso_month(month) {
        return None;
    }
    let y: i32 = month[0..4].parse().ok()?;
    let m: i32 = month[5..7].parse().ok()?;
    if !(1..=12).contains(&m) {
        return None;
    }
    let total = y * 12 + (m - 1) - n;
    Some(format!("{:04}-{:02}", total.div_euclid(12), total.rem_euclid(12) + 1))
}

/// 所有运行态都收在这个隐藏目录：根目录只留 todo.txt / done.txt / notes.md。
pub(crate) const STATE_DIR: &str = ".worktodolist";

pub(crate) fn state_dir(root: &Path) -> PathBuf {
    root.join(STATE_DIR)
}

pub(crate) fn ensure_state_dirs(root: &Path) -> Result<PathBuf, String> {
    let base = state_dir(root);
    for sub in ["backup", "sessions", "sessions/legacy", "logs"] {
        fs::create_dir_all(base.join(sub))
            .map_err(|e| format!("创建运行态目录失败（{sub}）：{e}"))?;
    }
    Ok(base)
}

/// 失败留痕有上限：超过 64 KB 只保留最后约一半，避免两个点文件无线增长。
pub(crate) fn append_capped_log(path: &Path, line: &str) {
    const MAX: u64 = 64 * 1024;
    if let Some(dir) = path.parent() {
        let _ = fs::create_dir_all(dir);
    }
    let mut text = fs::read_to_string(path).unwrap_or_default();
    text.push_str(line.trim_end());
    text.push('\n');
    if text.len() as u64 > MAX {
        let keep = (MAX / 2) as usize;
        let cut = text.len().saturating_sub(keep);
        let boundary = text[cut..].find('\n').map(|i| cut + i + 1).unwrap_or(cut);
        text = text[boundary..].to_string();
    }
    let tmp = path.with_extension("log.tmp");
    if fs::write(&tmp, text).is_ok() {
        let _ = fs::rename(&tmp, path);
    }
}

/// 会话日志保留窗口：月文件只留最近 12 个月；旧布局的日文件按所属月同样处理。
fn prune_sessions(base: &Path, today: &str) -> Result<(), String> {
    let Some(cutoff) = today
        .get(0..7)
        .filter(|m| is_iso_month(m))
        .and_then(|m| months_before(m, 11))
    else {
        return Ok(());
    };
    let sessions = base.join("sessions");
    if let Ok(entries) = fs::read_dir(&sessions) {
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            let month = if is_monthly_session_name(&name) {
                &name[8..15]
            } else {
                continue;
            };
            if month < cutoff.as_str() {
                let _ = fs::remove_file(entry.path());
            }
        }
    }
    let legacy = sessions.join("legacy");
    if let Ok(entries) = fs::read_dir(&legacy) {
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            if !is_daily_session_name(&name) {
                continue;
            }
            if &name[8..15] < cutoff.as_str() {
                let _ = fs::remove_file(entry.path());
            }
        }
    }
    Ok(())
}

fn dir_usage(path: &Path) -> (u64, u64) {
    let mut files = 0u64;
    let mut bytes = 0u64;
    if let Ok(entries) = fs::read_dir(path) {
        for entry in entries.flatten() {
            if let Ok(meta) = entry.metadata() {
                if meta.is_file() {
                    files += 1;
                    bytes += meta.len();
                }
            }
        }
    }
    (files, bytes)
}

#[derive(Serialize)]
pub struct Usage {
    pub backup_files: u64,
    pub backup_bytes: u64,
    pub session_files: u64,
    pub session_bytes: u64,
    pub log_bytes: u64,
    pub total_bytes: u64,
}

fn usage_of(base: &Path) -> Usage {
    let (backup_files, backup_bytes) = dir_usage(&base.join("backup"));
    let (mut session_files, mut session_bytes) = dir_usage(&base.join("sessions"));
    let (legacy_files, legacy_bytes) = dir_usage(&base.join("sessions").join("legacy"));
    session_files += legacy_files;
    session_bytes += legacy_bytes;
    let (_, log_bytes) = dir_usage(&base.join("logs"));
    Usage {
        backup_files,
        backup_bytes,
        session_files,
        session_bytes,
        log_bytes,
        total_bytes: backup_bytes + session_bytes + log_bytes,
    }
}

/// 一次性迁移：旧根目录里的备份 / 日会话 / 提醒状态 / 失败日志搬进 `.worktodolist/`。
/// 只认本程序生成的文件名；`backup/` 里认不出的文件原地不动，旧目录空了才删。
/// 幂等：目标已存在时保留源文件，下次启动再试，不会覆盖或丢内容。
fn migrate_state(root: &Path) -> Result<(), String> {
    let base = ensure_state_dirs(root)?;

    let old_backup = root.join("backup");
    if old_backup.is_dir() {
        if let Ok(entries) = fs::read_dir(&old_backup) {
            for entry in entries.flatten() {
                let name = entry.file_name().to_string_lossy().to_string();
                if backup_family(&name).is_none() {
                    continue; // 用户自己的文件，绝不碰
                }
                let target = base.join("backup").join(&name);
                if !target.exists() {
                    let _ = fs::rename(entry.path(), &target);
                }
            }
        }
        if fs::read_dir(&old_backup)
            .map(|mut it| it.next().is_none())
            .unwrap_or(false)
        {
            let _ = fs::remove_dir(&old_backup);
        }
    }

    let legacy = base.join("sessions").join("legacy");
    if let Ok(entries) = fs::read_dir(root) {
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            if !is_daily_session_name(&name) {
                continue;
            }
            let target = legacy.join(&name);
            if !target.exists() {
                let _ = fs::rename(entry.path(), &target);
            }
        }
    }

    let old_fired = root.join(".todolist-remind-fired.txt");
    if old_fired.is_file() {
        let new_fired = base.join("remind-fired.txt");
        let mut keys: Vec<String> = fs::read_to_string(&old_fired)
            .unwrap_or_default()
            .lines()
            .map(|l| l.trim().to_string())
            .filter(|l| !l.is_empty())
            .collect();
        if let Ok(text) = fs::read_to_string(&new_fired) {
            keys.extend(text.lines().map(|l| l.trim().to_string()).filter(|l| !l.is_empty()));
        }
        keys.sort();
        keys.dedup();
        let start = keys.len().saturating_sub(1000);
        let body = keys[start..].join("\n");
        let body = if body.is_empty() { String::new() } else { format!("{body}\n") };
        if fs::write(&new_fired, body).is_ok() {
            let _ = fs::remove_file(&old_fired);
        }
    }

    for (old, new) in [
        (".todolist-backup.log", "backup.log"),
        (".todolist-launch.log", "launch.log"),
    ] {
        let source = root.join(old);
        if !source.is_file() {
            continue;
        }
        let target = base.join("logs").join(new);
        if let Ok(text) = fs::read_to_string(&source) {
            for line in text.lines() {
                append_capped_log(&target, line);
            }
            let _ = fs::remove_file(&source);
        }
    }

    Ok(())
}

// ---------------------------------------------------------------------------
// 原子写
// ---------------------------------------------------------------------------

/// 临时文件 + rename 覆盖。任何一步失败都保证原文件仍是完整的旧内容。
/// 收 `&[u8]` 而不是 `&str`：同一份逻辑要同时服务 todo.txt（文本）与导出的
/// xlsx/PNG（二进制），没必要为了字节再抄一遍 tmp+rename。
pub fn atomic_write(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let dir = path.parent().ok_or_else(|| "非法路径".to_string())?;
    fs::create_dir_all(dir).map_err(|e| format!("创建目录失败：{e}"))?;
    let name = path
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("data");
    let tmp = dir.join(format!(".{}.{}.tmp", name, std::process::id()));
    {
        let mut f = File::create(&tmp).map_err(|e| format!("创建临时文件失败：{e}"))?;
        f.write_all(bytes)
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
    // 旧布局（根目录 backup/、session-YYYY-MM-DD.ndjson）一次性收进 .worktodolist/。
    // 失败不阻塞打开：下次启动还会再试。
    let _ = migrate_state(&dir);
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
    // 启动即迁移；旧文件只在第一次成功后消失，幂等。
    let _ = migrate_state(&dir);
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
    let name = data_file_name(&name)?;
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
    let name = data_file_name(&name)?;
    let dir = current_dir(&state)?;
    let _gate = state
        .write_lock
        .lock()
        .map_err(|_| "写入闸门损坏".to_string())?;
    atomic_write(&dir.join(name), text.as_bytes())
}

/// 当日首次调用时把 todo.txt 复制到 backup/todo-YYYY-MM-DD.txt、notes.md 复制到
/// backup/notes-YYYY-MM-DD.md，两个家族各自保留最近 30 份。notes.md 不存在或为空
/// 则跳过该家族（空内容的每日备份没有意义，只会给 backup/ 塞空文件）。
/// 返回是否真的新建了至少一份（与浏览器侧 ensureDailyBackup 一致）。
#[tauri::command]
pub fn fs_backup(state: State<'_, Workspace>, today: String) -> Result<bool, String> {
    if !is_iso_date(&today) {
        return Err(format!("非法日期：{today}"));
    }
    let dir = current_dir(&state)?;
    let base = ensure_state_dirs(&dir)?;
    let backup_dir = base.join("backup");

    let mut created = false;
    {
        let _gate = state
            .write_lock
            .lock()
            .map_err(|_| "写入闸门损坏".to_string())?;
        // 两个家族独立判断「今天是否已有」：中午新建的 notes.md 不能因为早上
        // 已经备过 todo.txt 就错过当天的唯一备份窗口（反过来同理）。
        let todo_target = backup_dir.join(format!("todo-{today}.txt"));
        if !todo_target.exists() {
            let source = fs::read_to_string(dir.join("todo.txt")).unwrap_or_default();
            atomic_write(&todo_target, source.as_bytes())?;
            created = true;
        }
        let notes_target = backup_dir.join(format!("notes-{today}.md"));
        if !notes_target.exists() {
            let notes = fs::read_to_string(dir.join("notes.md")).unwrap_or_default();
            if !notes.is_empty() {
                atomic_write(&notes_target, notes.as_bytes())?;
                created = true;
            }
        }
    }
    prune_backups(&backup_dir, 30)?;
    prune_sessions(&base, &today)?;
    Ok(created)
}

/// 读当月会话日志（新布局：`.worktodolist/sessions/session-YYYY-MM.ndjson`）。
#[tauri::command]
pub fn fs_read_session(state: State<'_, Workspace>, month: String) -> Result<String, String> {
    if !is_iso_month(&month) {
        return Err(format!("非法月份：{month}"));
    }
    let dir = current_dir(&state)?;
    let path = state_dir(&dir)
        .join("sessions")
        .join(format!("session-{month}.ndjson"));
    match fs::read_to_string(path) {
        Ok(text) => Ok(text),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(String::new()),
        Err(e) => Err(format!("读取会话日志失败：{e}")),
    }
}

/// 写当月会话日志（原子写 + 进程内串行）。首次创建某个月的文件时顺手清理过期月份。
#[tauri::command]
pub fn fs_write_session(
    state: State<'_, Workspace>,
    month: String,
    text: String,
) -> Result<(), String> {
    if !is_iso_month(&month) {
        return Err(format!("非法月份：{month}"));
    }
    let dir = current_dir(&state)?;
    let base = ensure_state_dirs(&dir)?;
    let path = base
        .join("sessions")
        .join(format!("session-{month}.ndjson"));
    let existed = path.exists();
    {
        let _gate = state
            .write_lock
            .lock()
            .map_err(|_| "写入闸门损坏".to_string())?;
        atomic_write(&path, text.as_bytes())?;
    }
    if !existed {
        prune_sessions(&base, &format!("{month}-01"))?;
    }
    Ok(())
}

/// 运行态占用读数：备份 / 会话 / 日志各多少文件、多少字节。
#[tauri::command]
pub fn fs_usage(state: State<'_, Workspace>) -> Result<Usage, String> {
    let dir = current_dir(&state)?;
    Ok(usage_of(&state_dir(&dir)))
}

/// 弹出原生「另存为」对话框，把字节写到用户选定的位置。
///
/// 与 `ws_pick` 共用同一套约定：**用户取消返回 `Ok(false)`**，不算错误（前端据此
/// 静默收场，而不是弹一个"导出失败"）。默认文件名与过滤器都从 `name` 的扩展名推出来
/// —— 调用方只要给个像样的名字（`RTI工具数据-20261017-1500.xlsx`），就能得到
/// "Excel 工作簿 (*.xlsx)" 这样的对话框。走 Rust 侧的 dialog 插件（同 `ws_pick`），
/// 因此不经过前端 ACL，capabilities 不必新增条目。
#[tauri::command]
pub async fn fs_save_as(app: AppHandle, name: String, data: Vec<u8>) -> Result<bool, String> {
    let name = safe_name(&name)?;
    let ext = Path::new(name)
        .extension()
        .and_then(|s| s.to_str())
        .map(|s| s.to_ascii_lowercase())
        .unwrap_or_default();
    let label = match ext.as_str() {
        "xlsx" => "Excel 工作簿",
        "csv" => "CSV 表格",
        "png" => "PNG 图片",
        _ => "文件",
    };

    let mut builder = app.dialog().file().set_title("另存为").set_file_name(name);
    if !ext.is_empty() {
        builder = builder.add_filter(label, &[ext.as_str()]);
    }
    let Some(chosen) = builder.blocking_save_file() else {
        return Ok(false);
    };

    let path = chosen.to_string();
    atomic_write(Path::new(&path), &data)?;
    Ok(true)
}

/// 备份文件名按数据文件分两个家族：`todo-YYYY-MM-DD.txt`（序号 0）与
/// `notes-YYYY-MM-DD.md`（序号 1）。与浏览器版 `pruneBackups` 里的正则逐字对齐 ——
/// 光比长度会把 `todo-abcdefgh-1.txt` 也算进来，那就不是"完全不变"了。
/// 返回家族序号；prune 时每个家族独立保留 keep 份，互不挤占。
fn backup_family(name: &str) -> Option<usize> {
    const FAMILIES: [(&str, &str); 2] = [("todo-", ".txt"), ("notes-", ".md")];
    for (slot, (prefix, ext)) in FAMILIES.iter().enumerate() {
        if name.starts_with(prefix)
            && name.ends_with(ext)
            && name.len() == prefix.len() + 10 + ext.len()
            // get 而不是 [a..b]：先切片后校验会在非法 UTF-8 边界上 panic
            && name.get(prefix.len()..prefix.len() + 10).is_some_and(is_iso_date)
        {
            return Some(slot);
        }
    }
    None
}

fn prune_backups(dir: &Path, keep: usize) -> Result<(), String> {
    let mut families: [Vec<String>; 2] = [Vec::new(), Vec::new()];
    let entries = match fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return Ok(()),
    };
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        if let Some(slot) = backup_family(&name) {
            families[slot].push(name);
        }
    }
    for names in &mut families {
        names.sort();
        while names.len() > keep {
            let oldest = names.remove(0);
            // 逐个删除，删不掉就跳过继续：单个文件被占用（杀软扫描 / 编辑器打开）
            // 不该让后面所有过期备份都留下来——那等于"保留 30 份"的承诺只兑现一次。
            if fs::remove_file(dir.join(&oldest)).is_err() {
                log_prune_failure(dir, &oldest);
            }
        }
    }
    Ok(())
}

/// 清理失败留痕。与 git.rs 的失败日志同一套思路：静默降级但留证据，
/// 写在 `.worktodolist/logs/` 下而不是 stdout（用户是从桌面图标启动的，没有控制台）。
fn log_prune_failure(dir: &Path, name: &str) {
    append_capped_log(
        &state_dir(dir).join("logs").join("backup.log"),
        &format!("[prune] 删除失败：{name}"),
    );
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn backup_family_只认两个家族的严格全名() {
        assert_eq!(backup_family("todo-2026-10-24.txt"), Some(0));
        assert_eq!(backup_family("notes-2026-10-24.md"), Some(1));
        // 这些名字若被误认成备份，prune 就会删掉用户文件 —— 必须全部拒绝
        assert_eq!(backup_family("todo-abcdefgh-1.txt"), None);
        assert_eq!(backup_family("todo-2026-10-24.txt.bak"), None);
        assert_eq!(backup_family("notes.md"), None);
        assert_eq!(backup_family("notes-2026-10-24.md.orig"), None);
        // 日期段是形状校验（与浏览器正则同一口径，不校历法）：非数字才算非法，
        // "2026-13-99" 这种形状合规的名字两侧都放行 —— 备份名只由本程序生成，无碍。
        assert_eq!(backup_family("todo-2026-1a-99.txt"), None);
    }

    #[test]
    fn data_file_name_只认白名单() {
        for ok in ["todo.txt", "done.txt", "notes.md", "session-2026-11-15.ndjson"] {
            assert!(data_file_name(ok).is_ok(), "{ok} 应放行");
        }
        // 穿越 / 盘符相对路径 / 旁系名字一律拒绝
        for bad in [
            "../todo.txt",
            "C:todo.txt",
            "todo.txt.bak",
            "prefs.json",
            "session-2026-11-15.ndjson.exe",
            "session-2026-1a-99.ndjson",
            "session-.ndjson",
            "",
        ] {
            assert!(data_file_name(bad).is_err(), "{bad} 应拒绝");
        }
    }

    #[test]
    fn prune_每个家族独立保留_keep_份() {
        let dir = std::env::temp_dir().join(format!("ws-prune-{}-{}", std::process::id(), line!()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        for d in ["2026-10-01", "2026-10-02", "2026-10-03"] {
            fs::write(dir.join(format!("todo-{d}.txt")), "").unwrap();
            fs::write(dir.join(format!("notes-{d}.md")), "x").unwrap();
        }
        // 不属于任何家族的文件绝不能动
        fs::write(dir.join("todo.txt"), "").unwrap();
        fs::write(dir.join("readme.txt"), "").unwrap();

        prune_backups(&dir, 2).unwrap();

        let mut left: Vec<String> = fs::read_dir(&dir)
            .unwrap()
            .flatten()
            .map(|e| e.file_name().to_string_lossy().to_string())
            .collect();
        left.sort();
        assert_eq!(
            left,
            vec![
                "notes-2026-10-02.md".to_string(),
                "notes-2026-10-03.md".to_string(),
                "readme.txt".to_string(),
                "todo-2026-10-02.txt".to_string(),
                "todo-2026-10-03.txt".to_string(),
                "todo.txt".to_string(),
            ]
        );
        let _ = fs::remove_dir_all(&dir);
    }

    fn temp_root(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("ws-{tag}-{}-{}", std::process::id(), line!()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn 月份推进与保留窗口() {
        assert_eq!(months_before("2026-11", 11).as_deref(), Some("2025-12"));
        assert_eq!(months_before("2026-01", 1).as_deref(), Some("2025-12"));
        assert_eq!(months_before("2026-13", 1), None);
        assert!(is_monthly_session_name("session-2026-11.ndjson"));
        assert!(!is_monthly_session_name("session-2026-11-20.ndjson"));
        assert!(is_daily_session_name("session-2026-11-20.ndjson"));
    }

    #[test]
    fn 会话日志按月保留_12_个月_旧日文件也按月份清理() {
        let root = temp_root("sessions-prune");
        let base = ensure_state_dirs(&root).unwrap();
        for m in ["2025-10", "2025-11", "2025-12", "2026-11"] {
            fs::write(base.join("sessions").join(format!("session-{m}.ndjson")), "").unwrap();
        }
        for d in ["2025-11-01", "2026-11-01"] {
            fs::write(
                base.join("sessions").join("legacy").join(format!("session-{d}.ndjson")),
                "",
            )
            .unwrap();
        }
        // keep 12 个月：以 2026-11 为当前月，截止 2025-12
        prune_sessions(&base, "2026-11-23").unwrap();
        let mut names: Vec<String> = fs::read_dir(base.join("sessions"))
            .unwrap()
            .flatten()
            .filter(|e| e.path().is_file())
            .map(|e| e.file_name().to_string_lossy().to_string())
            .collect();
        names.sort();
        assert_eq!(
            names,
            vec!["session-2025-12.ndjson".to_string(), "session-2026-11.ndjson".to_string()]
        );
        let legacy: Vec<String> = fs::read_dir(base.join("sessions").join("legacy"))
            .unwrap()
            .flatten()
            .map(|e| e.file_name().to_string_lossy().to_string())
            .collect();
        assert_eq!(legacy, vec!["session-2026-11-01.ndjson".to_string()]);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn 迁移把旧运行态收进隐藏目录且不碰用户文件() {
        let root = temp_root("migrate");
        fs::write(root.join("todo.txt"), "任务\n").unwrap();
        fs::write(root.join("done.txt"), "").unwrap();
        fs::write(root.join("notes.md"), "备注\n").unwrap();
        fs::create_dir_all(root.join("backup")).unwrap();
        fs::write(root.join("backup").join("todo-2026-10-01.txt"), "旧备份\n").unwrap();
        fs::write(root.join("backup").join("notes-2026-10-01.md"), "旧备注\n").unwrap();
        fs::write(root.join("backup").join("my-own-file.txt"), "别动我\n").unwrap();
        fs::write(root.join("session-2026-10-01.ndjson"), "{}\n").unwrap();
        fs::write(root.join(".todolist-remind-fired.txt"), "aaa|2026-10-01T09:00\n").unwrap();
        fs::write(root.join(".todolist-launch.log"), "[autocommit] boom\n").unwrap();

        migrate_state(&root).unwrap();

        let base = state_dir(&root);
        assert!(base.join("backup").join("todo-2026-10-01.txt").is_file());
        assert!(base.join("backup").join("notes-2026-10-01.md").is_file());
        assert!(!root.join("backup").join("todo-2026-10-01.txt").exists());
        // 用户自己的文件留在旧 backup/，旧目录因此不删
        assert!(root.join("backup").join("my-own-file.txt").is_file());
        assert!(base.join("sessions").join("legacy").join("session-2026-10-01.ndjson").is_file());
        assert!(!root.join("session-2026-10-01.ndjson").exists());
        assert!(base.join("remind-fired.txt").is_file());
        assert!(!root.join(".todolist-remind-fired.txt").exists());
        assert!(base.join("logs").join("launch.log").is_file());
        assert!(!root.join(".todolist-launch.log").exists());
        // 根目录只剩事实文件 + 隐藏目录 + 用户自己的旧 backup/
        let mut root_names: Vec<String> = fs::read_dir(&root)
            .unwrap()
            .flatten()
            .map(|e| e.file_name().to_string_lossy().to_string())
            .collect();
        root_names.sort();
        assert_eq!(
            root_names,
            vec![".worktodolist", "backup", "done.txt", "notes.md", "todo.txt"]
        );
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn 占用读数只数运行态文件() {
        let root = temp_root("usage");
        let base = ensure_state_dirs(&root).unwrap();
        fs::write(base.join("backup").join("todo-2026-10-01.txt"), "1234").unwrap();
        fs::write(base.join("sessions").join("session-2026-10.ndjson"), "12").unwrap();
        fs::write(base.join("sessions").join("legacy").join("session-2026-09-01.ndjson"), "1").unwrap();
        fs::write(base.join("logs").join("launch.log"), "123").unwrap();
        let usage = usage_of(&base);
        assert_eq!(usage.backup_files, 1);
        assert_eq!(usage.backup_bytes, 4);
        assert_eq!(usage.session_files, 2);
        assert_eq!(usage.session_bytes, 3);
        assert_eq!(usage.log_bytes, 3);
        assert_eq!(usage.total_bytes, 10);
        let _ = fs::remove_dir_all(&root);
    }
}
