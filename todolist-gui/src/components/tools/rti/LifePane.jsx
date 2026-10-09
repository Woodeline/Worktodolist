// 页 1 · 寿命推算：单个老化温度下的一条衰减序列 → t₅₀
//
// 这一页（以及另外两页）由外壳分两次渲染：part="in" 进左输入列，part="out" 进右结果列。
// 拆开的理由纯粹是版式：输入是窄而高的表单，结果是宽而高的图，并排放才装得进一屏。
// 两份实例的状态完全同源（都由 RtiTool 持有），画布的 ref / 事件只在 out 那一份里有值，
// 所以每次渲染两次也不会多画一遍图。
import { useEffect, useRef } from 'react';
import { fmtH, fmtTemp, fmtSig, toNum, yearsOf } from '../../../lib/rti/calc.js';
import { drawLifeChart } from '../../../lib/rti/chart.js';
import { downloadCanvasPNG, stamp } from '../../../lib/rti/files.js';
import NumberCell from './NumberCell.jsx';

export default function LifePane({ part = 'both', state, setState, out, onDemo, onClear, onPaste, onCalc, onToCmp }) {
  const canvasRef = useRef(null);
  const result = out.result;

  // 与 lib/rti/calc.js 用同一套解析规则统计"有几行真会被用上"，
  // 免得用户填了行却不知道为什么没算进去
  const usable = state.pts.filter((p) => toNum(p.t) > 0 && toNum(p.v) != null).length;

  useEffect(() => {
    if (canvasRef.current && result) drawLifeChart(canvasRef.current, result);
  }, [result]);

  // 画布是按像素画的，容器宽度变了必须重画（否则会被拉伸变形）
  useEffect(() => {
    if (!result) return undefined;
    const onResize = () => {
      if (canvasRef.current) drawLifeChart(canvasRef.current, result);
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [result]);

  const setRow = (i, key, value) =>
    setState((s) => ({ ...s, pts: s.pts.map((p, j) => (j === i ? { ...p, [key]: value } : p)) }));
  const addRow = () => setState((s) => ({ ...s, pts: [...s.pts, { t: '', v: '' }] }));
  const delRow = (i) => setState((s) => ({ ...s, pts: s.pts.filter((_, j) => j !== i) }));

  const savedPng = () =>
    downloadCanvasPNG(canvasRef.current, `图1-寿命推算-${stamp()}.png`);

  /* --- 左输入列：试验条件与数据 --- */
  const inputCol = (
    <div className="tool-stack">
      <section className="tool-sec">
        <h3 className="tool-sec-title">试验条件与数据</h3>

        <div className="tool-toolbar">
          <button type="button" className="btn btn-sm" onClick={onDemo}>
            填入示例
          </button>
          <button type="button" className="btn btn-sm" onClick={onPaste}>
            粘贴导入
          </button>
          <button type="button" className="btn btn-sm" onClick={addRow}>
            加一行
          </button>
          <button type="button" className="btn btn-sm btn-danger" onClick={onClear}>
            清空
          </button>
        </div>

        <div className="tool-fields">
          <div className="tool-field">
            <label className="tool-field-label" htmlFor="rti-life-name">
              材料名称
            </label>
            <div className="tool-field-body">
              <input
                id="rti-life-name"
                className="tool-input tool-input-wide"
                type="text"
                value={state.name}
                placeholder="未命名材料"
                onChange={(e) => setState((s) => ({ ...s, name: e.target.value }))}
              />
            </div>
          </div>

          <div className="tool-field">
            <label className="tool-field-label" htmlFor="rti-life-t">
              老化温度 T（°C）
            </label>
            <div className="tool-field-body">
              <input
                id="rti-life-t"
                className="tool-input"
                type="text"
                inputMode="decimal"
                autoComplete="off"
                value={state.T}
                onChange={(e) => setState((s) => ({ ...s, T: e.target.value }))}
              />
              <span className="tool-hint">只用于标注结果，不参与计算</span>
            </div>
          </div>

          <div className="tool-field">
            <label className="tool-field-label" htmlFor="rti-life-p0">
              初始特性值 P₀
            </label>
            <div className="tool-field-body">
              <input
                id="rti-life-p0"
                className="tool-input"
                type="text"
                inputMode="decimal"
                autoComplete="off"
                value={state.p0}
                onChange={(e) => setState((s) => ({ ...s, p0: e.target.value }))}
              />
              <span className="tool-hint">留空 = 取最早那个点的特性值</span>
            </div>
          </div>
        </div>

        <div className="tool-table-wrap">
          {state.pts.length === 0 ? (
            <div className="tool-empty">
              <b>还没有数据点</b>点「加一行」或「填入示例」，把每个老化时长对应的特性值录进来。
            </div>
          ) : (
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
                {state.pts.map((p, i) => (
                  // 行没有稳定标识（按序号定位是这张表的语义），所以用索引做 key
                  <tr key={i}>
                    <td className="tool-td-idx">{i + 1}</td>
                    <td>
                      <NumberCell value={p.t} onChange={(v) => setRow(i, 't', v)} />
                    </td>
                    <td>
                      <NumberCell value={p.v} onChange={(v) => setRow(i, 'v', v)} />
                    </td>
                    <td className="tool-td-act">
                      <button
                        type="button"
                        className="tool-row-del"
                        onClick={() => delRow(i)}
                        title="删除该行"
                        aria-label={`删除第 ${i + 1} 行`}
                      >
                        ✕
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* 主操作（推算 t₅₀）在页头工具条上，这里只留一行"几行有效"的实话 ——
            按钮钉在顶部，改完数据随手就能重算，不必再滚到底部找它 */}
        <p className="tool-hint">
          {state.pts.length === 0
            ? '至少需要 2 个有效数据点'
            : `共 ${state.pts.length} 行，其中 ${usable} 行有效（需要 ≥2 行；时长要大于 0、特性值不能为空）`}
        </p>
      </section>
    </div>
  );

  /* --- 右结果列：主数字 + 图 1 + 算法说明 --- */
  const outputCol = (
    <div className="tool-stack">
      {!result && !out.error && (
        <div className="tool-empty">
          <b>结果会出现在这一列</b>
          左边把数据录完、点「推算 t₅₀」，主要结果与图 1 就显示在这里 —— 输入与结果并排，改一个数就能立刻对照。
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
          <div className="tool-hero">
            <span className="tool-hero-label">
              {result.name}
              {result.T != null ? ` · T = ${fmtTemp(result.T)} °C` : ''} — 特性衰减至初始值的 50%
              （阈值 {fmtSig(result.thr)}）所需的老化时间 t₅₀
            </span>
            <span className="tool-hero-val">
              {fmtH(result.t50)}
              <small> h</small>
            </span>
            <span className="tool-hero-sub">
              {result.mode === 'interp'
                ? `半对数内插：${fmtH(result.lo.t)} h（${fmtSig(result.lo.v)}）↘ ${fmtH(result.hi.t)} h（${fmtSig(result.hi.v)}）`
                : `趋势外推：log₁₀ t₅₀ = (阈值 − a)/b = ${Math.log10(result.t50).toFixed(4)} · R² = ${result.fit.r2.toFixed(4)}`}
              {yearsOf(result.t50)}
            </span>
          </div>

          <section className="tool-sec">
            <div className="tool-chart">
              <canvas ref={canvasRef} className="tool-canvas" />
              <p className="tool-chart-title">
                图 1 · 特性值随老化时间的变化（对数时间轴）、50% 阈值线与 t₅₀ 交点
              </p>
              <div className="tool-chart-tools">
                <button type="button" className="btn btn-sm" onClick={savedPng}>
                  保存 PNG
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
        <b>怎么算的：</b>数据跨过 50% 阈值时，在 (log₁₀ t, 特性值) 平面跨阈两点间线性内插
        （IEC 60216-1 终点时间法）；没跨过时按「特性值 ~ log₁₀ t」回归外推，并在上方明确标注。
        外推结果的置信度不如内插，建议延长试验再验证。
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
