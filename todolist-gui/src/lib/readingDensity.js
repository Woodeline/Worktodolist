// 阅读密度：侧栏 / 列表的字号与行距 —— 本机偏好，不写进 todo.txt。
//
// **为什么是「档位」而不是数值**：字阶 8 档数值已冻结（排版契约），行高是外壳的
// 唯一口径。让用户填任意 px 等于把这两条契约撕开；所以这里只允许在既有档位里
// 选「用哪一档」，每个档位都落在冻结字阶 / 既有行高节奏上。
//
// **应用方式与主题同构**：真相在 localStorage（configStore，一个能力一个键），
// 生效靠 documentElement 上的 --pref-* 偏好变量；index.css 的基础令牌以
// var(--pref-*, 默认) 消费它。没设置 = 不写变量 = 走令牌层默认，QA 的新 profile
// 与没配过的用户看到的几何一字不差。
//
// **触屏兜底天然压过偏好**：@media (pointer: coarse) 里直接重写 --row-h: 44px，
// 与基础令牌同特异性、源码序更后 —— 用户选「紧凑」也不会把触屏命中区压到 44 以下。
import { useCallback, useEffect, useState } from 'react';
import { createConfigStore } from './configStore.js';

/** 字号三档。按钮上的「A」字样按本档真实字号画 —— 点之前看到的就是点之后的。 */
export const FONT_TIERS = [
  { id: 's', label: '小' },
  { id: 'm', label: '标准' },
  { id: 'l', label: '大' },
];

/** 行距三档。按钮上的三线刻度按本档真实疏密画。 */
export const ROW_TIERS = [
  { id: 's', label: '紧凑' },
  { id: 'm', label: '标准' },
  { id: 'l', label: '宽松' },
];

const FONT_IDS = FONT_TIERS.map((t) => t.id);
const ROW_IDS = ROW_TIERS.map((t) => t.id);

/** 四个可调维度：侧栏 / 列表 × 字号 / 行距。设置页按这个顺序渲染。 */
export const DENSITY_FIELDS = [
  { key: 'navFont', scope: 'nav', kind: 'font', label: '侧栏字号' },
  { key: 'navRows', scope: 'nav', kind: 'rows', label: '侧栏行距' },
  { key: 'listFont', scope: 'list', kind: 'font', label: '列表字号' },
  { key: 'listRows', scope: 'list', kind: 'rows', label: '列表行距' },
];

export const DENSITY_DEFAULTS = { navFont: 'm', navRows: 'm', listFont: 'm', listRows: 'm' };

// —— 档位 → 令牌 / 行高（单一真相源，设置页样张与运行时应用都读这里）——

/** 字号档 → 冻结字阶里的哪一档。侧栏与列表正文同映射。 */
export const FONT_VARS = { s: 'var(--fs-sm)', m: 'var(--fs-md)', l: 'var(--fs-lg)' };

/** 子任务永远比正文小 2px：13/11、14/12、16/14 —— 层级差不随档位漂移。 */
export const CHILD_FONT_VARS = { s: 'var(--fs-2xs)', m: 'var(--fs-xs)', l: 'var(--fs-md)' };

/** 侧栏行高（--nav-h）三档。默认 26 是 11-12 定稿值，紧凑 / 宽松各让一档。 */
export const NAV_ROW_PX = { s: 22, m: 26, l: 32 };

/** 列表行高（--row-h）三档。默认 32（11-15 九改：40→32，行距再收 20%）；
    紧凑 / 宽松各让一档，仍保持「小 < 标准 < 大」。 */
export const LIST_ROW_PX = { s: 28, m: 32, l: 38 };

/** 行距样张（按钮里三条横线）的间隙：与行高同比例疏密，只是缩到按钮里画。 */
export const ROW_GLYPH_GAP = { s: 2, m: 4, l: 7 };

/** 归一化：未知字段丢弃，非法档位回「标准」—— 手改坏的 JSON 不会让界面炸掉。 */
export function normalizeDensity(c) {
  const src = c && typeof c === 'object' ? c : {};
  const out = { ...DENSITY_DEFAULTS };
  for (const { key, kind } of DENSITY_FIELDS) {
    const ids = kind === 'font' ? FONT_IDS : ROW_IDS;
    if (ids.includes(src[key])) out[key] = src[key];
  }
  return out;
}

