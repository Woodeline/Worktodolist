// RTI 算法层 · 单测
//
// 这组用例的意义不在"覆盖率"，而在于**给移植一个独立的裁判**：
//   · 回归汇总值（a / b / R² / s / 两个 RTI 与 95%CI / Ea）直接对着
//     RTI-计算工具/verify_out.txt 里由独立 Python 实现算出的数值断言；
//   · t₅₀ 另有一条**手算**用例（两位数笔算就能验证），避免整组断言变成自证。
// 改算法时如果这组红了，先怀疑改动，别改断言。
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TEMP_RANGE,
  RTI_LIFE,
  cmpSeries,
  fmtH,
  fmtR2,
  fmtSig,
  fmtTemp,
  fitSeries,
  lifeCalc,
  normRange,
  rtiCalc,
  toNum,
  yearsOf,
} from './calc.js';
import { DEMO_CMP, DEMO_LIFE, DEMO_RTI } from './demo.js';

/* ---------------------------------------------------------------------------
   基准对拍（verify_out.txt）
   ------------------------------------------------------------------------- */

describe('RTI 基准对拍：与独立 Python 实现的结果一致', () => {
  const out = rtiCalc(DEMO_RTI);
  const R = out.result;

  it('回归参数 a / b / R² / 残差 s 与基准逐位一致', () => {
    // verify_out.txt: a=-10.8100 b=6382.2 R2=0.99997 s=0.00447
    expect(R.a).toBeCloseTo(-10.81, 4);
    expect(R.b).toBeCloseTo(6382.2, 1);
    expect(R.r2.toFixed(5)).toBe('0.99997');
    expect(R.s.toFixed(5)).toBe('0.00447');
  });

  it('RTI 与 95% 置信区间与基准一致（100,000 h 口径）', () => {
    // verify_out.txt: L=100000: RTI=130.5 C, 95%CI=[130.0, 131.1]
    expect(R.r100.rti.toFixed(1)).toBe('130.5');
    expect(R.r100.ci.lo.toFixed(1)).toBe('130.0');
    expect(R.r100.ci.hi.toFixed(1)).toBe('131.1');
  });

  it('RTI 与 95% 置信区间与基准一致（20,000 h 口径）', () => {
    // verify_out.txt: L=20000: RTI=149.2 C, 95%CI=[148.9, 149.5]
    expect(R.r20.rti.toFixed(1)).toBe('149.2');
    expect(R.r20.ci.lo.toFixed(1)).toBe('148.9');
    expect(R.r20.ci.hi.toFixed(1)).toBe('149.5');
  });

  it('表观活化能与基准一致', () => {
    // verify_out.txt: Ea = 122.2 kJ/mol
    expect(R.Ea.toFixed(1)).toBe('122.2');
  });

  it('温度点、自由度与 t₀.₉₇₅ 都对得上', () => {
    expect(R.n).toBe(4);
    expect(R.df).toBe(2);
    expect(R.ciOk).toBe(true);
    expect(R.tc).toBeCloseTo(4.3027, 3);
    expect(out.warns).toEqual([]);
  });

  it('四个温度的 t₅₀ 都走内插，且数值可复核', () => {
    expect(R.perT.map((p) => [p.T, Math.round(p.t50)])).toEqual([
      [185, 1329],
      [170, 3860],
      [155, 12518],
      [140, 43499],
    ]);
    expect(R.perT.every((p) => p.mode === 'interp')).toBe(true);
  });
});

/* ---------------------------------------------------------------------------
   手算用例：t₅₀ 的终点时间内插
   ------------------------------------------------------------------------- */

