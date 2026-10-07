// RTI 工具的数学内核 —— 纯函数，不碰 DOM。
//
// 之所以单独抽一层：这套算法要能被单测直接钉住数值。原来的独立工具把算法写在
// 页面脚本里、与 document.getElementById 混在一起，除了在浏览器里点一遍没有别的
// 验证手段。抽出来之后 `calc.test.js` 可以拿 Python 基准（verify_out.txt）的数值
// 直接断言。
//
// 三个概念（与 IEC 60216-1 对应）：
//   · t₅₀ —— 终点时间：特性值衰减到初始值 50% 所需的时长
//   · Arrhenius —— log₁₀t₅₀ 对 1/T(K) 线性，据此外推任意寿命对应的温度（即 RTI）
//   · 95%CI —— 回归均值置信带 ±t₀.₉₇₅·s·√(1/n + (x−x̄)²/Sₓₓ) 与水平线的交点

/* ---------------------------------------------------------------------------
   最小二乘
   ------------------------------------------------------------------------- */

/**
 * 一元线性回归 y = a + b·x（附带 R²）。
 * 注意：n < 2 或 x 无变化时返回 NaN 而非抛错 —— 调用方各自决定怎么报错，
 * 这样与基准实现（Python 侧同样返回 nan）保持一致。
 */
export function linreg(xs, ys) {
  const n = xs.length;
  const xm = xs.reduce((s, x) => s + x, 0) / n;
  const ym = ys.reduce((s, y) => s + y, 0) / n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i += 1) {
    const dx = xs[i] - xm;
    const dy = ys[i] - ym;
    sxy += dx * dy;
    sxx += dx * dx;
    syy += dy * dy;
  }
  const b = sxy / sxx;
  const a = ym - b * xm;
  const r2 = (sxy * sxy) / (sxx * syy);
  return { n, a, b, r2, xm, sxx };
}

/* ---------------------------------------------------------------------------
   Student-t 分布：t₀.₉₇₅ 分位数
   路径 = gammaln(Numerical Recipes) → 不完全 Beta（Lentz 连分式）→ 二分反解。
   之所以不查表：置信区间要随温度点数变化，df 连续可变的场合查表不现实。
   ------------------------------------------------------------------------- */

function gammaln(x) {
  const cof = [
    76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155,
    0.1208650973866179e-2, -0.5395239384953e-5,
  ];
  let y = x;
  let tmp = x + 5.5;
  tmp -= (x + 0.5) * Math.log(tmp);
  let ser = 1.000000000190015;
  for (let j = 0; j < 6; j += 1) {
    y += 1;
    ser += cof[j] / y;
  }
  return -tmp + Math.log((2.5066282746310005 * ser) / x);
}

function betacf(a, b, x) {
  const MAXIT = 200;
  const EPS = 3e-16;
  const FPMIN = 1e-300;
  const qab = a + b;
  const qap = a + 1;
  const qam = a - 1;
  let c = 1;
  let d = 1 - (qab * x) / qap;
  if (Math.abs(d) < FPMIN) d = FPMIN;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= MAXIT; m += 1) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    h *= d * c;
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < EPS) break;
  }
  return h;
}

/** 正则化不完全 Beta 函数 I_x(a,b) */
export function betai(a, b, x) {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const lbt = Math.exp(
    gammaln(a + b) - gammaln(a) - gammaln(b) + a * Math.log(x) + b * Math.log(1 - x)
  );
  return x < (a + 1) / (a + b + 2) ? (lbt * betacf(a, b, x)) / a : 1 - (lbt * betacf(b, a, 1 - x)) / b;
}

/** 双侧尾部概率 P(|T| > t)，自由度 df */
export function tTwoSidedP(t, df) {
  return betai(df / 2, 0.5, df / (df + t * t));
}

/** 双侧 95% 的 t 分位数 t₀.₉₇₅,df（解 P(|T|>t) = 0.05） */
export function tQ975(df) {
  let lo = 0;
  let hi = 1e4;
  for (let i = 0; i < 200; i += 1) {
    const mid = (lo + hi) / 2;
    if (tTwoSidedP(mid, df) > 0.05) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/* ---------------------------------------------------------------------------
   终点时间 t₅₀
   ------------------------------------------------------------------------- */

/**
 * 单温度序列 → t₅₀。
 *
 * ① 若相邻两点跨过阈值，在 (log₁₀t, 特性值) 平面线性内插 —— 这是 IEC 60216-1 的
 *    终点时间方法，也是唯一"实测得来"的口径；
 * ② 若整条序列都没跨过阈值，退而求其次按「特性值 ~ log₁₀t」回归外推，并在
 *    界面上标注出来（外推的不确定性由调用方负责提示）。
 *
 * @returns {{t50:number, mode:'interp'|'extrap', lo?:object, hi?:object, fit?:object} | {error:string}}
 */
export function seriesT50(pts, thr) {
  for (let i = 0; i < pts.length - 1; i += 1) {
    const a = pts[i];
    const b = pts[i + 1];
    if (a.v >= thr && b.v < thr) {
      const lt =
        Math.log10(a.t) + ((a.v - thr) * (Math.log10(b.t) - Math.log10(a.t))) / (a.v - b.v);
      return { t50: 10 ** lt, mode: 'interp', lo: a, hi: b };
    }
  }
  if (pts[pts.length - 1].v < thr) {
    return { error: '所有实测值都低于 50% 阈值，缺早期高值的点，无法求 t₅₀' };
  }
  const fit = linreg(pts.map((p) => Math.log10(p.t)), pts.map((p) => p.v));
  if (!(fit.b < 0)) return { error: '数据看不出随时间衰减的趋势（回归斜率 ≥ 0）' };
  return { t50: 10 ** ((thr - fit.a) / fit.b), mode: 'extrap', fit };
}

/* ---------------------------------------------------------------------------
   95% 置信带与寿命水平线的交点
   ------------------------------------------------------------------------- */

/**
 * 解「回归均值置信带」与水平线 y = ystar 的交点，返回温度区间。
 *
 * 置信带是 x 的二次曲线，所以交点方程也是二次的 —— 直接解判别式，
 * 不用二分迭代（原实现里这两条路径已对拍一致，这里留解析解）。
 *
 * 注意 x = 1/T(K)：x 越大温度越低，所以两个根里大的那个对应**下限**。
 */
export function rtiCI(a, b, s, xm, sxx, n, ystar, tc) {
  const k = tc * s;
  const A = b * b - (k * k) / sxx;
  const B = 2 * b * (a - ystar) + (2 * k * k * xm) / sxx;
  const C = (a - ystar) ** 2 - (k * k) / n - (k * k * xm * xm) / sxx;
  const disc = B * B - 4 * A * C;
  if (disc < 0 || A === 0) return null;
  const r1 = (-B - Math.sqrt(disc)) / (2 * A);
  const r2 = (-B + Math.sqrt(disc)) / (2 * A);
  const xCold = Math.max(r1, r2);
  const xHot = Math.min(r1, r2);
  return { lo: 1 / xCold - 273.15, hi: 1 / xHot - 273.15 };
}
