// RTI 工具的绘图层。
//
// 与原工具的差别只有一处，但很关键：**颜色不再写死在代码里**。全部从样式令牌
// 读出来（见 index.css 的「图表」令牌节），因此暗色主题会自动跟着换，图表不会再
// 出现"浅色底上一套土黄、深色底上还是那套土黄"的情况。
//
// 这一层是有副作用的（要往 canvas 上画），但**不持有状态**：悬停/固定这些交互态
// 由调用方通过参数传进来。所以它既好测（几何函数是纯的），也不会和 React 的
// 渲染节奏打架 —— 鼠标移动引起的重画完全不必走 React 状态。

/* ---------------------------------------------------------------------------
   令牌读取
   ------------------------------------------------------------------------- */

/** 与样式层解耦的兜底色 —— 只在没有 DOM 时才会被用到（例如单测里误调） */
const FALLBACK = {
  '--chart-axis': '#5f5f5f',
  '--chart-grid': '#e8e8e8',
  '--chart-frame': '#8f8f8f',
  '--chart-thr': '#b3261e',
  '--chart-thr-ink': '#7f1811',
  '--chart-warn': '#8a5a00',
  '--surface': '#ffffff',
  '--text': '#1b1b1b',
  '--text-2': '#444444',
  '--font-ui': 'sans-serif',
  '--font-mono': 'monospace',
};

export function token(name) {
  if (typeof document === 'undefined') return FALLBACK[name] || '#888888';
  const v = getComputedStyle(document.documentElement).getPropertyValue(name);
  return (v || '').trim() || FALLBACK[name] || '#888888';
}

export const SERIES_COUNT = 8;

/** 一次性把这次绘制要用的颜色取齐（每帧取一次，不要在循环里反复读 computedStyle） */
export function palette() {
  const series = [];
  for (let i = 1; i <= SERIES_COUNT; i += 1) series.push(token(`--chart-${i}`));
  return {
    series,
    thr: token('--chart-thr'),
    thrInk: token('--chart-thr-ink'),
    warn: token('--chart-warn'),
    grid: token('--chart-grid'),
    frame: token('--chart-frame'),
    axis: token('--chart-axis'),
    panel: token('--surface'),
    ink: token('--text'),
    label: token('--text-2'),
    fontUi: token('--font-ui'),
    fontMono: token('--font-mono'),
  };
}

/** #rrggbb → rgba(r,g,b,a)；其它格式原样返回（令牌都是六位十六进制） */
export function withAlpha(color, a) {
  const hex6 = /^#([0-9a-f]{6})$/i.exec(String(color).trim());
  if (hex6) {
    const n = parseInt(hex6[1], 16);
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
  }
  const hex3 = /^#([0-9a-f]{3})$/i.exec(String(color).trim());
  if (hex3) {
    const [r, g, b] = hex3[1].split('').map((c) => parseInt(c + c, 16));
    return `rgba(${r}, ${g}, ${b}, ${a})`;
  }
  return color;
}

/** 数据点的形状与字形：与颜色正交的第二重编码（黑白打印/色弱也能分辨） */
export const SHAPES = ['circle', 'tri', 'diamond', 'square', 'triDown', 'cross'];
export const GLYPHS = ['●', '▲', '◆', '■', '▼', '✕'];

export function seriesStyle(index) {
  return { slot: index % SERIES_COUNT, shape: SHAPES[index % SHAPES.length], glyph: GLYPHS[index % GLYPHS.length] };
}

/* ---------------------------------------------------------------------------
   画布基础设施
   ------------------------------------------------------------------------- */

const fnt = (pal, size, weight, mono) =>
  `${weight ? `${weight} ` : ''}${size}px ${mono ? pal.fontMono : pal.fontUi}`;

/**
 * 按设备像素比设置画布尺寸。
 * @param {HTMLCanvasElement} cv
 * @param {number} height CSS 像素高度（宽度跟随容器）
 */
export function setupCanvas(cv, height) {
  const dpr = window.devicePixelRatio || 1;
  const w = cv.clientWidth || cv.width || 1;
  cv.width = Math.round(w * dpr);
  cv.height = Math.round(height * dpr);
  cv.style.height = `${height}px`;
  const ctx = cv.getContext('2d');
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.scale(dpr, dpr);
  return { ctx, w, h: height };
}

/** 「好看」的刻度：步长收敛到 1/2/5×10ⁿ，避免出现 7、13 这种刻度 */
export function niceTicks(min, max, count) {
  let hi = max;
  if (min === hi) hi = min + 1;
  const span = hi - min;
  const step0 = span / count;
  const mag = 10 ** Math.floor(Math.log10(step0));
  const norm = step0 / mag;
  const step = (norm < 1.5 ? 1 : norm < 3.5 ? 2 : norm < 7.5 ? 5 : 10) * mag;
  const t0 = Math.ceil(min / step) * step;
  const ticks = [];
  for (let t = t0; t <= hi + 1e-9; t += step) ticks.push(+t.toFixed(10));
  return ticks;
}

