// 视图过滤 / 排序 / 搜索 / 统计（纯函数，日期用 YYYY-MM-DD 字符串比较）
import { buildNesting, nestChildren, withDescendants } from './subtasks.js';

export const PRIORITY_LABELS = { A: '高', B: '中', C: '低' };

export function isOverdue(task, today) {
  return !task.completed && Boolean(task.dueDate) && task.dueDate < today;
}

export function isThresholdReached(task, today) {
  return !task.thresholdDate || task.thresholdDate <= today;
}

// 今天视图可见：未完成、阈值已到、无截止日或截止日<=今天
export function isVisibleToday(task, today) {
  if (task.completed) return false;
  if (!isThresholdReached(task, today)) return false;
  if (!task.dueDate) return true;
  return task.dueDate <= today;
}

// 「即将到期」视图可见：未完成、有截止日、且截止日严格晚于今天。
// 逾期的不算"即将"（它们在「今天」里已有强色提示），无日期的也不算 ——
// 这个视图只回答一个问题："接下来几天有什么等着做"。
export function isUpcoming(task, today) {
  return !task.completed && Boolean(task.dueDate) && task.dueDate > today;
}

export function activeTasks(entries) {
  return entries.filter((e) => e.kind === 'task' && !e.completed);
}

/**
 * 「今天」的可见性继承：**子任务的日期来自父任务的排期**。
 *
 * `isVisibleToday` 只认任务自己的字段（无截止日 = 今天要做），对顶层任务成立，
 * 对子任务不成立：子任务上没有 due 往往只是因为它把排期交给了父任务。于是
 * 「父任务下周到期、子任务没有日期」时，子任务会自己混进「今天」，而父任务
 * 不在这一屏 —— 它带着缩进插进分组末尾，读起来像挂在最后一条任务下面
 * （真实数据里 7 条子任务整段堆在「出差报告」之下，就是这条）。
 *
 * 规则：只有当祖先链上有一条任务也在本屏时，子任务才进来；
 * 例外是它**自己就到期/逾期**（due <= today）—— 那是凭自己的理由进的屏，
 * 进来后按顶层行渲染（父不在本屏，见 subtasks.js 的 nestChildren / depthWithin）。
 *
 * 这个判断必须放在 tasksForView 里而不是渲染层：侧栏计数、底部导航、↑↓ 顺序
 * 都读这里，"看得见几条"与"侧栏报几条"才不会分叉。
 */
export function todayAdmitted(tasks, nesting, today) {
  if (!nesting) return tasks || [];
  const inBase = new Set(tasks.map((t) => t.id));
  const memo = new Map();
  const admitted = (t) => {
    if (memo.has(t.id)) return memo.get(t.id);
    // 先占位再递归：parentOf 已排掉环（buildNesting 里），这里只留一道深链兜底。
    memo.set(t.id, false);
    const parent = nesting.parentOf.get(t.id);
    let ok;
    if (!parent) ok = true; // 顶层：自己的字段已经决定过了
    else if (t.dueDate && t.dueDate <= today) ok = true; // 自己就到期
    else ok = inBase.has(parent.id) ? admitted(parent) : false;
    memo.set(t.id, ok);
    return ok;
  };
  return tasks.filter(admitted);
}

export function tasksForView(entries, view, today, nesting = null) {
  const tasks = entries.filter((e) => e.kind === 'task');
  switch (view) {
    case 'today':
      return todayAdmitted(
        tasks.filter((t) => isVisibleToday(t, today)),
        nesting || buildNesting(entries),
        today
      );
    case 'upcoming':
      return tasks.filter((t) => isUpcoming(t, today));
    case 'all':
      return tasks;
    case 'inbox':
      return tasks.filter((t) => !t.completed && t.contexts.length === 0);
    default:
      if (view.startsWith('@:')) {
        const name = view.slice(2);
        return tasks.filter((t) => !t.completed && t.contexts.includes(name));
      }
      if (view.startsWith('+:')) {
        const name = view.slice(2);
        return tasks.filter((t) => !t.completed && t.projects.includes(name));
      }
      return tasks;
  }
}

// 自动排序：未完成在前 → 优先级字母升序 → due 升序空值最后 → 创建日期升序
export function compareAuto(a, b) {
  if (a.completed !== b.completed) return a.completed ? 1 : -1;
  const prioA = a.priority || '[';
  const prioB = b.priority || '[';
  if (prioA !== prioB) return prioA < prioB ? -1 : 1;
  const dueA = a.dueDate || '9999-99-99';
  const dueB = b.dueDate || '9999-99-99';
  if (dueA !== dueB) return dueA < dueB ? -1 : 1;
  const createdA = a.createdAt || '9999-99-99';
  const createdB = b.createdAt || '9999-99-99';
  if (createdA !== createdB) return createdA < createdB ? -1 : 1;
  return 0;
}

