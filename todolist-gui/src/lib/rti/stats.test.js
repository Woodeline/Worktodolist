// RTI 算法层 · 数学内核单测
//
// t 分位数用**统计表上的公认值**断言，而不是用另一段自己写的实现算出来的值 ——
// 否则 gammaln / 不完全 Beta / 二分反解这一串如果有系统性偏差，测试也会跟着一致地错。
import { describe, expect, it } from 'vitest';
import { betai, linreg, rtiCI, seriesT50, tQ975, tTwoSidedP } from './stats.js';

describe('t 分布：t₀.₉₇₅ 分位数对标准表', () => {
  // 教科书 t 表（双侧 95%）公认值，只保留 3 位小数比较
  const TABLE = [
    [1, 12.706],
    [2, 4.303],
    [3, 3.182],
    [4, 2.776],
    [5, 2.571],
    [10, 2.228],
    [20, 2.086],
    [30, 2.042],
    [100, 1.984],
  ];

  it.each(TABLE)('df = %i → %f', (df, expected) => {
    expect(tQ975(df)).toBeCloseTo(expected, 3);
  });

  it('随自由度单调下降', () => {
    for (let df = 1; df < 40; df += 1) {
      expect(tQ975(df)).toBeGreaterThan(tQ975(df + 1));
    }
  });

  it('尾部概率与分位数互为逆运算', () => {
    expect(tTwoSidedP(tQ975(5), 5)).toBeCloseTo(0.05, 6);
    expect(tTwoSidedP(0, 7)).toBeCloseTo(1, 10);
  });
});

describe('正则化不完全 Beta', () => {
  it('边界值封闭', () => {
    expect(betai(2, 3, 0)).toBe(0);
    expect(betai(2, 3, 1)).toBe(1);
  });

  it('对称性：I_x(a,b) = 1 − I_{1−x}(b,a)', () => {
    expect(betai(2, 5, 0.3)).toBeCloseTo(1 - betai(5, 2, 0.7), 12);
  });
});

describe('线性回归', () => {
  it('完全共线时 R² = 1，且斜率截距精确', () => {
    const f = linreg([1, 2, 3], [3, 5, 7]);
    expect(f.b).toBeCloseTo(2, 12);
    expect(f.a).toBeCloseTo(1, 12);
    expect(f.r2).toBeCloseTo(1, 12);
  });

  it('同时给出中心化的均值与离差平方和（置信区间要用）', () => {
    const f = linreg([1, 2, 3, 4], [1, 2, 3, 4]);
    expect(f.xm).toBeCloseTo(2.5, 12);
    expect(f.sxx).toBeCloseTo(5, 12);
  });
});

describe('终点时间 seriesT50', () => {
  it('跨阈时内插，并回报跨阈的那两个点', () => {
    const r = seriesT50([{ t: 10, v: 90 }, { t: 100, v: 40 }], 50);
    expect(r.mode).toBe('interp');
    // log10(t50) = log10(10) + (90−50)×(log10(100)−log10(10))/(90−40) = 1 + 40/50 = 1.8
    expect(r.t50).toBeCloseTo(10 ** 1.8, 10);
    expect(r.lo.t).toBe(10);
    expect(r.hi.t).toBe(100);
  });

  it('未跨阈时回归外推，并带上拟合结果', () => {
    const r = seriesT50([{ t: 10, v: 95 }, { t: 100, v: 85 }, { t: 1000, v: 75 }], 50);
    expect(r.mode).toBe('extrap');
    expect(r.fit.b).toBeLessThan(0);
    expect(r.t50).toBeGreaterThan(1000);
  });

  it('全部低于阈值时报错', () => {
    expect(seriesT50([{ t: 10, v: 40 }, { t: 100, v: 20 }], 50).error).toMatch(/低于 50% 阈值/);
  });

  it('斜率不为负时报错', () => {
    expect(seriesT50([{ t: 10, v: 60 }, { t: 100, v: 70 }], 50).error).toMatch(/递减|衰减/);
  });
});

describe('95% 置信带与水平线的交点', () => {
  // 用第 2 页示例拟合出来的量级，验证交点把点估计夹在中间
  const a = -10.81;
  const b = 6382.2;
  const s = 0.00447;
  const n = 4;
  const xs = [1 / 458.15, 1 / 443.15, 1 / 428.15, 1 / 413.15];
  const { xm, sxx } = linreg(xs, [0, 0, 0, 0]);
  const tc = tQ975(n - 2);

  it('交点区间包含点估计，且下限低于上限', () => {
    const ystar = Math.log10(20000);
    const xstar = (ystar - a) / b;
    const point = 1 / xstar - 273.15;
    const ci = rtiCI(a, b, s, xm, sxx, n, ystar, tc);
    expect(ci.lo).toBeLessThan(point);
    expect(ci.hi).toBeGreaterThan(point);
    expect(ci.hi - ci.lo).toBeGreaterThan(0);
  });

  it('置信带太平（s → 0）时退化为点估计附近的很小区间', () => {
    const ystar = Math.log10(20000);
    const ci = rtiCI(a, b, 1e-12, xm, sxx, n, ystar, tc);
    const point = 1 / ((ystar - a) / b) - 273.15;
    expect(ci.hi - ci.lo).toBeLessThan(0.01);
    expect(ci.lo).toBeCloseTo(point, 3);
  });

  it('判别式为负时返回 null（置信带与水平线无交点）', () => {
    // 残差大到置信带被撑开、与 20,000 h 这条线不再相交
    expect(rtiCI(a, b, 5, xm, sxx, n, Math.log10(20000), tc)).toBeNull();
  });
});
