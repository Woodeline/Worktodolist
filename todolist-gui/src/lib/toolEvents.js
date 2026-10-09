// 工具动作写入会话事件线 —— 「我做过什么」只有一条时间线。
//
// 与对话共用同一份 append-only NDJSON（按本地日历日归档为 session-YYYY-MM-DD.ndjson，
// ts 存 UTC ISO），只是 type 不同：
//   tool.open    打开了某个工具（含来源：左栏还是对话）
//   tool.run     执行了一次计算/查询（例如联网查询）
//   tool.export  导出了文件
//   tool.apply   把提议确认落盘了（同时也会有对话侧那条 intent/tool_result）
//
// 两条硬约束：
//   1. replay 必须保持无副作用 —— 回放工具事件不能触发重算、更不能触发写入。
//      刷新页面会重放日志，这条一旦破，刷新就成了"再执行一次"。
//   2. seq 必须与对话事件**同一个递增序列**，否则同一份日志里会出现重号，
//      回放顺序不稳定。这里用 nextSeq（读当日最大值 +1），并把写过的最大 seq
//      通过 drainLastToolSeq 交给对话侧，让它在下一次写之前把自己的计数器抬上去。
import dayjs from 'dayjs';
import { appendEvent, loadEvents, makeEvent } from './eventLog.js';

export const TOOL_EVENT_TYPES = ['tool.open', 'tool.run', 'tool.export', 'tool.apply'];

// 最近一次工具事件的 seq。对话侧每次写事件前取一次（取完清零），
// 用来避免"工具写 12、对话接着写 12"这种重号。
let lastToolSeq = 0;

export function drainLastToolSeq() {
  const v = lastToolSeq;
  lastToolSeq = 0;
  return v;
}

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
  if (!written) return null;
  lastToolSeq = Math.max(lastToolSeq, seq);
  return event;
}
