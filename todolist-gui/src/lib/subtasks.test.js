// 子任务关系（parent: 标签）。
//
// 这一层的失效方式全是"不报错的错"：父子互相认成环会让整组任务从界面上消失、
// 父不在当前视图时子任务会跟着消失、完成的子任务会从进度里蒸发。
// 三种都不抛异常，只表现为"我的任务不见了" —— 所以每一条都写成断言。
import { describe, expect, it } from 'vitest';
import { parseFile } from './todoParser.js';
import { buildNesting, childProgress, childrenOf, depthOf, nestChildren } from './subtasks.js';

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