/** 画网格与坐标轴，返回数据坐标 → 像素坐标的两个映射函数 */
export function frame(ctx, m, xmin, xmax, ymin, ymax, fmtX, fmtY, xTitle, yTitle, w, h, yticks, xticks, pal) {
  ctx.clearRect(0, 0, w, h);
  const px = (x) => m.l + ((x - xmin) / (xmax - xmin)) * (w - m.l - m.r);
  const py = (y) => h - m.b - ((y - ymin) / (ymax - ymin)) * (h - m.t - m.b);

  ctx.font = fnt(pal, 11, '', true);
  ctx.lineWidth = 1;
  const xt = xticks || niceTicks(Math.min(xmin, xmax), Math.max(xmin, xmax), 7);
  const yt = yticks || niceTicks(Math.min(ymin, ymax), Math.max(ymin, ymax), 6);

  ctx.strokeStyle = pal.grid;
  xt.forEach((t) => {
    const X = Math.round(px(t)) + 0.5;
    ctx.beginPath();
    ctx.moveTo(X, m.t);
    ctx.lineTo(X, h - m.b);
    ctx.stroke();
  });
  yt.forEach((t) => {
    const Y = Math.round(py(t)) + 0.5;
    ctx.beginPath();
    ctx.moveTo(m.l, Y);
    ctx.lineTo(w - m.r, Y);
    ctx.stroke();
  });

  ctx.fillStyle = pal.axis;
  xt.forEach((t) => {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(fmtX(t), px(t), h - m.b + 7);
  });
  yt.forEach((t) => {
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillText(fmtY(t), m.l - 8, py(t));
  });

  // 坐标轴：只画左与下两条，和绘图区边界重合
  ctx.strokeStyle = pal.frame;
  ctx.beginPath();
  ctx.moveTo(Math.round(m.l) + 0.5, m.t);
  ctx.lineTo(Math.round(m.l) + 0.5, Math.round(h - m.b) + 0.5);
  ctx.lineTo(w - m.r, Math.round(h - m.b) + 0.5);
  ctx.stroke();

  ctx.fillStyle = pal.axis;
  ctx.font = fnt(pal, 12);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(xTitle, (m.l + w - m.r) / 2, h - 4);
  ctx.save();
  ctx.translate(13, (m.t + h - m.b) / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.fillText(yTitle, 0, 0);
  ctx.restore();

  return { px, py };
}

/** 虚线辅助线：所有参考线共用一种画法，避免各处 dash 值不一致 */
function dashed(ctx, color, dash, width, draw) {
  ctx.save();
  ctx.setLineDash(dash);
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  draw();
  ctx.stroke();
  ctx.restore();
}

/** 菱形标记（t₅₀ 交点 / RTI 交点）：比圆点更像"人工标注"，与实测点区分开 */
function diamond(ctx, x, y, r, fill, stroke) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(Math.PI / 4);
  ctx.beginPath();
  ctx.rect(-r, -r, r * 2, r * 2);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.strokeStyle = stroke;
  ctx.lineWidth = 2.5;
  ctx.stroke();
  ctx.restore();
}

/* ---------------------------------------------------------------------------
   图 1 · 寿命推算：特性值 ~ log₁₀t
   ------------------------------------------------------------------------- */

