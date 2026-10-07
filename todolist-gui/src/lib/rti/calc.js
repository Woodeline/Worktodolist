// RTI 工具的三个计算入口 + 全部显示格式化。
//
// 与界面完全解耦：入参是普通对象，出参是普通对象或 { error }。
// 这样单测不用起浏览器，界面也不用写业务判断。
//
// 返回约定：
//   成功 → { result, warns: string[] }
//   失败 → { error: string }
// 一次只报第一个错（与源工具一致：先拦住最该修的那个，而不是堆一屏红字）。

import { linreg, rtiCI, seriesT50, tQ975 } from './stats.js';

/** 50% 阈值的口径：初始特性值的一半 */
export const THRESHOLD_RATIO = 0.5;

/** RTI 的两个标准寿命口径（小时） */
export const RTI_LIFE = { r20: 20000, r100: 100000 };

/** 表观活化能系数：Ea = ln10 · R · b，R = 8.314 J/(mol·K)，再折成 kJ/mol */
export const EA_FACTOR = (Math.LN10 * 8.314) / 1000;

/**
 * 输入框里的值 → 数字或 null。
 *
 * 界面上的数字框保存的是**用户正在输入的字符串**（而不是解析后的数字），
 * 否则受控输入会在"0."、"-"这种中间态上把光标内容吞掉。所以解析统一放在这里：
 * 空串 / 非数字 / null 一律当成"没填"，而不是 0 —— 这一点很关键，
 * 把空值当 0 会让 `+'' === 0` 悄悄通过所有"大于 0"的检查。
 *
 * 导出它是为了让界面能用**同一把尺子**统计"有几行会被真正用上"，
 * 而不是在组件里再写一遍解析规则。
 */
export function toNum(x) {
  if (x === '' || x == null) return null;
  const n = +x;
  return Number.isFinite(n) ? n : null;
}

/* ---------------------------------------------------------------------------
   格式化 —— 单位与有效位在数据密集的界面里是信息的一部分，统一在这里定
   ------------------------------------------------------------------------- */

/** 小时：小值留一位小数，大值取整并加千分位 */
export function fmtH(t) {
  if (!(t > 0)) return '—';
  if (t >= 10000) return Math.round(t).toLocaleString('en-US');
  if (t >= 100) return String(Math.round(t));
  return t.toFixed(1);
}

/** 只有到"年"的量级才换算 —— 否则反而更难读 */
export function yearsOf(t) {
  return t >= 8760 ? `（约 ${(t / 8760).toFixed(1)} 年）` : '';
}

export function fmtTemp(v) {
  if (v == null || !Number.isFinite(+v)) return '—';
  return Math.abs(v - Math.round(v)) < 0.05 ? String(Math.round(v)) : (+v).toFixed(1);
}

/**
 * R² 的显示位数随"好到什么程度"变化：
 * 拟合极好时多留一位，否则 0.99997 会被四舍五入成 1.0000，读者就分不出
 * "几乎完美"和"完全共线"了。
 */
export function fmtR2(r) {
  if (!Number.isFinite(r)) return '—';
  if (r >= 0.999995) return '1.0000';
  if (r >= 0.99995) return r.toFixed(5);
  return r.toFixed(4);
}

/** 4 位有效数字（阈值这类"必须和输入对得上"的数值用它） */
export function fmtSig(v) {
  return +(+v).toPrecision(4);
}

/* ---------------------------------------------------------------------------
   页 1 · 寿命推算：单温度序列 → t₅₀
   ------------------------------------------------------------------------- */

