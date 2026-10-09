// 工具骨架配套的三个小 hook —— 把「工具自己实现的第七件事」也收进骨架。
//
// 抽出来的理由和 ToolShell 一样：toast、粘贴弹窗、自动保存，这三样每个数据型
// 工具都会写一遍；写在 RtiTool 里时它们叫 rti-*，第二个工具出现时会被整段抄走。
import { useCallback, useEffect, useRef, useState } from 'react';
import { loadToolState, saveToolState } from '../lib/toolStorage.js';

const TOAST_MS = 3400;
const SAVE_DEBOUNCE_MS = 400;

/**
 * 工具内 toast（相对工具工作区定位，不飘到整窗右下角）。
 * @returns {{toast:string|null, showToast:Function}}
 */
export function useToolToast() {
  const [toast, setToast] = useState(null);
  const timer = useRef(null);
  const showToast = useCallback((msg) => {
    setToast(msg);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast(null), TOAST_MS);
  }, []);
  useEffect(() => () => clearTimeout(timer.current), []);
  return { toast, showToast };
}

/**
 * 粘贴导入弹窗的通用外壳：管开关、管文本、管报错文案。
 * 解析与填充由调用方给（`open(title, hint, applyRows)` 里的 applyRows）。
 *
 * @returns {{paste:object|null, open:Function, close:Function}}
 */
export function useToolPaste(showToast) {
  const [state, setState] = useState(null);

  const open = useCallback((title, hint, applyRows) => {
    setState({ title, hint, applyRows, text: '', error: '' });
  }, []);

  const close = useCallback(() => setState(null), []);

  const setText = useCallback((text) => {
    setState((s) => (s ? { ...s, text, error: '' } : s));
  }, []);

  // 弹窗对象交给 ToolShell 渲染；setText / apply 由骨架调用。
  const paste = state
    ? {
        title: state.title,
        hint: state.hint,
        text: state.text,
        error: state.error,
        setText,
        close,
        apply: () => {
          const rows = parsePasteRows(state.text);
          if (!rows.length) {
            setState((s) => (s ? { ...s, error: '没有解析到有效内容，请粘贴后重试' } : s));
            return;
          }
          const msg = state.applyRows(rows);
          if (!msg) {
            setState((s) => (s ? { ...s, error: '未能解析出有效数据行，请检查列数与数值格式' } : s));
            return;
          }
          setState(null);
          if (showToast) showToast(msg);
        },
      }
    : null;

  return { paste, open, close };
}

/**
 * 粘贴文本 → 单元格矩阵。
 * 分隔符容错：Excel 复制出来是 tab，手写常用逗号/空格/分号。
 * 单列时再按空白切一次，让「155 1000 0.98」这种一行三值也能直接贴。
 */
export function parsePasteRows(text) {
  const rows = [];
  String(text || '')
    .split(/\r\n|\n|\r/)
    .forEach((line) => {
      if (!line.trim()) return;
      let cells = line
        .trim()
        .split(/\t|,|，|;|；/)
        .map((c) => c.trim())
        .filter((c) => c !== '');
      if (cells.length === 1) cells = cells[0].split(/\s+/).filter((c) => c !== '');
      if (cells.length) rows.push(cells);
    });
  return rows;
}

/**
 * 工具的自动保存：改动停下 400ms 后落盘（键名走 toolStorage 的既有形态）。
 * @param {string} id 工具 id
 * @param {number} version 存档版本
 * @param {*} value 待存值（由调用方先转成"可落盘形态"）
 * @returns {{savedAt:number|null}} 落盘时间戳，供骨架显示保存徽标
 */
export function useToolAutoSave(id, version, value, enabled = true) {
  const [savedAt, setSavedAt] = useState(null);
  useEffect(() => {
    if (!enabled) return undefined;
    const t = setTimeout(() => {
      if (saveToolState(id, version, value)) setSavedAt(Date.now());
    }, SAVE_DEBOUNCE_MS);
    return () => clearTimeout(t);
    // value 是每次渲染新建的对象 —— 靠序列化结果判断"真的变了没有"
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, version, enabled, JSON.stringify(value)]);
  return { savedAt };
}

/**
 * 读一次存档（仅在挂载时）。读到就返回，读不到返回 null。
 * 放在 hook 里是为了让"恢复过上次数据"这件事能被工具拿到并提示用户。
 */
export function useRestoredState(id, version, opts = {}) {
  const [restored] = useState(() => loadToolState(id, version, opts));
  return restored;
}

/** 保存徽标文案（与 RTI 原有口径一致）。 */
export function saveLabel(savedAt) {
  if (!savedAt) return '自动保存已开启';
  const d = new Date(savedAt);
  const pad = (n) => String(n).padStart(2, '0');
  return `已自动保存 ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
