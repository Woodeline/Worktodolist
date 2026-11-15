// 工具动作写入会话事件线 —— 「我做过什么」只有一条时间线。
//
// append-only NDJSON，按本地日历日归档为 session-YYYY-MM-DD.ndjson（ts 存 UTC ISO）：
//   tool.open    打开了某个工具
//   tool.run     执行了一次计算/查询
//   tool.export  导出了文件
//   tool.apply   把提议确认落盘了
//
// seq 严格递增：每次写入前用 nextSeq 读当日最大值 +1，保证同一份日志里不出现重号。
import dayjs from 'dayjs';
import { appendEvent, loadEvents, makeEvent } from './eventLog.js';

export const TOOL_EVENT_TYPES = ['tool.open', 'tool.run', 'tool.export', 'tool.apply'];

/** 当日日志的最大 seq（无日志或读失败时为 0）。 */
export async function nextSeq(handle, date) {
  if (!handle) return 0;
  try {
    const events = await loadEvents(handle, date);
    return events.length ? Number(events[events.length - 1].seq) || 0 : 0;
  } catch {
    return 0;
  }
}

/**
 * 追加一条工具事件。
 * @returns {Promise<object|null>} 写入的事件，写失败/无句柄时为 null
 */
export async function logToolEvent(handle, type, payload, date) {
  if (!handle || !TOOL_EVENT_TYPES.includes(type)) return null;
  const day = date || dayjs().format('YYYY-MM-DD');
  const seq = (await nextSeq(handle, day)) + 1;
  const event = makeEvent(seq, type, { source: 'tools', ...(payload || {}) });
  let written = false;
  try {
    written = await appendEvent(handle, event);
  } catch {
    written = false;
  }
  return written ? event : null;
}
