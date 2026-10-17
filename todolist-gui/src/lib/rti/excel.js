// RTI 工具的数据 ⇄ Excel 工作簿 的映射。
//
// 「导出数据 / 导入数据」原来是 JSON。改成 Excel 的动机很实在：这份数据本来就是
// 从实验表里抄来的，用户真正想干的事是"在 Excel 里改两格再喂回去"，而不是
// 面对一段看不懂的 JSON。于是导出成三张工作表，导入再把它们读回来：
//
//   耐热指数     —— 顶部是参数（材料名称 / 初始特性值 P₀），下面那张就是录入表本身
//   推算结果     —— 有结果时才写：各温度 t₅₀、回归参数、RTI + 95%CI、Ea（**只写不读**）
//   多材料对比   —— 材料名 / 温度 / t₅₀ 三列，与对比页的"粘贴导入"同一口径
//   对比图设置   —— 温度轴上下限 + 对数纵轴（只有对比页用得上）
//
// 读的一侧刻意**按内容找位置**，不按固定行号：用户可以删掉参数行、给表加表头、
// 在中间插空行，只要还认得出"老化温度 / 特性值"这行表头，数据就进得来。
// 「推算结果」是一张**派生表**（由数据算出，导入时自然忽略），所以它只出现在导出侧。
// 一句"导出的文件再导入必须回到原样"由 excel.test.js 钉住。
import { DEFAULT_TEMP_RANGE, RTI_LIFE, fmtTemp, toNum } from './calc.js';

export const SHEET_RTI = '耐热指数';
export const SHEET_RESULT = '推算结果';
export const SHEET_CMP = '多材料对比';
export const SHEET_SET = '对比图设置';

const MAIN_HEADER = ['老化温度 T（°C）', '老化时长 t（h）', '特性值'];
const CMP_HEADER = ['材料名称', '老化温度 T（°C）', 't50（h）'];

/** 单元格 → 文本（数字也转成文本；null/undefined → 空串） */
const text = (v) => (v == null ? '' : String(v).trim());

/** 单元格 → 数字或 null（口径与界面一致：空/非数字 = 没填） */
function num(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  return toNum(text(v));
}

/* ---------------------------------------------------------------------------
   导出：存档状态 → 工作表
   ------------------------------------------------------------------------- */

/**
 * 界面存档（toStorage 的输出形状）→ 工作表数组。
 * 数字直接写成数字单元格 —— 用户拿去做进一步计算时不用再"转成数值"。
 *
 * 第二参 `result` 传 `compute().out.result`（算不出来时为 null）：
 * 有结果就多挂一张「推算结果」表，把它紧跟在「耐热指数」后面 —— 数据与由它算出的
 * 结论放在相邻两张表，用户从一个文件里就能同时拿到"输入"与"答案"。没有结果时
 * 保持原来的三张表，不多写一张空表。
 */
export function sheetsFromData(s, result = null) {
  const rti = (s && s.rti) || {};
  const cmp = (s && s.cmp) || {};

  const rtiRows = [['材料名称', text(rti.name)], ['初始特性值 P0', rti.p0 == null ? '' : rti.p0], [], MAIN_HEADER.slice()];
  ((rti.rows) || []).forEach((r) => {
    const T = r && r.T != null ? r.T : null;
    const t = r && r.t != null ? r.t : null;
    const v = r && r.v != null ? r.v : null;
    if (T == null && t == null && v == null) return; // 整行空的没信息量，不写进文件
    rtiRows.push([T ?? '', t ?? '', v ?? '']);
  });

  const cmpRows = [CMP_HEADER.slice()];
  (((cmp.mats) || [])).forEach((m) => {
    const name = text(m && m.name);
    const rows = ((m && m.rows) || []).filter((r) => r && (r.T != null || r.t != null));
    if (!rows.length) {
      // 一个还没填值的材料也要留名，否则导入后就"少了一种材料"
      cmpRows.push([name, '', '']);
      return;
    }
    rows.forEach((r) => cmpRows.push([name, r.T ?? '', r.t ?? '']));
  });

  const setRows = [
    ['温度下限（°C）', cmp.xMin == null ? DEFAULT_TEMP_RANGE.min : cmp.xMin],
    ['温度上限（°C）', cmp.xMax == null ? DEFAULT_TEMP_RANGE.max : cmp.xMax],
    ['Y 轴对数坐标', cmp.logY === false ? '否' : '是'],
  ];

  const sheets = [{ name: SHEET_RTI, rows: rtiRows }];
  const derived = resultSheet(result);
  if (derived) sheets.push(derived);
  sheets.push({ name: SHEET_CMP, rows: cmpRows });
  sheets.push({ name: SHEET_SET, rows: setRows });
  return sheets;
}

/**
 * 推算结果 → 工作表（只写不读）。
 *
 * 内容与界面上「各温度 t₅₀ / 统计条 / 结论卡」同一口径：perT 的 t₅₀、Arrhenius 回归
 * 参数、RTI@两档寿命 + 95%CI、活化能 Ea。数值格式沿用结果页那版的写法，导入时
 * 这张表被忽略（结果永远由数据现算，不读文件）。
 */
