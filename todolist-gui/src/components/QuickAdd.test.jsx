// QuickAdd chips 折叠的纯函数单测。
//
// 组件本身驱动不了（SSR 没有输入事件），所以折叠逻辑放在 quickChips 里，
// 这里直接驱动它。守的是一条静默失败：chips 超过容器宽度时旧行为是
// overflow:hidden 裁掉 —— 界面不报错，只是用户看不到解析结果。
import { describe, expect, it } from 'vitest';
import { MAX_QUICK_CHIPS, quickChips } from './QuickAdd.jsx';
import { parseQuickInput } from '../lib/todoParser.js';

describe('quickChips（快速添加的 chips 预览）', () => {
  it('没有输入时返回空三件套', () => {
    expect(quickChips(null)).toEqual({ all: [], shown: [], extra: 0 });
  });

  it('不超过上限时全部露出、没有折叠计数', () => {
    const { shown, extra } = quickChips(parseQuickInput('交周报 @工作 due:2026-10-25'));
    // 预览抄录的是文件里的原文写法（due:），不是中文释义 —— 界面与 todo.txt 用同一套记号。
    expect(shown.map((c) => c.label)).toEqual(['@工作', 'due:2026-10-25']);
    expect(extra).toBe(0);
  });

  it('超过上限时只露前 N 个，其余折叠成 +N', () => {
    const parsed = parseQuickInput('(A) 交周报 @工作 @生活 +回测 +量化 due:2026-10-25 star:1');
    const { all, shown, extra } = quickChips(parsed);
    expect(all.length).toBeGreaterThan(MAX_QUICK_CHIPS);
    expect(shown).toHaveLength(MAX_QUICK_CHIPS);
    expect(extra).toBe(all.length - MAX_QUICK_CHIPS);
    // 露出的永远是前 N 个（优先级在最前），不是随机的 N 个
    expect(shown[0].label).toBe('高 (A)');
  });

  it('优先级 chip 同时给出中文分级与文件记号', () => {
    // 界面要读得出急慢，又得能和 todo.txt 里的 (A)/(B)/(C) 对上：两者都留。
    expect(quickChips(parseQuickInput('(A) 交周报')).all[0].label).toBe('高 (A)');
    expect(quickChips(parseQuickInput('(B) 写周报')).all[0].label).toBe('中 (B)');
    expect(quickChips(parseQuickInput('(C) 买网线')).all[0].label).toBe('低 (C)');
  });

  it('写入行 chip 也带档位形状，输入时就能看出急缓', () => {
    const high = quickChips(parseQuickInput('(A) 交周报')).all[0];
    expect(high.cls).toContain('prio-high');
    expect(high.mark).toBe('prio-high');
    expect(quickChips(parseQuickInput('(B) 写周报')).all[0].mark).toBe('prio-mid');
    expect(quickChips(parseQuickInput('(C) 买网线')).all[0].mark).toBe('prio-low');
    // 没写优先级就没有优先级 chip，不会凭空造一个「无」出来
    expect(quickChips(parseQuickInput('交周报')).all.some((c) => c.key === 'p')).toBe(false);
  });

  it('星标与未识别标签都占一个 chip 位', () => {
    const { all } = quickChips(parseQuickInput('写周报 star:1 foo:bar'));
    expect(all.map((c) => c.label)).toContain('star:1');
    expect(all.map((c) => c.label)).toContain('foo:bar');
  });
});
