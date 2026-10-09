import { describe, expect, it } from 'vitest';
import {
  WRITE_OPS,
  applicableTasks,
  filterTasks,
  invertIds,
  nextPriorityAfter,
  opNeedsValue,
  selectAllIds,
  summarizeSelection,
  toggleId,
  valueKindOf,
} from './bulkSelect.js';

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

const TASKS = [
  task({ id: 't1', title: '写周报', priority: 'A', contexts: ['工作'], projects: ['汇报'], dueDate: '2026-10-01' }),
  task({ id: 't2', title: '写测试', priority: 'B', contexts: ['工作'], dueDate: '2026-10-07' }),
  task({ id: 't3', title: '买咖啡', contexts: ['生活'] }),
  task({ id: 't4', title: 'Review Code', priority: 'C', projects: ['汇报'], starValue: '1' }),
];

describe('filterTasks', () => {
  it('无筛选条件返回全部任务（忽略 raw 行）', () => {
    const withRaw = [...TASKS, { id: 'r1', kind: 'raw', raw: '乱七八糟一行' }];
    expect(filterTasks(withRaw, {}).map((t) => t.id)).toEqual(['t1', 't2', 't3', 't4']);
  });

  it('关键字对标题不区分大小写', () => {
    expect(filterTasks(TASKS, { keyword: 'review' }).map((t) => t.id)).toEqual(['t4']);
    expect(filterTasks(TASKS, { keyword: '写' }).map((t) => t.id)).toEqual(['t1', 't2']);
  });

  it('分类 / 项目筛选（自动去前缀）', () => {
    expect(filterTasks(TASKS, { context: '@工作' }).map((t) => t.id)).toEqual(['t1', 't2']);
    expect(filterTasks(TASKS, { project: '汇报' }).map((t) => t.id)).toEqual(['t1', 't4']);
  });

  it('优先级筛选，含 none', () => {
    expect(filterTasks(TASKS, { priority: 'A' }).map((t) => t.id)).toEqual(['t1']);
    expect(filterTasks(TASKS, { priority: 'none' }).map((t) => t.id)).toEqual(['t3']);
  });

  it('仅逾期', () => {
    expect(filterTasks(TASKS, { overdueOnly: true, today: TODAY }).map((t) => t.id)).toEqual(['t1']);
  });

  it('多条件叠加', () => {
    const out = filterTasks(TASKS, { context: '工作', priority: 'B', today: TODAY });
    expect(out.map((t) => t.id)).toEqual(['t2']);
  });
});

describe('summarizeSelection', () => {
  it('计数与优先级分布', () => {
    const s = summarizeSelection(TASKS, TODAY);
    expect(s.count).toBe(4);
    expect(s.byPriority).toEqual({ A: 1, B: 1, none: 1, C: 1 });
    expect(s.overdue).toBe(1);
    expect(s.dueToday).toBe(1);
    expect(s.noDue).toBe(2); // t3、t4 无截止日
  });

  it('空选归零', () => {
    const s = summarizeSelection([], TODAY);
    expect(s).toEqual({ count: 0, byPriority: {}, overdue: 0, dueToday: 0, noDue: 0 });
  });
});

describe('选择辅助', () => {
  it('全选 / 反选 / 单行切换', () => {
    expect(selectAllIds(TASKS)).toEqual(['t1', 't2', 't3', 't4']);
    expect(invertIds(TASKS, ['t1', 't3'])).toEqual(['t2', 't4']);
    expect(toggleId(['t1'], 't2')).toEqual(['t1', 't2']);
    expect(toggleId(['t1', 't2'], 't1')).toEqual(['t2']);
  });

  it('反选两次回到原集合', () => {
    const all = selectAllIds(TASKS);
    const none = invertIds(TASKS, all);
    expect(none).toEqual([]);
    expect(invertIds(TASKS, none)).toEqual(all);
  });
});

describe('WRITE_OPS 与 op 适配性', () => {
  it('排除 delete，共 10 种', () => {
    expect(WRITE_OPS).toHaveLength(10);
    expect(WRITE_OPS.some((o) => o.type === 'delete')).toBe(false);
    expect(WRITE_OPS.map((o) => o.type)).toContain('setPriority');
    expect(WRITE_OPS.map((o) => o.type)).toContain('complete');
  });

  it('是否需要值 / 取值类型', () => {
    expect(opNeedsValue('setPriority')).toBe(true);
    expect(valueKindOf('postpone')).toBe('days');
    expect(opNeedsValue('star')).toBe(false);
    expect(valueKindOf('star')).toBe(null);
  });

  it('applicableTasks 只保留真正吃这个 op 的任务', () => {
    // t4 已有星标 → star 对它不适用
    expect(applicableTasks(TASKS, { type: 'star' }, TODAY).map((t) => t.id)).toEqual(['t1', 't2', 't3']);
    // 只有 t4 有星标 → unstar 只对它适用
    expect(applicableTasks(TASKS, { type: 'unstar' }, TODAY).map((t) => t.id)).toEqual(['t4']);
    // addContext 没给值 → 全部不适用
    expect(applicableTasks(TASKS, { type: 'addContext' }, TODAY)).toEqual([]);
    // removeContext '@工作' → 只有带 @工作 的两条
    expect(applicableTasks(TASKS, { type: 'removeContext', value: '@工作' }, TODAY).map((t) => t.id)).toEqual([
      't1',
      't2',
    ]);
  });
});

describe('nextPriorityAfter', () => {
  it('空集合从 A 起，否则取最高字母的下一个', () => {
    expect(nextPriorityAfter([])).toBe('A');
    expect(nextPriorityAfter(TASKS)).toBe('D');
    expect(nextPriorityAfter([task({ title: 'x', priority: 'A' })])).toBe('B');
    expect(nextPriorityAfter([task({ title: 'x', priority: 'Z' })])).toBe('Z');
  });
});