export function lifeCalc({ name, T, p0, pts } = {}) {
  const clean = (pts || [])
    .map((p) => ({ t: toNum(p && p.t), v: toNum(p && p.v) }))
    .filter((p) => p.t > 0 && p.v != null)
    .sort((a, b) => a.t - b.t);

  if (clean.length < 2) {
    return { error: '先凑够 2 个有效数据点（时长大于 0、特性值不为空），再来推算' };
  }

  // P₀ 留空 = 用最早那个点的特性值当初始值（试验里最常见的约定）。
  // 但"填了但填错"不能悄悄回退到默认值，所以两条路分开判断。
  const base = p0 === '' || p0 == null ? clean[0].v : toNum(p0);
  if (!(base > 0)) return { error: '初始特性值 P₀ 得是正数' };
  const thr = base * THRESHOLD_RATIO;

  const warns = [];
  const found = seriesT50(clean, thr);
  if (found.error) {
    return {
      error:
        found.error.includes('低于 50%')
          ? '所有实测值都已经低于 50% 阈值，缺了早期高值的点，没法内插。补几组更早（特性值更高）的数据试试'
          : '这组数据看不出随时间衰减的趋势（回归斜率 ≥ 0），先核对一下数值',
    };
  }

  if (found.mode === 'extrap') {
    warns.push(
      '数据还没跨过 50% 阈值，这个结果是按「特性值 ~ log₁₀ t」回归外推出来的，置信度不如内插，建议延长试验再验证'
    );
    if (found.t50 > 10 * clean[clean.length - 1].t) {
      warns.push(
        `外推跨度达到最长实测时长的 ${(found.t50 / clean[clean.length - 1].t).toFixed(0)} 倍，不确定性不小`
      );
    }
  }

  const Tnum = toNum(T);
  return {
    warns,
    result: {
      name: (name || '').trim() || '未命名材料',
      T: Tnum,
      p0: base,
      thr,
      t50: found.t50,
      mode: found.mode,
      lo: found.lo || null,
      hi: found.hi || null,
      fit: found.fit || null,
      pts: clean,
    },
  };
}

/* ---------------------------------------------------------------------------
   页 2 · RTI 耐热指数：多温度 t₅₀ → Arrhenius 外推 → RTI + 95%CI + Ea
   ------------------------------------------------------------------------- */

export function rtiCalc({ name, p0, temps } = {}) {
  const groups = (temps || [])
    .map((g) => ({
      T: toNum(g && g.T),
      pts: ((g && g.rows) || [])
        .map((r) => ({ t: toNum(r && r[0]), v: toNum(r && r[1]) }))
        .filter((p) => p.t > 0 && p.v != null)
        .sort((a, b) => a.t - b.t),
    }))
    .filter((g) => g.T != null);

  if (groups.length < 2) {
    return { error: '至少需要 2 个有效老化温度（每个都要填温度值，且至少 1 个数据点）；IEC 60216-1 建议 ≥3 个' };
  }

  // P₀ 留空 = 取各温度序列里最早那个点的最大特性值。
  // 只在**有数据点**的温度组里取 —— 否则一个刚加进来、行还空着的温度组会让
  // 这里读到 undefined，整次推算直接抛异常（原工具的隐性崩溃，见 CHANGELOG）。
  const withPts = groups.filter((g) => g.pts.length > 0);
  if (!withPts.length) return { error: '每个老化温度至少要有 1 个有效数据点' };
  const base = p0 === '' || p0 == null ? Math.max(...withPts.map((g) => g.pts[0].v)) : toNum(p0);
  if (!(base > 0)) return { error: '初始特性值 P₀ 得是正数' };
  const thr = base * THRESHOLD_RATIO;

  /* ① 各温度 → t₅₀ */
  const perT = [];
  for (const g of groups) {
    if (g.pts.length < 2) {
      return { error: `温度 ${fmtTemp(g.T)} °C 的有效数据点不足 2 个，无法求 t₅₀` };
    }
    const r = seriesT50(g.pts, thr);
    if (r.error) {
      return { error: `温度 ${fmtTemp(g.T)} °C：${r.error}。请补足该温度的数据，或删除这个温度组` };
    }
    perT.push({ T: g.T, t50: r.t50, mode: r.mode, lo: r.lo || null, hi: r.hi || null });
  }

  /* ② Arrhenius 回归：log₁₀t₅₀ ~ 1/T(K)，中心化最小二乘 */
  const n = perT.length;
  const fit = linreg(
    perT.map((p) => 1 / (p.T + 273.15)),
    perT.map((p) => Math.log10(p.t50))
  );
  const { a, b, r2, xm, sxx } = fit;

  if (!(b > 0)) {
    return { error: 'Arrhenius 回归斜率 ≤ 0：寿命没有随温度降低而延长，先核对各温度的 t₅₀ 数值' };
  }

  // df = n − 2；n = 2 时残差无定义（0/0），所以 s 置空而不是留一个 NaN
  // 显示成"NaN"（原工具的表现）。只在 n ≥ 3 时给出残差。
  const df = n - 2;
  const ciOk = n >= 3;
  const sse = perT.reduce(
    (acc, p, i) => acc + (Math.log10(p.t50) - (a + b * (1 / (p.T + 273.15)))) ** 2,
    0
  );
  const s = ciOk ? Math.sqrt(sse / df) : null;

  /* ③ RTI 与 95%CI */
  const warns = [];
  perT
    .filter((p) => p.mode === 'extrap')
    .forEach((p) =>
      warns.push(
        `温度 ${fmtTemp(p.T)} °C 的 t₅₀ 来自趋势外推（数据未跨过 50% 阈值），置信度低于内插，建议延长该温度的试验`
      )
    );
  if (!ciOk) {
    warns.push('老化温度不足 3 个，无法计算 95% 置信区间（df = n−2 ≤ 0），结果只有点估计');
  }
  const tc = ciOk ? tQ975(df) : null;

  const mk = (ystar) => {
    const xstar = (ystar - a) / b;
    if (!(xstar > 0)) return null;
    return {
      rti: 1 / xstar - 273.15,
      xstar,
      ci: ciOk ? rtiCI(a, b, s, xm, sxx, n, ystar, tc) : null,
    };
  };
  const r20 = mk(Math.log10(RTI_LIFE.r20));
  const r100 = mk(Math.log10(RTI_LIFE.r100));
  if (!r20 || !r100) return { error: '回归外推得到的温度无效（x* ≤ 0），请核对数据' };

  if (r20.ci === null && ciOk) warns.push('置信带与寿命水平线无交点（拟合过近或异常），95%CI 不可得');
  if (r2 < 0.95) warns.push(`Arrhenius 线性欠佳（R² = ${fmtR2(r2)}），外推结果谨慎使用`);

  return {
    warns,
    result: {
      name: (name || '').trim() || '未命名材料',
      p0: base,
      thr,
      perT,
      n,
      a,
      b,
      r2,
      s,
      xm,
      sxx,
      tc,
      ciOk,
      df,
      Ea: EA_FACTOR * b,
      r20,
      r100,
    },
  };
}

