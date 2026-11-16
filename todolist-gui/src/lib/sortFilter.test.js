import { describe, expect, it } from 'vitest';
import {
  compareAuto,
  displayOrder,
  isOverdue,
  isVisibleToday,
  searchMatch,
  sidebarStats,
  sortTasks,
  tasksForView,
  todayGroups,
  viewTasks,
} from './sortFilter';
import { parseFile } from './todoParser';
import { buildNesting } from './subtasks.js';

const TODAY = '2026-09-30';

function task(fields) {
  return {
    id: fields.title,
    kind: 'task',
    raw: fields.title,
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
    ...fields,
  };
}

describe('逾期与今日判断', () => {
  it('isOverdue', () => {
    expect(isOverdue(task({ title: 'a', dueDate: '2026-09-25' }), TODAY)).toBe(true);
    expect(isOverdue(task({ title: 'b', dueDate: '2026-09-30' }), TODAY)).toBe(false);
    expect(isOverdue(task({ title: 'c', dueDate: '2026-09-25', completed: true }), TODAY)).toBe(false);
    expect(isOverdue(task({ title: 'd' }), TODAY)).toBe(false);
  });

  it('isVisibleToday 隐藏未到期阈值任务', () => {
    expect(isVisibleToday(task({ title: 'a', thresholdDate: '2026-10-05' }), TODAY)).toBe(false);
    expect(isVisibleToday(task({ title: 'b', thresholdDate: '2026-09-01' }), TODAY)).toBe(true);
    expect(isVisibleToday(task({ title: 'c', dueDate: '2026-10-10' }), TODAY)).toBe(false);
    expect(isVisibleToday(task({ title: 'd', dueDate: '2026-09-30' }), TODAY)).toBe(true);
    expect(isVisibleToday(task({ title: 'e' }), TODAY)).toBe(true);
  });
});

describe('视图过滤', () => {
  const entries = [
    task({ title: '逾期', dueDate: '2026-09-25', contexts: ['工作'] }),
    task({ title: '今日', dueDate: '2026-09-30', contexts: ['工作'] }),
    task({ title: '未来', dueDate: '2026-10-10', projects: ['回测'] }),
    task({ title: '无日期' }),
    task({ title: '阈值未到', thresholdDate: '2026-10-05' }),
  ];

  it('today 视图仅含逾期/今日/无日期', () => {
    const titles = tasksForView(entries, 'today', TODAY).map((t) => t.title);
    expect(titles).toEqual(['逾期', '今日', '无日期']);
  });

  it('upcoming 视图 = 未完成 + 有截止日 + 严格晚于今天', () => {
    const titles = tasksForView(entries, 'upcoming', TODAY).map((t) => t.title);
    expect(titles).toEqual(['未来']);
  });

  it('inbox 视图 = 无 @ 任务', () => {
    const titles = tasksForView(entries, 'inbox', TODAY).map((t) => t.title);
    expect(titles).toEqual(['未来', '无日期', '阈值未到']);
  });

  it('@分类 / +项目 过滤', () => {
    expect(tasksForView(entries, '@:工作', TODAY).map((t) => t.title)).toEqual(['逾期', '今日']);
    expect(tasksForView(entries, '+:回测', TODAY).map((t) => t.title)).toEqual(['未来']);
  });
});

describe('排序', () => {
  it('手动模式保持文件顺序', () => {
    const list = [task({ title: 'b', priority: 'B' }), task({ title: 'a', priority: 'A' })];
    expect(sortTasks(list, 'manual').map((t) => t.title)).toEqual(['b', 'a']);
  });

  it('自动模式：优先级升序 → due 升序（空值最后）', () => {
    const list = [
      task({ title: 'B', priority: 'B' }),
      task({ title: 'A-late', priority: 'A', dueDate: '2026-10-10' }),
      task({ title: 'A-none', priority: 'A' }),
      task({ title: 'A-early', priority: 'A', dueDate: '2026-10-01' }),
      task({ title: 'none', priority: null }),
    ];
    expect(sortTasks(list, 'auto').map((t) => t.title)).toEqual([
      'A-early',
      'A-late',
      'A-none',
      'B',
      'none',
    ]);
  });

  it('完成项排在末尾', () => {
    const list = [task({ title: 'done', completed: true, priority: 'A' }), task({ title: 'todo', priority: 'B' })];
    expect([...list].sort(compareAuto).map((t) => t.title)).toEqual(['todo', 'done']);
  });
});

describe('todayGroups / search / sidebarStats', () => {
  it('todayGroups 分组', () => {
    const groups = todayGroups(
      [
        task({ title: '逾期', dueDate: '2026-09-25' }),
        task({ title: '今日', dueDate: '2026-09-30' }),
        task({ title: '无日期' }),
      ],
      TODAY
    );
    expect(groups.overdue.map((t) => t.title)).toEqual(['逾期']);
    expect(groups.dueToday.map((t) => t.title)).toEqual(['今日']);
    expect(groups.noDate.map((t) => t.title)).toEqual(['无日期']);
  });

  it('searchMatch 标题与全文', () => {
    const t = task({ title: '写报告', raw: '写报告 @工作' });
    expect(searchMatch(t, '报告')).toBe(true);
    expect(searchMatch(t, '工作')).toBe(true);
    expect(searchMatch(t, '不存在')).toBe(false);
    expect(searchMatch(t, '')).toBe(true);
  });

  it('sidebarStats 计数', () => {
    const entries = parseFile(
      [
        '(A) 2026-09-20 任务1 @工作 +周报',
        '2026-09-20 任务2 @工作',
        '2026-09-20 收集箱',
      ].join('\n')
    );
    const stats = sidebarStats(entries);
    expect(stats.inbox).toBe(1);
    expect(stats.contexts).toEqual([{ name: '工作', count: 2 }]);
    expect(stats.projects).toEqual([{ name: '周报', count: 1 }]);
  });
});