describe('终点时间内插（IEC 60216-1）：笔算可验证', () => {
  it('跨阈两点在 (log₁₀t, 特性值) 平面线性内插', () => {
    // 阈值 50（P₀=100）。跨阈两点：(1008 h, 53.0) 与 (1512 h, 48.6)
    //   把内插式在**对数空间**写出来断言，避免把"手算指数"的误差算进期望值：
    //   log10(t50) = log10(1008) + (53.0−50)×[log10(1512)−log10(1008)]/(53.0−48.6)
    //              = 3.0034605 + 3×0.1760913/4.4 = 3.1235228
    const out = rtiCalc({ name: 'x', p0: '100', temps: [{ T: '185', rows: DEMO_RTI.temps[0].rows }] });
    // 只有一个温度 → 报错，所以这里直接调 lifeCalc 验内插本身
    expect(out.error).toBeTruthy();

    const single = lifeCalc({ name: 'x', p0: '100', pts: DEMO_RTI.temps[0].rows.map(([t, v]) => ({ t, v })) });
    const expectedLog = Math.log10(1008) + (3 * (Math.log10(1512) - Math.log10(1008))) / 4.4;
    expect(single.result.mode).toBe('interp');
    expect(Math.log10(single.result.t50)).toBeCloseTo(expectedLog, 12);
    expect(Math.round(single.result.t50)).toBe(1329);
    expect(single.result.lo.t).toBe(1008);
    expect(single.result.hi.t).toBe(1512);
  });

  it('页 1 示例：阈值 49.3，跨阈两点为 12096 h(49.7) 与 15120 h(47.1)', () => {
    // lt = log10(12096) + (49.7−49.3)×(log10(15120)−log10(12096))/(49.7−47.1) = 4.097574 → 12518.4 h
    const out = lifeCalc(DEMO_LIFE);
    expect(out.warns).toEqual([]);
    expect(out.result.thr).toBeCloseTo(49.3, 10);
    expect(out.result.t50).toBeCloseTo(12518.46, 1);
    expect(fmtH(out.result.t50)).toBe('12,518');
    expect(out.result.T).toBe(155);
  });
});

/* ---------------------------------------------------------------------------
   页 1 的边界与错误路径
   -------------------------------------------------------------------------- */

describe('页 1 · 寿命推算的边界', () => {
  it('P₀ 留空时取最早那个点的特性值', () => {
    const out = lifeCalc({ name: 'a', p0: '', pts: DEMO_LIFE.pts });
    expect(out.result.p0).toBe(90.0);
    expect(out.result.thr).toBeCloseTo(45, 10);
  });

  it('有效点不足 2 个时报错', () => {
    expect(lifeCalc({ pts: [{ t: 100, v: 90 }] }).error).toMatch(/2 个有效数据点/);
    expect(lifeCalc({ pts: [] }).error).toMatch(/2 个有效数据点/);
  });

  it('空串与非法数字都算"没填"，不会被当成 0 混进计算', () => {
    const out = lifeCalc({ pts: [{ t: '168', v: '90' }, { t: '', v: '' }, { t: 'abc', v: '70' }] });
    expect(out.error).toMatch(/2 个有效数据点/);
  });

  it('P₀ 是非法值时明确报错，而不是悄悄回退到默认值', () => {
    expect(lifeCalc({ ...DEMO_LIFE, p0: 'abc' }).error).toMatch(/P₀ 得是正数/);
    expect(lifeCalc({ ...DEMO_LIFE, p0: '0' }).error).toMatch(/P₀ 得是正数/);
  });

  it('所有实测值都低于阈值时给出可操作的提示', () => {
    const out = lifeCalc({ p0: '100', pts: [{ t: 10, v: 40 }, { t: 20, v: 30 }] });
    expect(out.error).toMatch(/早期高值/);
  });

  it('看不出衰减趋势（斜率 ≥ 0）时报错', () => {
    const out = lifeCalc({ p0: '100', pts: [{ t: 10, v: 60 }, { t: 20, v: 70 }, { t: 30, v: 80 }] });
    expect(out.error).toMatch(/回归斜率/);
  });

  it('未跨阈时走外推，并给出"置信度不如内插"的告警', () => {
    const out = lifeCalc({ p0: '100', pts: [{ t: 10, v: 90 }, { t: 20, v: 85 }, { t: 40, v: 80 }] });
    expect(out.result.mode).toBe('extrap');
    expect(out.warns[0]).toMatch(/回归外推/);
    expect(out.result.t50).toBeGreaterThan(40);
  });

  it('外推跨度超过最长实测时长 10 倍时追加告警', () => {
    const out = lifeCalc({ p0: '100', pts: [{ t: 10, v: 99 }, { t: 20, v: 98 }, { t: 30, v: 97 }] });
    expect(out.result.mode).toBe('extrap');
    expect(out.warns.some((w) => /不确定性不小/.test(w))).toBe(true);
  });

  it('数据点按老化时长升序使用，与录入顺序无关', () => {
    const shuffled = [DEMO_LIFE.pts[5], DEMO_LIFE.pts[1], DEMO_LIFE.pts[7], DEMO_LIFE.pts[0],
      DEMO_LIFE.pts[4], DEMO_LIFE.pts[2], DEMO_LIFE.pts[6], DEMO_LIFE.pts[3]];
    expect(lifeCalc({ ...DEMO_LIFE, pts: shuffled }).result.t50).toBeCloseTo(lifeCalc(DEMO_LIFE).result.t50, 9);
  });
});

