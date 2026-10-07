// 页 2 · RTI 耐热指数：多温度 t₅₀ → Arrhenius 外推 → RTI / 95%CI / 活化能
import { useEffect, useRef } from 'react';
import { RTI_LIFE, fmtH, fmtSig, fmtTemp, toNum, yearsOf } from '../../../lib/rti/calc.js';
import { drawRtiChart } from '../../../lib/rti/chart.js';
import { downloadCSV, downloadCanvasPNG, stamp } from '../../../lib/rti/files.js';
import NumberCell from './NumberCell.jsx';

export default function RtiPane({ state, setState, out, onDemo, onClear, onPaste, onCalc, onToCmp }) {
  const canvasRef = useRef(null);
  const result = out.result;

  useEffect(() => {
    if (canvasRef.current && result) drawRtiChart(canvasRef.current, result);
  }, [result]);

  useEffect(() => {
    if (!result) return undefined;
    const onResize = () => {
      if (canvasRef.current) drawRtiChart(canvasRef.current, result);
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [result]);

  const patchGroup = (ti, patch) =>
    setState((s) => ({ ...s, temps: s.temps.map((g, j) => (j === ti ? { ...g, ...patch(g) } : g)) }));

  const setTemp = (ti, value) => patchGroup(ti, () => ({ T: value }));
  const setCell = (ti, ri, ci, value) =>
    patchGroup(ti, (g) => ({ rows: g.rows.map((r, j) => (j === ri ? r.map((c, k) => (k === ci ? value : c)) : r)) }));
  const addRow = (ti) => patchGroup(ti, (g) => ({ rows: [...g.rows, ['', '']] }));
  const delRow = (ti, ri) => patchGroup(ti, (g) => ({ rows: g.rows.filter((_, j) => j !== ri) }));
  const addTemp = () =>
    setState((s) => ({ ...s, temps: [...s.temps, { T: '', rows: [['', ''], ['', ''], ['', '']] }] }));
  const delTemp = (ti) => setState((s) => ({ ...s, temps: s.temps.filter((_, j) => j !== ti) }));

  const usableTemps = state.temps.filter((g) => toNum(g.T) != null).length;

  const rowsOf = (g) => g.rows.filter((r) => toNum(r[0]) > 0 && toNum(r[1]) != null).length;

  const exportCSV = () => {
    const R = result;
    const rows = [];
    rows.push([`RTI 推算结果 — ${R.name}`]);
    rows.push([]);
    rows.push(['老化温度 T（°C）', 't50（h）', '求法']);
    R.perT.forEach((p) => rows.push([fmtTemp(p.T), Math.round(p.t50), p.mode === 'interp' ? '内插' : '外推']));
    rows.push([]);
    rows.push(['回归 a', '回归 b', 'R2', '残差 s', '自由度 df', 't0.975']);
    rows.push([
      R.a.toFixed(4),
      R.b.toFixed(2),
      R.r2.toFixed(5),
      R.s == null ? '—' : R.s.toFixed(5),
      R.df,
      R.tc == null ? '—' : R.tc.toFixed(3),
    ]);
    rows.push([]);
    rows.push(['指标', 'RTI（°C）', '95%CI 下限', '95%CI 上限']);
    rows.push([
      `RTI @ ${RTI_LIFE.r20} h`,
      R.r20.rti.toFixed(1),
      R.r20.ci ? R.r20.ci.lo.toFixed(1) : '',
      R.r20.ci ? R.r20.ci.hi.toFixed(1) : '',
    ]);
    rows.push([
      `RTI @ ${RTI_LIFE.r100} h`,
      R.r100.rti.toFixed(1),
      R.r100.ci ? R.r100.ci.lo.toFixed(1) : '',
      R.r100.ci ? R.r100.ci.hi.toFixed(1) : '',
    ]);
    rows.push([]);
    rows.push(['活化能 Ea（kJ/mol）', R.Ea.toFixed(1)]);
    rows.push(['50% 阈值（P₀×50%）', fmtSig(R.thr)]);
    downloadCSV(`RTI结果-${R.name}-${stamp()}.csv`, rows);
  };

  const stat = (k, v) => (
    <div className="rti-stat" key={k}>
      <b>{k}</b>
      <span>{v}</span>
    </div>
  );

  const ciText = (ci) =>
    ci ? `95%CI ${ci.lo.toFixed(1)} – ${ci.hi.toFixed(1)} °C` : '95%CI 不可得（温度点不足或置信带无交点）';

  return (
    <div className="tool-body">
      <div className="rti-stack">
        <section className="rti-sec">
          <h3 className="rti-sec-title">材料与各温度的老化数据</h3>

          <div className="rti-toolbar">
            <button type="button" className="btn btn-sm" onClick={onDemo}>
              填入示例
            </button>
            <button type="button" className="btn btn-sm" onClick={addTemp}>
              添加温度
            </button>
            <button type="button" className="btn btn-sm" onClick={onPaste}>
              粘贴导入
            </button>
            <button type="button" className="btn btn-sm btn-danger" onClick={onClear}>
              清空
            </button>
          </div>

          <div className="rti-fields">
            <div className="rti-field">
              <label className="rti-field-label" htmlFor="rti-name">
                材料名称
              </label>
              <div className="rti-field-body">
                <input
                  id="rti-name"
                  className="rti-input rti-input-wide"
                  type="text"
                  value={state.name}
                  placeholder="未命名材料"
                  onChange={(e) => setState((s) => ({ ...s, name: e.target.value }))}
                />
              </div>
            </div>

            <div className="rti-field">
              <label className="rti-field-label" htmlFor="rti-p0">
                初始特性值 P₀
              </label>
              <div className="rti-field-body">
                <NumberCell value={state.p0} onChange={(v) => setState((s) => ({ ...s, p0: v }))} />
                <span className="rti-hint">留空 = 取各温度里最早那些点的最大特性值</span>
              </div>
            </div>
          </div>

          <div className="rti-groups">
            {state.temps.map((g, ti) => (
              // 温度组按序号定位，用索引做 key
              <div className="rti-group" key={ti}>
                <div className="rti-group-head">
                  <span className="rti-group-label">老化温度 T</span>
                  <input
                    className="rti-input rti-input-temp"
                    type="text"
                    inputMode="decimal"
                    autoComplete="off"
                    spellCheck={false}
                    value={g.T ?? ''}
                    placeholder="°C"
                    aria-label={`第 ${ti + 1} 个温度组的老化温度`}
                    onChange={(e) => setTemp(ti, e.target.value)}
                  />
                  <span className="rti-group-meta">
                    {g.rows.length} 行 / {rowsOf(g)} 行有效
                  </span>
                  <span className="rti-toolbar-spring" />
                  <button type="button" className="btn btn-sm" onClick={() => addRow(ti)}>
                    加一行
                  </button>
                  <button type="button" className="btn btn-sm btn-danger" onClick={() => delTemp(ti)}>
                    删除温度
                  </button>
                </div>
                <div className="rti-group-body">
                  {g.rows.length === 0 ? (
                    <div className="rti-empty">
                      <b>这个温度还没有数据</b>点「加一行」，录进（时长, 特性值）序列。
                    </div>
                  ) : (
                    <div className="rti-table-wrap">
                      <table className="rti-table">
                        <thead>
                          <tr>
                            <th>#</th>
                            <th>老化时长 t（h）</th>
                            <th>特性值（绝对实测值）</th>
                            <th />
                          </tr>
                        </thead>
                        <tbody>
                          {g.rows.map((r, ri) => (
                            <tr key={ri}>
                              <td className="rti-td-idx">{ri + 1}</td>
                              <td>
                                <NumberCell value={r[0]} onChange={(v) => setCell(ti, ri, 0, v)} />
                              </td>
                              <td>
                                <NumberCell value={r[1]} onChange={(v) => setCell(ti, ri, 1, v)} />
                              </td>
                              <td className="rti-td-act">
                                <button
                                  type="button"
                                  className="rti-row-del"
                                  onClick={() => delRow(ti, ri)}
                                  title="删除该行"
                                  aria-label={`删除第 ${ri + 1} 行`}
                                >
                                  ✕
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>
            ))}
            {state.temps.length === 0 && (
              <div className="rti-empty">
                <b>还没有温度组</b>点「添加温度」，为每个老化温度录入（时长, 特性值）序列；
                至少 2 个温度，IEC 60216-1 建议 ≥3 个。
              </div>
            )}
          </div>

          <div className="rti-toolbar">
            <button type="button" className="btn btn-primary" onClick={onCalc}>
              推算 RTI
            </button>
            <span className="rti-toolbar-spring" />
            <span className="rti-hint">
              当前 {state.temps.length} 个温度组，其中 {usableTemps} 个填了温度值（需 ≥2，建议 ≥3 才有 95% 置信区间）
            </span>
          </div>
        </section>

        {out.error && (
          <ul className="rti-errors">
            <li>{out.error}</li>
          </ul>
        )}
        {out.warns.length > 0 && (
          <ul className="rti-warns">
            {out.warns.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        )}

        {result && (
          <>
            {out.stale && (
              <p className="rti-hint">上面的数据已经改过，下面这份结果还是上一次推算的。</p>
            )}
            <section className="rti-sec">
              <h3 className="rti-sec-title">各温度下的 t₅₀</h3>
              <div className="rti-table-wrap">
                <table className="rti-table">
                  <thead>
                    <tr>
                      <th>老化温度 T（°C）</th>
                      <th>t₅₀（h）</th>
                      <th>求法</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.perT.map((p) => (
                      <tr key={p.T}>
                        <td>{fmtTemp(p.T)}</td>
                        <td>
                          {fmtH(p.t50)} h{yearsOf(p.t50)}
                        </td>
                        <td>
                          {p.mode === 'interp'
                            ? `半对数内插（${fmtH(p.lo.t)} ↘ ${fmtH(p.hi.t)} h）`
                            : '趋势外推（置信度较低）'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <div className="rti-metrics">
              <div className="rti-metric">
                <span className="rti-metric-label">RTI · 寿命 {RTI_LIFE.r20.toLocaleString('en-US')} h</span>
                <span className="rti-metric-val">
                  {result.r20.rti.toFixed(1)}
                  <small> °C</small>
                </span>
                <span className="rti-metric-note">{ciText(result.r20.ci)}</span>
              </div>
              <div className="rti-metric">
                <span className="rti-metric-label">RTI · 寿命 {RTI_LIFE.r100.toLocaleString('en-US')} h</span>
                <span className="rti-metric-val">
                  {result.r100.rti.toFixed(1)}
                  <small> °C</small>
                </span>
                <span className="rti-metric-note">{ciText(result.r100.ci)}</span>
              </div>
            </div>

            <div className="rti-stats">
              {stat('活化能 Ea', `${result.Ea.toFixed(1)} kJ/mol`)}
              {stat('R²', result.r2.toFixed(5))}
              {stat('残差 s', result.s == null ? '—' : result.s.toFixed(5))}
              {stat('温度点 n', result.n)}
              {result.ciOk ? stat('自由度 df', result.df) : stat('自由度 df', '—')}
              {result.ciOk ? stat('t₀.₉₇₅', result.tc.toFixed(3)) : null}
            </div>

            <section className="rti-sec">
              <div className="rti-chart">
                <canvas ref={canvasRef} className="rti-canvas" />
                <p className="rti-chart-title">
                  图 2 · Arrhenius 图：t₅₀ ~ 1/T 回归、95% 置信带与 RTI 交点
                </p>
                <div className="rti-chart-tools">
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={() => downloadCanvasPNG(canvasRef.current, `图2-RTI-Arrhenius-${stamp()}.png`)}
                  >
                    保存 PNG
                  </button>
                  <button type="button" className="btn btn-sm" onClick={exportCSV}>
                    导出结果 CSV
                  </button>
                  <button type="button" className="btn btn-sm" onClick={onToCmp}>
                    加入多材料对比
                  </button>
                </div>
              </div>
            </section>
          </>
        )}

        <p className="rti-note">
          <b>怎么算的：</b>① 每个温度的 (时长, 特性值) 序列按 IEC 60216 终点时间方法求 t₅₀；
          ② 对 log₁₀ t₅₀ ~ 1/T(K) 做最小二乘回归，寿命达 L 小时的温度即 RTI；
          ③ 95% 置信区间 = 回归均值置信带 ±t₀.₉₇₅·s·√(1/n + (x−x̄)²/Sₓₓ)（df = 温度数 − 2）与水平线的交点；
          ④ 表观活化能 Ea = ln10 · R · b。本页算法与独立 Python 基准逐项对拍一致。
        </p>
      </div>
    </div>
  );
}
