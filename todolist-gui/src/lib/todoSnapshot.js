// 任务快照：给工具页（以及 T3 待办域工具）一个**只读**的任务视图。
//
// 为什么需要它：工具若自己 `useTodoStore()`，会产出**第二个 store 实例** ——
// 两份状态各自演化，写入必然打架。所以整条链路的做法是：
//   App 层从唯一实例投影出一个只读子集 → ToolsPage 透传 → 具体工具消费。
//
// 这一层是纯函数（可单测），派生逻辑一律复用 lib/sortFilter.js，不重写。
//
// 硬约束：返回对象里**不许出现任何变更方法**（没有 addTask / updateTask / undo…）。
// 这不是口头约定 —— Object.freeze + 单测一起把它钉住。工具的写入口只有一条：
// 经「提议 → 用户确认 → dispatch」的落盘通道（见 lib/proposals.js）。
import { activeTasks, sidebarStats, sortTasks, todayGroups } from './sortFilter.js';

/**
 * @param {object} src
 * @param {Array} src.todoEntries 唯一 store 的 todo.txt 条目
 * @param {Array} src.doneEntries 唯一 store 的 done.txt 条目
 * @param {string} src.today 'YYYY-MM-DD'
 * @param {string} [src.sortMode] 'manual' | 'auto'
 * @returns {object} 冻结的只读快照
 */
export function buildTodoSnapshot(src = {}) {
  const {
    todoEntries = [],
    doneEntries = [],
    today = '',
    sortMode = 'auto',
    dirReady = false,
    saveStatus = 'saved',
    lastSavedAt = null,
    view = 'today',
  } = src;

  const tasks = sortTasks(activeTasks(todoEntries), sortMode === 'manual' ? 'manual' : 'auto');
  const done = doneEntries
    .filter((e) => e.kind === 'task')
    .slice()
    .sort((a, b) => String(b.completedAt || '').localeCompare(String(a.completedAt || '')));
  const raw = todoEntries.filter((e) => e.kind === 'raw');
  const groups = todayGroups(tasks, today);
  const stats = sidebarStats(todoEntries);

  const snapshot = {
    today,
    tasks,
    done,
    raw,
    groups,
    counts: {
      active: tasks.length,
      done: done.length,
      overdue: groups.overdue.length,
      dueToday: groups.dueToday.length,
      inbox: stats.inbox,
      raw: raw.length,
    },
    contexts: stats.contexts,
    projects: stats.projects,
    dirReady,
    saveStatus,
    lastSavedAt,
    view,
    sortMode,
  };

  // 只冻结顶层：工具要排序/过滤请自己复制（`[...tasks]`）。
  // 冻结的意义是让"投影里没有写入口"成为运行时事实，而不是一句注释。
  return Object.freeze(snapshot);
}

/** 快照里是否含任何函数型字段（只读断言用；正常应恒为 false）。 */
export function hasMutators(snapshot) {
  return Object.values(snapshot || {}).some((v) => typeof v === 'function');
}
