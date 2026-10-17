// 「工具数据 ⇄ Excel」映射的单测。
//
// 这条路径是**无损**的底线：导出 → 在 Excel 里转一圈（甚至只是打开再另存）→ 导入，
// 界面上的表必须一模一样。所以用真实字节往返（走 buildXlsx / readXlsx），
// 而不是只比对象。
import { describe, expect, it } from 'vitest';
import { DEMO_CMP, DEMO_RTI } from './demo.js';
import { dataFromSheets, sheetsFromData } from './excel.js';
import { readXlsx, buildXlsx } from './xlsx.js';

/** 与 RtiTool.toStorage 的输出同形状（数字或 null） */
const STORAGE = {
  rti: {
    name: '示例材料 <A>',
    p0: 100,
    rows: [
      { T: 185, t: 24, v: 88.4 },
      { T: 185, t: 72, v: 78.3 },
      { T: null, t: null, v: null }, // 整行空：没信息量，导出时丢掉
      { T: 170, t: null, v: null }, // 半行：必须留住（界面据此提示"有 N 行不完整"）
      { T: 140, t: 504, v: 92.4 },
    ],
  },
  cmp: {
    mats: [
      { name: '材料 A（PA66）', rows: [{ T: 160, t: 1500 }, { T: 100, t: 98000 }] },
      { name: '材料 B', rows: [{ T: null, t: null }] }, // 还没填数的材料：光有名字也要留住
    ],
    xMin: 60,
    xMax: 160,
    logY: false,
  },
};

const roundTrip = (data) => dataFromSheets(readXlsx(buildXlsx(sheetsFromData(data))));

describe('导出 → 导入 无损往返', () => {
  it('耐热指数行（含半行）与对比材料（含空材料）都回到原样', () => {
    expect(roundTrip(STORAGE)).toEqual({
      rti: {
        name: '示例材料 <A>',
        p0: 100,
        rows: [
          { T: 185, t: 24, v: 88.4 },
          { T: 185, t: 72, v: 78.3 },
          { T: 170, t: null, v: null },
          { T: 140, t: 504, v: 92.4 },
        ],
      },
      cmp: {
        mats: [
          { name: '材料 A（PA66）', rows: [{ T: 160, t: 1500 }, { T: 100, t: 98000 }] },
          { name: '材料 B', rows: [{ T: '', t: '' }] },
        ],
        xMin: 60,
        xMax: 160,
        logY: false,
      },
    });
  });

  it('示例数据（DEMO）摊平后往返不丢行', () => {
    const rows = DEMO_RTI.temps.flatMap((g) => g.rows.map(([t, v]) => ({ T: g.T, t, v })));
    const data = {
      rti: { name: DEMO_RTI.name, p0: DEMO_RTI.p0, rows },
      cmp: { mats: DEMO_CMP.mats, xMin: DEMO_CMP.xMin, xMax: DEMO_CMP.xMax, logY: DEMO_CMP.logY },
    };
    const back = roundTrip(data);
    expect(back.rti.rows).toEqual(rows);
    expect(back.cmp.mats).toEqual(DEMO_CMP.mats);
    expect(back.rti.name).toBe('示例材料');
    expect(back.rti.p0).toBe(100);
  });

  it('空数据也能往返（p0 / 材料都空）', () => {
    const empty = { rti: { name: '', p0: null, rows: [] }, cmp: { mats: [], xMin: 60, xMax: 160, logY: true } };
    const back = roundTrip(empty);
    expect(back.rti).toEqual({ name: '', p0: null, rows: [] });
    expect(back.cmp).toEqual({ mats: [], xMin: 60, xMax: 160, logY: true });
  });
});

describe('导出内容（三张工作表）', () => {
  const sheets = sheetsFromData(STORAGE);

  it('表名与顺序固定，泵着人也能看懂', () => {
    expect(sheets.map((s) => s.name)).toEqual(['耐热指数', '多材料对比', '对比图设置']);
  });

  it('参数写在表头块里，数据表带表头', () => {
    expect(sheets[0].rows[0]).toEqual(['材料名称', '示例材料 <A>']);
    expect(sheets[0].rows[1]).toEqual(['初始特性值 P0', 100]);
    expect(sheets[0].rows[3]).toEqual(['老化温度 T（°C）', '老化时长 t（h）', '特性值']);
    expect(sheets[1].rows[0]).toEqual(['材料名称', '老化温度 T（°C）', 't50（h）']);
    expect(sheets[2].rows).toEqual([['温度下限（°C）', 60], ['温度上限（°C）', 160], ['Y 轴对数坐标', '否']]);
  });

  it('整行空的行不写进文件，半行写进去（留下用户的痕迹）', () => {
    const dataRows = sheets[0].rows.slice(4);
    expect(dataRows).toEqual([
      [185, 24, 88.4],
      [185, 72, 78.3],
      [170, '', ''],
      [140, 504, 92.4],
    ]);
  });
});