/* ---------------------------------------------------------------------------
   页 2 的边界：两个曾经会崩 / 会显示 NaN 的地方
   -------------------------------------------------------------------------- */

describe('页 2 · RTI 的边界', () => {
  it('温度组不足 2 个时报错', () => {
    expect(rtiCalc({ temps: [{ T: '155', rows: DEMO_RTI.temps[2].rows }] }).error).toMatch(/至少需要 2 个/);
    expect(rtiCalc({ temps: [] }).error).toMatch(/至少需要 2 个/);
  });

  it('P₀ 留空、且存在还没填数据的温度组时，给出明确报错而不是抛异常', () => {
    // 原独立工具在这里会读到 undefined 的属性直接抛 TypeError ——
    // 表现是"点了按钮什么也没发生"，所以这条必须钉住。
    const out = rtiCalc({
      p0: '',
      temps: [
        { T: '155', rows: DEMO_RTI.temps[2].rows },
        { T: '140', rows: [['', ''], ['', ''], ['', '']] },
      ],
    });
    expect(out.error).toMatch(/140/);
    expect(out.error).toMatch(/不足 2 个/);
  });

  it('所有温度组都没有数据点时报错', () => {
    const out = rtiCalc({ p0: '', temps: [{ T: '155', rows: [['', '']] }, { T: '140', rows: [['', '']] }] });
    expect(out.error).toMatch(/至少要有 1 个有效数据点/);
  });

  it('只有 2 个温度时不给残差（df = 0，0/0 是 NaN 而不是 0）', () => {
    const out = rtiCalc({
      p0: '100',
      temps: [
        { T: '185', rows: DEMO_RTI.temps[0].rows },
        { T: '155', rows: DEMO_RTI.temps[2].rows },
      ],
    });
    expect(out.result.n).toBe(2);
    expect(out.result.df).toBe(0);
    expect(out.result.ciOk).toBe(false);
    expect(out.result.s).toBeNull();
    expect(out.result.r20.ci).toBeNull();
    expect(out.result.r100.ci).toBeNull();
    expect(out.warns.some((w) => /不足 3 个/.test(w))).toBe(true);
  });

  it('Arrhenius 斜率 ≤ 0（寿命没随降温延长）时报错', () => {
    const out = rtiCalc({
      p0: '100',
      temps: [
        // 185 °C 反而"更耐用"（外推 t₅₀ 极大），155 °C 却很快到终点 —— 趋势反了
        { T: '185', rows: [[10, 95], [100, 85]] },
        { T: '155', rows: [[10, 90], [20, 40]] },
      ],
    });
    expect(out.error).toMatch(/Arrhenius 回归斜率/);
  });

  it('Arrhenius 线性欠佳时追加告警', () => {
    const temps = DEMO_RTI.temps.map((g, i) => (i === 0 ? { ...g, rows: g.rows.map(([t, v]) => [t, v * 0.9]) } : g));
    const out = rtiCalc({ ...DEMO_RTI, temps });
    if (out.result && out.result.r2 < 0.95) {
      expect(out.warns.some((w) => /线性欠佳/.test(w))).toBe(true);
    }
  });
});

/* ---------------------------------------------------------------------------
   页 3 · 对比拟合
   -------------------------------------------------------------------------- */

