// 页 2 · RTI 耐热指数：多温度 t₅₀ → Arrhenius 外推 → RTI / 95%CI / 活化能
//
// 与页 1 同样由外壳分两次渲染：part="in" 是左输入列（温度组表单），
// part="out" 是右结果列（各温度 t₅₀ 表 / RTI 指标 / Arrhenius 图）。
import { useEffect, useRef, useState } from 'react';
import { RTI_LIFE, fmtH, fmtSig, fmtTemp, toNum, yearsOf } from '../../../lib/rti/calc.js';
import { drawRtiChart } from '../../../lib/rti/chart.js';
import { downloadCSV, downloadCanvasPNG, stamp } from '../../../lib/rti/files.js';
import NumberCell from './NumberCell.jsx';

export default function RtiPane({ part = 'both', state, setState, out, onDemo, onClear, onPaste, onCalc, onToCmp }) {
  const canvasRef = useRef(null);
  const result = out.result;

  // 温度组折叠：默认只展开第一组。
  // 记录的是"收起了哪些"而不是"展开了哪些" —— 这样新加的温度组天然是展开的，
  // 用户刚点完「添加温度」就能直接录数，不用再去把它点开。
  const [collapsed, setCollapsed] = useState(() => new Set(state.temps.map((_, i) => i).slice(1)));
  const toggleGroup = (ti) =>
    setCollapsed((s) => {
      const next = new Set(s);
      if (next.has(ti)) next.delete(ti);
      else next.add(ti);
      return next;
    });

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
    <div className="tool-stat" key={k}>
      <b>{k}</b>
      <span>{v}</span>
    </div>
  );

  const ciText = (ci) =>
    ci ? `95%CI ${ci.lo.toFixed(1)} – ${ci.hi.toFixed(1)} °C` : '95%CI 不可得（温度点不足或置信带无交点）';

  const inputCol = (
    <div className="tool-stack">
        <section className="tool-sec">
          <h3 className="tool-sec-title">材料与各温度的老化数据</h3>

          <div className="tool-toolbar">
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

          <div className="tool-fields">
            <div className="tool-field">
              <label className="tool-field-label" htmlFor="rti-name">
                材料名称
              </label>
              <div className="tool-field-body">
                <input
                  id="rti-name"
                  className="tool-input tool-input-wide"
                  type="text"
                  value={state.name}
                  placeholder="未命名材料"
                  onChange={(e) => setState((s) => ({ ...s, name: e.target.value }))}
                />
              </div>
            </div>

            <div className="tool-field">
              <label className="tool-field-label" htmlFor="rti-p0">
                初始特性值 P₀
              </label>
              <div className="tool-field-body">
                <NumberCell value={state.p0} onChange={(v) => setState((s) => ({ ...s, p0: v }))} />
                <span className="tool-hint">留空 = 取各温度里最早那些点的最大特性值</span>
              </div>
            </div>
          </div>

          <div className="tool-groups">
            {state.temps.map((g, ti) => (
              // 温度组按序号定位，用索引做 key
              <div className={'tool-group' + (collapsed.has(ti) ? ' is-collapsed' : '')} key={ti}>
                <div className="tool-group-head">
                  <button
                    type="button"
                    className="tool-group-toggle"
                    aria-expanded={!collapsed.has(ti)}
                    aria-label={`${collapsed.has(ti) ? '展开' : '收起'}第 ${ti + 1} 个温度组`}
                    title={collapsed.has(ti) ? '展开这一组' : '收起这一组'}
                    onClick={() => toggleGroup(ti)}
                  >
                    <span className="tool-group-caret" aria-hidden="true" />
                  </button>
                  <span className="tool-group-label">老化温度 T</span>
                  <input
                    className="tool-input tool-input-temp"
                    type="text"
                    inputMode="decimal"
                    autoComplete="off"
                    spellCheck={false}
                    value={g.T ?? ''}
                    placeholder="°C"
                    aria-label={`第 ${ti + 1} 个温度组的老化温度`}
                    onChange={(e) => setTemp(ti, e.target.value)}
                  />
                  <span className="tool-group-meta">
                    {g.rows.length} 行 / {rowsOf(g)} 行有效
                  </span>
                  <span className="tool-group-acts">
                    <button type="button" className="btn btn-sm" onClick={() => addRow(ti)}>
                      加一行
                    </button>
                    <button type="button" className="btn btn-sm btn-danger" onClick={() => delTemp(ti)}>
                      删除温度
                    </button>
                  </span>
                </div>
                <div className="tool-group-body">
                  {g.rows.length === 0 ? (
                    <div className="tool-empty">
                      <b>这个温度还没有数据</b>点「加一行」，录进（时长, 特性值）序列。
                    </div>
                  ) : (
                    <div className="tool-table-wrap">
                      <table className="tool-table">
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
                              <td className="tool-td-idx">{ri + 1}</td>
                              <td>
                                <NumberCell value={r[0]} onChange={(v) => setCell(ti, ri, 0, v)} />
                              </td>
                              <td>
                                <NumberCell value={r[1]} onChange={(v) => setCell(ti, ri, 1, v)} />
                              </td>
                              <td className="tool-td-act">
                                <button
                                  type="button"
                                  className="tool-row-del"
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
              <div className="tool-empty">
                <b>还没有温度组</b>点「添加温度」，为每个老化温度录入（时长, 特性值）序列；
                至少 2 个温度，IEC 60216-1 建议 ≥3 个。
              </div>
            )}
          </div>

          {/* 主操作（推算 RTI）在页头工具条上，这里只留一行实时统计 —— 
              按钮钉在顶部，改完任何一个格子都能立刻推算，不必再滚到底部 */}
          <p className="tool-hint">
            当前 {state.temps.length} 个温度组，其中 {usableTemps} 个填了温度值（需 ≥2，建议 ≥3 才有 95% 置信区间）
          </p>
        </section>
    </div>
  );

  const outputCol = (
    <div className="tool-stack">
      {!result && !out.error && (
        <div className="tool-empty">
          <b>结果会出现在这一列</b>
          左边把各温度的数据录完、点「推算 RTI」，RTI、95% 置信区间、活化能与图 2 就显示在这里。
        </div>
      )}

      {out.error && (
          <ul className="tool-errors">
            <li>{out.error}</li>
          </ul>
        )}
        {out.warns.length > 0 && (
          <ul className="tool-warns">
            {out.warns.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        )}

        {result && (
          <>
            {out.stale && (
              <p className="tool-hint">上面的数据已经改过，下面这份结果还是上一次推算的。</p>
            )}
            <section className="tool-sec">
              <h3 className="tool-sec-title">各温度下的 t₅₀</h3>
              <div className="tool-table-wrap">
                <table className="tool-table">
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

            <div className="tool-metrics">
              <div className="tool-metric">
                <span className="tool-metric-label">RTI · 寿命 {RTI_LIFE.r20.toLocaleString('en-US')} h</span>
                <span className="tool-metric-val">
                  {result.r20.rti.toFixed(1)}
                  <small> °C</small>
                </span>
                <span className="tool-metric-note">{ciText(result.r20.ci)}</span>
              </div>
              <div className="tool-metric">
                <span className="tool-metric-label">RTI · 寿命 {RTI_LIFE.r100.toLocaleString('en-US')} h</span>
                <span className="tool-metric-val">
                  {result.r100.rti.toFixed(1)}
                  <small> °C</small>
                </span>
                <span className="tool-metric-note">{ciText(result.r100.ci)}</span>
              </div>
            </div>

            <div className="tool-stats">
              {stat('活化能 Ea', `${result.Ea.toFixed(1)} kJ/mol`)}
              {stat('R²', result.r2.toFixed(5))}
              {stat('残差 s', result.s == null ? '—' : result.s.toFixed(5))}
              {stat('温度点 n', result.n)}
              {result.ciOk ? stat('自由度 df', result.df) : stat('自由度 df', '—')}
              {result.ciOk ? stat('t₀.₉₇₅', result.tc.toFixed(3)) : null}
            </div>

            <section className="tool-sec">
              <div className="tool-chart">
                <canvas ref={canvasRef} className="tool-canvas" />
                <p className="tool-chart-title">
                  图 2 · Arrhenius 图：t₅₀ ~ 1/T 回归、95% 置信带与 RTI 交点
                </p>
                <div className="tool-chart-tools">
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

        <p className="tool-note">
          <b>怎么算的：</b>① 每个温度的 (时长, 特性值) 序列按 IEC 60216 终点时间方法求 t₅₀；
          ② 对 log₁₀ t₅₀ ~ 1/T(K) 做最小二乘回归，寿命达 L 小时的温度即 RTI；
          ③ 95% 置信区间 = 回归均值置信带 ±t₀.₉₇₅·s·√(1/n + (x−x̄)²/Sₓₓ)（df = 温度数 − 2）与水平线的交点；
          ④ 表观活化能 Ea = ln10 · R · b。本页算法与独立 Python 基准逐项对拍一致。
        </p>
    </div>
  );

  if (part === 'in') return inputCol;
  if (part === 'out') return outputCol;
  return (
    <>
      {inputCol}
      {outputCol}
    </>
  );
}
