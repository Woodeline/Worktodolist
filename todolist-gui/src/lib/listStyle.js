// 列表外观：给「+项目」配一个颜色 —— 提醒事项式列表的第一层。
//
// **为什么颜色不写进 todo.txt**：颜色是外观偏好，不是数据。三件事决定了它该待在本机配置里：
//   ① 同一份 todo.txt 换台机器打开，颜色该跟着这台机器的偏好，写进文本就把它变成了数据的一部分
//   ② 纯文本里塞 #E24B4A 会污染 grep / 排序 / topydo（topydo 会把色值当普通词）
//   ③ 备份与 git 只该管事实，不该管审美
// 所以它走与其它本机偏好同一套存储（configStore），一个键、可清除、不进数据目录。
//
// **没配过色的项目也要有色**：提醒事项里每个列表都有颜色，颜色是"一眼分流"的线索 ——
// 不给色等于退回一排长得一样的文字。所以未配置时按项目名**稳定散列**取一色：
// 同名项目每次都同色，不同项目尽量分散，且不会因为排序变化而跳色（散列只吃名字）。
import { useCallback, useEffect, useState } from 'react';
import { createConfigStore } from './configStore.js';

// 色板：取项目既有的语义色（与 index.css 里的强调色同族），
// 顺序按提醒事项列表取色的习惯排：红 → 橙 → 黄 → 绿 → 青 → 蓝 → 紫 → 灰。
export const PALETTE = [
  { id: 'red', label: '红', hex: '#E24B4A' },
  { id: 'orange', label: '橙', hex: '#D85A30' },
  { id: 'amber', label: '黄', hex: '#EF9F27' },
  { id: 'green', label: '绿', hex: '#639922' },
  { id: 'teal', label: '青', hex: '#1D9E75' },
  { id: 'blue', label: '蓝', hex: '#378ADD' },
  { id: 'violet', label: '紫', hex: '#7F77DD' },
  { id: 'gray', label: '灰', hex: '#888780' },
];

export const PALETTE_IDS = PALETTE.map((p) => p.id);

const BY_ID = new Map(PALETTE.map((p) => [p.id, p]));

/** 未配置色的兜底色：不参与色板选择，仅用于"取不到"时的最后一层。 */
const FALLBACK_ID = 'gray';

function fnv1a(text) {
  let h = 0x811c9dc5;
  const s = String(text ?? '');
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** 项目名 → 默认色 id。同一个名字永远得到同一个色。 */
export function defaultColorId(name) {
  return PALETTE[fnv1a(name) % PALETTE.length].id;
}

/** 色 id → 十六进制值。脏 id 回落灰色，不抛错。 */
export function colorHex(id) {
  return (BY_ID.get(id) || BY_ID.get(FALLBACK_ID)).hex;
}

/** 色 id → 中文名（无障碍标签用）。 */
export function colorLabel(id) {
  const p = BY_ID.get(id);
  return p ? p.label : '默认';
}

/**
 * 解析某个项目最终该用什么色。
 * 显式配过的用配置；没配过的走稳定散列 —— 所以"没设置过"和"设置成灰色"是两回事，
 * 只有显式存了 gray 才会是灰，否则按名字给色。
 */
export function resolveColorId(name, colors) {
  const picked = colors && colors[name];
  if (picked && PALETTE_IDS.includes(picked)) return picked;
  return defaultColorId(name);
}

const listStyle = createConfigStore({
  key: 'worktodolist.list-style.v1',
  defaults: { colors: {} },
  normalize: (c) => {
    // 只留「非空名字 → 色板内的 id」这一对，其余一律丢弃：
    // 旧版本的键、手改坏的 JSON、被删掉的色，都不会让界面炸掉。
    const src = c && typeof c.colors === 'object' && c.colors ? c.colors : {};
    const colors = {};
    for (const [name, id] of Object.entries(src)) {
      if (typeof name === 'string' && name && PALETTE_IDS.includes(id)) colors[name] = id;
    }
    return { colors };
  },
});

/** 直接读（非 React 上下文，如测试、样式计算）。 */
export function loadColors() {
  return listStyle.loadOr().colors;
}

/**
 * 列表外观的读写。写入会广播，所以侧栏与设置页不会各说各话。
 * @returns {{colors:Object, setColor:(name:string, id:string|null)=>void}}
 *   colors   项目名 → 色 id（只含显式配过的）
 *   setColor 传 null / '' 表示"恢复按名字取色"
 */
export function useListStyle() {
  const [colors, setColors] = useState(loadColors);

  useEffect(() => {
    const off = listStyle.subscribe(() => setColors(loadColors()));
    return () => {
      off();
    };
  }, []);

  const setColor = useCallback((name, id) => {
    if (typeof name !== 'string' || !name) return;
    const next = { ...loadColors() };
    if (!id || !PALETTE_IDS.includes(id)) delete next[name];
    else next[name] = id;
    listStyle.save({ colors: next });
    setColors(next);
  }, []);

  return { colors, setColor };
}
