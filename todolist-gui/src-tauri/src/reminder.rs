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

use std::collections::HashSet;
use std::path::{Path, PathBuf};
#[cfg(windows)]
use std::process::Command;

use serde::Serialize;
use tauri::AppHandle;
use tauri_plugin_notification::NotificationExt;

use crate::workspace::Workspace;

/// 最多在一屏里列出的条数（与 Python 版一致）。
const MAX_LINES: usize = 10;

/// rem: 提醒最多补发的滞后（天）。超过这个期限的过期提醒直接视为作废，
/// 不再补弹 —— 否则用户一个月后编辑旧任务会突然被轰炸一屏陈年提醒。
const REM_MAX_LAG_DAYS: i64 = 3;

/// 已提醒记录文件（数据目录下）。每行一个 key：`<fnv1a(title)|rem>`。
/// 重启后靠它防止同一条提醒反复弹；文件只增不改，超过上限整体截断。
const FIRED_FILE: &str = ".todolist-remind-fired.txt";
const FIRED_KEEP: usize = 1000;

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

/// rem: 标签的值：`YYYY-MM-DDTHH:mm`（本地时间，与前端 datetime-local 同形状）。
fn is_iso_datetime(s: &str) -> bool {
    let b = s.as_bytes();
    if b.len() != 16 || b[4] != b'-' || b[7] != b'-' || b[10] != b'T' || b[13] != b':' {
        return false;
    }
    if parse_date(&s[..10]).is_none() {
        return false;
    }
    b[11..13]
        .iter()
        .chain(b[14..16].iter())
        .all(|c| c.is_ascii_digit())
        && s[11..13].parse::<i64>().map(|h| h <= 23).unwrap_or(false)
        && s[14..16].parse::<i64>().map(|m| m <= 59).unwrap_or(false)
}

fn rem_of(line: &str) -> Option<String> {
    for word in line.split_whitespace() {
        if let Some(v) = word.strip_prefix("rem:") {
            if is_iso_datetime(v) {
                return Some(v.to_string());
            }
        }
    }
    None
}

/// rem 时刻 → (距 1970 的天数, 当天分钟数)。
fn parse_rem(s: &str) -> Option<(i64, i64)> {
    let days = parse_date(&s[..10])?;
    let h = s[11..13].parse::<i64>().ok()?;
    let m = s[14..16].parse::<i64>().ok()?;
    Some((days, h * 60 + m))
}

fn now_parts(now: &str) -> Option<(i64, i64)> {
    parse_rem(now)
}

/// FNV-1a 64 位，返回 16 位十六进制。给提醒条目做去重 key 用，
/// 不需要密码学强度，只要同一行稳定、不同行基本不撞。
fn fnv1a(s: &str) -> String {
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    for b in s.as_bytes() {
        h ^= u64::from(*b);
        h = h.wrapping_mul(0x0000_0100_0000_01b3);
    }
    format!("{h:016x}")
}

fn is_completed_line(line: &str) -> bool {
    line == "x" || line.starts_with("x ")
}

/// 已提醒记录文件的路径。
fn fired_path(dir: &Path) -> PathBuf {
    dir.join(FIRED_FILE)
}

fn load_fired(dir: &Path) -> HashSet<String> {
    std::fs::read_to_string(fired_path(dir))
        .map(|text| text.lines().map(|l| l.trim().to_string()).collect())
        .unwrap_or_default()
}

fn save_fired(dir: &Path, fired: &HashSet<String>) {
    let mut keys: Vec<String> = fired.iter().cloned().collect();
    // 按 key 排序保证文件内容确定；超出上限丢最旧的（丢了的后果只是可能重复弹一次，可接受）
    keys.sort();
    let start = keys.len().saturating_sub(FIRED_KEEP);
    let body = keys[start..].join("\n");
    let body = if body.is_empty() { String::new() } else { format!("{body}\n") };
    let tmp = fired_path(dir).with_extension("txt.tmp");
    if std::fs::write(&tmp, body).is_ok() {
        let _ = std::fs::rename(&tmp, fired_path(dir));
    }
}

#[derive(Serialize)]
pub struct DueReminder {
    pub title: String,
    pub rem: String,
}

/// 纯函数：找出 rem 时刻已到、且未提醒过的一次性提醒。
/// 只看活跃行（x 开头的完成行不提醒）；滞后超过 REM_MAX_LAG_DAYS 的过期作废。
pub fn collect_due(text: &str, now: &str, fired: &HashSet<String>) -> Vec<DueReminder> {
    let Some((now_days, now_min)) = now_parts(now) else {
        return Vec::new();
    };
    let max_lag_min = REM_MAX_LAG_DAYS * 24 * 60;
    let mut out = Vec::new();
    for raw in text.lines() {
        let line = raw.trim();
        if line.is_empty() || is_completed_line(line) {
            continue;
        }
        let Some(rem) = rem_of(line) else {
            continue;
        };
        let Some((rem_days, rem_min)) = parse_rem(&rem) else {
            continue;
        };
        let rem_total = rem_days * 24 * 60 + rem_min;
        let now_total = now_days * 24 * 60 + now_min;
        if rem_total > now_total {
            continue; // 还没到点
        }
        if now_total - rem_total > max_lag_min {
            continue; // 过期太久，作废不补弹
        }
        let title = title_of(line);
        let key = format!("{}|{}", fnv1a(&title), rem);
        if fired.contains(&key) {
            continue;
        }
        out.push(DueReminder { title, rem });
    }
    out.sort_by(|a, b| a.rem.cmp(&b.rem));
    out
}

