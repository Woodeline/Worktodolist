import { describe, expect, it } from 'vitest';
import { buildWeeklyReport, weekRange } from './weekly.js';

// 2026-10-07 是周三 → 本周（周一起算）为 2026-10-05 ~ 2026-10-11
const TODAY = '2026-10-07';

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

describe('weekRange 周区间', () => {
  it('周一起算：本周', () => {
    expect(weekRange(TODAY)).toEqual({
      from: '2026-10-05',
      to: '2026-10-11',
      label: '2026-10-05 ~ 2026-10-11',
    });
  });

  it('偏移周：上一周 / 下一周', () => {
    expect(weekRange(TODAY, { weeksAgo: 1 }).from).toBe('2026-09-28');
    expect(weekRange(TODAY, { weeksAgo: 1 }).to).toBe('2026-10-04');
    expect(weekRange(TODAY, { weeksAgo: -1 }).from).toBe('2026-10-12');
    expect(weekRange(TODAY, { weeksAgo: -1 }).to).toBe('2026-10-18');
  });

  it('跨月边界（周四落在上月末）', () => {
    const r = weekRange('2026-10-01');
    expect(r.from).toBe('2026-09-28');
    expect(r.to).toBe('2026-10-04');
  });

  it('跨年边界（元旦落在上一年末）', () => {
    const r = weekRange('2026-01-01');
    expect(r.from).toBe('2025-12-29');
    expect(r.to).toBe('2026-01-04');
  });

  it('startOfWeek=0 时按周日起算', () => {
    expect(weekRange(TODAY, { startOfWeek: 0 })).toEqual({
      from: '2026-10-04',
      to: '2026-10-10',
      label: '2026-10-04 ~ 2026-10-10',
    });
  });
});

describe('buildWeeklyReport 完成项筛选与统计', () => {
  const done = [
    task({ title: '本周一完成', completed: true, completedAt: '2026-10-05', contexts: ['工作'], projects: ['周报'] }),
    task({ title: '本周三完成', completed: true, completedAt: '2026-10-07', contexts: ['工作'] }),
    task({ title: '上周完成', completed: true, completedAt: '2026-10-02' }),
    task({ title: '无完成日期', completed: true, completedAt: null }),
  ];
  const tasks = [
    task({ title: '本周到期', dueDate: '2026-10-06' }),
    task({ title: '下周待办', dueDate: '2026-10-13' }),
    task({ title: '已逾期', dueDate: '2026-10-01' }),
    task({ title: '无期限' }),
  ];

  it('只统计落在本周的完成项', () => {
    const r = buildWeeklyReport({ done, tasks, today: TODAY });
    expect(r.stats.doneCount).toBe(2);
    expect(r.from).toBe('2026-10-05');
    expect(r.to).toBe('2026-10-11');
  });

  it('byDay 为连续 7 天且缺的补 0', () => {
    const { byDay } = buildWeeklyReport({ done, tasks, today: TODAY }).stats;
    expect(byDay.map((d) => d.date)).toEqual([
      '2026-10-05',
      '2026-10-06',
      '2026-10-07',
      '2026-10-08',
      '2026-10-09',
      '2026-10-10',
      '2026-10-11',
    ]);
    expect(byDay.map((d) => d.count)).toEqual([1, 0, 1, 0, 0, 0, 0]);
  });

  it('到期 / 逾期 / 活跃计数', () => {
    const { stats } = buildWeeklyReport({ done, tasks, today: TODAY });
    expect(stats.dueCount).toBe(1); // 本周到期
    expect(stats.overdueCount).toBe(2); // 已逾期 + 本周到期但已过今天
    expect(stats.activeCount).toBe(4);
  });

  it('分类 / 项目分布按本周完成项统计', () => {
    const { stats } = buildWeeklyReport({ done, tasks, today: TODAY });
    expect(stats.contextCounts).toEqual([{ name: '工作', count: 2 }]);
    expect(stats.projectCounts).toEqual([{ name: '周报', count: 1 }]);
  });

  it('Markdown 含各小节且能粘走', () => {
    const { markdown } = buildWeeklyReport({ done, tasks, today: TODAY });
    expect(markdown).toContain('# 周报 · 2026-10-05 ~ 2026-10-11');
    expect(markdown).toContain('## 概览');
    expect(markdown).toContain('## 本周完成');
    expect(markdown).toContain('## 下周待办');
    expect(markdown).toContain('## 每日完成');
    expect(markdown).toContain('## 分类分布');
    expect(markdown).toContain('## 项目分布');
    expect(markdown).toContain('- [x] 本周三完成');
  });

  it('切换偏移周只影响对应区间', () => {
    const r = buildWeeklyReport({ done, tasks, today: TODAY, weeksAgo: 1 });
    expect(r.from).toBe('2026-09-28');
    expect(r.stats.doneCount).toBe(1); // 只有 10-02 那条
  });
});

describe('空数据不崩', () => {
  it('全空输入产出空周报', () => {
    const r = buildWeeklyReport({ done: [], tasks: [], today: TODAY });
    expect(r.stats.doneCount).toBe(0);
    expect(r.stats.activeCount).toBe(0);
    expect(r.stats.byDay).toHaveLength(7);
    expect(r.markdown).toContain('## 本周完成');
    expect(r.markdown).toContain('_（无）_');
  });

  it('缺省参数也不抛异常', () => {
    const r = buildWeeklyReport();
    expect(typeof r.markdown).toBe('string');
  });
});
