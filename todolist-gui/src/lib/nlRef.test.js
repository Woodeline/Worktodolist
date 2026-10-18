// 会话回指层的契约测试：档位规则 + 焦点还原 + parseIntent 集成。
import { describe, it, expect } from 'vitest';
import { detectRef, resolveRef } from './nlRef.js';
import { parseIntent } from './nlRules.js';

const mk = (id, title, extra = {}) => ({
  id, kind: 'task', raw: '', completed: false, completedAt: null,
  createdAt: '2026-09-20', priority: null, title, contexts: [], projects: [],
  dueDate: null, thresholdDate: null, starValue: null, extraTags: [], ...extra,
});

const TASKS = [mk('t1', '季报复核'), mk('t2', '写第 10 周回测报告'), mk('t3', '带截止日的周线复盘')];
const MEMORY = { lastTaskId: 't3', lastCandidates: ['t1', 't3'] };

describe('detectRef 三档回指', () => {
  it('强回指：它 / 刚才那条 / 上一条 直接认定', () => {
    expect(detectRef('把它延到下周五', '')).toMatchObject({ type: 'last', matchedText: '它' });
    expect(detectRef('刚才那条 标为高', '')).toMatchObject({ type: 'last' });
    expect(detectRef('上一条 删掉', '')).toMatchObject({ type: 'last' });
  });

  it('序数回指必须带指向词，裸「第N条」仍走序号通道', () => {
    expect(detectRef('上面第二个 删掉', '')).toMatchObject({ type: 'ordinal', n: 2 });
    expect(detectRef('前面第一个 完成了', '')).toMatchObject({ type: 'ordinal', n: 1 });
    expect(detectRef('第三个', '')).toBeNull();
  });

  it('弱回指只在"剥完动作词什么都不剩"时才算', () => {
    expect(detectRef('这条完成了', '这条')).toMatchObject({ type: 'last', matchedText: '这条' });
    // 用户给了新关键词时，"那个"不能劫持它
    expect(detectRef('删掉那个没用的', '那个没用的')).toBeNull();
  });
});

describe('resolveRef 焦点还原', () => {
  it('序数优先落在上一份候选列表上', () => {
    expect(resolveRef({ type: 'ordinal', n: 2 }, MEMORY, TASKS)).toBe('t3');
  });

  it('没有候选列表时退回全量快照（与「第N条」同口径）', () => {
    expect(resolveRef({ type: 'ordinal', n: 2 }, null, TASKS)).toBe('t2');
  });

  it('焦点任务已不在活跃列表时退回候选首条，而不是放弃', () => {
    const gone = { lastTaskId: 't9', lastCandidates: ['t2'] };
    expect(resolveRef({ type: 'last' }, gone, TASKS)).toBe('t2');
  });

  it('完全没有会话记忆时返回 null（交给上层走澄清）', () => {
    expect(resolveRef({ type: 'last' }, null, TASKS)).toBeNull();
  });
});

describe('parseIntent 集成会话记忆', () => {
  const ctx = { tasks: TASKS, today: '2026-10-01', memory: MEMORY };

  it('「删了它」定位到焦点任务并给高置信', () => {
    const r = parseIntent('删了它', ctx);
    expect(r.intent).toBe('delete');
    expect(r.target.kind).toBe('ref');
    expect(r.matches).toEqual(['t3']);
    expect(r.confidence).toBe('high');
  });

  it('「这个延到下周三」在无其它关键词时指焦点，且带上日期槽', () => {
    const r = parseIntent('这个延到下周三', ctx);
    expect(r.intent).toBe('postpone');
    expect(r.target.kind).toBe('ref');
    expect(r.slots.dueDate).toBe('2026-10-07');
  });

  it('无 memory 时回指不猜，降为低置信走澄清', () => {
    const r = parseIntent('把它删了', { tasks: TASKS, today: '2026-10-01' });
    expect(r.intent).toBe('delete');
    expect(r.matches).toEqual([]);
    expect(r.confidence).toBe('low');
  });

  it('关键词命中时不回指劫持（用户给的是新目标）', () => {
    const r = parseIntent('删掉季报复核这条', ctx);
    expect(r.intent).toBe('delete');
    expect(r.target.kind).toBe('keyword');
    expect(r.matches).toEqual(['t1']);
  });
});