describe('页 3 · 多材料对比', () => {
  it('示例数据能算出三条曲线，R² 按对数坐标给出', () => {
    const series = cmpSeries(DEMO_CMP.mats, true);
    expect(series.map((s) => s.name)).toEqual(['材料 A（PA66）', '材料 B（PET）', '材料 C（PPS）']);
    expect(series.map((s) => s.pts.length)).toEqual([4, 4, 3]);
    expect(series[0].fit.r2).toBeCloseTo(0.9884, 4);
    expect(series[2].fit.r2).toBeCloseTo(0.9959, 4);
  });

  it('切换坐标会重新拟合（直线性是坐标的函数）', () => {
    const log = cmpSeries(DEMO_CMP.mats, true)[0].fit;
    const lin = cmpSeries(DEMO_CMP.mats, false)[0].fit;
    expect(log.b).not.toBeCloseTo(lin.b, 6);
    expect(log.r2).toBeGreaterThan(lin.r2); // t₅₀ 在对数空间里更接近直线
  });

  it('没有有效点的材料被剔除，但保留它在原列表里的序号（颜色不跳）', () => {
    const mats = [
      { name: 'A', rows: [{ T: '', t: '' }] },
      { name: 'B', rows: [{ T: 160, t: 1000 }, { T: 140, t: 5000 }] },
    ];
    const series = cmpSeries(mats, true);
    expect(series).toHaveLength(1);
    expect(series[0].name).toBe('B');
    expect(series[0].index).toBe(1);
  });

  it('单点或温度全相同的序列无法拟合', () => {
    expect(fitSeries([{ T: 150, t: 100 }], true)).toBeNull();
    expect(fitSeries([{ T: 150, t: 100 }, { T: 150, t: 200 }], true)).toBeNull();
  });
});

/* ---------------------------------------------------------------------------
   输入解析与格式化
   -------------------------------------------------------------------------- */

describe('输入解析（toNum）', () => {
  it('空串与 null 都算"没填"', () => {
    expect(toNum('')).toBeNull();
    expect(toNum(null)).toBeNull();
    expect(toNum(undefined)).toBeNull();
  });

  it('数字字符串与数字都能用，非法值算没填', () => {
    expect(toNum('76.4')).toBe(76.4);
    expect(toNum(1512)).toBe(1512);
    expect(toNum('abc')).toBeNull();
    expect(toNum('1e3')).toBe(1000);
  });

  it('空串不会被当成 0（这是最容易悄悄出错的地方）', () => {
    expect(toNum('')).not.toBe(0);
    expect(toNum('')).toBeNull();
  });
});

describe('温度显示范围的规范化（normRange）', () => {
  it('正常值原样返回', () => {
    expect(normRange('60', '160')).toEqual({ min: 60, max: 160 });
  });

  it('空值 / 非法值回退默认', () => {
    expect(normRange('', '160')).toEqual(DEFAULT_TEMP_RANGE);
    expect(normRange('60', 'abc')).toEqual(DEFAULT_TEMP_RANGE);
  });

  it('上下限颠倒自动交换', () => {
    expect(normRange('160', '60')).toEqual({ min: 60, max: 160 });
  });

  it('上下限相等回退默认（否则 xmax−xmin = 0 会算出 Infinity）', () => {
    expect(normRange('100', '100')).toEqual(DEFAULT_TEMP_RANGE);
  });
});

describe('显示格式化', () => {
  it('小时：小值留一位小数，大值取整加千分位', () => {
    expect(fmtH(0)).toBe('—');
    expect(fmtH(-1)).toBe('—');
    expect(fmtH(7.25)).toBe('7.3');
    expect(fmtH(168.4)).toBe('168');
    expect(fmtH(12518.46)).toBe('12,518');
  });

  it('只有到"年"的量级才换算', () => {
    expect(yearsOf(8760)).toBe('（约 1.0 年）');
    expect(yearsOf(8759)).toBe('');
    expect(yearsOf(87600)).toBe('（约 10.0 年）');
  });

  it('温度去掉无意义的小数尾巴', () => {
    expect(fmtTemp(185)).toBe('185');
    expect(fmtTemp(185.04)).toBe('185');
    expect(fmtTemp(185.6)).toBe('185.6');
    expect(fmtTemp(null)).toBe('—');
  });

  it('R² 的位数随"好到什么程度"变化，0.99997 不会被压成 1.0000', () => {
    expect(fmtR2(1)).toBe('1.0000');
    expect(fmtR2(0.9999996)).toBe('1.0000');
    expect(fmtR2(0.99997)).toBe('0.99997');
    expect(fmtR2(0.9884)).toBe('0.9884');
  });

  it('阈值保留 4 位有效数字，与输入对得上', () => {
    expect(fmtSig(49.3)).toBe(49.3);
    expect(fmtSig(49.29999999999999)).toBe(49.3);
  });
});

describe('常量口径', () => {
  it('两个寿命口径是 20,000 / 100,000 小时', () => {
    expect(RTI_LIFE.r20).toBe(20000);
    expect(RTI_LIFE.r100).toBe(100000);
  });
});