/// 去掉 `due:` / `rem:` 词、行首优先级、行首创建日期，只留人话标题。
fn title_of(line: &str) -> String {
    let mut t = line
        .split_whitespace()
        .filter(|w| !w.starts_with("due:") && !w.starts_with("rem:"))
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

/// 问系统要本地时刻（YYYY-MM-DDTHH:mm）。取不到就回落 UTC。
/// 前端 tick 路径始终自带 now，这只是 headless / 容错兜底。
pub fn local_now() -> String {
    #[cfg(windows)]
    {
        let mut cmd = Command::new("powershell");
        cmd.args([
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            "Get-Date -Format \"yyyy-MM-ddTHH:mm\"",
        ])
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null());
        {
            use std::os::windows::process::CommandExt;
            cmd.creation_flags(CREATE_NO_WINDOW);
        }
        if let Ok(out) = cmd.output() {
            let s = String::from_utf8_lossy(&out.stdout).trim().to_string();
            if is_iso_datetime(&s) {
                return s;
            }
        }
    }
    // 兜底：UTC 时刻（与本地可能差一个时区，仅在前端没给 now 时使用）
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    let days = secs.div_euclid(86_400);
    let mins = secs.rem_euclid(86_400) / 60;
    let (y, m, d) = civil_from_days(days);
    format!("{y:04}-{m:02}-{d:02}T{:02}:{:02}", mins / 60, mins % 60)
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

/// 每任务时刻提醒（rem: 标签）的 tick：前端每 30 秒调一次。
/// 找出已到期且未提醒过的条目 → 弹一条聚合通知 → 记入已提醒文件。
/// 返回本次弹出的提醒条数。
#[tauri::command]
pub fn reminder_tick(
    app: AppHandle,
    state: tauri::State<'_, Workspace>,
    now: Option<String>,
) -> Result<usize, String> {
    let dir = state
        .dir
        .lock()
        .map_err(|_| "工作区状态损坏".to_string())?
        .clone()
        .ok_or_else(|| "尚未选择数据目录".to_string())?;
    let now = now
        .filter(|s| is_iso_datetime(s))
        .unwrap_or_else(local_now);
    let text = std::fs::read_to_string(dir.join("todo.txt")).unwrap_or_default();
    let mut fired = load_fired(&dir);
    let due = collect_due(&text, &now, &fired);
    if due.is_empty() {
        return Ok(0);
    }
    let total = due.len();
    let lines: Vec<String> = due
        .iter()
        .take(MAX_LINES)
        .map(|r| format!("[{}] {}", &r.rem[11..16], r.title))
        .collect();
    let mut body = lines.join("\n");
    if total > MAX_LINES {
        body.push_str(&format!("\n…… 以及另外 {} 条", total - MAX_LINES));
    }
    app.notification()
        .builder()
        .title("待办提醒")
        .body(body)
        .show()
        .map_err(|e| format!("通知发送失败：{e}"))?;
    // 弹成功才记账，失败下次还会再试。直接在上面那份上记，不再重读一次文件：
    // 这个 tick 每 30 秒跑一趟，重复读是在给数据目录（可能在网盘 / 被杀软实时扫描）加压。
    for r in &due {
        fired.insert(format!("{}|{}", fnv1a(&r.title), r.rem));
    }
    save_fired(&dir, &fired);
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

    #[test]
    fn datetime_validation() {
        assert!(is_iso_datetime("2026-10-23T15:00"));
        assert!(is_iso_datetime("2026-10-23T00:00"));
        assert!(!is_iso_datetime("2026-10-23T24:00"));
        assert!(!is_iso_datetime("2026-10-23T15:60"));
        assert!(!is_iso_datetime("2026-13-23T15:00"));
        assert!(!is_iso_datetime("2026-10-23 15:00"));
        assert!(!is_iso_datetime("15:00"));
    }

    #[test]
    fn collects_due_reminders_only_when_time_reached() {
        let text = "交周报 rem:2026-10-23T15:00 due:2026-10-24\n体检 rem:2026-10-23T18:00\n";
        let fired = HashSet::new();
        // 15:00 整点：只弹周报
        let got = collect_due(text, "2026-10-23T15:00", &fired);
        assert_eq!(got.len(), 1);
        assert_eq!(got[0].title, "交周报");
        // 17:59：周报已到、体检未到
        let got = collect_due(text, "2026-10-23T17:59", &fired);
        assert_eq!(got.len(), 1);
        // 18:00：两条都到，按时刻先后排序
        let got = collect_due(text, "2026-10-23T18:00", &fired);
        assert_eq!(got.len(), 2);
        assert_eq!(got[0].title, "交周报");
        assert_eq!(got[1].title, "体检");
    }

    #[test]
    fn skips_fired_and_completed_and_stale() {
        let text = "交周报 rem:2026-10-23T15:00\nx 2026-10-20 体检 rem:2026-10-23T16:00\n旧事 rem:2026-10-01T09:00\n";
        // 周报已提醒过 → 不再出现；完成行与过期太久的不弹
        let mut fired = HashSet::new();
        fired.insert(format!("{}|2026-10-23T15:00", fnv1a("交周报")));
        let got = collect_due(text, "2026-10-23T15:05", &fired);
        assert!(got.is_empty());
        // 未记录过时正常弹（完成行与陈年过期始终被排除）
        let got = collect_due(text, "2026-10-23T16:00", &HashSet::new());
        assert_eq!(got.len(), 1);
        assert_eq!(got[0].title, "交周报");
    }

    #[test]
    fn title_excludes_rem_tag() {
        assert_eq!(title_of("交周报 rem:2026-10-23T15:00 due:2026-10-24"), "交周报");
    }

    #[test]
    fn fired_key_is_stable() {
        assert_eq!(fnv1a("交周报"), fnv1a("交周报"));
        assert_ne!(fnv1a("交周报"), fnv1a("体检"));
    }
}
