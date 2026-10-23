// todo.txt 解析器与序列化器（纯函数，无浏览器依赖）
// 行为对齐 topydo 0.16（TodoParser.py / TodoBase.py）：
// - 完成行头：x [完成日期] [创建日期] 其余
// - 活跃行头：[优先级] [创建日期] 其余
// - 完成行中的优先级位于两个日期之后（与 done.txt 实际数据一致）
// - 时间片段（如 13:45）不视为 key:value 标签
import { parseRecurrence } from './recurrence';

const COMPLETED_HEAD_RE = /^(?:(\d{4}-\d{2}-\d{2}) )?(?:(\d{4}-\d{2}-\d{2}) )?(.*)$/;
const NORMAL_HEAD_RE = /^(?:\(([A-Z])\) )?(?:(\d{4}-\d{2}-\d{2}) )?(.*)$/;
const PRIORITY_RE = /^(?:\(([A-Z])\) )?(.*)$/;
const TAG_RE = /^(?![0-9+]{1,2}:[0-9]{1,2}$)([^:\s]+):(.+)$/;
const PROJECT_RE = /^\+(\S*[\p{L}\p{N}_])$/u;
const CONTEXT_RE = /^@(\S*[\p{L}\p{N}_])$/u;
const QUICK_PRIORITY_RE = /^\(([A-Za-z])\)$/;

// id: 标签的值 —— 写进 todo.txt 的**稳定 ID**。
//
// 它和 baseTask 里的 `task.id` 是两回事，不要合并：
//   · `task.id` 是**运行时** ID（makeId 每次解析现算，含递增种子），只服务 React key 与拖拽，
//     重新读一次文件就全变了，写进文本毫无意义。
//   · `stableId` 是**持久** ID，一旦写进那一行就不再变，用来被别人引用 ——
//     子任务认父、重复规则认自己、备注文件认主人，全都靠它。
//
// 字符集只留字母数字：它要能出现在文件名里（将来的 notes/<id>.md），
// 也要能扛住 topydo / 记事本 / grep 的往返。
const STABLE_ID_RE = /^[0-9a-zA-Z]{4,16}$/;

export function isValidStableId(s) {
  return typeof s === 'string' && STABLE_ID_RE.test(s);
}

/**
 * 生成一个新的稳定 ID（6 位 base36，约 21 亿空间）。
 * @param {Set<string>|Iterable<string>} taken 已被占用的 ID
 * @returns {string|null} 拿不到唯一 ID 时返回 null —— **宁可不写，也不写重复的**：
 *          重复 ID 会让"引用它的那个人"指向错的任务，那比没有 ID 更糟。
 */
export function newStableId(taken) {
  const used = taken instanceof Set ? taken : new Set(taken || []);
  for (let i = 0; i < 24; i += 1) {
    const id = Math.floor(Math.random() * 36 ** 6)
      .toString(36)
      .padStart(6, '0');
    if (!used.has(id)) return id;
  }
  return null;
}

/** 收集一批条目里已占用的稳定 ID。 */
export function collectStableIds(entries) {
  const set = new Set();
  for (const e of entries || []) {
    if (e && e.stableId) set.add(e.stableId);
  }
  return set;
}

// rem: 标签的值是一次性提醒时刻（本地时间）：YYYY-MM-DDTHH:mm
// 编辑浮窗的 datetime-local 控件产出的正是这个形状，两端零转换。
export function isValidRemind(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(s)) return false;
  if (!isValidDate(s.slice(0, 10))) return false;
  const hh = Number(s.slice(11, 13));
  const mm = Number(s.slice(14, 16));
  return hh <= 23 && mm <= 59;
}

let idSeed = 0;

