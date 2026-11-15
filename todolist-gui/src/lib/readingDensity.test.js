// 阅读密度的纯函数契约：档位映射、归一化、偏好变量输出。
// 渲染层（设置页样张 / 预览）另由 SettingsPage.test.jsx 与 qa-settings 钉。
import { afterEach, describe, expect, it } from 'vitest';
import {
  CHILD_FONT_VARS,
  DENSITY_DEFAULTS,
  DENSITY_FIELDS,
  FONT_VARS,
  LIST_ROW_PX,
  NAV_ROW_PX,
  applyDensity,
  densityPrefVars,
  isDefaultDensity,
  normalizeDensity,
} from './readingDensity.js';

describe('normalizeDensity：脏值不炸界面', () => {
  it('空 / 非对象 → 全默认', () => {
    expect(normalizeDensity(null)).toEqual(DENSITY_DEFAULTS);
    expect(normalizeDensity('乱码')).toEqual(DENSITY_DEFAULTS);
    expect(normalizeDensity(undefined)).toEqual(DENSITY_DEFAULTS);
  });

  it('合法档位保留，非法档位回「标准」', () => {
    expect(normalizeDensity({ navFont: 'l', listRows: 's' })).toEqual({
      navFont: 'l', navRows: 'm', listFont: 'm', listRows: 's',
    });
    expect(normalizeDensity({ navFont: '巨大', listRows: 42 })).toEqual(DENSITY_DEFAULTS);
  });

  it('未知字段丢弃（旧版本键 / 手改坏的 JSON 不进来）', () => {
    expect(normalizeDensity({ navFont: 's', chatFont: 'l' })).toEqual({
      ...DENSITY_DEFAULTS, navFont: 's',
    });
  });
});

describe('档位映射：只选档，不改冻结数值', () => {
  it('字号三档落在冻结字阶上（13 / 14 / 16）', () => {
    expect(FONT_VARS).toEqual({ s: 'var(--fs-sm)', m: 'var(--fs-md)', l: 'var(--fs-lg)' });
  });

  it('子任务恒比正文小 2px：13/11、14/12、16/14', () => {
    expect(CHILD_FONT_VARS).toEqual({ s: 'var(--fs-2xs)', m: 'var(--fs-xs)', l: 'var(--fs-md)' });
  });

  it('行高三档单调，且默认档就是令牌层现值（26 / 32）', () => {
    expect(NAV_ROW_PX.s).toBeLessThan(NAV_ROW_PX.m);
    expect(NAV_ROW_PX.m).toBeLessThan(NAV_ROW_PX.l);
    expect(LIST_ROW_PX.s).toBeLessThan(LIST_ROW_PX.m);
    expect(LIST_ROW_PX.m).toBeLessThan(LIST_ROW_PX.l);
    expect(NAV_ROW_PX.m).toBe(26);
    // 2026-11-15 九改：40 → 32（行距再收 20%）。这里与 index.css 的 --row-h 默认值
    // 必须一字不差 —— 否则「没设置」的用户看到的标准档会跟设置页样张不一样。
    expect(LIST_ROW_PX.m).toBe(32);
  });
});

describe('densityPrefVars：默认档不写变量', () => {
  it('全默认 → 空（QA 新 profile 与未配置用户走令牌层，几何不变）', () => {
    expect(densityPrefVars(DENSITY_DEFAULTS)).toEqual([]);
    expect(isDefaultDensity(DENSITY_DEFAULTS)).toBe(true);
  });

  it('侧栏字号只写一枚；列表字号连子任务档一起写（两枚）', () => {
    expect(densityPrefVars({ ...DENSITY_DEFAULTS, navFont: 'l' })).toEqual([
      { prop: '--pref-fs-nav', value: 'var(--fs-lg)' },
    ]);
    expect(densityPrefVars({ ...DENSITY_DEFAULTS, listFont: 's' })).toEqual([
      { prop: '--pref-fs-list', value: 'var(--fs-sm)' },
      { prop: '--pref-fs-list-child', value: 'var(--fs-2xs)' },
    ]);
  });

  it('行距档写 px，且四档齐改时五枚变量都在', () => {
    const vars = densityPrefVars({ navFont: 's', navRows: 'l', listFont: 'l', listRows: 's' });
    expect(vars).toHaveLength(5);
    expect(vars.find((v) => v.prop === '--pref-nav-h').value).toBe('32px');
    expect(vars.find((v) => v.prop === '--pref-row-h').value).toBe('28px');
    expect(isDefaultDensity({ navRows: 's' })).toBe(false);
  });
});

describe('applyDensity：写非默认、删默认（document 桩）', () => {
  const written = new Map();
  const removed = [];
  afterEach(() => {
    written.clear();
    removed.length = 0;
    delete globalThis.document;
  });

  function stubDocument() {
    globalThis.document = {
      documentElement: {
        style: {
          setProperty: (p, v) => written.set(p, v),
          removeProperty: (p) => removed.push(p),
        },
      },
    };
  }

  it('无 document（node / SSR）不抛错', () => {
    expect(() => applyDensity(DENSITY_DEFAULTS)).not.toThrow();
  });

  it('非默认档写入，其余偏好变量一律移除（回到令牌层）', () => {
    stubDocument();
    applyDensity({ ...DENSITY_DEFAULTS, navRows: 's' });
    expect([...written.entries()]).toEqual([['--pref-nav-h', '22px']]);
    expect(removed).toContain('--pref-fs-nav');
    expect(removed).toContain('--pref-row-h');
    expect(removed).toHaveLength(4);
  });

  it('全默认 → 五枚全删，一枚不写', () => {
    stubDocument();
    applyDensity(DENSITY_DEFAULTS);
    expect(written.size).toBe(0);
    expect(removed).toHaveLength(5);
  });
});

describe('维度清单与设置页渲染顺序一致', () => {
  it('四维：侧栏 / 列表 × 字号 / 行距', () => {
    expect(DENSITY_FIELDS.map((f) => f.key)).toEqual(['navFont', 'navRows', 'listFont', 'listRows']);
  });
});