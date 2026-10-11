//! 每日提醒：解析规则与文案对齐 `scripts/daily_reminder.py`。
//!
//! 两条路径：
//!   * **应用在运行**：前端每分钟（或窗口重新获得焦点时）调用 `reminder_check`，
//!     由前端决定是否已经提醒过今天，然后调 `notify` 弹系统通知。
//!   * **应用没打开**：计划任务用 `Worktodolist.exe --reminder` 拉起一个隐藏实例，
//!     在 setup 阶段执行 `headless_reminder` 后立即退出。这样"没打开也会提醒"
//!     这条既有承诺不丢，而且不再需要 Python 解释器。
//!
//! 本地日期怎么来：Rust 标准库只有 UTC 时间戳，没有时区库。这里不引重量级日期依赖，
//! 而是问一次系统（PowerShell 的 Get-Date）——一天只跑一次的后台任务，|
//! 多花几百毫秒无所谓，换来的是"跨时区/跨夏令时都对"。取不到时回落 UTC。

use std::path::Path;
use std::process::Command;

use serde::Serialize;
use tauri::AppHandle;
use tauri_plugin_notification::NotificationExt;

use crate::workspace::Workspace;

/// 最多在一屏里列出的条数（与 Python 版一致）。
const MAX_LINES: usize = 10;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

#[derive(Serialize)]
pub struct Reminder {
    pub title: String,
    pub due: String,
    /// >0 表示逾期天数；0 表示今天到期
    pub overdue_days: i64,
}

#[derive(Serialize)]
pub struct ReminderReport {
    pub items: Vec<Reminder>,
    /// 命中的总条数（可能大于 items.len()）
    pub total: usize,
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

/// 霍华德·欣南特的 civil-days 算法：ISO 日期 → 距 1970-01-01 的天数。
/// 用它做日期差，避免引入 chrono/time。
fn days_from_civil(y: i64, m: i64, d: i64) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = y - era * 400;
    let mp = (m + 9) % 12;
    let doy = (153 * mp + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146097 + doe - 719468
}

fn parse_date(s: &str) -> Option<i64> {
    if !is_iso_date(s) {
        return None;
    }
    let y = s[0..4].parse::<i64>().ok()?;
    let m = s[5..7].parse::<i64>().ok()?;
    let d = s[8..10].parse::<i64>().ok()?;
    if !(1..=12).contains(&m) || !(1..=31).contains(&d) {
        return None;
    }
    Some(days_from_civil(y, m, d))
}

fn due_of(line: &str) -> Option<String> {
    for word in line.split_whitespace() {
        if let Some(v) = word.strip_prefix("due:") {
            if is_iso_date(v) {
                return Some(v.to_string());
            }
        }
    }
    None
}

/// 去掉 `due:` 词、行首优先级、行首创建日期，只留人话标题。
fn title_of(line: &str) -> String {
    let mut t = line
        .split_whitespace()
        .filter(|w| !w.starts_with("due:"))
        .collect::<Vec<_>>()
        .join(" ");

    if t.starts_with('(') {
        let rest = &t[1..];
        if let Some(close) = rest.find(')') {
            let inner = &rest[..close];
            if inner.len() == 1 && inner.as_bytes()[0].is_ascii_uppercase() {
                t = rest[close + 1..].trim_start().to_string();
            }
        }
    }
    if let Some(head) = t.get(..10) {
        // 必须用 get 而不是 &t[..10]：t 是人话标题，很可能以中文开头，
        // 第 10 个字节未必落在字符边界上，直接切片会 panic。
        // release 里开了 panic = "abort"，一次 panic 就是整个应用被提醒功能打死。
        if is_iso_date(head) && t.as_bytes().get(10) == Some(&b' ') {
            t = t.get(11..).unwrap_or("").to_string();
        }
    }
    t.trim().to_string()
}

/// 纯函数：从 todo.txt 文本算出提醒列表（逾期在前，今天到期在后）。
pub fn collect(text: &str, today: &str) -> Vec<Reminder> {
    let Some(today_days) = parse_date(today) else {
        return Vec::new();
    };
    let mut overdue = Vec::new();
    let mut due_today = Vec::new();

    for raw in text.lines() {
        let line = raw.trim();
        if line.is_empty() {
            continue;
        }
        let Some(due) = due_of(line) else {
            continue;
        };
        let Some(due_days) = parse_date(&due) else {
            continue;
        };
        let item = Reminder {
            title: title_of(line),
            due,
            overdue_days: today_days - due_days,
        };
        if item.overdue_days > 0 {
            overdue.push(item);
        } else if item.overdue_days == 0 {
            due_today.push(item);
        }
    }
    overdue.extend(due_today);
    overdue
}

/// 把提醒列表渲染成通知正文（与 Python 版排版一致）。
pub fn render(items: &[Reminder], total: usize) -> String {
    let mut lines: Vec<String> = items
        .iter()
        .take(MAX_LINES)
        .map(|r| {
            if r.overdue_days > 0 {
                format!("[逾期 {} 天] {}", r.overdue_days, r.title)
            } else {
                format!("[今天到期] {}", r.title)
            }
        })
        .collect();
    if total > MAX_LINES {
        lines.push(format!("…… 以及另外 {} 条", total - MAX_LINES));
    }
    lines.join("\n")
}

/// 问系统要本地日期（YYYY-MM-DD）。取不到就回落 UTC。
pub fn local_today() -> String {
    #[cfg(windows)]
    {
        let mut cmd = Command::new("powershell");
        cmd.args([
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            "Get-Date -Format yyyy-MM-dd",
        ])
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null());
        {
            use std::os::windows::process::CommandExt;
            cmd.creation_flags(CREATE_NO_WINDOW);
        }
        if let Ok(out) = cmd.output() {
            let s = String::from_utf8_lossy(&out.stdout).trim().to_string();
            if is_iso_date(&s) {
                return s;
            }
        }
    }
    // 兜底：UTC 日期
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    let days = secs.div_euclid(86_400);
    let (y, m, d) = civil_from_days(days);
    format!("{y:04}-{m:02}-{d:02}")
}

