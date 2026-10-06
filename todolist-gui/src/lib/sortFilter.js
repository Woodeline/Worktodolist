// 视图过滤 / 排序 / 搜索 / 统计（纯函数，日期用 YYYY-MM-DD 字符串比较）

export const PRIORITY_LABELS = { A: '高', B: '中', C: '低' };

export function isOverdue(task, today) {
  return !task.completed && Boolean(task.dueDate) && task.dueDate < today;
}

export function isDueToday(task, today) {
  return !task.completed && task.dueDate === today;
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

export function activeTasks(entries) {
  return entries.filter((e) => e.kind === 'task' && !e.completed);
}

export function tasksForView(entries, view, today) {
  const tasks = entries.filter((e) => e.kind === 'task');
  switch (view) {
    case 'today':
      return tasks.filter((t) => isVisibleToday(t, today));
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

// 今天视图分组：逾期 / 今日到期 / 无日期
export function todayGroups(tasks, today) {
  const overdue = [];
  const dueToday = [];
  const noDate = [];
  for (const t of tasks) {
    if (t.dueDate && t.dueDate < today) overdue.push(t);
    else if (t.dueDate === today) dueToday.push(t);
    else noDate.push(t);
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
