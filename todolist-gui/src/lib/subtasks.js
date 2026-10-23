// 子任务关系（纯函数层）。
//
// 关系写在子任务那一行上：`parent:<父的 stableId>`。
// **不用缩进**表达从属 —— 缩进在 todo.txt 里活不下来：topydo 不认、记事本会吃掉行首空格、
// 复制粘贴时经常丢。一行一条 + 一个标签，是唯一能扛住"外部编辑器随便改"的形状。
//
// 这里只回答三个问题：谁是谁的子、某个父有几个子完成了、按"父在前、子紧随"排出来是什么顺序。
// 所有函数都吃 buildNesting 的产物 —— 索引只建一次，别在每个行组件里各扫一遍全表。
import { isValidStableId } from './todoParser.js';

/**
 * 沿 parent 链往上走，判断这条任务是否落在环里（A 认 B 为父、B 又认 A）。
 * 环不检测的话，嵌套排序会把两条任务互相吞掉 —— 谁都不肯先出场，最后整组消失。
 */
function inCycle(entry, stableIndex) {
  const seen = new Set();
  let cur = entry;
  for (let guard = 0; guard < 32; guard += 1) {
    if (!cur.parentId || !isValidStableId(cur.parentId)) return false;
    if (seen.has(cur.parentId)) return true;
    seen.add(cur.parentId);
    const parent = stableIndex.get(cur.parentId);
    if (!parent) return false;
    if (parent.id === entry.id) return true;
    cur = parent;
  }
  return true; // 链长得离谱，按环处理（不再往下追）
}

/**
 * 建子任务索引。
 * @param {Array} entries 全部条目（todo.txt 的；done.txt 不用建，已完成不参与嵌套）
 * @returns {{stableIndex:Map, parentOf:Map, byParent:Map, depth:Map}}
 */
export function buildNesting(entries) {
  const stableIndex = new Map(); // stableId → entry
  for (const e of entries || []) {
    if (e && e.kind === 'task' && e.stableId) stableIndex.set(e.stableId, e);
  }

  const parentOf = new Map(); // 子运行时 id → 父 entry
  const byParent = new Map(); // 父运行时 id → 子 entry[]
  for (const e of entries || []) {
    if (!e || e.kind !== 'task' || !e.parentId) continue;
    const parent = stableIndex.get(e.parentId);
    // 认不出来 / 认自己 / 落在环里 —— 三种都当它没有父：降级为顶层任务，
    // 宁可显示成一条普通任务，也不能让它从界面上消失。
    if (!parent || parent.id === e.id || inCycle(e, stableIndex)) continue;
    parentOf.set(e.id, parent);
    if (!byParent.has(parent.id)) byParent.set(parent.id, []);
    byParent.get(parent.id).push(e);
  }

  const depth = new Map(); // 运行时 id → 层级（顶层 0）
  const depthOf = (e) => {
    if (depth.has(e.id)) return depth.get(e.id);
    let d = 0;
    let cur = e;
    for (let guard = 0; guard < 16 && parentOf.has(cur.id); guard += 1) {
      d += 1;
      cur = parentOf.get(cur.id);
    }
    depth.set(e.id, d);
    return d;
  };
  for (const e of entries || []) {
    if (e && e.kind === 'task') depthOf(e);
  }

  return { stableIndex, parentOf, byParent, depth };
}

/** 某条任务的子任务（没建索引或没有子时返回空数组）。 */
export function childrenOf(nesting, stableId) {
  if (!nesting || !stableId) return [];
  const parent = nesting.stableIndex.get(stableId);
  if (!parent) return [];
  return nesting.byParent.get(parent.id) || [];
}

/** 进度：{done, total}。没有子任务时 total 为 0 —— 调用方据此决定要不要显示。 */
export function childProgress(nesting, stableId) {
  const kids = childrenOf(nesting, stableId);
  return { done: kids.filter((k) => k.completed).length, total: kids.length };
}

/** 层级（0 = 顶层）。 */
export function depthOf(nesting, entry) {
  if (!nesting || !entry) return 0;
  return nesting.depth.get(entry.id) || 0;
}

/**
 * 把子任务排到它的父任务后面。
 *
 * 两条硬约束：
 *  ① **父不在列表里时，子降级为顶层，绝不能消失** —— 过滤 / 搜索 / 父已完成都会造成这种情况，
 *     一条任务因为"它爹不在这屏"就看不见了，是最难排查的那类 bug。
 *  ② 环已在建索引时断开，这里不再处理。
 *
 * @param {Array} tasks 当前视图已经过滤 + 排序好的任务
 * @param {object} nesting buildNesting 的产物
 */
export function nestChildren(tasks, nesting) {
  if (!nesting) return tasks;
  const list = tasks || [];
  const inList = new Set(list.map((t) => t.id));
  const childIds = new Set();
  const kidsInList = new Map(); // 父运行时 id → 子[]（只含也在列表里的）

  for (const t of list) {
    // 认 parentOf（建索引时已排除环与自己认自己），**不再从 parentId 现推** ——
    // 现推会把环上那几条也当成人家的子，于是谁都不肯先出场，整组一起消失。
    const parent = nesting.parentOf.get(t.id);
    if (!parent) continue;
    if (!inList.has(parent.id)) continue; // 父不在这屏 → 降级顶层
    childIds.add(t.id);
    if (!kidsInList.has(parent.id)) kidsInList.set(parent.id, []);
    kidsInList.get(parent.id).push(t);
  }

  const out = [];
  for (const t of list) {
    if (childIds.has(t.id)) continue; // 由它的父带出场
    out.push(t);
    for (const kid of kidsInList.get(t.id) || []) out.push(kid);
  }
  return out;
}