describe('推算结果表（只写不读）', () => {
  // 与 compute().out.result 同形状的最小样本（数字够用即可，重在结构与口径）
  const RESULT = {
    name: '示例材料 <A>',
    p0: 100,
    perT: [
      { T: 185, t50: 1329.4, mode: 'interp' },
      { T: 170, t50: 3860.2, mode: 'extrap' },
    ],
    a: -8.1234,
    b: 4567.89,
    r2: 0.99997,
    s: 0.00123,
    df: 2,
    tc: 4.303,
    Ea: 122.2,
    r20: { rti: 149.24, ci: { lo: 148.9, hi: 149.5 } },
    r100: { rti: 130.53, ci: { lo: 130.0, hi: 131.1 } },
  };

  it('有结果时多挂一张「推算结果」，紧跟在「耐热指数」后面', () => {
    const sheets = sheetsFromData(STORAGE, RESULT);
    expect(sheets.map((s) => s.name)).toEqual(['耐热指数', '推算结果', '多材料对比', '对比图设置']);
  });

  it('没有结果时不写空表，仍是三张', () => {
    expect(sheetsFromData(STORAGE).map((s) => s.name)).toEqual(['耐热指数', '多材料对比', '对比图设置']);
    expect(sheetsFromData(STORAGE, null).map((s) => s.name)).toEqual(['耐热指数', '多材料对比', '对比图设置']);
  });

  it('结果表把 t₅₀ / 回归参数 / RTI + 95%CI / Ea 都写进去', () => {
    const rows = sheetsFromData(STORAGE, RESULT).find((s) => s.name === '推算结果').rows;
    expect(rows[0]).toEqual(['材料名称', '示例材料 <A>']);
    expect(rows[1]).toEqual(['初始特性值 P0', 100]);
    expect(rows).toContainEqual(['老化温度 T（°C）', 't50（h）', '求法']);
    expect(rows).toContainEqual(['185', 1329, '内插']);
    expect(rows).toContainEqual(['170', 3860, '外推']);
    expect(rows).toContainEqual(['回归 a', '回归 b', 'R2', '残差 s', '自由度 df', 't0.975']);
    expect(rows).toContainEqual(['-8.1234', '4567.89', '0.99997', '0.00123', 2, '4.303']);
    // RTI 与寿命口径从 RTI_LIFE 来（20,000 / 100,000），不是写死的字符串
    expect(rows).toContainEqual(['RTI @ 20000 h', '149.2', '148.9', '149.5']);
    expect(rows).toContainEqual(['RTI @ 100000 h', '130.5', '130.0', '131.1']);
    expect(rows).toContainEqual(['活化能 Ea（kJ/mol）', '122.2']);
  });

  it('导入时忽略结果表：数据与「不带结果导出」完全等价', () => {
    const withResult = dataFromSheets(readXlsx(buildXlsx(sheetsFromData(STORAGE, RESULT))));
    const without = dataFromSheets(readXlsx(buildXlsx(sheetsFromData(STORAGE))));
    expect(withResult).toEqual(without);
  });
});

describe('导入的容错（用户手里的表不会长成我们的样子）', () => {
  const wrap = (rows) => dataFromSheets([{ name: '耐热指数', rows }]);

  it('参数行被删掉，仍然读得到数据', () => {
    const back = wrap([
      ['老化温度 T（°C）', '老化时长 t（h）', '特性值'],
      [185, 24, 88.4],
      [185, '', ''],
    ]);
    expect(back.rti.name).toBe('');
    expect(back.rti.p0).toBeNull();
    expect(back.rti.rows).toEqual([{ T: 185, t: 24, v: 88.4 }, { T: 185, t: null, v: null }]);
  });

  it('表头前多几行空行、中间夹空行都不影响', () => {
    const back = wrap([[null], [], ['老化温度 T（°C）', '老化时长 t（h）', '特性值'], [], [155, 168, 91.3]]);
    expect(back.rti.rows).toEqual([{ T: 155, t: 168, v: 91.3 }]);
  });

  it('数字被 Excel 存成文本也认；真正读不出来的（"x"）当没填', () => {
    const back = wrap([['老化温度 T（°C）', '老化时长 t（h）', '特性值'], ['185', '24', '88.4'], ['155', 'x', '9']]);
    expect(back.rti.rows).toEqual([
      { T: 185, t: 24, v: 88.4 },
      { T: 155, t: null, v: 9 },
    ]);
  });

  it('表名被改过：退一步认表头', () => {
    const back = dataFromSheets([{ name: '我的数据', rows: [['老化温度 T（°C）', '老化时长 t（h）', '特性值'], [170, 48, 92]] }]);
    expect(back.rti.rows).toEqual([{ T: 170, t: 48, v: 92 }]);
  });

  it('对比表：同名材料合并，t₅₀ 非正的行走不进图（与对比页口径一致）', () => {
    const back = dataFromSheets([
      { name: '耐热指数', rows: [['老化温度 T（°C）', '老化时长 t（h）', '特性值'], [170, 48, 92]] },
      {
        name: '多材料对比',
        rows: [
          ['材料名称', '老化温度 T（°C）', 't50（h）'],
          ['A', 160, 1500],
          ['A', 140, 8500],
          ['B', 160, 0], // t₅₀ 必须 > 0
          ['B', 150, 700],
        ],
      },
    ]);
    expect(back.cmp.mats).toEqual([
      { name: 'A', rows: [{ T: 160, t: 1500 }, { T: 140, t: 8500 }] },
      { name: 'B', rows: [{ T: 150, t: 700 }] },
    ]);
  });

  it('设置表缺失/写坏时回默认（60–160、对数开）', () => {
    const back = dataFromSheets([{ name: '耐热指数', rows: [['老化温度 T（°C）', '老化时长 t（h）', '特性值'], [170, 48, 92]] }]);
    expect(back.cmp.xMin).toBe(60);
    expect(back.cmp.xMax).toBe(160);
    expect(back.cmp.logY).toBe(true);
  });

  it('不是本工具的文件（没有数据表）→ null，调用方据此报错', () => {
    expect(dataFromSheets([])).toBeNull();
    expect(dataFromSheets([{ name: 'Sheet1', rows: [['a', 'b']] }])).toBeNull();
  });
});
