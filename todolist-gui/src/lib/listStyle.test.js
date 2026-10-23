// 列表外观的契约测试。
//
// 这层的失效方式全是"不报错的错"：色板里少一个色导致侧栏某行变黑、
// 散列换了算法导致所有列表一夜之间换了颜色、脏 id 没被过滤导致界面拿到 undefined。
// 所以这里锁的是三件事：取色稳定、脏值不入、显式配过的色不会被散列覆盖。
import { beforeEach, describe, expect, it } from 'vitest';
import { PALETTE, PALETTE_IDS, colorHex, defaultColorId, resolveColorId } from './listStyle.js';

function makeStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
  };
}

describe('defaultColorId', () => {
  it('同一个项目名永远得到同一个色（改名前的稳定锚点）', () => {
    expect(defaultColorId('投资')).toBe(defaultColorId('投资'));
    expect(defaultColorId('硬件')).toBe(defaultColorId('硬件'));
  });

  it('取到的色一定在色板内', () => {
    for (const name of ['投资', '硬件', 'health', '', '一个很长的中文项目名']) {
      expect(PALETTE_IDS).toContain(defaultColorId(name));
    }
  });

  it('不同项目名会散开，不会全挤在同一色', () => {
    const names = ['投资', '硬件', '写作', '家务', '学习', '出行', '工作', '健康'];
    const picked = new Set(names.map(defaultColorId));
    expect(picked.size).toBeGreaterThan(1);
  });
});

describe('colorHex', () => {
  it('色板里每个 id 都能取到 #RRGGBB', () => {
    for (const id of PALETTE_IDS) {
      expect(colorHex(id)).toMatch(/^#[0-9A-Fa-f]{6}$/);
    }
  });

  it('脏 id 回落到一个真实存在的色，而不是 undefined', () => {
    expect(colorHex('nope')).toMatch(/^#[0-9A-Fa-f]{6}$/);
    expect(colorHex(undefined)).toMatch(/^#[0-9A-Fa-f]{6}$/);
  });
});

describe('resolveColorId', () => {
  beforeEach(() => {
    globalThis.localStorage = makeStorage();
  });

  it('显式配过的色优先于散列', () => {
    expect(resolveColorId('投资', { 投资: 'red' })).toBe('red');
  });

  it('没配过就按名字散列', () => {
    expect(resolveColorId('投资', {})).toBe(defaultColorId('投资'));
    expect(resolveColorId('投资', undefined)).toBe(defaultColorId('投资'));
  });

  it('配了色板外的 id 视为没配（脏值不该让界面拿到无效色）', () => {
    expect(resolveColorId('投资', { 投资: 'hotpink' })).toBe(defaultColorId('投资'));
  });

  it('显式配灰色与"没配过"是两回事', () => {
    expect(resolveColorId('投资', { 投资: 'gray' })).toBe('gray');
  });
});

describe('PALETTE', () => {
  it('id 不重复 —— 重复会让两个色点渲染成同一个色', () => {
    expect(new Set(PALETTE.map((p) => p.id)).size).toBe(PALETTE.length);
  });
});
