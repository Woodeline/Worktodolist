// 排版偏好：侧栏 / 列表的字号与行距（显示层偏好，不进 todo.txt）。
//
// 与「列表颜色」「显示模式」同一套形状：本机配置是唯一真相，界面只是投影。
// 换台机器打开同一份 todo.txt，看到的字号 / 行距跟这台机器的偏好走。
//
// 为什么不用裸数值 / 原生滑块：
//   ① qa-settings 断言设置页「没有任何 input 控件」，原生 range 会让门禁变红；
//   ② 字阶 8 档数值冻结（qa-typography 钉死），不能改 --fs-*，只能在消费点乘系数。
// 所以这里只存「小 / 中 / 大」三档离散 id，由 CSS 变量 + calc() 把系数乘到字号 / 行高上。
import { useCallback, useEffect, useState } from 'react';
import { createConfigStore } from './configStore.js';

/** 四个可独立调节的维度。 */
export const TYPO_KEYS = ['navFs', 'navLh', 'rowFs', 'rowLh'];

/** 档位：小 / 中 / 大。 */
export const TYPO_STEPS = ['s', 'm', 'l'];

/** 档位的中文说法（按钮 aria-label 与字形提示共用一份）。 */
export const STEP_LABEL = { s: '小', m: '中', l: '大' };

/** 档位 → 字号缩放系数（侧栏 / 列表共用）。中档=1 即冻结令牌原值。 */
const FS_SCALE = { s: 0.9, m: 1, l: 1.15 };

/** 档位 → 行距（行高）缩放系数。中档=1 即 --nav-h / --row-h 原值。 */
const LH_SCALE = { s: 0.92, m: 1, l: 1.18 };

const DEFAULTS = { navFs: 'm', navLh: 'm', rowFs: 'm', rowLh: 'm' };

/** 单维度脏值一律回落「中」——这是没有偏好时的默认形态，也最不会误导。 */
function cleanStep(v) {
  return TYPO_STEPS.includes(v) ? v : 'm';
}

const listTypographyStore = createConfigStore({
  key: 'worktodolist.list-typography.v1',
  defaults: DEFAULTS,
  normalize: (c) => {
    const src = c || {};
    const out = {};
    for (const k of TYPO_KEYS) out[k] = cleanStep(src[k]);
    return out;
  },
});

/** 落盘的偏好（没配过 = 全中档）。 */
export function loadListTypography() {
  return listTypographyStore.loadOr();
}

/** 合并写入单个维度（其余维度沿用已落盘的值）。写入即广播。 */
export function saveListTypography(partial) {
  const next = { ...loadListTypography(), ...partial };
  return listTypographyStore.save(next);
}

/** 四维各自的缩放系数（供投影 / 测试读取）。 */
export function scalesOf(cfg) {
  return {
    navFs: FS_SCALE[cfg.navFs],
    navLh: LH_SCALE[cfg.navLh],
    rowFs: FS_SCALE[cfg.rowFs],
    rowLh: LH_SCALE[cfg.rowLh],
  };
}

/** 把偏好投影到 :root 的 CSS 变量上（calc 在消费点乘上去）。无 DOM 环境安全跳过。 */
export function applyListTypography(cfg) {
  const c = cfg || loadListTypography();
  const s = scalesOf(c);
  if (typeof document === 'undefined' || !document.documentElement) return s;
  const root = document.documentElement.style;
  root.setProperty('--nav-fs-scale', String(s.navFs));
  root.setProperty('--nav-lh-scale', String(s.navLh));
  root.setProperty('--row-fs-scale', String(s.rowFs));
  root.setProperty('--row-lh-scale', String(s.rowLh));
  return s;
}

let booted = false;

/**
 * 启动时调用一次：投影落盘偏好，并盯住本 store 变化做重投影。
 * 重投影是为了「在设置页改完，整个应用（侧栏 + 列表）即时跟着变」，
 * 而不只是设置页这一屏。重复调用安全（监听只挂一次）。
 */
export function initListTypography() {
  applyListTypography(loadListTypography());
  if (booted) return;
  booted = true;
  listTypographyStore.subscribe(() => applyListTypography(loadListTypography()));
}

/** @returns {[object, (key:string, step:string)=>void]} 当前偏好 + 改单维度的写入器。 */
export function useListTypography() {
  const [cfg, setCfg] = useState(loadListTypography);

  useEffect(() => {
    const off = listTypographyStore.subscribe(() => setCfg(loadListTypography()));
    return () => {
      off();
    };
  }, []);

  const setStep = useCallback((key, step) => {
    if (!TYPO_KEYS.includes(key)) return;
    saveListTypography({ [key]: cleanStep(step) });
  }, []);

  return [cfg, setStep];
}