export function sortTasks(tasks, mode) {
  if (mode === 'auto') {
    return [...tasks].sort(compareAuto);
  }
  return tasks; // 手动模式 = 文件行序
}

// 「即将到期」的排序：截止日升序是视图的本意（"接下来几天"按时间走），
// 优先级 / 文件行序都不该压过它。同日再落回 compareAuto（优先级 → 创建序）。
export function compareUpcoming(a, b) {
  const dueA = a.dueDate || '9999-99-99';
  const dueB = b.dueDate || '9999-99-99';
  if (dueA !== dueB) return dueA < dueB ? -1 : 1;
  return compareAuto(a, b);
}

// 当前视图下、经搜索过滤与排序后的任务列表（「今天」视图尚未分组）。
// 主列表与键盘导航共用这一条口径，避免"看得见的顺序"和"上下键走的顺序"分叉。
export function viewTasks(entries, view, sortMode, query, today) {
  const nesting = buildNesting(entries);
  const base = tasksForView(entries, view, today, nesting);
  // 「即将到期」= 有截止日且晚于今天。子任务的截止日往往空着（它回答的是
  // "这事分几步"），于是父项有箭头、点开空空如也 —— 父项在本屏时带上它的后代。
  // 有搜索词时不补：搜索是在收窄，凭空多出没命中的行只会让人怀疑筛选坏了。
  const pool = view === 'upcoming' && !query ? withDescendants(base, nesting) : base;
  const filtered = pool.filter((t) => searchMatch(t, query));
  const sorted =
    view === 'upcoming'
      ? [...filtered].sort(compareUpcoming)
      : sortTasks(filtered, sortMode);
  // 2026-11-16 起「今天」也做嵌套：子任务要能挂在父任务下面展开 / 收起。
  // 分组仍按紧急度走，但组内保持「父前子后」，且子任务跟随父任务所在的分组
  // （见 todayGroups 的 group 继承）—— 否则父在「今天到期」、子落「无日期」，
  // 展开出来的行跑到别的分组去，看着像什么都没发生。
  if (view === 'done') return sorted;
  return nestChildren(sorted, nesting);
}

// 列表自上而下的显示顺序：今天视图按「逾期 → 今日到期 → 无日期」分组，
// 其余视图就是 viewTasks 的顺序。键盘 ↑↓ 移动选中项时以此为准。
export function displayOrder(entries, view, sortMode, query, today) {
  const tasks = viewTasks(entries, view, sortMode, query, today);
  if (view === 'today') {
    const g = todayGroups(tasks, today, buildNesting(entries));
    return [...g.overdue, ...g.dueToday, ...g.noDate];
  }
  return tasks;
}

// 今天视图分组：逾期 / 今日到期 / 无日期。
//
// nesting 可选：给了就让子任务跟着**父任务所在的分组**走。父子被拆到两个分组时，
// 展开父项会"什么都没出现"（子行在另一组里），这正是这一层继承要挡住的事。
export function todayGroups(tasks, today, nesting = null) {
  const overdue = [];
  const dueToday = [];
  const noDate = [];
  const groupOf = new Map(); // 任务 id → 它落在哪个数组
  for (const t of tasks) {
    const parent = nesting ? nesting.parentOf.get(t.id) : null;
    const inherited = parent ? groupOf.get(parent.id) : null;
    if (inherited) {
      inherited.push(t);
      groupOf.set(t.id, inherited);
      continue;
    }
    const target =
      t.dueDate && t.dueDate < today ? overdue : t.dueDate === today ? dueToday : noDate;
    target.push(t);
    groupOf.set(t.id, target);
  }
  return { overdue, dueToday, noDate };
}

export function searchMatch(task, query) {
  if (!query) return true;
  const q = query.toLowerCase();
  return (
    task.title.toLowerCase().includes(q) ||
    (task.raw || '').toLowerCase().includes(q)
  );
}

export function sidebarStats(entries) {
  const tasks = activeTasks(entries);
  const contextMap = new Map();
  const projectMap = new Map();
  let inbox = 0;
  for (const t of tasks) {
    if (t.contexts.length === 0) inbox += 1;
    for (const c of new Set(t.contexts)) {
      contextMap.set(c, (contextMap.get(c) || 0) + 1);
    }
    for (const p of new Set(t.projects)) {
      projectMap.set(p, (projectMap.get(p) || 0) + 1);
    }
  }
  const toList = (map) =>
    [...map.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'zh'));
  return { inbox, contexts: toList(contextMap), projects: toList(projectMap) };
}