describe('列表显示顺序（键盘上下移动的口径）', () => {
  const entries = [
    task({ title: '逾期', dueDate: '2026-09-25' }),
    task({ title: '今日', dueDate: '2026-09-30' }),
    task({ title: '无日期' }),
    task({ title: '未来', dueDate: '2026-10-10' }),
  ];

  it('today 视图：逾期 → 今日到期 → 无日期', () => {
    const titles = displayOrder(entries, 'today', 'manual', '', TODAY).map((t) => t.title);
    // 未来任务不在 today 视图内
    expect(titles).toEqual(['逾期', '今日', '无日期']);
  });

  it('all 视图 = viewTasks 的排序结果', () => {
    const ordered = displayOrder(entries, 'all', 'auto', '', TODAY).map((t) => t.title);
    const same = viewTasks(entries, 'all', 'auto', '', TODAY).map((t) => t.title);
    expect(ordered).toEqual(same);
  });

  it('upcoming 视图：截止日升序压过排序模式（手动/自动都一样）', () => {
    const future = [
      task({ title: 'late', dueDate: '2026-10-10', priority: 'A' }),
      task({ title: 'early', dueDate: '2026-10-02', priority: 'C' }),
    ];
    for (const mode of ['manual', 'auto']) {
      const titles = displayOrder(future, 'upcoming', mode, '', TODAY).map((t) => t.title);
      expect(titles).toEqual(['early', 'late']);
    }
  });

  it('搜索过滤后顺序随之收窄', () => {
    const titles = displayOrder(entries, 'all', 'manual', '任务', TODAY).map((t) => t.title);
    expect(titles).toEqual([]); // 这批任务的标题都不含“任务”
    const hit = displayOrder(entries, 'all', 'manual', '日期', TODAY).map((t) => t.title);
    expect(hit).toEqual(['无日期']);
  });
});

// 2026-11-16：子任务在「今天」「即将到期」两个视图里的行为（bug 修复的钉子）。
// 「今天」过去刻意不建层级（父子被拆到不同分组、缩进没意义），结果是那里
// 连展开箭头都没有；「即将到期」反过来：箭头有（childProgress 数全部子任务），
// 点开却是空的（nestChildren 只认本屏可见的子任务）。
describe('子任务在「今天」/「即将到期」里的可见性', () => {
  const T = (lines) => parseFile(lines.join('\n'));
  // 买硬盘带一个未来的阈值日期：这是"今天看不见、但父项在「即将到期」里"的
  // 典型形态 —— 也正是「有箭头、点开为空」的那条真实数据。
  const entries = T([
    '装机 id:aaa111 due:2026-09-30',      // 今天到期
    '拆后盖 parent:aaa111',                // 子任务，无截止日 → 今天落在「无日期」
    '备份 id:bbb222 due:2026-10-05',      // 将来到期
    '买硬盘 parent:bbb222 t:2026-10-05',   // 子任务，阈值未到 → 今天不出现
    '单独一条 due:2026-09-30',
  ]);

  it('「今天」也保留父前子后：子任务紧随父任务', () => {
    const titles = viewTasks(entries, 'today', 'auto', '', TODAY).map((t) => t.title);
    expect(titles).toEqual(['装机', '拆后盖', '单独一条']);
  });

  it('「今天」分组里子任务跟着父任务走，不会被拆到「无日期」组', () => {
    const nested = viewTasks(entries, 'today', 'auto', '', TODAY);
    const g = todayGroups(nested, TODAY, buildNesting(entries));
    expect(g.dueToday.map((t) => t.title)).toEqual(['装机', '拆后盖', '单独一条']);
    expect(g.noDate).toEqual([]);
  });

  it('「今天」的 displayOrder 与分组后的顺序一致（键盘 ↑↓ 与渲染同源）', () => {
    const ordered = displayOrder(entries, 'today', 'auto', '', TODAY).map((t) => t.title);
    expect(ordered).toEqual(['装机', '拆后盖', '单独一条']);
  });

  it('「即将到期」把父项的后代一并带上（否则箭头点开是空的）', () => {
    const titles = viewTasks(entries, 'upcoming', 'auto', '', TODAY).map((t) => t.title);
    expect(titles).toEqual(['备份', '买硬盘']);
  });

  it('「即将到期」搜索时不补后代（搜索是在收窄，不能凭空多行）', () => {
    const titles = viewTasks(entries, 'upcoming', 'auto', '备份', TODAY).map((t) => t.title);
    expect(titles).toEqual(['备份']);
  });

  it('todayGroups 不传 nesting 时保持老行为（父在前、子按自己的日期归组）', () => {
    const flat = tasksForView(entries, 'today', TODAY);
    const g = todayGroups(flat, TODAY);
    expect(g.dueToday.map((t) => t.title)).toEqual(['装机', '单独一条']);
    expect(g.noDate.map((t) => t.title)).toEqual(['拆后盖']);
  });
});