export function drawLifeChart(cv, R, pal = palette()) {
  if (!R) return;
  const { pts, thr, t50, p0, mode, fit } = R;
  const { ctx, w, h } = setupCanvas(cv, 420);
  const m = { l: 60, r: 20, t: 18, b: 46 };

  const ltMax = Math.log10(Math.max(t50, pts[pts.length - 1].t)) * 1.15;
  const ltMin = Math.log10(pts[0].t) / 1.6;
  const vMin = Math.min(...pts.map((p) => p.v), thr) * 0.9;
  const vMax = Math.max(...pts.map((p) => p.v), p0) * 1.06;

  const { px, py } = frame(
    ctx,
    m,
    ltMin,
    ltMax,
    vMin,
    vMax,
    (v) => {
      const t = 10 ** v;
      if (t >= 1000) {
        const k = t / 1000;
        return `${k >= 10 ? Math.round(k) : +k.toFixed(1)}k`;
      }
      return t >= 1 ? String(Math.round(t)) : t.toFixed(1);
    },
    (v) => (Math.abs(v) >= 100 ? String(Math.round(v)) : v.toFixed(v >= 10 ? 0 : 1)),
    '老化时间 t（h，对数轴）',
    '特性值（绝对值）',
    w,
    h,
    null,
    null,
    pal
  );

  // 外推回归线：数据没跨过阈值时，把"据以外推的那条线"画出来，结果才可追溯
  if (mode === 'extrap' && fit) {
    dashed(ctx, pal.frame, [5, 4], 1.5, () => {
      ctx.moveTo(px(ltMin), py(fit.a + fit.b * ltMin));
      ctx.lineTo(px(ltMax), py(fit.a + fit.b * ltMax));
    });
  }

  // 50% 阈值水平线
  dashed(ctx, pal.thr, [6, 4], 1.5, () => {
    ctx.moveTo(m.l, py(thr));
    ctx.lineTo(w - m.r, py(thr));
  });
  ctx.fillStyle = pal.thrInk;
  ctx.font = fnt(pal, 11, '', true);
  ctx.textAlign = 'right';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(`50% 阈值 = ${+thr.toPrecision(4)}`, w - m.r - 4, py(thr) - 6);

  // 实测折线 + 散点
  ctx.strokeStyle = pal.series[0];
  ctx.lineWidth = 2;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  pts.forEach((p, i) => {
    const X = px(Math.log10(p.t));
    const Y = py(p.v);
    if (i) ctx.lineTo(X, Y);
    else ctx.moveTo(X, Y);
  });
  ctx.stroke();
  ctx.fillStyle = pal.series[0];
  pts.forEach((p) => {
    ctx.beginPath();
    ctx.arc(px(Math.log10(p.t)), py(p.v), 3.2, 0, 7);
    ctx.fill();
  });

  // t₅₀ 交点
  const X50 = px(Math.log10(t50));
  const Y50 = py(thr);
  dashed(ctx, pal.thrInk, [3, 3], 1, () => {
    ctx.moveTo(X50, Y50);
    ctx.lineTo(X50, h - m.b);
  });
  diamond(ctx, X50, Y50, 4.5, pal.panel, pal.thrInk);
  ctx.fillStyle = pal.thrInk;
  ctx.font = fnt(pal, 12, 'bold', true);
  ctx.textAlign = X50 > w - 140 ? 'right' : 'left';
  ctx.fillText(`t₅₀ = ${fmtTick(t50)} h`, X50 + (X50 > w - 140 ? -10 : 10), Y50 + 22);
}

// 图表内的数字不走 fmtH 的千分位（图里短一点更好读），保留 4 位有效数字
function fmtTick(t) {
  if (!(t > 0)) return '—';
  if (t >= 10000) return `${Math.round(t / 1000)}k`;
  if (t >= 100) return String(Math.round(t));
  return t.toFixed(1);
}

/* ---------------------------------------------------------------------------
   图 2 · RTI：log₁₀t₅₀ ~ 1/T(K) + 95% 置信带
   ------------------------------------------------------------------------- */

