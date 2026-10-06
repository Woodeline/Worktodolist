// todo.txt 解析器与序列化器（纯函数，无浏览器依赖）
// 行为对齐 topydo 0.16（TodoParser.py / TodoBase.py）：
// - 完成行头：x [完成日期] [创建日期] 其余
// - 活跃行头：[优先级] [创建日期] 其余
// - 完成行中的优先级位于两个日期之后（与 done.txt 实际数据一致）
// - 时间片段（如 13:45）不视为 key:value 标签

const COMPLETED_HEAD_RE = /^(?:(\d{4}-\d{2}-\d{2}) )?(?:(\d{4}-\d{2}-\d{2}) )?(.*)$/;
const NORMAL_HEAD_RE = /^(?:\(([A-Z])\) )?(?:(\d{4}-\d{2}-\d{2}) )?(.*)$/;
const PRIORITY_RE = /^(?:\(([A-Z])\) )?(.*)$/;
const TAG_RE = /^(?![0-9+]{1,2}:[0-9]{1,2}$)([^:\s]+):(.+)$/;
const PROJECT_RE = /^\+(\S*[\p{L}\p{N}_])$/u;
const CONTEXT_RE = /^@(\S*[\p{L}\p{N}_])$/u;
const QUICK_PRIORITY_RE = /^\(([A-Za-z])\)$/;

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
    starValue: null,
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
      else if (key === 'star' && !task.starValue) task.starValue = value;
      else task.extraTags.push({ key, value });
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
  return entries;
}

// 序列化单个任务为 todo.txt 行
// 活跃行：[优先级] 创建日期 标题 @ctx +proj due: t: star: 其他key:val
// 完成行：x 完成日期 创建日期 [优先级] 标题 ...（与 done.txt 实际数据一致）
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
  if (task.starValue) parts.push(`star:${task.starValue}`);
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
    starValue: null,
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
      else if (key === 'star' && !result.starValue) result.starValue = value;
      else result.extraTags.push({ key, value });
      continue;
    }
    titleParts.push(word);
  }
  result.title = titleParts.join(' ');
  return result;
}

// 由快速添加输入构造完整任务（自动补当天创建日期）
export function taskFromQuickInput(str, todayStr) {
  const parsed = parseQuickInput(str);
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
