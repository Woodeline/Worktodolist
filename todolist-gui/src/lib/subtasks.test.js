// 子任务关系（parent: 标签）。
//
// 这一层的失效方式全是"不报错的错"：父子互相认成环会让整组任务从界面上消失、
// 父不在当前视图时子任务会跟着消失、完成的子任务会从进度里蒸发。
// 三种都不抛异常，只表现为"我的任务不见了" —— 所以每一条都写成断言。
import { describe, expect, it } from 'vitest';
import { parseFile } from './todoParser.js';
import {
  buildNesting,
  childProgress,
  childrenOf,
  depthOf,
  filterCollapsed,
  nestChildren,
  withDescendants,
} from './subtasks.js';

const T = (lines) => parseFile(lines.join('\n'));

describe('buildNesting', () => {
  it('认得出父子，算得出进度与层级', () => {
    const entries = T([
      '换硅脂 +硬件 id:aaa111',
      '拆后盖 parent:aaa111',
      '买硅脂 parent:aaa111',
    ]);
    const n = buildNesting(entries);
    const parent = entries[0];
    expect(childrenOf(n, parent.stableId)).toHaveLength(2);
    expect(childProgress(n, parent.stableId)).toEqual({ done: 0, total: 2 });
    expect(depthOf(n, entries[1])).toBe(1);
    expect(depthOf(n, parent)).toBe(0);
  });

  it('parent 指向不存在的 ID → 降级为顶层，绝不消失', () => {
    const entries = T(['孤儿任务 parent:nope1']);
    const n = buildNesting(entries);
    expect(depthOf(n, entries[0])).toBe(0);
    expect(nestChildren(entries, n)).toHaveLength(1);
  });

  it('自己认自己当爹 → 不算父', () => {
    const entries = T(['自恋任务 id:self01 parent:self01']);
    const n = buildNesting(entries);
    expect(depthOf(n, entries[0])).toBe(0);
  });

  it('两人互认父子（环）→ 两条都降级为顶层，不能整组消失', () => {
    const entries = T(['A id:a00001 parent:b00002', 'B id:b00002 parent:a00001']);
    const n = buildNesting(entries);
    expect(depthOf(n, entries[0])).toBe(0);
    expect(depthOf(n, entries[1])).toBe(0);
    expect(nestChildren(entries, n)).toHaveLength(2);
  });

  it('三人成环同样断得开', () => {
    const entries = T([
      'A id:a00001 parent:c00003',
      'B id:b00002 parent:a00001',
      'C id:c00003 parent:b00002',
    ]);
    const n = buildNesting(entries);
    expect(nestChildren(entries, n)).toHaveLength(3);
  });

  it('祖父 → 父 → 子：层级按链累加', () => {
    const entries = T([
      '装机 id:g00001',
      '换硅脂 id:p00002 parent:g00001',
      '拆后盖 id:c00003 parent:p00002',
    ]);
    const n = buildNesting(entries);
    expect(depthOf(n, entries[0])).toBe(0);
    expect(depthOf(n, entries[1])).toBe(1);
    expect(depthOf(n, entries[2])).toBe(2);
  });
});

describe('nestChildren', () => {
  it('子任务紧跟在父任务后面（不管文件里隔多远）', () => {
    const entries = T([
      '拆后盖 parent:aaa111',
      '别的事',
      '换硅脂 id:aaa111',
    ]);
    const n = buildNesting(entries);
    const out = nestChildren(entries, n);
    expect(out.map((t) => t.title)).toEqual(['别的事', '换硅脂', '拆后盖']);
  });

  it('父不在这一屏时，子任务降级为顶层而不是消失', () => {
    // 模拟"搜索把父过滤掉了"：只有子任务进了列表
    const entries = T(['换硅脂 id:aaa111', '拆后盖 parent:aaa111']);
    const n = buildNesting(entries);
    const onlyChild = [entries[1]];
    expect(nestChildren(onlyChild, n).map((t) => t.title)).toEqual(['拆后盖']);
  });

  it('没有父子关系时顺序原样不动', () => {
    const entries = T(['甲', '乙', '丙']);
    const n = buildNesting(entries);
    expect(nestChildren(entries, n).map((t) => t.title)).toEqual(['甲', '乙', '丙']);
  });
});