export function drawRtiChart(cv, R, pal = palette()) {
  const parsed = R;
  if (!parsed) return;
  const { ctx, w, h } = setupCanvas(cv, 440);
  const m = { l: 64, r: 24, t: 18, b: 46 };

  const xsD = parsed.perT.map((p) => 1 / (p.T + 273.15));
  let xmin = Math.min(...xsD, parsed.r20.xstar, parsed.r100.xstar);
  let xmax = Math.max(...xsD, parsed.r20.xstar, parsed.r100.xstar);
  const padX = (xmax - xmin) * 0.14;
  xmin -= padX;
  xmax += padX;

  const ysD = parsed.perT.map((p) => Math.log10(p.t50));
  let ymin = Math.min(...ysD, Math.log10(20000), Math.log10(100000));
  let ymax = Math.max(...ysD, Math.log10(20000), Math.log10(100000));
  const padY = (ymax - ymin) * 0.18;
  ymin -= padY;
  ymax += padY;

  // 温度刻度等温差布置后映射到 1/T —— 否则刻度会挤在低温端
  const Tmin = 1 / xmax - 273.15;
  const Tmax = 1 / xmin - 273.15;
  const spanT = Tmax - Tmin;
  const step = spanT <= 40 ? 5 : spanT <= 90 ? 10 : spanT <= 180 ? 20 : 50;
  const xticks = [];
  for (let T = Math.ceil(Tmin / step) * step; T <= Tmax + 1e-9; T += step) xticks.push(1 / (T + 273.15));

  const ystep = ymax - ymin > 3.2 ? 1 : 0.5;
  const yticks = [];
  for (let e = Math.ceil(ymin / ystep) * ystep; e <= ymax + 1e-9; e += ystep) yticks.push(+e.toFixed(6));

  const fmtY = (v) => {
    const t = 10 ** v;
    if (t >= 10000) return `${Math.round(t / 1000)}k`;
    if (t >= 1000) return `${(t / 1000).toFixed(1).replace(/\.0$/, '')}k`;
    return String(Math.round(t));
  };

  const { px, py } = frame(
    ctx,
    m,
    xmin,
    xmax,
    ymin,
    ymax,
    (v) => String(Math.round(1 / v - 273.15)),
    fmtY,
    '老化温度 T（°C · Arrhenius 横轴 1/T，高温在左）',
    '各温度 t₅₀（h · 对数轴）',
    w,
    h,
    yticks,
    xticks,
    pal
  );

  ctx.save();
  ctx.beginPath();
  ctx.rect(m.l, m.t, w - m.l - m.r, h - m.t - m.b);
  ctx.clip();

  // 95% 均值置信带
  if (parsed.ciOk && parsed.tc && Number.isFinite(parsed.s)) {
    const k = parsed.tc * parsed.s;
    const up = (x) => parsed.a + parsed.b * x + k * Math.sqrt(1 / parsed.n + (x - parsed.xm) ** 2 / parsed.sxx);
    const lo = (x) => parsed.a + parsed.b * x - k * Math.sqrt(1 / parsed.n + (x - parsed.xm) ** 2 / parsed.sxx);
    const N = 80;
    ctx.beginPath();
    for (let i = 0; i <= N; i += 1) {
      const x = xmin + ((xmax - xmin) * i) / N;
      const Y = py(up(x));
      if (i) ctx.lineTo(px(x), Y);
      else ctx.moveTo(px(x), Y);
    }
    for (let i = N; i >= 0; i -= 1) {
      const x = xmin + ((xmax - xmin) * i) / N;
      ctx.lineTo(px(x), py(lo(x)));
    }
    ctx.closePath();
    ctx.fillStyle = withAlpha(pal.series[0], 0.1);
    ctx.fill();
    ctx.save();
    ctx.setLineDash([3, 3]);
    ctx.strokeStyle = withAlpha(pal.series[0], 0.35);
    ctx.lineWidth = 1;
    [up, lo].forEach((f) => {
      ctx.beginPath();
      for (let i = 0; i <= N; i += 1) {
        const x = xmin + ((xmax - xmin) * i) / N;
        const Y = py(f(x));
        if (i) ctx.lineTo(px(x), Y);
        else ctx.moveTo(px(x), Y);
      }
      ctx.stroke();
    });
    ctx.restore();
  }

  // 回归线
  ctx.strokeStyle = pal.series[0];
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(px(xmin), py(parsed.a + parsed.b * xmin));
  ctx.lineTo(px(xmax), py(parsed.a + parsed.b * xmax));
  ctx.stroke();

  // 两条寿命水平线 + 与回归线的交点（即 RTI）
  [[20000, parsed.r20], [100000, parsed.r100]].forEach(([L, mk]) => {
    const yv = Math.log10(L);
    dashed(ctx, pal.frame, [6, 4], 1.2, () => {
      ctx.moveTo(m.l, py(yv));
      ctx.lineTo(w - m.r, py(yv));
    });
    ctx.fillStyle = pal.axis;
    ctx.font = fnt(pal, 11, '', true);
    ctx.textAlign = 'right';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(`${L.toLocaleString('en-US')} h`, w - m.r - 4, py(yv) - 5);

    if (mk.xstar > xmin && mk.xstar < xmax) {
      const X = px(mk.xstar);
      const Y = py(yv);
      dashed(ctx, pal.thrInk, [3, 3], 1, () => {
        ctx.moveTo(X, Y);
        ctx.lineTo(X, h - m.b);
      });
      diamond(ctx, X, Y, 4.5, pal.panel, pal.thrInk);
      const right = X < w - 170;
      ctx.textAlign = right ? 'left' : 'right';
      const lx = X + (right ? 10 : -10);
      ctx.fillStyle = pal.thrInk;
      ctx.font = fnt(pal, 12, 'bold', true);
      ctx.fillText(`RTI = ${mk.rti.toFixed(1)} °C`, lx, Y + 20);
      ctx.font = fnt(pal, 11, '', true);
      ctx.fillText(
        mk.ci ? `95%CI [${mk.ci.lo.toFixed(1)}, ${mk.ci.hi.toFixed(1)}]` : '95%CI 不可得',
        lx,
        Y + 35
      );
    }
  });

  // 各温度实测点：外推得来的点用警告色，提示"这个点本身就不如内插可靠"
  parsed.perT.forEach((p) => {
    const X = px(1 / (p.T + 273.15));
    const Y = py(Math.log10(p.t50));
    ctx.beginPath();
    ctx.arc(X, Y, 4.5, 0, 7);
    ctx.fillStyle = p.mode === 'extrap' ? pal.warn : pal.series[0];
    ctx.fill();
    ctx.strokeStyle = pal.panel;
    ctx.lineWidth = 1.5;
    ctx.stroke();
  });

  ctx.restore();
}

/* ---------------------------------------------------------------------------
   图 3 · 多材料对比（含悬停 / 点击固定的交互层）
   ------------------------------------------------------------------------- */

