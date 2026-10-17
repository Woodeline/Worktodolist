// RTI 扁平行模型 · 单测
//
// 要点：groupRows / compute 是"把页 1 并进页 2"这条交互改造的**承重墙** ——
// 温度组由 T 推导、empty/非数字行被跳过、每条衰减曲线能单独算出来。
// 这些都不能只靠浏览器里"看着对"来保证，所以在这里钉住。
import { describe, expect, it } from 'vitest';
import { toNum } from './calc.js';
import { DEMO_CMP, DEMO_LIFE, DEMO_RTI } from './demo.js';
import { compute, emptyRows, groupRows, legacyRows, rowsFromDemo } from './model.js';

describe('扁平行 → 温度组（groupRows）', () => {
  it('示例数据摊平再分组，回到原来的 4 个温度组', () => {
    const rows = rowsFromDemo(DEMO_RTI);
    expect(rows).toHaveLength(32);
    const { groups, blank } = groupRows(rows);
    expect(groups.map((g) => g.T)).toEqual([185, 170, 155, 140]); // 高温在前
    expect(groups.map((g) => g.pts.length)).toEqual([8, 8, 8, 8]);
    expect(blank).toBe(0);
  });

  it('同一温度的两种写法（170 / 170.0）自动并到一组', () => {
    const { groups } = groupRows([
      { T: '170', t: '48', v: '92' },
      { T: '170.0', t: '168', v: '80' },
      { T: ' 170 ', t: '504', v: '69' },
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].pts).toHaveLength(3);
  });

  it('组内数据点按老化时长升序，与录入顺序无关', () => {
    const { groups } = groupRows([
      { T: '155', t: '6048', v: '57' },
      { T: '155', t: '168', v: '91' },
      { T: '155', t: '3024', v: '63' },
    ]);
    expect(groups[0].pts.map((p) => p.t)).toEqual([168, 3024, 6048]);
  });

  it('空白行不算"不完整"，只有用户碰过又填错的才计入 blank', () => {
    const { blank } = groupRows([
      { T: '', t: '', v: '' },
      { T: '155', t: '', v: '91' }, // 碰过，缺时长 → 计入
      { T: 'abc', t: '168', v: '91' }, // 温度非法 → 计入
    ]);
    expect(blank).toBe(2);
  });

  it('空的 / 非数字 / 时长为 0 的行被跳过，不污染分组', () => {
    const { groups } = groupRows([
      { T: '155', t: '168', v: '91' },
      { T: '155', t: '', v: '90' },
      { T: '155', t: '0', v: '90' },
      { T: '', t: '200', v: '80' },
      { T: '140', t: '504', v: '92' },
    ]);
    expect(groups.map((g) => [g.T, g.pts.length])).toEqual([
      [155, 1],
      [140, 1],
    ]);
  });
});

describe('一次算全部（compute）', () => {
  it('示例数据算出与基线一致的 RTI（149.2 / 130.5 °C）', () => {
    const m = compute(rowsFromDemo(DEMO_RTI), DEMO_RTI.name, String(DEMO_RTI.p0));
    const R = m.out.result;
    expect(R.r20.rti.toFixed(1)).toBe('149.2');
    expect(R.r100.rti.toFixed(1)).toBe('130.5');
    expect(R.Ea.toFixed(1)).toBe('122.2');
  });

  it('每个温度组各自给出 t₅₀（页 1 的下钻数据）', () => {
    const m = compute(rowsFromDemo(DEMO_RTI), DEMO_RTI.name, String(DEMO_RTI.p0));
    expect(m.perGroup.map((g) => [g.T, Math.round(g.life.result.t50)])).toEqual([
      [185, 1329],
      [170, 3860],
      [155, 12518],
      [140, 43499],
    ]);
  });

  it('不足 2 个温度时整体报错，但每个温度自己的 t₅₀ 仍然算得出来', () => {
    const one = DEMO_RTI.temps.slice(2, 3); // 只留 155 一组
    const m = compute(rowsFromDemo({ temps: one }), 'x', '100');
    expect(m.out.error).toMatch(/至少需要 2 个/);
    expect(m.perGroup).toHaveLength(1);
    expect(Math.round(m.perGroup[0].life.result.t50)).toBe(12518);
  });

  it('不抛异常：整表为空时返回空分组 + 错误对象', () => {
    const m = compute(emptyRows(), '', '');
    expect(m.groups).toEqual([]);
    expect(m.perGroup).toEqual([]);
    expect(m.out.error).toBeTruthy();
  });
});

describe('旧存档 → 扁平行（legacyRows）', () => {
  it('页 2 的多温度数据摊平（主线）', () => {
    const rows = legacyRows(DEMO_LIFE, DEMO_RTI.temps);
    const { groups } = groupRows(rows);
    expect(groups.map((g) => g.T)).toEqual([185, 170, 155, 140]);
  });

  it('只用了页 1 的老用户：life 被折进来，数据不丢', () => {
    const rows = legacyRows(DEMO_LIFE, []);
    const { groups } = groupRows(rows);
    expect(groups).toHaveLength(1);
    expect(groups[0].T).toBe(155);
    expect(groups[0].pts).toHaveLength(8);
  });

  it('页 2 已有 155 组时不再并入 life 的 155，避免两组混成一条序列', () => {
    const rows = legacyRows(DEMO_LIFE, DEMO_RTI.temps);
    const g155 = groupRows(rows).groups.find((g) => g.T === 155);
    expect(g155.pts).toHaveLength(8); // 仍是页 2 的 8 点，没有被 life 的 8 点加到 16
  });

  it('两边都空时回退到空表骨架（而不是空数组）', () => {
    const rows = legacyRows({ pts: [] }, []);
    expect(rows).toEqual(emptyRows());
    expect(rows.length).toBeGreaterThan(0);
  });

  it('数值转成字符串（与界面表单同一形态）', () => {
    // life 至少要 2 个点才值得折进来（1 个点算不出 t₅₀），见 legacyRows 的规则
    const rows = legacyRows({ T: 155, pts: [{ t: 168, v: 90 }, { t: 336, v: 80 }] }, []);
    expect(typeof rows[0].T).toBe('string');
    expect(toNum(rows[0].T)).toBe(155);
    expect(toNum(rows[0].t)).toBe(168);
  });
});

describe('示例摊平的边界', () => {
  it('rowsFromDemo 容忍缺字段的示例对象', () => {
    expect(rowsFromDemo({})).toEqual([]);
    expect(rowsFromDemo({ temps: [{ T: 150 }] })).toEqual([]);
  });

  it('DEMO_CMP 与扁平行模型无关（对比页仍用自己的材料结构）', () => {
    expect(DEMO_CMP.mats.length).toBe(3);
  });
});