export function resultSheet(result) {
  if (!result) return null;
  const rows = [];
  rows.push(['材料名称', text(result.name)]);
  rows.push(['初始特性值 P0', result.p0]);
  rows.push([]);
  rows.push(['各温度下的 t₅₀']);
  rows.push(['老化温度 T（°C）', 't50（h）', '求法']);
  result.perT.forEach((p) => rows.push([fmtTemp(p.T), Math.round(p.t50), p.mode === 'interp' ? '内插' : '外推']));
  rows.push([]);
  rows.push(['Arrhenius 回归']);
  rows.push(['回归 a', '回归 b', 'R2', '残差 s', '自由度 df', 't0.975']);
  rows.push([
    result.a.toFixed(4),
    result.b.toFixed(2),
    result.r2.toFixed(5),
    result.s == null ? '—' : result.s.toFixed(5),
    result.df,
    result.tc == null ? '—' : result.tc.toFixed(3),
  ]);
  rows.push([]);
  rows.push(['耐热指数']);
  rows.push(['指标', 'RTI（°C）', '95%CI 下限', '95%CI 上限']);
  rows.push([`RTI @ ${RTI_LIFE.r20} h`, result.r20.rti.toFixed(1), result.r20.ci ? result.r20.ci.lo.toFixed(1) : '', result.r20.ci ? result.r20.ci.hi.toFixed(1) : '']);
  rows.push([`RTI @ ${RTI_LIFE.r100} h`, result.r100.rti.toFixed(1), result.r100.ci ? result.r100.ci.lo.toFixed(1) : '', result.r100.ci ? result.r100.ci.hi.toFixed(1) : '']);
  rows.push([]);
  rows.push(['活化能 Ea（kJ/mol）', result.Ea.toFixed(1)]);
  return { name: SHEET_RESULT, rows };
}

/* ---------------------------------------------------------------------------
   导入：工作表 → 存档状态
   ------------------------------------------------------------------------- */

/** 工作表清单里按名字挑一张（名字被改过时返回 null，由调用方兜底） */
const pick = (sheets, name) => (sheets || []).find((s) => text(s && s.name) === name) || null;

const isBlankCell = (v) => v == null || v === '';

/** 「耐热指数」表：先扫关键词（材料名称 / 初始特性值）与表头，再顺着读数据行 */
function readRtiSheet(sheet) {
  const rows = (sheet && sheet.rows) || [];
  let name = '';
  let p0 = null;
  let start = -1;
  for (let i = 0; i < rows.length; i++) {
    const cells = rows[i] || [];
    const a = text(cells[0]);
    if (start >= 0) continue;
    if (a === '材料名称') {
      name = text(cells[1]);
      continue;
    }
    if (a.indexOf('初始特性值') === 0) {
      p0 = num(cells[1]);
      continue;
    }
    if (a.indexOf('老化温度') === 0 || text(cells[2]) === '特性值') start = i + 1;
  }
  if (start < 0) start = 0; // 用户自己攒的表：没有表头就从第一行读

  const data = [];
  for (let i = start; i < rows.length; i++) {
    const cells = rows[i] || [];
    if (isBlankCell(cells[0]) && isBlankCell(cells[1]) && isBlankCell(cells[2])) continue;
    data.push({ T: num(cells[0]), t: num(cells[1]), v: num(cells[2]) });
  }
  return { name, p0, rows: data };
}

/** 「多材料对比」表：第一列是材料名，同名归一种材料（与对比页的粘贴导入同规则） */
function readCmpSheet(sheet) {
  const rows = (sheet && sheet.rows) || [];
  const mats = [];
  const byName = new Map();
  rows.forEach((cells) => {
    cells = cells || [];
    const name = text(cells[0]);
    if (!name) return;
    // 表头行：第三列写着 t50 / t₅₀
    if (/t\s*50|t₅₀/i.test(text(cells[2]))) return;
    if (!byName.has(name)) {
      const m = { name, rows: [] };
      byName.set(name, m);
      mats.push(m);
    }
    const m = byName.get(name);
    const T = num(cells[1]);
    const t = num(cells[2]);
    if (T != null && t != null && t > 0) m.rows.push({ T, t });
    else if (!m.rows.length) m.rows.push({ T: '', t: '' }); // 占位：保住这个还没填数的材料
  });
  mats.forEach((m) => {
    if (m.rows.length > 1) m.rows = m.rows.filter((r) => !isBlankCell(r.T) || !isBlankCell(r.t));
  });
  return mats;
}

/** 「对比图设置」表：键值对，认不出就留默认 */
function readSetSheet(sheet) {
  const out = { xMin: null, xMax: null, logY: null };
  ((sheet && sheet.rows) || []).forEach((cells) => {
    const a = text((cells || [])[0]);
    const b = (cells || [])[1];
    if (a.indexOf('温度下限') === 0) out.xMin = num(b);
    else if (a.indexOf('温度上限') === 0) out.xMax = num(b);
    else if (a.indexOf('对数') >= 0) out.logY = !/^(否|no|false|0)$/i.test(text(b));
  });
  return out;
}

/**
 * 工作表 → 存档状态（与 toStorage 同形状，可直接交给 applyIn）。
 * 找不到「耐热指数」表就返回 null —— 这是"这不是本工具的文件"的唯一硬判据；
 * 另外两张表缺了都不算错（对比页可以是空的）。
 */
export function dataFromSheets(sheets) {
  const list = sheets || [];
  const rtiSheet =
    pick(list, SHEET_RTI) ||
    // 表名被改过：退一步认表头（有"老化温度"这一行的就是数据表）
    list.find((s) => ((s && s.rows) || []).some((r) => text((r || [])[0]).indexOf('老化温度') === 0)) ||
    null;
  if (!rtiSheet) return null;

  const rti = readRtiSheet(rtiSheet);
  const set = readSetSheet(pick(list, SHEET_SET));
  const xMin = set.xMin == null ? DEFAULT_TEMP_RANGE.min : set.xMin;
  const xMax = set.xMax == null ? DEFAULT_TEMP_RANGE.max : set.xMax;

  return {
    rti: { name: rti.name, p0: rti.p0, rows: rti.rows },
    cmp: {
      mats: readCmpSheet(pick(list, SHEET_CMP)),
      xMin,
      xMax,
      logY: set.logY == null ? true : set.logY,
    },
  };
}