fn civil_from_days(z: i64) -> (i64, i64, i64) {
    let z = z + 719468;
    let era = if z >= 0 { z } else { z - 146096 } / 146097;
    let doe = z - era * 146097;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    (if m <= 2 { y + 1 } else { y }, m, d)
}

// ---------------------------------------------------------------------------
// 命令
// ---------------------------------------------------------------------------

/// 扫描数据目录里的 todo.txt，返回提醒列表。
#[tauri::command]
pub fn reminder_check(
    state: tauri::State<'_, Workspace>,
    today: Option<String>,
) -> Result<ReminderReport, String> {
    let dir = state
        .dir
        .lock()
        .map_err(|_| "工作区状态损坏".to_string())?
        .clone()
        .ok_or_else(|| "尚未选择数据目录".to_string())?;
    let today = today.filter(|s| is_iso_date(s)).unwrap_or_else(local_today);
    let text = std::fs::read_to_string(dir.join("todo.txt")).unwrap_or_default();
    let all = collect(&text, &today);
    let total = all.len();
    Ok(ReminderReport {
        items: all.into_iter().take(MAX_LINES).collect(),
        total,
    })
}

/// 弹一条系统通知。
#[tauri::command]
pub fn notify(app: AppHandle, title: String, body: String) -> Result<(), String> {
    app.notification()
        .builder()
        .title(title)
        .body(body)
        .show()
        .map_err(|e| format!("通知发送失败：{e}"))
}

/// 供 `--reminder` 无界面模式使用：算出来就直接弹通知。
/// 返回提醒条数（0 = 无事发生，应当完全静默）。
pub fn headless_reminder(app: &AppHandle, dir: &Path) -> Result<usize, String> {
    let today = local_today();
    let text = std::fs::read_to_string(dir.join("todo.txt")).unwrap_or_default();
    let all = collect(&text, &today);
    if all.is_empty() {
        return Ok(0);
    }
    let total = all.len();
    let body = render(&all, total);
    app.notification()
        .builder()
        .title("待办清单提醒")
        .body(body)
        .show()
        .map_err(|e| format!("通知发送失败：{e}"))?;
    Ok(total)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn collects_overdue_before_due_today() {
        let text = "2026-10-01 交周报 due:2026-10-09\n(A) 2026-09-20 体检 due:2026-10-10\n普通任务\n";
        let got = collect(text, "2026-10-10");
        assert_eq!(got.len(), 2);
        assert_eq!(got[0].title, "交周报");
        assert_eq!(got[0].overdue_days, 1);
        assert_eq!(got[1].title, "体检");
        assert_eq!(got[1].overdue_days, 0);
    }

    #[test]
    fn ignores_lines_without_due() {
        assert!(collect("没有日期的任务\n", "2026-10-10").is_empty());
    }

    #[test]
    fn civil_days_roundtrip() {
        let d = days_from_civil(2026, 10, 10);
        assert_eq!(civil_from_days(d), (2026, 10, 10));
    }

    /// 回归：中文标题曾让 `&t[..10]` panic（第 10 字节不是字符边界）。
    /// 这类标题在真实数据里是最常见的一类，必须钉死。
    /// 注意两种写法都要盖：带创建日期前缀的、以及**不带前缀**的——
    /// 恰恰是后者长度 ≥ 11 却没有边界保护，才是真正会 panic 的那一种。
    #[test]
    fn chinese_title_does_not_panic() {
        let titles = [
            "整理季度汇报材料",
            "交周报",
            "把方案发给客户确认一下细节",
            "abc中文混合的标题内容",
        ];
        for title in titles {
            for line in [
                format!("2026-10-01 {title} due:2026-10-10"),
                format!("{title} due:2026-10-10"),
            ] {
                let got = collect(&line, "2026-10-10");
                assert_eq!(got.len(), 1, "{line}");
                assert_eq!(got[0].title, title, "{line}");
            }
        }
    }

    /// 标题里真的带创建日期时仍然要剥掉（原逻辑的正向用例，别被上面的修复破坏）。
    #[test]
    fn strips_leading_created_date() {
        assert_eq!(title_of("2026-10-01 交周报 due:2026-10-10"), "交周报");
        assert_eq!(title_of("2026-10-01 整理季度汇报材料"), "整理季度汇报材料");
        assert_eq!(title_of("(A) 2026-09-20 体检"), "体检");
    }
}
