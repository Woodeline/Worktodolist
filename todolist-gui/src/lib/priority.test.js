// 四档字阶徽章的档位映射。
//
// 这一层的失效方式全是「不报错的错」：把「无」映射成 p-other、把 B 落回默认态、
// 或者把界面读数改回 (A)，页面照常渲染，只是层次悄悄少了一档 —— 单看组件
// 谁都没写错。所以值域、梯度顺序、中文读数、悬停原文都在这里钉死。
import { describe, expect, it } from 'vitest';
import {
  PRIORITY_STEPS,
  priorityClass,
  priorityLabel,
  priorityTitle,
  priorityTone,
} from './priority.js';

describe('档位值域', () => {
  it('界面四档 + D~Z 兜底，一共五档', () => {
    expect(priorityTone(null)).toBe('none');
    expect(priorityTone(undefined)).toBe('none');
    expect(priorityTone('')).toBe('none');
    expect(priorityTone('C')).toBe('low');
    expect(priorityTone('B')).toBe('mid');
    expect(priorityTone('A')).toBe('high');
    expect(priorityTone('D')).toBe('other');
    expect(priorityTone('Z')).toBe('other');
  });

  it('所有渲染点取同一份类名，不再各拼一套', () => {
    expect(priorityClass(null)).toBe('prio-none');
    expect(priorityClass('C')).toBe('prio-low');
    expect(priorityClass('B')).toBe('prio-mid');
    expect(priorityClass('A')).toBe('prio-high');
    expect(priorityClass('D')).toBe('prio-other');
  });

  it('梯度顺序是「无 → 低 → 中 → 高」，四档齐全且不重复', () => {
    expect(PRIORITY_STEPS.map((s) => s.tone)).toEqual(['none', 'low', 'mid', 'high']);
    expect(PRIORITY_STEPS.map((s) => s.label)).toEqual(['无', '低', '中', '高']);
    expect(PRIORITY_STEPS.map((s) => s.letter)).toEqual([null, 'C', 'B', 'A']);
  });
});

describe('界面读数与文件原文', () => {
  it('读中文分级，不改回括号字母', () => {
    expect(priorityLabel('A')).toBe('高');
    expect(priorityLabel('B')).toBe('中');
    expect(priorityLabel('C')).toBe('低');
  });

  it('「无」返回空串 —— 没填不是「中」，也不是任何等级的值', () => {
    expect(priorityLabel(null)).toBe('');
    expect(priorityLabel(undefined)).toBe('');
    expect(priorityLabel(null)).not.toBe('中');
  });

  it('自定义字母原样透出，不静默吞掉', () => {
    expect(priorityLabel('D')).toBe('D');
  });

  it('悬停里留 todo.txt 原文记号供核对', () => {
    expect(priorityTitle('A')).toContain('高');
    expect(priorityTitle('A')).toContain('(A)');
    expect(priorityTitle('C')).toContain('(C)');
  });

  it('「无」的悬停不编造一个不存在的括号字母', () => {
    const title = priorityTitle(null);
    expect(title).toContain('未填');
    expect(title).not.toMatch(/\([A-Z]\)/);
  });
});
