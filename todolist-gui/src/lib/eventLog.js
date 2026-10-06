// Append-only 会话事件日志。
//
// 落盘文件：数据目录下的 session-YYYY-MM-DD.ndjson（NDJSON，一行一事件）。
// 语义：只追加。实现上采用“读现有内容 → 追加一行 → 整体写回”（File System Access API
// 不支持就地 append，会话文件很小，整体写回可接受）；关键约定是——已写入的历史行
// 永不修改、永不重排、永不删除，因此文件内容即为不可变的事件流。
//
// 重放（replay）纯函数，只做数据变形，绝不触发任何 store 副作用。
import { readFileText, writeFileText } from './fileStore';

/**
 * 会话日志文件名。
 * @param {string} date 'YYYY-MM-DD'
 */
export function sessionFileName(date) {
  return `session-${date}.ndjson`;
}

// 事件时间戳 → 会话文件日期（本地日历日）。
// 注意：makeEvent 的 ts 为 UTC ISO 字符串，若直接 slice(0,10) 取的是 UTC 日期；
// 而 useChatAgent 用本地 today(dayjs) 读取日志，二者在 UTC+8 的 00:00–08:00 会相差一天，
// 导致该时段事件落盘到错误文件、刷新后无法回放。故此处统一按本地日期归档。
function tsToDate(ts) {
  const d = new Date(ts || '');
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
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
  const date = tsToDate(event.ts);
  if (!date) return false;
  const name = sessionFileName(date);
  const existing = await readFileText(dirHandle, name);
  const line = JSON.stringify(event);
  const base = existing && !existing.endsWith('\n') ? `${existing}\n` : existing || '';
  await writeFileText(dirHandle, name, `${base}${line}\n`);
  return true;
}

/**
 * 读取指定日期的全部事件（按 seq 升序）。损坏行会被跳过。
 */
export async function loadEvents(dirHandle, date) {
  if (!dirHandle || !date) return [];
  const text = await readFileText(dirHandle, sessionFileName(date));
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

/**
 * 把事件流还原为聊天记录（无副作用）。
 * 返回消息数组，元素形如：
 *   { id, seq, ts, role:'user'|'agent'|'tool', text?, tool?:{name,params,status,durationMs} }
 * tool_call / tool_result 通过 callId 配对成一张工具卡片。
 */
export function replay(events) {
  const messages = [];
  const toolIndex = new Map();

  for (const ev of Array.isArray(events) ? events : []) {
    if (!ev || typeof ev !== 'object') continue;
    const seq = ev.seq;
    const ts = ev.ts;
    const payload = ev.payload || {};

    if (ev.type === 'user') {
      messages.push({ id: `u-${seq}`, seq, ts, role: 'user', text: payload.text || '', raw: ev });
    } else if (ev.type === 'agent') {
      messages.push({
        id: `a-${seq}`,
        seq,
        ts,
        role: 'agent',
        text: payload.text || '',
        kind: payload.kind || 'text',
        raw: ev,
      });
    } else if (ev.type === 'tool_call') {
      const msg = {
        id: `t-${seq}`,
        seq,
        ts,
        role: 'tool',
        tool: {
          name: (payload.tool && payload.tool.name) || 'agent.noop',
          params: (payload.tool && payload.tool.params) || {},
          status: 'running',
          durationMs: null,
        },
        raw: ev,
      };
      messages.push(msg);
      if (payload.callId) toolIndex.set(payload.callId, msg);
    } else if (ev.type === 'tool_result') {
      const msg = toolIndex.get(payload.callId);
      if (msg) {
        msg.tool.status = payload.status || 'ok';
        msg.tool.durationMs = payload.durationMs != null ? payload.durationMs : null;
        // 执行完成后回填最终参数（重放时卡片展示的参数以 tool_result 为准）。
        if (payload.params) msg.tool.params = payload.params;
        msg.resultRaw = ev;
      }
    } else if (ev.type === 'error') {
      messages.push({
        id: `e-${seq}`,
        seq,
        ts,
        role: 'agent',
        kind: 'error',
        text: payload.message || '发生未知错误',
        raw: ev,
      });
    }
    // 'intent' 事件仅用于审计，不单独渲染为气泡。
  }

  return messages;
}