function makeId(raw) {
  let h = 0x811c9dc5;
  for (let i = 0; i < raw.length; i += 1) {
    h ^= raw.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  idSeed += 1;
  return `${h.toString(36)}-${idSeed}`;
}

export function isValidDate(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const y = Number(s.slice(0, 4));
  const m = Number(s.slice(5, 7));
  const d = Number(s.slice(8, 10));
  if (m < 1 || m > 12) return false;
  const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
  return d >= 1 && d <= days;
}

function baseTask() {
  return {
    id: '',
    kind: 'task',
    raw: '',
    completed: false,
    completedAt: null,
    createdAt: null,
    priority: null,
    title: '',
    contexts: [],
    projects: [],
    dueDate: null,
    thresholdDate: null,
    remindAt: null,
    starValue: null,
    stableId: null,
    parentId: null,
    recurrence: null,
    extraTags: [],
  };
}

// 无标题行视为不可解析（原样保留为 raw，只读展示不删）
function isBlankTask(task) {
  return !task.title;
}

// 将剩余文本拆为 标题/@分类/+项目/key:value 标签
function tokenizeRest(rest, task) {
  const titleParts = [];
  for (const word of rest.split(/\s+/)) {
    if (!word) continue;
    const proj = PROJECT_RE.exec(word);
    if (proj) {
      task.projects.push(proj[1]);
      continue;
    }
    const ctx = CONTEXT_RE.exec(word);
    if (ctx) {
      task.contexts.push(ctx[1]);
      continue;
    }
    const tag = TAG_RE.exec(word);
    if (tag) {
      const key = tag[1];
      const value = tag[2];
      if (key === 'due' && !task.dueDate) task.dueDate = value;
      else if (key === 't' && !task.thresholdDate) task.thresholdDate = value;
      else if (key === 'rem' && !task.remindAt && isValidRemind(value)) task.remindAt = value;
      else if (key === 'star' && !task.starValue) task.starValue = value;
      // 非法的 id: 直接丢掉而不是塞进 extraTags —— 否则编辑浮窗会显示一个
      // 「id: 乱码」的标签，而它既不是用户写的，也不是我们能用的。
      else if (key === 'id') {
        if (!task.stableId && isValidStableId(value)) task.stableId = value;
      }
      // parent: 同 id: —— 引用别人的 ID，非法值没有意义，丢了比显示出来强。
      else if (key === 'parent') {
        if (!task.parentId && isValidStableId(value)) task.parentId = value;
      }
      // rec: 与上面三个相反 —— 它是**用户自己写的**规则，不是系统分配的引用，
      // 所以认不出的值原样留在 extraTags（编辑浮窗里看得见），不静默吞掉。
      else if (key === 'rec') {
        if (!task.recurrence && parseRecurrence(value)) task.recurrence = value.trim().toLowerCase();
        else task.extraTags.push({ key, value });
      } else task.extraTags.push({ key, value });
      continue;
    }
    titleParts.push(word);
  }
  task.title = titleParts.join(' ');
}

// 解析单行；返回带 kind 的条目（task / raw）
export function parseSingleLine(line) {
  const task = baseTask();
  task.raw = line;
  task.id = makeId(line);

  let rest = line;
  if (line === 'x' || line.startsWith('x ')) {
    task.completed = true;
    const body = line === 'x' ? '' : line.slice(2);
    const head = COMPLETED_HEAD_RE.exec(body);
    const completedAt = head[1];
    const createdAt = head[2];
    if (isValidDate(completedAt)) task.completedAt = completedAt;
    if (isValidDate(createdAt)) task.createdAt = createdAt;
    rest = head[3];
    const prio = PRIORITY_RE.exec(rest);
    if (prio[1]) task.priority = prio[1];
    rest = prio[2];
  } else {
    const head = NORMAL_HEAD_RE.exec(line);
    task.priority = head[1] || null;
    if (isValidDate(head[2])) task.createdAt = head[2];
    rest = head[3];
  }

  tokenizeRest(rest, task);

  if (isBlankTask(task)) {
    return { id: task.id, kind: 'raw', raw: line };
  }
  return task;
}

// 解析整个文件文本；忽略空行，保留注释行与不可解析行
export function parseFile(text) {
  const normalized = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const entries = [];
  for (const line of normalized.split('\n')) {
    if (line.trim() === '') continue;
    if (line.trim().startsWith('#')) {
      entries.push({ id: makeId(line), kind: 'comment', raw: line });
      continue;
    }
    entries.push(parseSingleLine(line));
  }
  // 重复 ID 只认第一个（复制粘贴 / 手工编辑常见的后果）。
  // 后来者置空而不是改号：改号等于替用户决定"哪条是真的"，而置空后
  // 它会在下次被编辑时重新领一个号 —— 那时候的上下文才足以判断谁是谁。
  const seen = new Set();
  for (const e of entries) {
    if (e.kind !== 'task' || !e.stableId) continue;
    if (seen.has(e.stableId)) e.stableId = null;
    else seen.add(e.stableId);
  }
  return entries;
}

// 序列化单个任务为 todo.txt 行
// 活跃行：[优先级] 创建日期 标题 @ctx +proj due: t: star: id: 其他key:val
// 完成行：x 完成日期 创建日期 [优先级] 标题 ...（与 done.txt 实际数据一致）
//
// id: 排在用户自写标签（extraTags）**之前**：它是我们加的元数据，放最后会把用户
// 自己写的标签顶到中间去，读起来像"任务正文里混了个 id"。
export function serializeTask(task) {
  if (task.kind !== 'task') return task.raw;
  const parts = [];
  if (task.completed) {
    parts.push('x');
    if (task.completedAt) parts.push(task.completedAt);
    if (task.createdAt) parts.push(task.createdAt);
    if (task.priority) parts.push(`(${task.priority})`);
  } else {
    if (task.priority) parts.push(`(${task.priority})`);
    if (task.createdAt) parts.push(task.createdAt);
  }
  if (task.title) parts.push(task.title);
  task.contexts.forEach((c) => parts.push(`@${c}`));
  task.projects.forEach((p) => parts.push(`+${p}`));
  if (task.dueDate) parts.push(`due:${task.dueDate}`);
  if (task.thresholdDate) parts.push(`t:${task.thresholdDate}`);
  if (task.remindAt) parts.push(`rem:${task.remindAt}`);
  if (task.starValue) parts.push(`star:${task.starValue}`);
  if (task.recurrence) parts.push(`rec:${task.recurrence}`);
  if (task.stableId) parts.push(`id:${task.stableId}`);
  if (task.parentId) parts.push(`parent:${task.parentId}`);
  task.extraTags.forEach(({ key, value }) => parts.push(`${key}:${value}`));
  const result = parts.join(' ').trim();
  return result || task.raw;
}

export function serializeEntries(entries) {
  const lines = entries.map((e) => (e.kind === 'task' ? serializeTask(e) : e.raw.trimEnd()));
  return lines.length > 0 ? `${lines.join('\n')}\n` : '';
}

// 应用字段补丁并重算 raw
export function applyPatch(task, patch) {
  const merged = { ...task, ...patch };
  merged.raw = serializeTask(merged);
  return merged;
}

// 完成任务（保留优先级，序列化时移到日期之后，与 done.txt 现有格式一致）
export function completeTask(task, todayStr) {
  const completed = {
    ...task,
    completed: true,
    completedAt: todayStr,
  };
  completed.raw = serializeTask(completed);
  return completed;
}

// 撤销完成 / 取消完成
export function reviveTask(task) {
  const revived = {
    ...task,
    completed: false,
    completedAt: null,
  };
  revived.raw = serializeTask(revived);
  return revived;
}

// 快速添加输入框的实时解析（(A) 可出现在任意位置）
export function parseQuickInput(str) {
  const result = {
    priority: null,
    title: '',
    contexts: [],
    projects: [],
    dueDate: null,
    thresholdDate: null,
    remindAt: null,
    starValue: null,
    recurrence: null,
    extraTags: [],
  };
  const titleParts = [];
  for (const word of String(str || '').trim().split(/\s+/)) {
    if (!word) continue;
    const prio = QUICK_PRIORITY_RE.exec(word);
    if (prio) {
      result.priority = prio[1].toUpperCase();
      continue;
    }
    const proj = PROJECT_RE.exec(word);
    if (proj) {
      result.projects.push(proj[1]);
      continue;
    }
    const ctx = CONTEXT_RE.exec(word);
    if (ctx) {
      result.contexts.push(ctx[1]);
      continue;
    }
    const tag = TAG_RE.exec(word);
    if (tag) {
      const key = tag[1];
      const value = tag[2];
      if (key === 'due' && !result.dueDate) result.dueDate = value;
      else if (key === 't' && !result.thresholdDate) result.thresholdDate = value;
      else if (key === 'rem' && !result.remindAt && isValidRemind(value)) result.remindAt = value;
      else if (key === 'star' && !result.starValue) result.starValue = value;
      // rec: 在快速添加里是**允许用户手打**的（「每周一交周报 rec:mon」），
      // 它不像 id:/parent: 那样是系统分配的引用关系。
      else if (key === 'rec') {
        if (!result.recurrence && parseRecurrence(value)) result.recurrence = value.trim().toLowerCase();
        else result.extraTags.push({ key, value });
      } else result.extraTags.push({ key, value });
      continue;
    }
    titleParts.push(word);
  }
  result.title = titleParts.join(' ');
  return result;
}

/** 给一条凭空造出来的任务分配运行时 ID（例如重复规则生成的下一次实例）。 */
export function newTaskId(seedText) {
  return makeId(String(seedText || ''));
}

// 由快速添加输入构造完整任务（自动补当天创建日期）
export function taskFromQuickInput(str, todayStr) {
  const parsed = parseQuickInput(str);
  // 输入框里手打的 id: / parent: 一律丢弃：这两个是系统分配的引用关系，
  // 让用户写一个上来只会制造重复 ID 和挂不上的父子。
  parsed.extraTags = parsed.extraTags.filter((t) => t.key !== 'id' && t.key !== 'parent');
  const task = {
    ...baseTask(),
    ...parsed,
    id: makeId(`${str}|${todayStr}`),
    createdAt: todayStr,
    raw: '',
  };
  task.raw = serializeTask(task);
  return task;
}
