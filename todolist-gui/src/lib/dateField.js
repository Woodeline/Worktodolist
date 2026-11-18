// 日期字段的值转换 —— 界面用 Date，落盘仍是 todo.txt 的 ISO 形状。
// 纯函数：不碰 DOM；makePresets 传入固定 base 时也不读时钟，方便无 jsdom 环境单测。
//
// 形状契约（lib/todoParser.js）：
//   due:  YYYY-MM-DD
//   rem:  YYYY-MM-DDTHH:mm
// 任何日期控件都必须产出这两个形状，不能扩展纯文本数据模型。

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})/;
const TIME_RE = /T(\d{2}):(\d{2})/;

export const DEFAULT_TIME = '09:00';

function pad(n) {
  return String(n).padStart(2, '0');
}

/** 形状合法不代表日期合法：2 月 30 日会被 Date 自动进位，必须挡掉。 */
function validYmd(y, mo, d) {
  const probe = new Date(y, mo - 1, d);
  return probe.getFullYear() === y && probe.getMonth() === mo - 1 && probe.getDate() === d;
}

export function formatISODate(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** 字符串 → { date, time }；非法值一律当成空值，不把原文露到界面读数上。 */
export function parseDateValue(value) {
  if (typeof value !== 'string' || !value) return { date: null, time: '' };
  const m = DATE_RE.exec(value);
  if (!m) return { date: null, time: '' };
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (!validYmd(y, mo, d)) return { date: null, time: '' };
  const date = new Date(y, mo - 1, d);
  const t = TIME_RE.exec(value);
  return { date, time: t ? `${t[1]}:${t[2]}` : '' };
}

/** { date, time } → 落盘字符串。withTime 且没给时刻时用默认 09:00（界面上可见可改）。 */
export function formatDateValue(date, time, withTime) {
  const base = formatISODate(date);
  if (!base) return '';
  return withTime ? `${base}T${time || DEFAULT_TIME}` : base;
}

/** 界面读数：短日期 YYYY/MM/DD；withTime 时补 HH:mm。落盘形状仍是上面的 ISO。 */
export function formatDateShort(value, withTime) {
  if (!value) return '';
  const m = DATE_RE.exec(value);
  if (!m) return '';
  // 与 parseDateValue 同一口径：脏值不能「读数说有日期、控件说未设置」。
  if (!validYmd(Number(m[1]), Number(m[2]), Number(m[3]))) return '';
  const base = `${m[1]}/${m[2]}/${m[3]}`;
  if (!withTime) return base;
  const t = TIME_RE.exec(value);
  return t ? `${base} ${t[1]}:${t[2]}` : base;
}

/** 截止日相对今天的人话读数：今天 / 明天 / 后天 / 昨天 / 逾期 N 天 / N 天后；无日期为空串。
 *  base 省略时取本机今天（仅运行时用）；单测传固定 base，不读时钟。 */
export function describeDueRel(value, base) {
  const { date } = parseDateValue(value);
  if (!date) return '';
  const day = base instanceof Date && !Number.isNaN(base.getTime())
    ? new Date(base.getFullYear(), base.getMonth(), base.getDate())
    : new Date();
  day.setHours(0, 0, 0, 0);
  const n = Math.round((date - day) / 86400000);
  if (n === 0) return '今天';
  if (n === 1) return '明天';
  if (n === 2) return '后天';
  if (n === -1) return '昨天';
  return n < 0 ? `逾期 ${-n} 天` : `${n} 天后`;
}

/** 逾期 = 截止日严格早于今天（与列表 / 日历同一口径）。无日期不算逾期。 */
export function isDueOverdue(value, base) {
  const { date } = parseDateValue(value);
  if (!date) return false;
  const day = base instanceof Date && !Number.isNaN(base.getTime())
    ? new Date(base.getFullYear(), base.getMonth(), base.getDate())
    : new Date();
  day.setHours(0, 0, 0, 0);
  return date < day;
}

/** 快捷预设。base 省略时取本机今天（仅运行时用）。 */
export function makePresets(base) {
  const day = base instanceof Date && !Number.isNaN(base.getTime())
    ? new Date(base.getFullYear(), base.getMonth(), base.getDate())
    : new Date();
  const addDays = (n) => {
    const d = new Date(day);
    d.setDate(d.getDate() + n);
    return d;
  };
  const monday = addDays(1);
  while (monday.getDay() !== 1) monday.setDate(monday.getDate() + 1);
  return [
    { label: '今天', date: day },
    { label: '明天', date: addDays(1) },
    { label: '下周一', date: monday },
  ];
}