/* ---------------------------------------------------------------------------
   页 3 · 多材料对比：每条曲线在当前坐标空间里做最小二乘
   ------------------------------------------------------------------------- */

/**
 * 图 3 的温度显示范围规范化。
 *
 * 输入框存的是用户正在输入的字符串，所以"空着""只填了一半""下限比上限大"
 * 都是正常状态，这里统一收口成可用的范围；真的没法用时回退到默认 60~160。
 * （上下限相等也必须回退 —— 否则 xmax === xmin 会让后面的除法得到 ±Infinity。）
 */
export const DEFAULT_TEMP_RANGE = { min: 60, max: 160 };

export function normRange(minRaw, maxRaw) {
  const lo = toNum(minRaw);
  const hi = toNum(maxRaw);
  if (lo == null || hi == null) return { ...DEFAULT_TEMP_RANGE };
  if (lo > hi) return { min: hi, max: lo };
  if (lo === hi) return { ...DEFAULT_TEMP_RANGE };
  return { min: lo, max: hi };
}

/**
 * 在当前视图坐标空间里拟合：对数 Y 下拟合 log₁₀t₅₀ ~ T，线性 Y 下拟合 t₅₀ ~ T。
 * 切换坐标会重新拟合 —— 这不是 bug，是因为"直线性"本身就是坐标的函数。
 */
export function fitSeries(pts, logY) {
  if (!(pts.length > 1)) return null;
  if (new Set(pts.map((p) => p.T)).size < 2) return null;
  const f = linreg(
    pts.map((p) => p.T),
    pts.map((p) => (logY ? Math.log10(p.t) : p.t))
  );
  if (!Number.isFinite(f.b)) return null;
  return { a: f.a, b: f.b, r2: Number.isFinite(f.r2) ? f.r2 : null };
}

/** 材料列表 → 可直接绘图的曲线（去掉没有有效点的材料，温度降序） */export function cmpSeries(mats, logY) {
  return (mats || [])
    .map((m, i) => {
      const pts = (m.rows || [])
        .map((r) => ({ T: toNum(r && r.T), t: toNum(r && r.t) }))
        .filter((r) => r.T != null && r.t > 0)
        .sort((a, b) => b.T - a.T);
      return { name: ((m.name || '').trim() || `材料${i + 1}`), pts, fit: fitSeries(pts, logY), index: i };
    })
    .filter((series) => series.pts.length > 0);
}