const CMP_MARGIN = { l: 64, r: 24, t: 18, b: 46 };

/** 图 3 的 Y 轴上限：t₅₀ 常跨好几个数量级，固定上限才能横向比较材料 */
export const CMP_Y_TOP = 100000;
/** 图 3 的参考线：50,000 h */
export const CMP_Y_REF = 50000;

/**
 * 命中信息在数据变动后可能失效（材料被删了、点被删了）。
 * 悬停/固定是"指向某条曲线某个点"的引用，重画前必须校验一次，
 * 否则会读到 undefined 上的属性直接抛异常。
 */
function validHit(hit, series) {
  if (!hit) return null;
  const s = series[hit.si];
  if (!s) return null;
  if (hit.type === 'fit') return s.fit ? hit : null;
  return s.pts[hit.pi] ? hit : null;
}

/** X 轴温度刻度：默认每 5℃，范围大时自动放稀 */
export function cmpXTicks(min, max) {
  const span = max - min;
  const step = span <= 120 ? 5 : span <= 240 ? 10 : 20;
  const ticks = [];
  for (let t = Math.ceil(min / step) * step; t <= max + 1e-9; t += step) ticks.push(Math.round(t));
  return ticks;
}

/** 按面积/跨度调过比例的形状绘制：不同形状看起来"一样大" */
export function drawShape(ctx, shape, x, y, r, col, pal) {
  ctx.save();
  ctx.beginPath();
  if (shape === 'tri') {
    const R = 1.25 * r;
    ctx.moveTo(x, y - R);
    ctx.lineTo(x + R * 0.866, y + R * 0.5);
    ctx.lineTo(x - R * 0.866, y + R * 0.5);
    ctx.closePath();
  } else if (shape === 'triDown') {
    const R = 1.25 * r;
    ctx.moveTo(x, y + R);
    ctx.lineTo(x + R * 0.866, y - R * 0.5);
    ctx.lineTo(x - R * 0.866, y - R * 0.5);
    ctx.closePath();
  } else if (shape === 'diamond') {
    ctx.moveTo(x, y - 1.35 * r);
    ctx.lineTo(x + 1.05 * r, y);
    ctx.lineTo(x, y + 1.35 * r);
    ctx.lineTo(x - 1.05 * r, y);
    ctx.closePath();
  } else if (shape === 'square') {
    const a = 0.95 * r;
    ctx.rect(x - a, y - a, 2 * a, 2 * a);
  } else if (shape === 'cross') {
    const k = 0.95 * r;
    ctx.moveTo(x - k, y - k);
    ctx.lineTo(x + k, y + k);
    ctx.moveTo(x + k, y - k);
    ctx.lineTo(x - k, y + k);
  } else {
    ctx.arc(x, y, r, 0, 7);
  }
  if (shape === 'cross') {
    // 叉形只能靠描边表达，所以先描一道底色再描本身颜色
    ctx.strokeStyle = pal.panel;
    ctx.lineWidth = 4.4;
    ctx.stroke();
    ctx.strokeStyle = col;
    ctx.lineWidth = 2.1;
    ctx.stroke();
  } else {
    ctx.fillStyle = col;
    ctx.fill();
    ctx.strokeStyle = pal.panel;
    ctx.lineWidth = 1.6;
    ctx.stroke();
  }
  ctx.restore();
}

function rrect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/**
 * 画图 3 并返回坐标几何，供命中测试使用。
 *
 * @param {HTMLCanvasElement} cv
 * @param {object} opts
 * @param {Array}  opts.series    calc.cmpSeries() 的输出
 * @param {object} opts.xRange    { min, max } 温度显示范围
 * @param {boolean} opts.logY     Y 轴是否对数
 * @param {object|null} opts.hover  悬停命中 { si, type, pi, frac }
 * @param {object|null} opts.pinned 固定命中
 * @returns {object} chart 几何：{ series, px, py, yv, m, w, h, dom, clipped }
 */