export function isDefaultDensity(cfg) {
  const c = normalizeDensity(cfg);
  return DENSITY_FIELDS.every(({ key }) => c[key] === DENSITY_DEFAULTS[key]);
}

/**
 * 档位 → 要写到 documentElement 的偏好变量。**只输出非默认档**：
 * 默认档不写变量，令牌层的 var(--pref-*, 默认) 自然兜底 ——
 * 这样「没设置」与「设置成标准」在 CSS 层是同一件事，QA 几何不受影响。
 * @returns {Array<{prop: string, value: string}>}
 */
export function densityPrefVars(cfg) {
  const c = normalizeDensity(cfg);
  const out = [];
  if (c.navFont !== 'm') out.push({ prop: '--pref-fs-nav', value: FONT_VARS[c.navFont] });
  if (c.listFont !== 'm') {
    out.push({ prop: '--pref-fs-list', value: FONT_VARS[c.listFont] });
    out.push({ prop: '--pref-fs-list-child', value: CHILD_FONT_VARS[c.listFont] });
  }
  if (c.navRows !== 'm') out.push({ prop: '--pref-nav-h', value: `${NAV_ROW_PX[c.navRows]}px` });
  if (c.listRows !== 'm') out.push({ prop: '--pref-row-h', value: `${LIST_ROW_PX[c.listRows]}px` });
  return out;
}

const PREF_PROPS = ['--pref-fs-nav', '--pref-fs-list', '--pref-fs-list-child', '--pref-nav-h', '--pref-row-h'];

/** 把档位投到 <html> 上：非默认档写变量，默认档移除变量（回到令牌层）。 */
export function applyDensity(cfg) {
  if (typeof document === 'undefined' || !document.documentElement) return;
  const el = document.documentElement;
  const want = new Map(densityPrefVars(cfg).map((v) => [v.prop, v.value]));
  for (const prop of PREF_PROPS) {
    if (want.has(prop)) el.style.setProperty(prop, want.get(prop));
    else el.style.removeProperty(prop);
  }
}

const densityStore = createConfigStore({
  key: 'worktodolist.reading-density.v1',
  defaults: DENSITY_DEFAULTS,
  normalize: normalizeDensity,
});

/** 直接读（非 React 上下文）。未落盘 = 全默认。 */
export function loadDensity() {
  return densityStore.loadOr();
}

/** 换档：先落盘，再投影（与主题 setThemeMode 同一套路）。 */
export function saveDensity(cfg) {
  const ok = densityStore.save(cfg);
  applyDensity(loadDensity());
  return ok;
}

/** 恢复默认：清除落盘（不是「存一份默认」—— 没设置与标准必须不可区分）。 */
export function resetDensity() {
  const ok = densityStore.clear();
  applyDensity(loadDensity());
  return ok;
}

/** 订阅落盘变化。返回取消订阅函数。 */
export function subscribeDensity(fn) {
  return densityStore.subscribe(fn);
}

let booted = false;

/** 首帧前投影一次，并挂上「落盘 → 投影」的常驻订阅（main / styleguide 各调一次）。 */
export function initDensity() {
  applyDensity(loadDensity());
  if (booted) return;
  booted = true;
  densityStore.subscribe(() => applyDensity(loadDensity()));
}

/**
 * 设置页的读写绑定。写入会广播，预览与真实界面不会各说各话。
 * @returns {{cfg:Object, pick:(field:string, tier:string)=>void, reset:()=>void, isDefault:boolean}}
 */
export function useReadingDensity() {
  const [cfg, setCfg] = useState(loadDensity);

  useEffect(() => subscribeDensity(() => setCfg(loadDensity())), []);

  const pick = useCallback((field, tier) => {
    if (!DENSITY_FIELDS.some((f) => f.key === field)) return;
    saveDensity({ ...loadDensity(), [field]: tier });
    setCfg(loadDensity());
  }, []);

  const reset = useCallback(() => {
    resetDensity();
    setCfg(loadDensity());
  }, []);

  return { cfg, pick, reset, isDefault: isDefaultDensity(cfg) };
}