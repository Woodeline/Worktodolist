// 周报导出（纯函数）—— 只读：把 done.txt / todo.txt 现场汇总成一份中文 Markdown 周报。
//
// 为什么单独放一层：周报是"视图"而不是"数据"，它不该写任何文件，也不该改任何状态。
// 因此全部逻辑收敛在这里的纯函数里（可单测），组件只负责选择周偏移与复制文本。
import dayjs from 'dayjs';

const isTask = (t) => Boolean(t) && t.kind === 'task';
const inRange = (date, from, to) => Boolean(date) && date >= from && date <= to;

/**
 * 周区间（默认周一起算）。
 *
 * @param {string} today 'YYYY-MM-DD'
 * @param {{weeksAgo?:number, startOfWeek?:number}} [opts]
 *   weeksAgo   0=本周，1=上一周，-1=下一周
 *   startOfWeek 0=周日，1=周一（默认）
 * @returns {{from:string, to:string, label:string}}
 */
export function weekRange(today, opts = {}) {
  const { weeksAgo = 0, startOfWeek = 1 } = opts;
  const base = dayjs(today);
  const offset = (base.day() - startOfWeek + 7) % 7;
  const start = base.subtract(offset, 'day').subtract(Number(weeksAgo) || 0, 'week');
  const from = start.format('YYYY-MM-DD');
  const to = start.add(6, 'day').format('YYYY-MM-DD');
  return { from, to, label: `${from} ~ ${to}` };
}

/** 统计一组任务里各 @分类 / +项目 的出现次数（同一任务内去重），按次数降序。 */
function countBy(list, pick) {
  const map = new Map();
  for (const t of list) {
    for (const key of new Set(pick(t) || [])) {
      map.set(key, (map.get(key) || 0) + 1);
    }
  }
  return [...map.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'zh'));
}

/** 一条任务的 Markdown 行尾注（@分类 +项目 (截止 …)）。 */
function tail(task, extra) {
  const bits = [];
  for (const c of task.contexts || []) bits.push(`@${c}`);
  for (const p of task.projects || []) bits.push(`+${p}`);
  if (extra) bits.push(extra);
  return bits.length ? ` ${bits.join(' ')}` : '';
}

function bulletLines(list, box, note) {
  return list.map((t) => `- [${box}] ${t.title}${tail(t, note ? note(t) : '')}`);
}

function section(title, lines) {
  return `## ${title}\n\n${lines.length ? lines.join('\n') : '_（无）_'}\n`;
}

/** 组装中文 Markdown 周报。 */
function renderWeekly({ range, next, doneInWeek, nextWeek, stats, today }) {
  const overview = [
    `- 本周完成：${stats.doneCount} 条`,
    `- 活跃待办：${stats.activeCount} 条`,
    `- 本周到期：${stats.dueCount} 条`,
    `- 逾期未完成：${stats.overdueCount} 条`,
  ];

  const daily = stats.byDay.map((d) => `- ${d.date}：${d.count} 条`);

  const md = [];
  md.push(`# 周报 · ${range.label}`);
  md.push('');
  md.push(section('概览', overview));
  md.push(section('本周完成', bulletLines(doneInWeek, 'x', (t) => (t.completedAt ? `完成于 ${t.completedAt}` : ''))));
  md.push(section('下周待办', bulletLines(nextWeek, ' ', (t) => (t.dueDate ? `截止 ${t.dueDate}` : ''))));
  md.push(section('每日完成', daily));
  md.push(section('分类分布', stats.contextCounts.map((c) => `- @${c.name}：${c.count} 条`)));
  md.push(section('项目分布', stats.projectCounts.map((p) => `- +${p.name}：${p.count} 条`)));
  return md.join('\n');
}

/**
 * 生成一份周报（含 Markdown 与统计）。
 *
 * @param {{done?:Array, tasks?:Array, today:string, weeksAgo?:number}} input
 *   done  已完成任务（含 completedAt）
 *   tasks 活跃任务（含 dueDate）
 * @returns {{from:string, to:string, label:string, markdown:string, stats:object}}
 */
export function buildWeeklyReport(input = {}) {
  const { done = [], tasks = [], today = '', weeksAgo = 0 } = input;
  const range = weekRange(today, { weeksAgo });
  const next = weekRange(today, { weeksAgo: weeksAgo - 1 });

  const doneList = (done || []).filter(isTask);
  const taskList = (tasks || []).filter(isTask);

  const doneInWeek = doneList.filter((t) => inRange(t.completedAt, range.from, range.to));
  const dueInWeek = taskList.filter((t) => inRange(t.dueDate, range.from, range.to));
  const nextWeek = taskList.filter((t) => inRange(t.dueDate, next.from, next.to));
  const overdue = taskList.filter((t) => t.dueDate && today && t.dueDate < today);

  const byDay = [];
  const start = dayjs(range.from);
  for (let i = 0; i < 7; i += 1) {
    const date = start.add(i, 'day').format('YYYY-MM-DD');
    byDay.push({ date, count: doneInWeek.filter((t) => t.completedAt === date).length });
  }

  const stats = {
    doneCount: doneInWeek.length,
    activeCount: taskList.length,
    dueCount: dueInWeek.length,
    overdueCount: overdue.length,
    contextCounts: countBy(doneInWeek, (t) => t.contexts),
    projectCounts: countBy(doneInWeek, (t) => t.projects),
    byDay,
  };

  const markdown = renderWeekly({ range, next, doneInWeek, nextWeek, stats, today });
  return { from: range.from, to: range.to, label: range.label, markdown, stats };
}
