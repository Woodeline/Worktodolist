//! git 自动提交：把旧 `scripts/git_autocommit.py` 的能力搬进壳里（该脚本已随之移除）。
//!
//! 语义与 Python 版逐条对齐：只 add 数据路径（todo.txt / done.txt / backup），
//! 绝不碰代码；没有 git、不是仓库、没有变更、提交失败——一律**静默降级**，
//! 因为 git 化是增强而不是依赖。

use std::fs;
use std::io::Write;
use std::path::Path;
use std::process::{Command, Output};

use serde::Serialize;
use tauri::State;

use crate::workspace::Workspace;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// 提交范围：与 Python 版的 DATA_PATHS 完全一致。
const DATA_PATHS: [&str; 3] = ["todo.txt", "done.txt", "backup"];

#[derive(Serialize)]
pub struct CommitReport {
    /// git-missing | not-a-repo | no-change | committed | failed
    pub status: String,
    pub detail: String,
}

fn run_git(root: &Path, args: &[&str]) -> Option<Output> {
    let mut cmd = Command::new("git");
    cmd.args(args)
        .current_dir(root)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // 无控制台环境（pythonw / 计划任务）下不起黑窗
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd.output().ok()
}

fn report(status: &str, detail: impl Into<String>) -> CommitReport {
    CommitReport {
        status: status.to_string(),
        detail: detail.into(),
    }
}

/// 提交失败时留痕。与旧 `scripts/git_autocommit.py` 写 `.todolist-launch.log` 的行为对齐 ——
/// 迁移前"git 身份没配置"这件事是有痕迹的，不能因为换了实现就悄悄丢掉。
fn log_failure(root: &Path, detail: &str) {
    if let Ok(mut fh) = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(root.join(".todolist-launch.log"))
    {
        let _ = writeln!(fh, "[autocommit] {}", detail.trim());
    }
}

/// 在 `root` 里跑一次数据提交。`stamp` 由前端传入本地时间（形如 "2026-10-10 22:40"），
/// 缺省时用占位文案——刻意不在 Rust 侧算本地时间，避免为此引入日期依赖。
pub fn autocommit(root: &Path, stamp: Option<&str>) -> CommitReport {
    let probe = match run_git(root, &["rev-parse", "--is-inside-work-tree"]) {
        Some(out) => out,
        None => return report("git-missing", "本机没有可用的 git"),
    };
    if String::from_utf8_lossy(&probe.stdout).trim() != "true" {
        return report("not-a-repo", "数据目录还不是 git 仓库");
    }

    let mut add_args = vec!["add", "--"];
    add_args.extend(DATA_PATHS.iter().copied());
    let _ = run_git(root, &add_args);

    // diff --cached --quiet：有差异时退出码为 1
    let diff = match run_git(root, &["diff", "--cached", "--quiet"]) {
        Some(out) => out,
        None => return report("git-missing", "git 调用失败"),
    };
    if diff.status.success() {
        return report("no-change", "数据没有变更");
    }

    let message = match stamp {
        Some(s) if !s.trim().is_empty() => format!("auto: 任务数据更新 {}", s.trim()),
        _ => "auto: 任务数据更新".to_string(),
    };
    let commit = match run_git(root, &["commit", "-m", &message]) {
        Some(out) => out,
        None => return report("git-missing", "git 调用失败"),
    };
    if commit.status.success() {
        return report("committed", message);
    }
    // 最常见原因：git 身份没配置。失败要留痕，但不打断任何流程。
    let detail = String::from_utf8_lossy(&commit.stderr).trim().to_string();
    log_failure(root, &detail);
    report("failed", detail)
}

/// 对当前数据目录跑一次自动提交。
///
/// 触发时机与原来一致：**应用启动时一次**（由前端在挂载后调用，因此能带上本地时间戳）。
/// 另外提供一个刻意关掉的开关 `ws_set_git_on_save`——打开后前端会在每次成功保存后
/// 追加一次提交，把"运行期改动不入库"这个旧缺口补上。默认关闭，保持既有行为不变。
#[tauri::command]
pub fn git_autocommit(
    state: State<'_, Workspace>,
    stamp: Option<String>,
) -> Result<CommitReport, String> {
    let dir = state
        .dir
        .lock()
        .map_err(|_| "工作区状态损坏".to_string())?
        .clone()
        .ok_or_else(|| "尚未选择数据目录".to_string())?;
    Ok(autocommit(&dir, stamp.as_deref()))
}
