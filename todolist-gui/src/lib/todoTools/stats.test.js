import { describe, expect, it } from 'vitest';
import {
  completionTrend,
  contextHistogram,
  dueBucketOf,
  dueHistogram,
  loadBuckets,
  priorityHistogram,
  projectHistogram,
  weekCompletion,
} from './stats.js';

const TODAY = '2026-10-07'; // 周三 → 本周 2026-10-05 ~ 2026-10-11

function task(fields) {
  return {
    id: fields.id || fields.title,
    kind: 'task',
    raw: fields.title,
    completed: false,
    completedAt: null,
    createdAt: null,
    priority: null,
    title: fields.title || '',
    contexts: [],
    projects: [],
    dueDate: null,
    thresholdDate: null,
    starValue: null,
    extraTags: [],
    ...fields,
  };
}

describe('priorityHistogram', () => {
  it('A/B/C/无 四行固定且带百分比', () => {
    const rows = priorityHistogram([
      task({ title: '1', priority: 'A' }),
      task({ title: '2', priority: 'A' }),
      task({ title: '3', priority: 'B' }),
      task({ title: '4' }),
    ]);
    expect(rows.map((r) => r.key)).toEqual(['A', 'B', 'C', 'none']);
    expect(rows.map((r) => r.count)).toEqual([2, 1, 0, 1]);
    expect(rows.map((r) => r.pct)).toEqual([50, 25, 0, 25]);
    expect(rows[0].label).toBe('A 高');
    expect(rows[3].label).toBe('无');
  });

  it('空数组不崩，计数与百分比归零', () => {
    const rows = priorityHistogram([]);
    expect(rows.every((r) => r.count === 0 && r.pct === 0)).toBe(true);
  });

  it('非常规字母夹在 C 与「无」之间', () => {
    const rows = priorityHistogram([task({ title: 'x', priority: 'D' })]);
    expect(rows.map((r) => r.key)).toEqual(['A', 'B', 'C', 'D', 'none']);
    expect(rows[3].count).toBe(1);
  });
});

describe('contextHistogram / projectHistogram', () => {
  const tasks = [
    task({ title: '1', contexts: ['工作', '工作'], projects: ['周报'] }),
    task({ title: '2', contexts: ['工作'] }),
    task({ title: '3', contexts: ['生活'] }),
  ];

  it('去重后按次数降序', () => {
    const rows = contextHistogram(tasks);
    expect(rows.map((r) => r.key)).toEqual(['工作', '生活']);
    expect(rows.map((r) => r.count)).toEqual([2, 1]);
    expect(rows[0].label).toBe('@工作');
  });

  it('项目直方图', () => {
    const rows = projectHistogram(tasks);
    expect(rows).toEqual([{ key: '周报', label: '+周报', count: 1, pct: 33 }]);
  });

  it('空数组返回空清单', () => {
    expect(contextHistogram([])).toEqual([]);
    expect(projectHistogram([])).toEqual([]);
  });
});

describe('dueBucketOf / dueHistogram', () => {
  it('五桶判定', () => {
    expect(dueBucketOf(task({ title: 'a', dueDate: '2026-10-01' }), TODAY)).toBe('overdue');
    expect(dueBucketOf(task({ title: 'b', dueDate: '2026-10-07' }), TODAY)).toBe('today');
    expect(dueBucketOf(task({ title: 'c', dueDate: '2026-10-09' }), TODAY)).toBe('week');
    expect(dueBucketOf(task({ title: 'd', dueDate: '2026-10-20' }), TODAY)).toBe('later');
    expect(dueBucketOf(task({ title: 'e' }), TODAY)).toBe('none');
  });

  it('直方图五行固定', () => {
    const rows = dueHistogram(
      [
        task({ title: 'a', dueDate: '2026-10-01' }),
        task({ title: 'b', dueDate: '2026-10-01' }),
        task({ title: 'c', dueDate: '2026-10-07' }),
        task({ title: 'd' }),
      ],
      TODAY
    );
    expect(rows.map((r) => r.key)).toEqual(['overdue', 'today', 'week', 'later', 'none']);
    expect(rows.map((r) => r.count)).toEqual([2, 1, 0, 0, 1]);
  });
});

describe('completionTrend', () => {
  const done = [
    task({ title: '1', completed: true, completedAt: '2026-10-07' }),
    task({ title: '2', completed: true, completedAt: '2026-10-05' }),
    task({ title: '3', completed: true, completedAt: '2026-10-05' }),
    task({ title: '4', completed: true, completedAt: '2026-09-01' }),
  ];

  it('连续日期且缺的补 0', () => {
    const trend = completionTrend(done, TODAY, 3);
    expect(trend).toEqual([
      { date: '2026-10-05', count: 2 },
      { date: '2026-10-06', count: 0 },
      { date: '2026-10-07', count: 1 },
    ]);
  });

  it('默认 14 天', () => {
    expect(completionTrend(done, TODAY)).toHaveLength(14);
  });

  it('空数组补 0 不崩', () => {
    const trend = completionTrend([], TODAY, 2);
    expect(trend).toEqual([
      { date: '2026-10-06', count: 0 },
      { date: '2026-10-07', count: 0 },
    ]);
  });
});

describe('loadBuckets / weekCompletion', () => {
  it('按五桶分组', () => {
    const b = loadBuckets(
      [
        task({ title: '逾期', dueDate: '2026-10-01' }),
        task({ title: '今天', dueDate: '2026-10-07' }),
        task({ title: '本周', dueDate: '2026-10-09' }),
        task({ title: '以后', dueDate: '2026-10-20' }),
        task({ title: '无', dueDate: null }),
      ],
      TODAY
    );
    expect(b.overdue.map((t) => t.title)).toEqual(['逾期']);
    expect(b.today.map((t) => t.title)).toEqual(['今天']);
    expect(b.week.map((t) => t.title)).toEqual(['本周']);
    expect(b.later.map((t) => t.title)).toEqual(['以后']);
    expect(b.none.map((t) => t.title)).toEqual(['无']);
  });

  it('周完成计数', () => {
    const done = [
      task({ title: 'x', completed: true, completedAt: '2026-10-06' }),
      task({ title: 'y', completed: true, completedAt: '2026-10-02' }),
    ];
    expect(weekCompletion(done, TODAY)).toBe(1);
  });
});
