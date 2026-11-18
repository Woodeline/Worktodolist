// 外观主题纯函数契约：脏值回原版、投影落 <html data-skin>、落盘与订阅闭环。
import { describe, expect, it } from 'vitest';
import { SKINS, SKIN_LABELS, clean, loadSkin, applySkin, setSkin, subscribeSkin } from './skin.js';

describe('skin：档位与归一', () => {
  it('四档固定序，中文说法齐全', () => {
    expect(SKINS).toEqual(['classic', 'paper', 'night', 'garden']);
    expect(SKINS.map((s) => SKIN_LABELS[s])).toEqual(['原版', '素纸', '夜航', '园庭']);
  });

  it('脏值一律回原版', () => {
    expect(clean('paper')).toBe('paper');
    expect(clean('night')).toBe('night');
    expect(clean('garden')).toBe('garden');
    expect(clean('classic')).toBe('classic');
    expect(clean('dark')).toBe('classic');
    expect(clean('')).toBe('classic');
    expect(clean(undefined)).toBe('classic');
    expect(clean(null)).toBe('classic');
    expect(clean(42)).toBe('classic');
  });
});

describe('skin：投影与落盘', () => {
  it('applySkin 把归一后的档位投到 documentElement', () => {
    const root = { dataset: {} };
    globalThis.document = { documentElement: root };
    try {
      expect(applySkin('night')).toBe('night');
      expect(root.dataset.skin).toBe('night');
      expect(applySkin('脏值')).toBe('classic');
      expect(root.dataset.skin).toBe('classic');
    } finally {
      delete globalThis.document;
    }
  });

  it('setSkin 先落盘再投影，loadSkin 读回；订阅者收到通知', () => {
    const mem = new Map();
    globalThis.localStorage = {
      getItem: (k) => (mem.has(k) ? mem.get(k) : null),
      setItem: (k, v) => mem.set(k, v),
    };
    globalThis.document = { documentElement: { dataset: {} } };
    const seen = [];
    const off = subscribeSkin((s) => seen.push(s));
    try {
      setSkin('garden');
      expect(loadSkin()).toBe('garden');
      expect(globalThis.document.documentElement.dataset.skin).toBe('garden');
      expect(JSON.parse(mem.get('worktodolist.skin'))).toEqual({ skin: 'garden' });
      expect(seen).toEqual(['garden']);
      setSkin('nope');
      expect(loadSkin()).toBe('classic');
      expect(seen).toEqual(['garden', 'classic']);
    } finally {
      off();
      delete globalThis.localStorage;
      delete globalThis.document;
    }
  });

  it('落盘脏值读回时归一，不卡死在坏档', () => {
    const mem = new Map([['worktodolist.skin', JSON.stringify({ skin: 'blue' })]]);
    globalThis.localStorage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v) };
    try {
      expect(loadSkin()).toBe('classic');
    } finally {
      delete globalThis.localStorage;
    }
  });
});