describe('filterCollapsed', () => {
  const family = () => {
    const entries = T([
      '装机 id:aaa111',
      '拆后盖 parent:aaa111',
      '买硅脂 parent:aaa111',
    ]);
    return { entries, n: buildNesting(entries) };
  };

  it('没折叠时原样返回（同一个引用，不做无谓重排）', () => {
    const { entries, n } = family();
    expect(filterCollapsed(entries, n, new Set())).toBe(entries);
  });

  it('父在场且被收起：整组子任务一起隐藏，父行留着', () => {
    const { entries, n } = family();
    const nested = nestChildren(entries, n);
    expect(filterCollapsed(nested, n, new Set(['aaa111'])).map((t) => t.title))
      .toEqual(['装机']);
  });

  it('父不在本屏（子任务降级顶层）：不被一个不在场的折叠状态连带隐藏', () => {
    // 真事：nesting 是全量索引，早期版本沿 parentOf 上溯会把「搜索只命中
    // 子任务」的那一条也过滤掉，切视图后任务凭空消失。
    const { entries, n } = family();
    const onlyChild = [entries[1]];
    expect(nestChildren(onlyChild, n).map((t) => t.title)).toEqual(['拆后盖']);
    expect(filterCollapsed(onlyChild, n, new Set(['aaa111'])).map((t) => t.title))
      .toEqual(['拆后盖']);
  });

  it('沿 parentOf 上溯多级：收起祖父时孙辈也隐藏', () => {
    const entries = T([
      '装机 id:aaa111',
      '拆后盖 parent:aaa111 id:bbb222',
      '清灰 parent:bbb222',
    ]);
    const n = buildNesting(entries);
    expect(filterCollapsed(entries, n, new Set(['aaa111'])).map((t) => t.title))
      .toEqual(['装机']);
  });
});

describe('childProgress', () => {
  it('已完成的子任务仍然算在分母里（进度不会缩水）', () => {
    // 完成的子任务会被移到 done.txt —— 索引必须两边都吃，否则 2/3 会变成 0/1
    const todo = T(['装机 id:aaa111', '拆后盖 parent:aaa111', '买硅脂 parent:aaa111']);
    const done = T(['x 2026-10-22 2026-10-21 清灰 parent:aaa111']);
    const n = buildNesting([...todo, ...done]);
    expect(childProgress(n, 'aaa111')).toEqual({ done: 1, total: 3 });
  });

  it('没有子任务时 total 为 0（调用方据此不显示进度）', () => {
    const n = buildNesting(T(['装机 id:aaa111']));
    expect(childProgress(n, 'aaa111')).toEqual({ done: 0, total: 0 });
    expect(childProgress(n, null)).toEqual({ done: 0, total: 0 });
  });
});

// 2026-11-16：「即将到期」里父项有箭头、点开却空的根因 —— 视图过滤器只认
// 任务自己的 due:，子任务（往往没日期）根本没进这一屏。withDescendants 把它们补进来。
describe('withDescendants（父项在本屏时带上后代）', () => {
  it('补上不在列表里的子任务，原有顺序不变', () => {
    const entries = T(['装机 id:aaa111 due:2026-10-20', '拆后盖 parent:aaa111', '买硅脂 parent:aaa111']);
    const n = buildNesting(entries);
    const parent = entries[0];
    const out = withDescendants([parent], n);
    expect(out.map((t) => t.title)).toEqual(['装机', '拆后盖', '买硅脂']);
  });

  it('递归补到孙辈（不限一层）', () => {
    const entries = T([
      '装机 id:aaa111 due:2026-10-20',
      '拆后盖 id:bbb222 parent:aaa111',
      '拧螺丝 parent:bbb222',
    ]);
    const n = buildNesting(entries);
    const out = withDescendants([entries[0]], n).map((t) => t.title);
    expect(out).toEqual(['装机', '拆后盖', '拧螺丝']);
  });

  it('已经在列表里的子任务不重复追加', () => {
    const entries = T(['装机 id:aaa111 due:2026-10-20', '拆后盖 parent:aaa111 due:2026-10-21']);
    const n = buildNesting(entries);
    const out = withDescendants([entries[0], entries[1]], n);
    expect(out).toHaveLength(2);
    expect(new Set(out.map((t) => t.id)).size).toBe(2);
  });

  it('没有索引 / 空列表时原样返回（不炸）', () => {
    expect(withDescendants([], null)).toEqual([]);
    expect(withDescendants(null, buildNesting([]))).toEqual([]);
  });
});