export function drawCmpChart(cv, opts) {
  const { series, xRange, logY } = opts;
  const hover = validHit(opts.hover, series);
  const pinned = validHit(opts.pinned, series);
  const pal = opts.pal || palette();
  const { ctx, w, h } = setupCanvas(cv, 540);

  // X 轴为反向轴：xmin 对应温度上限（数值大、画在左），xmax 对应温度下限。
  // 命名沿用"像素域左/右端点"的旧约定，避免和 setRange 的 min/max 混起来。
  const xmin = xRange.max;
  const xmax = xRange.min;
  const xticks = cmpXTicks(xRange.min, xRange.max);

  const allt = series.flatMap((s) => s.pts.map((p) => p.t));
  const clipped = allt.filter((t) => t > CMP_Y_TOP).length;

  let ymin;
  let ymax;
  let fmtY;
  let yticks;
  if (logY) {
    ymin = Math.floor(Math.log10(Math.min(...allt)) + 1e-9);
    ymax = Math.log10(CMP_Y_TOP);
    if (ymax <= ymin) ymax = ymin + 1;
    yticks = [];
    const stepE = ymax - ymin > 3 ? 1 : 0.5;
    for (let e = ymin; e <= ymax + 1e-9; e += stepE) yticks.push(+e.toFixed(6));
    fmtY = (v) => {
      const t = 10 ** v;
      if (t >= 10000) return `${Math.round(t / 1000)}k`;
      if (t >= 1000) return `${(t / 1000).toFixed(1).replace(/\.0$/, '')}k`;
      return String(Math.round(t));
    };
  } else {
    ymin = 0;
    ymax = CMP_Y_TOP;
    fmtY = (v) => (v >= 1000 ? `${Math.round(v / 1000)}k` : String(Math.round(v)));
  }

  const m = CMP_MARGIN;
  const { px, py } = frame(
    ctx,
    m,
    xmin,
    xmax,
    ymin,
    ymax,
    (v) => String(Math.round(v)),
    fmtY,
    '老化温度 T（°C · 由高到低）',
    '50% 特性老化时间 t₅₀（h）',
    w,
    h,
    yticks,
    xticks,
    pal
  );
  const yv = (t) => (logY ? Math.log10(t) : t);
  const dom = { xmin, xmax, ymin, ymax };
  const chart = { series, pal, px, py, yv, m, w, h, dom, logY, clipped, hover, pinned };

  ctx.save();
  ctx.beginPath();
  ctx.rect(m.l, m.t, w - m.l - m.r, h - m.t - m.b);
  ctx.clip();

  // 固定参考线：50,000 h
  const yRef = logY ? Math.log10(CMP_Y_REF) : CMP_Y_REF;
  dashed(ctx, pal.frame, [6, 4], 1.2, () => {
    ctx.moveTo(m.l, py(yRef));
    ctx.lineTo(w - m.r, py(yRef));
  });
  ctx.fillStyle = pal.axis;
  ctx.font = fnt(pal, 11, '', true);
  ctx.textAlign = 'right';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText('50,000 h', w - m.r - 4, py(yRef) - 5);

  series.forEach((s, i) => {
    // 用材料在**原始列表**里的序号取样式和颜色：中间删掉一种材料时，
    // 剩下的材料颜色不该跟着变（否则图例像换了一套数据）
    const st = seriesStyle(s.index ?? i);
    const col = pal.series[st.slot];
    // 拟合线：低对比实线（趋势参考），悬停/固定时再高亮
    if (s.fit) {
      ctx.save();
      ctx.globalAlpha = 0.5;
      ctx.strokeStyle = col;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(px(xmin), py(s.fit.a + s.fit.b * xmin));
      ctx.lineTo(px(xmax), py(s.fit.a + s.fit.b * xmax));
      ctx.stroke();
      ctx.restore();
    }
    s.pts.forEach((p) => {
      drawShape(ctx, st.shape, px(p.T), py(yv(p.t)), 6.5, col, pal);
    });
  });
  ctx.restore();

  if (pinned) drawPinned(ctx, chart);
  else if (hover) drawHover(ctx, chart);
  return chart;
}

/* --- 交互层 --- */

function cmpGeomAt(chart, hit) {
  const s = chart.series[hit.si];
  if (hit.type === 'fit') {
    const X = chart.m.l + (hit.frac || 0) * (chart.w - chart.m.l - chart.m.r);
    const T = chart.dom.xmin + ((X - chart.m.l) / (chart.w - chart.m.l - chart.m.r)) * (chart.dom.xmax - chart.dom.xmin);
    return { X, Y: chart.py(s.fit.a + s.fit.b * T) };
  }
  const a = s.pts[hit.pi];
  const b = s.pts[Math.min(hit.pi + 1, s.pts.length - 1)];
  const f = hit.frac || 0;
  return {
    X: chart.px(a.T) + (chart.px(b.T) - chart.px(a.T)) * f,
    Y: chart.py(chart.yv(a.t)) + (chart.py(chart.yv(b.t)) - chart.py(chart.yv(a.t))) * f,
  };
}

function cmpValuesAt(chart, hit) {
  const { X, Y } = cmpGeomAt(chart, hit);
  const T = chart.dom.xmin + ((X - chart.m.l) / (chart.w - chart.m.l - chart.m.r)) * (chart.dom.xmax - chart.dom.xmin);
  const y = chart.dom.ymin + ((chart.h - chart.m.b - Y) / (chart.h - chart.m.t - chart.m.b)) * (chart.dom.ymax - chart.dom.ymin);
  return { T, t: chart.logY ? 10 ** y : y, X, Y };
}

