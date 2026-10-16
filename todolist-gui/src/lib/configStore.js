// 通用「本机配置」存储 —— localStorage 里的配置只该有一种读法。
//
// 提供一套统一的 load / normalize / save / clear / subscribe。
// 理由：**每个需要落盘的配置都要同样的三件事** ——
//   ① 默认值明确（没配置 = 用默认，不产生副作用）
//   ② 存在本机 localStorage（所以必须能"清除"而不只是"关闭"）
//   ③ 改完立刻生效（唯一真相是 localStorage，界面状态只是投影）
// 每加一个配置就抄一遍这三点，迟早有一份抄漏其中一条。
//
// 刻意保持"一个 store 一个键、各自广播"：不同能力的配置互不影响，
// 清除一个不会顺手把另一个也抹掉。
//
// 另一个刻意的取舍：**存储层不认识"启用"的语义**。
// 「已落盘」与「已启用」必须分开 —— 用户可能填了内容却没打开开关，
// 那仍然是一份落盘数据，必须允许清除，否则那份数据永远删不掉。
// 所以这里只提供 hasStored()，至于"算不算开启"由各自的 isXxxEnabled 判断。
export function createConfigStore({ key, defaults, normalize }) {
  if (!key) throw new Error('createConfigStore 需要一个 key');
  const norm = typeof normalize === 'function' ? normalize : (c) => ({ ...defaults, ...(c || {}) });
  const listeners = new Set();

  const emit = () => {
    for (const fn of [...listeners]) {
      try {
        fn();
      } catch {
        // 单个订阅者出错不影响其它订阅者，也不影响写入结果
      }
    }
  };

  const safeStorage = () => {
    try {
      return typeof localStorage === 'undefined' ? null : localStorage;
    } catch {
      return null; // 隐私模式 / 被策略禁用
    }
  };

  /** 读配置。未落盘或不可用时返回 null（调用方用 defaults 兜底）。 */
  function load() {
    const ls = safeStorage();
    if (!ls) return null;
    try {
      const raw = ls.getItem(key);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return null;
      return norm(parsed);
    } catch {
      return null;
    }
  }

  /** 读配置，未落盘时给 defaults 的归一化结果（读点最常用的形态）。 */
  function loadOr() {
    return load() || norm(defaults);
  }

  function save(cfg) {
    const ls = safeStorage();
    if (!ls) return false;
    try {
      ls.setItem(key, JSON.stringify(norm(cfg)));
      emit();
      return true;
    } catch {
      return false;
    }
  }

  function clear() {
    const ls = safeStorage();
    if (!ls) return false;
    try {
      ls.removeItem(key);
      emit();
      return true;
    } catch {
      return false;
    }
  }

  /** 本机是否已落盘过配置（决定"能不能清除"，与"是否启用"无关）。 */
  function hasStored() {
    const ls = safeStorage();
    if (!ls) return false;
    try {
      return ls.getItem(key) !== null;
    } catch {
      return false;
    }
  }

  /** 订阅保存 / 清除。返回取消订阅函数（可直接作为 useEffect 的返回值）。 */
  function subscribe(fn) {
    if (typeof fn !== 'function') return () => {};
    listeners.add(fn);
    return () => listeners.delete(fn);
  }

  return { key, defaults, normalize: norm, load, loadOr, save, clear, hasStored, subscribe };
}

// —— 表单字段共用的小工具 ——
// 数值型字段都有一组相同的取值范围约束，写在这里避免每个字段各写一遍。

/**
 * 把输入夹到 [min, max] 的整数。非数字回落到 fallback。
 * 注意 `''` 在 Number('') === 0 下会变成 min —— 所以先显式拒绝空串，
 * 否则用户清空输入框的瞬间就会被"纠正"成最小值，看起来像输入不动。
 */
export function clampInt(value, { min, max }, fallback) {
  if (value === '' || value === null || value === undefined) return fallback;
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

/** 多行文本 → 去重、去空白、小写化的字符串数组（列表类字段用）。 */
export function parseList(text) {
  const out = [];
  const seen = new Set();
  for (const line of String(text || '').split(/[\n,;，；]/)) {
    const v = line.trim().toLowerCase();
    if (!v || seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out;
}
