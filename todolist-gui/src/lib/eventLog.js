// Append-only 会话事件日志（工具动作的「我做过什么」时间线）。
//
// 落盘文件：`.worktodolist/sessions/session-YYYY-MM.ndjson`（NDJSON，一行一事件）。
// 按月归档：文件数一年最多 12 个，配合 12 个月保留窗口，长期不会把数据目录塞满。
// 语义：只追加。实现上采用“读现有内容 → 追加一行 → 整体写回”（File System Access API
// 不支持就地 append，会话文件很小，整体写回可接受）；关键约定是——已写入的历史行
// 永不修改、永不重排、永不删除（保留窗口到期由壳侧清理整月文件）。
import { readSessionText, writeSessionText } from './fileStore';

/**
 * 会话日志文件名（按月）。
 * @param {string} date 'YYYY-MM-DD' 或 'YYYY-MM'
 */
export function sessionFileName(date) {
  return `session-${String(date).slice(0, 7)}.ndjson`;
}

// 事件时间戳 → 会话文件月份（本地日历月）。
// 注意：makeEvent 的 ts 为 UTC ISO 字符串，若直接 slice(0,7) 取的是 UTC 月份；
// 而读取侧用本地 today(dayjs) 定位日志文件，二者在 UTC+8 的月初会相差一个月，
// 导致该时段事件落盘到错误文件、刷新后无法回放。故此处统一按本地日期归档。
function tsToMonth(ts) {
  const d = new Date(ts || '');
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}

/**
 * 构造一条事件。
 * @param {number} seq 递增序号
 * @param {string} type 'user'|'intent'|'tool_call'|'tool_result'|'agent'|'error'
 * @param {object} payload 事件负载
 * @param {string} [ts] ISO 时间戳，默认当前时间
 */
export function makeEvent(seq, type, payload, ts) {
  return { seq, ts: ts || new Date().toISOString(), type, payload: payload || {} };
}

/**
 * 追加一条事件到当日 NDJSON 日志。
 * @returns {Promise<boolean>} 是否写入成功
 */
export async function appendEvent(dirHandle, event) {
  if (!dirHandle || !event) return false;
  const month = tsToMonth(event.ts);
  if (!month) return false;
  const existing = await readSessionText(dirHandle, month);
  const line = JSON.stringify(event);
  const base = existing && !existing.endsWith('\n') ? `${existing}\n` : existing || '';
  await writeSessionText(dirHandle, month, `${base}${line}\n`);
  return true;
}

/**
 * 读取指定日期的全部事件（按 seq 升序）。损坏行会被跳过。
 */
export async function loadEvents(dirHandle, date) {
  if (!dirHandle || !date) return [];
  const month = String(date).slice(0, 7);
  const text = await readSessionText(dirHandle, month);
  const events = [];
  for (const rawLine of String(text).split(/\r?\n/)) {
    const s = rawLine.trim();
    if (!s) continue;
    try {
      events.push(JSON.parse(s));
    } catch {
      // 忽略损坏行，保证日志可被最大程度重放
    }
  }
  events.sort((a, b) => a.seq - b.seq);
  return events;
}
