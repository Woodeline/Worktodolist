// RTI 工具的**扁平行**数据模型。
//
// 改造前，数据按"页"分成三份实体：页 1 一条单温度序列、页 2 一组温度卡片、
// 页 3 一组材料。改造后页 1 并进页 2：只剩**一张 (温度, 时长, 特性值) 的扁平表**，
// 温度组由温度推导出来，衰减曲线成为每个温度组的下钻视图 —— 用户不必再手动
// 新建 / 折叠温度卡，写在一起就自动成组。
//
// 抽到 lib 里，理由与 calc.js 相同：这是纯函数，能单测；界面只负责把它接到表单上。
// 算法一行都没重写 —— compute() 只是把分组喂给真实的 rtiCalc / lifeCalc。
import { lifeCalc, rtiCalc, toNum } from './calc.js';

const asStr = (x) => (x == null ? '' : String(x));

/** 示例数据（DEMO_RTI）→ 扁平行。协议与「粘贴导入」一致：每行 T, t, v */
export function rowsFromDemo(demo) {
  const rows = [];
  ((demo && demo.temps) || []).forEach((g) =>
    ((g && g.rows) || []).forEach(([t, v]) => rows.push({ T: asStr(g.T), t: asStr(t), v: asStr(v) }))
  );
  return rows;
}

/** 空态：三行空表，够录第一组数据 */
export const emptyRows = () => Array.from({ length: 3 }, () => ({ T: '', t: '', v: '' }));

/**
 * 扁平行 → 温度组。
 *
 * 判据完全复用 calc.js 的 toNum：同一温度的写法（170 / 170.0）自动并到一组，
 * 空行与非数字被跳过。blank 只统计"用户碰过但填得不完整"的行，
 * 用于在界面上给一句实话（"有 N 行不完整、已跳过"），而不是默默吞掉。
 */
export function groupRows(rows) {
  const map = new Map();
  let blank = 0;
  (rows || []).forEach((r) => {
    const T = toNum(r && r.T);
    const t = toNum(r && r.t);
    const v = toNum(r && r.v);
    const touched = Boolean(r) && (r.T !== '' || r.t !== '' || r.v !== '');
    if (T == null || !(t > 0) || v == null) {
      if (touched) blank += 1;
      return;
    }
    if (!map.has(T)) map.set(T, { T, pts: [] });
    map.get(T).pts.push({ t, v });
  });
  const groups = [...map.values()]
    // 高温在前：与 Arrhenius 图、结果表的阅读顺序一致
    .sort((a, b) => b.T - a.T)
    .map((g) => ({ ...g, pts: [...g.pts].sort((a, b) => a.t - b.t) }));
  return { groups, blank };
}

/**
 * 一次算全部：
 *   · out —— 喂给 rtiCalc 的 RTI 结果（含 95%CI / Ea / 回归参数）；
 *   · perGroup —— 每个温度自己的 lifeCalc 结果，正是"把页 1 并进页 2"的关键：
 *     页 1 的独有价值（那条衰减曲线）变成每个温度组的下钻视图，而不是另一个平级页签。
 *
 * 两个子算法都不抛异常（失败一律返回 { error }），所以这里可以放心地在每次按键时调用。
 */
export function compute(rows, name, p0) {
  const { groups, blank } = groupRows(rows);
  const temps = groups.map((g) => ({ T: String(g.T), rows: g.pts.map((p) => [String(p.t), String(p.v)]) }));
  const out = rtiCalc({ name, p0, temps });
  const perGroup = groups.map((g) => ({
    T: g.T,
    pts: g.pts,
    life: lifeCalc({ name, T: String(g.T), p0, pts: g.pts }),
  }));
  return { groups, perGroup, blank, out };
}

/**
 * 旧存档 → 新的扁平行（**只**用于读懂 v1 的老数据，不参与新写入）。
 *
 * 折叠规则按"尽量不丢数据、也绝不污染计算"排序：
 *   ① 先把 rti.temps 摊平 —— 那是喂给 RTI 的多温度数据，是主线；
 *   ② 只有当摊平后不足 2 个有效温度、且旧 life 有 ≥2 个点、且它的温度不与
 *      已摊平的温度重复时，才把 life 那条单温度序列并进来
 *      （照顾"当年只用了页 1"的老用户）。
 *
 * 为什么要防重复：新模型里同一温度的行会**并成一组**。把 life 硬塞进一个已存在的
 * 温度里，会把它和页 2 的数据混成一条序列，t₅₀ 反而被算错 —— 所以宁可保守。
 */
export function legacyRows(life, temps) {
  const rows = [];
  const seen = new Set();
  (temps || []).forEach((g) => {
    const T = toNum(g && g.T);
    if (T != null) seen.add(T);
    ((g && g.rows) || []).forEach((r) => rows.push({ T: asStr(g && g.T), t: asStr(r && r[0]), v: asStr(r && r[1]) }));
  });

  const lifePts = life && Array.isArray(life.pts) ? life.pts : [];
  const lifeT = toNum(life && life.T);
  const tempCount = new Set(rows.map((r) => toNum(r.T)).filter((x) => x != null)).size;
  if (tempCount < 2 && lifeT != null && !seen.has(lifeT) && lifePts.length >= 2) {
    lifePts.forEach((p) => rows.push({ T: asStr(life.T), t: asStr(p && p.t), v: asStr(p && p.v) }));
  }
  return rows.length ? rows : emptyRows();
}
