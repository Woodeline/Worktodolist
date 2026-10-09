// 工具存档统一入口：键名生成 + 版本守卫 + 迁移钩子。
//
// 键名形态沿用既有的 `todolist.tool.<id>.v<version>`（RTI 原本硬编码
// `todolist.tool.rti.v1`）—— 因此 RTI 不需要任何迁移，只是从"自己拼字符串"
// 改为"调用这里"。工具多了以后，键名与版本守卫必须是同一处实现，否则
// 每加一个工具就多一份手写的读回校验。
//
// 职责边界：
//   · 这里只管「键名 + 版本 + 迁移 + 容错」，不认识任何具体工具的数据结构；
//   · 结构校验由调用方通过 isValid 传入（工具自己最清楚什么算合法存档）。
//
// 另有一份**工具集元数据**（MRU / 收藏），与各工具存档分开存：
// 它是左栏的排序信息，不属于任何工具的数据，因此不跟着 stateVersion 走。

const PREFIX = 'todolist.tool.';
const META_KEY = 'todolist.tools.meta.v1';

/** 存档键名。形态是既有约定，别改。 */
export function toolKey(id, version = 1) {
  return `${PREFIX}${id}.v${version}`;
}

function safeGet(key) {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage.getItem(key);
  } catch {
    return null; // 隐私模式 / 配额满 → 静默降级，导出导入仍然可用
  }
}

function safeSet(key, text) {
  try {
    if (typeof localStorage === 'undefined') return false;
    localStorage.setItem(key, text);
    return true;
  } catch {
    return false;
  }
}

/**
 * 读取一份工具存档。
 *
 * @param {string} id 工具 id
 * @param {number} version 当前存档版本
 * @param {object} [opts]
 * @param {(saved:object, fromVersion:number)=>object} [opts.migrate] 旧版本 → 新版本
 * @param {(saved:object)=>boolean} [opts.isValid] 结构校验（默认：非空对象）
 * @returns {object|null} 存档原样返回（不认识的字段也保留），或 null
 */
export function loadToolState(id, version = 1, opts = {}) {
  const { migrate, isValid } = opts;
  const raw = safeGet(toolKey(id, version));
  if (!raw) return null;
  let saved;
  try {
    saved = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!saved || typeof saved !== 'object') return null;

  // 版本守卫：同版本直接用；低版本走迁移（没有迁移钩子就当作无法识别）。
  if (saved.v !== version) {
    if (typeof migrate !== 'function' || typeof saved.v !== 'number' || saved.v > version) return null;
    try {
      saved = migrate(saved, saved.v);
    } catch {
      return null;
    }
    if (!saved || saved.v !== version) return null;
  }

  const ok = typeof isValid === 'function' ? isValid(saved) : true;
  return ok ? saved : null;
}

/** 写入一份工具存档。返回是否成功（localStorage 不可用时为 false）。 */
export function saveToolState(id, version = 1, value) {
  try {
    return safeSet(toolKey(id, version), JSON.stringify({ ...value, v: version, savedAt: Date.now() }));
  } catch {
    return false;
  }
}

/** 清掉某个工具的存档。 */
export function clearToolState(id, version = 1) {
  try {
    if (typeof localStorage !== 'undefined') localStorage.removeItem(toolKey(id, version));
  } catch {
    // 忽略
  }
}

/**
 * 按 `(id, version)` 封一个存取小对象，供工具少写样板。
 * @returns {{id:string, version:number, key:string, load:Function, save:Function, clear:Function}}
 */
export function toolStorage(id, version = 1, opts = {}) {
  return {
    id,
    version,
    key: toolKey(id, version),
    load: () => loadToolState(id, version, opts),
    save: (value) => saveToolState(id, version, value),
    clear: () => clearToolState(id, version),
  };
}

/* ---------------------------------------------------------------------------
   工具集元数据：最近使用 / 收藏
   ---------------------------------------------------------------------------
   这两样都是**左栏的排序与置顶行为**，不是新页面（实施说明条目 14 的硬约束）。
   与各工具存档分开存，避免把"导航信息"混进"工具数据"。
--------------------------------------------------------------------------- */

const EMPTY_META = { v: 1, mru: [], favorites: [] };

export function loadToolMeta() {
  const raw = safeGet(META_KEY);
  if (!raw) return { ...EMPTY_META };
  try {
    const m = JSON.parse(raw);
    if (!m || m.v !== 1) return { ...EMPTY_META };
    return {
      v: 1,
      mru: Array.isArray(m.mru) ? m.mru.filter((x) => typeof x === 'string') : [],
      favorites: Array.isArray(m.favorites) ? m.favorites.filter((x) => typeof x === 'string') : [],
    };
  } catch {
    return { ...EMPTY_META };
  }
}

export function saveToolMeta(meta) {
  const next = {
    v: 1,
    mru: Array.isArray(meta && meta.mru) ? meta.mru.slice(0, 12) : [],
    favorites: Array.isArray(meta && meta.favorites) ? meta.favorites.slice(0, 24) : [],
  };
  return safeSet(META_KEY, JSON.stringify(next)) ? next : next;
}

/** 把某个工具提到 MRU 队首（纯函数，返回新的 meta）。 */
export function touchMru(meta, id, limit = 12) {
  const mru = [id, ...(meta.mru || []).filter((x) => x !== id)].slice(0, limit);
  return { ...meta, mru };
}

/** 收藏开关（纯函数）。 */
export function toggleFavorite(meta, id) {
  const has = (meta.favorites || []).includes(id);
  const favorites = has
    ? meta.favorites.filter((x) => x !== id)
    : [id, ...(meta.favorites || [])];
  return { ...meta, favorites };
}
