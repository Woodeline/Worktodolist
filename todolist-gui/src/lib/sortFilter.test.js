import { describe, expect, it } from 'vitest';
import {
  compareAuto,
  isOverdue,
  isVisibleToday,
  searchMatch,
  sidebarStats,
  sortTasks,
  tasksForView,
  todayGroups,
} from './sortFilter';
import { parseFile } from './todoParser';

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
