// 通用配置存储的契约测试。
//
// 这一层的失效方式很隐蔽：键名写错、clear 顺手把别的键也删了、订阅在抛异常时
// 把整次写入带崩 —— 三种都不会报错，只会让"点了保存却没生效"变成偶发问题。
import { beforeEach, describe, expect, it } from 'vitest';
import { clampInt, createConfigStore, parseList } from './configStore.js';

function makeStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    _dump: () => Object.fromEntries(map),
  };
}

const DEFAULTS = { enabled: false, hosts: [], n: 7 };
const normalize = (c) => ({
  enabled: Boolean(c && c.enabled),
  hosts: Array.isArray(c && c.hosts) ? c.hosts : [],
  n: Number.isFinite(Number(c && c.n)) ? Number(c.n) : DEFAULTS.n,
});

describe('createConfigStore', () => {
  beforeEach(() => {
    globalThis.localStorage = makeStorage();
  });

  it('未落盘时 load() 返回 null、hasStored() 为 false、loadOr() 给默认值', () => {
    const s = createConfigStore({ key: 'k1', defaults: DEFAULTS, normalize });
    expect(s.load()).toBe(null);
    expect(s.hasStored()).toBe(false);
    expect(s.loadOr()).toEqual(DEFAULTS);
  });

  it('save 之后 load 能读回，且读到的是归一化结果（脏值不落地）', () => {
    const s = createConfigStore({ key: 'k1', defaults: DEFAULTS, normalize });
    expect(s.save({ enabled: 1, hosts: 'not-an-array', n: 'abc' })).toBe(true);
    expect(s.load()).toEqual({ enabled: true, hosts: [], n: 7 });
    expect(s.hasStored()).toBe(true);
  });

  it('hasStored 与"是否启用"互不相干：关着但已落盘仍算已存', () => {
    const s = createConfigStore({ key: 'k1', defaults: DEFAULTS, normalize });
    s.save({ enabled: false, hosts: ['a'], n: 1 });
    expect(s.hasStored()).toBe(true);
    expect(s.load().enabled).toBe(false);
  });

  it('两个 store 互不干扰：各自一个键、各自的订阅', () => {
    const a = createConfigStore({ key: 'a', defaults: DEFAULTS, normalize });
    const b = createConfigStore({ key: 'b', defaults: DEFAULTS, normalize });
    let aHits = 0;
    let bHits = 0;
    a.subscribe(() => (aHits += 1));
    b.subscribe(() => (bHits += 1));

    a.save({ enabled: true, hosts: ['x'], n: 1 });
    expect(aHits).toBe(1);
    expect(bHits).toBe(0);

    b.save({ enabled: true, hosts: ['y'], n: 2 });
    expect(bHits).toBe(1);

    // 清 a 不许把 b 也清掉
    a.clear();
    expect(a.load()).toBe(null);
    expect(b.load()).toEqual({ enabled: true, hosts: ['y'], n: 2 });
    expect(aHits).toBe(2);
  });

  it('clear 只删自己的键', () => {
    globalThis.localStorage = makeStorage({ other: 'keep' });
    const s = createConfigStore({ key: 'k1', defaults: DEFAULTS, normalize });
    s.save({ enabled: true, hosts: [], n: 1 });
    s.clear();
    expect(globalThis.localStorage._dump()).toEqual({ other: 'keep' });
    expect(s.hasStored()).toBe(false);
  });

  it('损坏的 JSON 当成"没配置"，而不是抛错', () => {
    globalThis.localStorage = makeStorage({ k1: '{ not json' });
    const s = createConfigStore({ key: 'k1', defaults: DEFAULTS, normalize });
    expect(s.load()).toBe(null);
    // 键还在，所以"能清除"仍然成立 —— 否则用户永远删不掉这条坏数据
    expect(s.hasStored()).toBe(true);
  });

  it('JSON 是数组/字符串这类非对象值时也当成"没配置"', () => {
    globalThis.localStorage = makeStorage({ k1: '123' });
    const s = createConfigStore({ key: 'k1', defaults: DEFAULTS, normalize });
    expect(s.load()).toBe(null);
  });

  it('单个订阅者抛异常不影响其它订阅者，也不影响写入结果', () => {
    const s = createConfigStore({ key: 'k1', defaults: DEFAULTS, normalize });
    let ok = 0;
    s.subscribe(() => {
      throw new Error('boom');
    });
    s.subscribe(() => (ok += 1));
    expect(s.save({ enabled: true, hosts: [], n: 1 })).toBe(true);
    expect(ok).toBe(1);
  });

  it('unsubscribe 之后不再收到通知', () => {
    const s = createConfigStore({ key: 'k1', defaults: DEFAULTS, normalize });
    let hits = 0;
    const off = s.subscribe(() => (hits += 1));
    s.save({ enabled: true, hosts: [], n: 1 });
    off();
    s.clear();
    expect(hits).toBe(1);
  });

  it('localStorage 不可用时降级为"没有配置"，save 返回 false 而不是抛错', () => {
    const original = globalThis.localStorage;
    delete globalThis.localStorage;
    const s = createConfigStore({ key: 'k1', defaults: DEFAULTS, normalize });
    expect(s.load()).toBe(null);
    expect(s.hasStored()).toBe(false);
    expect(s.save({ enabled: true, hosts: [], n: 1 })).toBe(false);
    expect(s.clear()).toBe(false);
    globalThis.localStorage = original;
  });

  it('没有 key 时直接抛错（配置键写漏是必须立刻暴露的错误）', () => {
    expect(() => createConfigStore({ defaults: DEFAULTS })).toThrow();
  });
});

describe('clampInt', () => {
  const R = { min: 10, max: 100 };

  it('夹到范围内并取整', () => {
    expect(clampInt(50, R, 20)).toBe(50);
    expect(clampInt(5, R, 20)).toBe(10);
    expect(clampInt(500, R, 20)).toBe(100);
    expect(clampInt(50.6, R, 20)).toBe(51);
  });

  it('非数字回落 fallback', () => {
    expect(clampInt('abc', R, 20)).toBe(20);
    expect(clampInt(null, R, 20)).toBe(20);
    expect(clampInt(undefined, R, 20)).toBe(20);
  });

  it('空串回落 fallback —— 不能被 Number(\'\')===0 误导成 min', () => {
    // 用户清空输入框的瞬间不该被"纠正"成最小值，否则看起来像输入不动
    expect(clampInt('', R, 20)).toBe(20);
  });

  it('数字字符串照常工作', () => {
    expect(clampInt('42', R, 20)).toBe(42);
  });
});

describe('parseList', () => {
  it('按换行/逗号/分号切、去空白、去重、转小写', () => {
    expect(parseList('A.com\nb.com, a.com;c.com')).toEqual(['a.com', 'b.com', 'c.com']);
  });

  it('空输入给空数组', () => {
    expect(parseList('')).toEqual([]);
    expect(parseList(null)).toEqual([]);
    expect(parseList('  \n , ; \n')).toEqual([]);
  });
});
