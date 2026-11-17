import { describe, expect, it } from 'vitest';
import { resolveEscape } from './escape.js';

// Esc 的语义是「逐层退出」，顺序本身就是契约：
// 编辑浮窗 → 冲突弹窗（阻塞，不做事）→ 搜索 → 选中行 → 隐藏到托盘。
const base = { editing: false, conflict: false, searchOpen: false, search: '', focusedId: null };

describe('resolveEscape', () => {
  it('没有可关的层才隐藏到托盘', () => {
    expect(resolveEscape(base)).toBe('hide-to-tray');
  });

  it('编辑浮窗优先于搜索与选中', () => {
    expect(resolveEscape({ ...base, editing: true, searchOpen: true, focusedId: 't1' })).toBe(
      'close-editor'
    );
  });

  it('冲突弹窗是阻塞层：Esc 不藏窗，也不去清背后的搜索 / 选中', () => {
    expect(resolveEscape({ ...base, conflict: true, searchOpen: true, focusedId: 't1' })).toBe('stay');
  });

  it('搜索开着或关键词没清时先收搜索', () => {
    expect(resolveEscape({ ...base, searchOpen: true })).toBe('close-search');
    expect(resolveEscape({ ...base, search: '报表' })).toBe('close-search');
  });

  it('只剩选中行时先取消选中，下一次才藏窗', () => {
    expect(resolveEscape({ ...base, focusedId: 't1' })).toBe('clear-selection');
  });
});