/** 命中测试：先找数据点（半径 14px），再找拟合线（距线 10px） */
export function cmpNearest(chart, mx, my) {
  let best = null;
  const inX = (X) => X >= chart.m.l - 1 && X <= chart.w - chart.m.r + 1;
  const consider = (c) => {
    if (inX(c.X) && (!best || c.d < best.d)) best = c;
  };
  chart.series.forEach((s, si) => {
    s.pts.forEach((p, pi) => {
      const X = chart.px(p.T);
      const Y = chart.py(chart.yv(p.t));
      const d = Math.hypot(mx - X, my - Y);
      if (d < 14) consider({ si, type: 'point', pi, frac: 0, d, X, Y });
    });
    if (s.fit) {
      const x1 = chart.px(chart.dom.xmin);
      const y1 = chart.py(s.fit.a + s.fit.b * chart.dom.xmin);
      const x2 = chart.px(chart.dom.xmax);
      const y2 = chart.py(s.fit.a + s.fit.b * chart.dom.xmax);
      const dx = x2 - x1;
      const dy = y2 - y1;
      const L2 = dx * dx + dy * dy;
      let f = L2 ? ((mx - x1) * dx + (my - y1) * dy) / L2 : 0;
      f = Math.max(0, Math.min(1, f));
      const cx = x1 + f * dx;
      const cy = y1 + f * dy;
      const d = Math.hypot(mx - cx, my - cy);
      if (d < 10) consider({ si, type: 'fit', frac: f, d, X: cx, Y: cy });
    }
  });
  return best;
}

/** 右键命中：固定点附近 / 两条辅助线上 —— 只有点在附近才算"取消固定"，避免误触 */
export function cmpPinHit(chart, mx, my) {
  if (!chart.pinned) return false;
  const { X, Y } = cmpGeomAt(chart, chart.pinned);
  if (Math.hypot(mx - X, my - Y) < 30) return true;
  if (Math.abs(mx - X) < 8 && my >= Y && my <= chart.h - chart.m.b) return true;
  if (Math.abs(my - Y) < 8 && mx >= chart.m.l && mx <= X) return true;
  return false;
}

function drawHover(ctx, chart) {
  const s = chart.series[chart.hover.si];
  const col = chart.pal.series[seriesStyle(s.index ?? chart.hover.si).slot];
  const { X, Y, T, t } = cmpValuesAt(chart, chart.hover);
  ctx.save();
  ctx.setLineDash([4, 4]);
  ctx.strokeStyle = col;
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(X, Y);
  ctx.lineTo(X, chart.h - chart.m.b);
  ctx.moveTo(X, Y);
  ctx.lineTo(chart.m.l, Y);
  ctx.stroke();
  ctx.restore();

  ctx.fillStyle = col;
  ctx.beginPath();
  ctx.arc(X, chart.h - chart.m.b, 3.5, 0, 7);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(chart.m.l, Y, 3.5, 0, 7);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(X, Y, 7.5, 0, 7);
  ctx.strokeStyle = col;
  ctx.lineWidth = 2;
  ctx.stroke();

  // 悬浮提示框：只有悬停才有；点击固定后改为轴上的定点标注（不遮挡图形）
  const lines = [
    { text: s.name, strong: true },
    { text: `T = ${fmtTempTick(T)} °C` },
    { text: `${chart.hover.type === 'fit' ? 't₅₀(拟合)' : 't₅₀'} = ${fmtTick(t)} h` },
  ];
  if (s.fit && s.fit.r2 != null) lines.push({ text: `R² = ${fmtR2Tick(s.fit.r2)}` });

  const pal = chart.pal;
  const widths = lines.map((l) => {
    ctx.font = l.strong ? fnt(pal, 12, 'bold') : fnt(pal, 12, '', true);
    return ctx.measureText(l.text).width;
  });
  const tw = Math.max(...widths) + 20;
  const th = lines.length * 17 + 12;
  let bx = X + 14;
  let by = Y - th - 10;
  if (bx + tw > chart.w - chart.m.r) bx = X - tw - 14;
  if (by < chart.m.t) by = Y + 14;

  ctx.save();
  ctx.setLineDash([]);
  rrect(ctx, bx, by, tw, th, 4);
  ctx.fillStyle = pal.panel;
  ctx.fill();
  ctx.strokeStyle = col;
  ctx.lineWidth = 1.2;
  ctx.stroke();
  lines.forEach((l, i) => {
    ctx.fillStyle = i === 0 ? col : pal.label;
    ctx.font = l.strong ? fnt(pal, 12, 'bold') : fnt(pal, 12, '', true);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(l.text, bx + 10, by + 18 + i * 17);
  });
  ctx.restore();
}

function drawPinned(ctx, chart) {
  const s = chart.series[chart.pinned.si];
  const col = chart.pal.series[seriesStyle(s.index ?? chart.pinned.si).slot];
  const { X, Y } = cmpGeomAt(chart, chart.pinned);

  // 拟合线高亮
  if (chart.pinned.type === 'fit' && s.fit) {
    ctx.save();
    ctx.globalAlpha = 0.9;
    ctx.strokeStyle = col;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(chart.px(chart.dom.xmin), chart.py(s.fit.a + s.fit.b * chart.dom.xmin));
    ctx.lineTo(chart.px(chart.dom.xmax), chart.py(s.fit.a + s.fit.b * chart.dom.xmax));
    ctx.stroke();
    ctx.restore();
  }

  ctx.save();
  ctx.setLineDash([4, 4]);
  ctx.strokeStyle = col;
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(X, Y);
  ctx.lineTo(X, chart.h - chart.m.b);
  ctx.stroke();
  ctx.restore();

  ctx.fillStyle = col;
  ctx.beginPath();
  ctx.arc(X, chart.h - chart.m.b, 3.5, 0, 7);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(X, Y, 8, 0, 7);
  ctx.strokeStyle = col;
  ctx.lineWidth = 2.2;
  ctx.stroke();

  /* 固定态的附加值：沿当前 t₅₀ 水平线读出**其它材料**的交点温度，
     这是"对比"真正想知道的东西 —— 同一寿命下谁更耐热。 */
  const pal = chart.pal;
  const pv = cmpValuesAt(chart, chart.pinned);
  const yTarget = chart.logY ? Math.log10(pv.t) : pv.t;
  const Yp = chart.py(yTarget);

  dashed(ctx, pal.frame, [4, 4], 1.2, () => {
    ctx.moveTo(chart.m.l, Yp);
    ctx.lineTo(chart.w - chart.m.r, Yp);
  });
  ctx.fillStyle = col;
  ctx.beginPath();
  ctx.arc(chart.m.l, Yp, 3, 0, 7);
  ctx.fill();

  const hits = [];
  chart.series.forEach((s2, si) => {
    if (chart.pinned.si === si || !s2.fit || !s2.fit.b) return;
    const Tc = (yTarget - s2.fit.a) / s2.fit.b;
    if (!(Tc >= chart.dom.xmax && Tc <= chart.dom.xmin)) return;
    const Xc = chart.px(Tc);
    if (!hits.some((hh) => Math.abs(hh.Xc - Xc) < 1)) {
      hits.push({ col: pal.series[seriesStyle(s2.index ?? si).slot], Xc, Tc });
    }
  });

  hits.forEach((hh) => {
    dashed(ctx, pal.frame, [4, 4], 1.2, () => {
      ctx.moveTo(hh.Xc, Yp);
      ctx.lineTo(hh.Xc, chart.h - chart.m.b);
    });
    ctx.save();
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.arc(hh.Xc, Yp, 4.5, 0, 7);
    ctx.fillStyle = pal.panel;
    ctx.fill();
    ctx.strokeStyle = hh.col;
    ctx.lineWidth = 1.8;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(hh.Xc, chart.h - chart.m.b, 3, 0, 7);
    ctx.fillStyle = hh.col;
    ctx.fill();
    ctx.restore();
  });

  // 温度标注统一贴在 X 轴上方，按 X 排序后横向推开，避免相邻重叠
  const labels = [
    { col, Xc: X, Tc: pv.T },
    ...hits.map((hh) => ({ col: hh.col, Xc: hh.Xc, Tc: hh.Tc })),
  ].map((l) => ({ ...l, text: `T = ${fmtTempTick(l.Tc)} °C` }));
  ctx.font = fnt(pal, 13, 'bold', true);
  labels.forEach((l) => {
    l.tw = ctx.measureText(l.text).width;
  });
  labels.sort((a, b) => a.Xc - b.Xc);
  for (let i = 1; i < labels.length; i += 1) {
    const minX = labels[i - 1].Xc + labels[i - 1].tw / 2 + 10;
    if (labels[i].Xc - labels[i].tw / 2 < minX) labels[i].Xc = minX + labels[i].tw / 2;
  }
  const ly = chart.h - chart.m.b - 8;
  labels.forEach((l) => {
    const cx = Math.max(chart.m.l + l.tw / 2, Math.min(l.Xc, chart.w - chart.m.r - l.tw / 2));
    ctx.fillStyle = l.col;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(l.text, cx, ly);
  });
}

/* 图表内的短格式（与 lib/rti/calc 的界面格式分开：图里不加千分位） */
function fmtTempTick(v) {
  return Math.abs(v - Math.round(v)) < 0.05 ? String(Math.round(v)) : v.toFixed(1);
}
function fmtR2Tick(r) {
  if (r >= 0.999995) return '1.0000';
  if (r >= 0.99995) return r.toFixed(5);
  return r.toFixed(4);
}
