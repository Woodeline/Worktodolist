// 页 3 · 多材料对比：把各材料的（温度, t₅₀）画到一张图上比较耐热性能。
//
// 这个页面唯一复杂的地方是画布上的交互（悬停读值 / 点击固定 / 右键取消）。
// 交互状态刻意存在 ref 里而不是 React state：鼠标移动不该触发整棵子树的
// 重新渲染，重画一次画布就够了 —— 这也正是原独立工具的做法。
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { cmpSeries, fmtH, fmtR2, normRange, toNum } from '../../../lib/rti/calc.js';
import {
  CMP_Y_TOP,
  cmpNearest,
  cmpPinHit,
  drawCmpChart,
  palette,
  seriesStyle,
} from '../../../lib/rti/chart.js';
import { downloadCSV, downloadCanvasPNG, stamp } from '../../../lib/rti/files.js';
import NumberCell from './NumberCell.jsx';

export default function CmpPane({ part = 'both', state, setState, drawn, tick, onDemo, onClear, onPaste, onToast }) {
  const canvasRef = useRef(null);
  const geomRef = useRef(null);
  const hoverRef = useRef(null);
  const pinnedRef = useRef(null);

  // 材料组折叠：默认只展开第一种（记录"收起了哪些"，新加的材料天然是展开的）
  const [collapsed, setCollapsed] = useState(() => new Set(state.mats.map((_, i) => i).slice(1)));
  const toggleGroup = (mi) =>
    setCollapsed((s) => {
      const next = new Set(s);
      if (next.has(mi)) next.delete(mi);
      else next.add(mi);
      return next;
    });

  const series = useMemo(() => cmpSeries(state.mats, state.logY), [state.mats, state.logY]);
  const xRange = useMemo(() => normRange(state.xMin, state.xMax), [state.xMin, state.xMax]);
  const showChart = drawn && series.length > 0;

  // 图表颜色来自样式令牌，而令牌会跟着系统深浅色切换 —— 所以要监听一次偏好变化
  const [pal, setPal] = useState(palette);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const on = () => setPal(palette());
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);

  const redraw = useCallback(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    geomRef.current = drawCmpChart(cv, {
      series,
      xRange,
      logY: state.logY,
      hover: hoverRef.current,
      pinned: pinnedRef.current,
      pal,
    });
  }, [series, xRange, state.logY, pal]);

  // 事件监听只挂一次，始终走 ref 调最新版 redraw（避免闭包拿到旧数据）
  const redrawRef = useRef(redraw);
  useEffect(() => {
    redrawRef.current = redraw;
  }, [redraw]);

  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv) return undefined;
    const local = (e) => {
      const r = cv.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    const onMove = (e) => {
      if (!geomRef.current) return;
      const { x, y } = local(e);
      hoverRef.current = cmpNearest(geomRef.current, x, y);
      cv.classList.toggle('tool-canvas-hot', Boolean(hoverRef.current));
      redrawRef.current();
    };
    const onLeave = () => {
      if (!geomRef.current) return;
      hoverRef.current = null;
      cv.classList.remove('tool-canvas-hot');
      redrawRef.current();
    };
    const onClick = () => {
      if (!geomRef.current || !hoverRef.current) return;
      pinnedRef.current = hoverRef.current;
      redrawRef.current();
    };
    // 右键取消固定：只有点在固定点或辅助线附近才算"取消"，避免误触
    const onCtx = (e) => {
      if (!geomRef.current || !pinnedRef.current) return;
      const { x, y } = local(e);
      if (!cmpPinHit(geomRef.current, x, y)) return;
      e.preventDefault();
      pinnedRef.current = null;
      redrawRef.current();
    };
    cv.addEventListener('mousemove', onMove);
    cv.addEventListener('mouseleave', onLeave);
    cv.addEventListener('click', onClick);
    cv.addEventListener('contextmenu', onCtx);
    return () => {
      cv.removeEventListener('mousemove', onMove);
      cv.removeEventListener('mouseleave', onLeave);
      cv.removeEventListener('click', onClick);
      cv.removeEventListener('contextmenu', onCtx);
    };
  }, []);

  // 重画时机：初次显示、点了「画对比图」、坐标/范围变化、配色变化。
  // 故意**不**在数据逐格编辑时重画 —— 与原工具一致：图是"按下按钮那一刻"的快照，
  // 否则 Y 轴范围会随每次按键跳动。
  useEffect(() => {
    if (showChart) redrawRef.current();
  }, [showChart, tick, state.logY, state.xMin, state.xMax, pal]);

  useEffect(() => {
    const onResize = () => {
      if (showChart) redrawRef.current();
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [showChart]);

  const clipped = useMemo(
    () => series.reduce((n, s) => n + s.pts.filter((p) => p.t > CMP_Y_TOP).length, 0),
    [series]
  );

  /* --- 数据编辑 --- */
  const patchMat = (mi, patch) =>
    setState((s) => ({ ...s, mats: s.mats.map((m, j) => (j === mi ? { ...m, ...patch(m) } : m)) }));
  const setName = (mi, value) => patchMat(mi, () => ({ name: value }));
  const setCell = (mi, ri, key, value) =>
    patchMat(mi, (m) => ({ rows: m.rows.map((r, j) => (j === ri ? { ...r, [key]: value } : r)) }));
  const addRow = (mi) => patchMat(mi, (m) => ({ rows: [...m.rows, { T: '', t: '' }] }));
  const delRow = (mi, ri) => patchMat(mi, (m) => ({ rows: m.rows.filter((_, j) => j !== ri) }));
  const addMat = () =>
    setState((s) => ({
      ...s,
      mats: [
        ...s.mats,
        {
          name: `材料 ${String.fromCharCode(65 + (s.mats.length % 26))}`,
          rows: [{ T: '', t: '' }, { T: '', t: '' }, { T: '', t: '' }],
        },
      ],
    }));
  const delMat = (mi) => setState((s) => ({ ...s, mats: s.mats.filter((_, j) => j !== mi) }));

  // 「画对比图」的触发（置 drawn + 计数重画）搬到了页头工具条，由 RtiTool 持有：
  // 按钮钉在顶部，改完数据随手就能重画，不必滚到底部找它。

  const exportCSV = () => {
    const rows = [['材料', '老化温度 T（°C）', 't50（h）']];
    let n = 0;
    state.mats.forEach((m) =>
      m.rows.forEach((r) => {
        const T = toNum(r.T);
        const t = toNum(r.t);
        if (T != null && t > 0) {
          rows.push([m.name || '', T, t]);
          n += 1;
        }
      })
    );
    if (!n) return false;
    downloadCSV(`对比数据-${stamp()}.csv`, rows);
    return true;
  };

  const doExportCSV = () => {
    if (!exportCSV()) onToast('页 3 还没有可导出的数据行');
  };

  const rangeDirty = xRange.min !== toNum(state.xMin) || xRange.max !== toNum(state.xMax);

  const inputCol = (
    <div className="tool-stack">
        <section className="tool-sec">
          <h3 className="tool-sec-title">录入各材料的（温度, t₅₀）</h3>

          <div className="tool-toolbar">
            <button type="button" className="btn btn-sm" onClick={onDemo}>
              填入示例
            </button>
            <button type="button" className="btn btn-sm" onClick={addMat}>
              添加材料
            </button>
            <button type="button" className="btn btn-sm" onClick={onPaste}>
              粘贴导入
            </button>
            <button type="button" className="btn btn-sm btn-danger" onClick={onClear}>
              清空
            </button>
          </div>

          <div className="tool-groups">
            {state.mats.map((m, mi) => (
              <div className={'tool-group' + (collapsed.has(mi) ? ' is-collapsed' : '')} key={mi}>
                <div className="tool-group-head">
                  <button
                    type="button"
                    className="tool-group-toggle"
                    aria-expanded={!collapsed.has(mi)}
                    aria-label={`${collapsed.has(mi) ? '展开' : '收起'}第 ${mi + 1} 种材料`}
                    title={collapsed.has(mi) ? '展开这种材料' : '收起这种材料'}
                    onClick={() => toggleGroup(mi)}
                  >
                    <span className="tool-group-caret" aria-hidden="true" />
                  </button>
                  {/* 与温度组用同一个"组名"位：两组摞在一起时，输入框左边缘才落在同一条竖线上 */}
                  <span className="tool-group-label">材料名称</span>
                  <input
                    className="tool-input tool-input-wide"
                    type="text"
                    value={m.name}
                    aria-label={`第 ${mi + 1} 种材料的名称`}
                    onChange={(e) => setName(mi, e.target.value)}
                  />
                  <span className="tool-group-meta">
                    {m.rows.length} 个温度点
                  </span>
                  <span className="tool-group-acts">
                    <button type="button" className="btn btn-sm" onClick={() => addRow(mi)}>
                      加温度点
                    </button>
                    <button type="button" className="btn btn-sm btn-danger" onClick={() => delMat(mi)}>
                      删除材料
                    </button>
                  </span>
                </div>
                <div className="tool-group-body">
                  {m.rows.length === 0 ? (
                    <div className="tool-empty">
                      <b>这种材料还没有数据</b>点「加温度点」，填入温度与对应的 t₅₀。
                    </div>
                  ) : (
                    <div className="tool-table-wrap">
                      <table className="tool-table">
                        <thead>
                          <tr>
                            <th>#</th>
                            <th>老化温度 T（°C）</th>
                            <th>50% 特性老化时间 t₅₀（h）</th>
                            <th />
                          </tr>
                        </thead>
                        <tbody>
                          {m.rows.map((r, ri) => (
                            <tr key={ri}>
                              <td className="tool-td-idx">{ri + 1}</td>
                              <td>
                                <NumberCell value={r.T} onChange={(v) => setCell(mi, ri, 'T', v)} />
                              </td>
                              <td>
                                <NumberCell value={r.t} onChange={(v) => setCell(mi, ri, 't', v)} />
                              </td>
                              <td className="tool-td-act">
                                <button
                                  type="button"
                                  className="tool-row-del"
                                  onClick={() => delRow(mi, ri)}
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
            {state.mats.length === 0 && (
              <div className="tool-empty">
                <b>还没有材料</b>点「添加材料」，把每种材料的温度点和对应的 t₅₀ 填进来就能画对比图；
                也可以在页 1 / 页 2 算出结果后直接「加入多材料对比」。
              </div>
            )}
          </div>

          {/* 「画对比图」已钉到页头工具条上；这里只留下"图长什么样"的三个参数。
              它们属于图的属性，改一下就自动重画，不需要再回到按钮那儿去。 */}
          <div className="tool-toolbar">
            <label className="tool-check">
              <input
                type="checkbox"
                checked={state.logY}
                onChange={(e) => setState((s) => ({ ...s, logY: e.target.checked }))}
              />
              Y 轴对数坐标（t₅₀ 常跨好几个数量级）
            </label>
          </div>

          <div className="tool-fields">
            <div className="tool-field">
              <label className="tool-field-label" htmlFor="cmp-xmax">
                温度上限（°C）
              </label>
              <div className="tool-field-body">
                <input
                  id="cmp-xmax"
                  className="tool-input"
                  type="text"
                  inputMode="decimal"
                  value={state.xMax}
                  onChange={(e) => setState((s) => ({ ...s, xMax: e.target.value }))}
                  onBlur={() => setState((s) => ({ ...s, xMin: String(xRange.min), xMax: String(xRange.max) }))}
                />
              </div>
            </div>

            <div className="tool-field">
              <label className="tool-field-label" htmlFor="cmp-xmin">
                温度下限（°C）
              </label>
              <div className="tool-field-body">
                <input
                  id="cmp-xmin"
                  className="tool-input"
                  type="text"
                  inputMode="decimal"
                  value={state.xMin}
                  onChange={(e) => setState((s) => ({ ...s, xMin: e.target.value }))}
                  onBlur={() => setState((s) => ({ ...s, xMin: String(xRange.min), xMax: String(xRange.max) }))}
                />
              </div>
            </div>
          </div>

          <div className="tool-toolbar">
            <span className="tool-toolbar-spring" />
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => setState((s) => ({ ...s, xMin: '60', xMax: '160' }))}
            >
              恢复默认
            </button>
          </div>
          {rangeDirty && (
            <p className="tool-hint">
              输入的范围不完整或上下限颠倒，图里暂按 60–160 °C 显示；离开输入框会自动写回。
            </p>
          )}
        </section>
    </div>
  );

  const outputCol = (
    <div className="tool-stack">
      {!showChart && !drawn && (
        <div className="tool-empty">
          <b>对比图会画在这一列</b>
          左边录入各材料的（温度, t₅₀）后点「画对比图」；也可以在页 1 / 页 2 算出结果后直接「加入多材料对比」。
        </div>
      )}

      {drawn && series.length === 0 && (
          <ul className="tool-errors">
            <li>还没有可用数据：每种材料至少要有 1 组（温度, t₅₀）记录</li>
          </ul>
        )}
        {drawn && clipped > 0 && (
          <ul className="tool-warns">
            <li>有 {clipped} 个数据点的 t₅₀ 超过 Y 轴上限 {fmtH(CMP_Y_TOP)} h，未显示在图中</li>
          </ul>
        )}

        {showChart && (
          <section className="tool-sec">
            <div className="tool-chart">
              <canvas ref={canvasRef} className="tool-canvas" />
              <p className="tool-chart-title">
                图 3 · 各材料 t₅₀ 随温度的变化（浅色实线 = 最小二乘拟合；点形状按材料区分）
              </p>
              <div className="tool-legend">
                {series.map((s) => {
                  const st = seriesStyle(s.index);
                  const col = pal.series[st.slot];
                  return (
                    <span className="tool-legend-item" key={s.name + s.index}>
                      <span className="tool-legend-swatch" style={{ background: col }} />
                      <b className="tool-legend-glyph" style={{ color: col }}>
                        {st.glyph}
                      </b>
                      {s.name}
                      {s.fit && s.fit.r2 != null && <em className="tool-legend-r2">R²={fmtR2(s.fit.r2)}</em>}
                    </span>
                  );
                })}
              </div>
              <div className="tool-chart-tools">
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() => downloadCanvasPNG(canvasRef.current, `图3-材料对比-${stamp()}.png`)}
                >
                  保存 PNG
                </button>
                <button type="button" className="btn btn-sm" onClick={doExportCSV}>
                  导出数据 CSV
                </button>
              </div>
            </div>
          </section>
        )}

        <p className="tool-note">
          <b>怎么读这张图：</b>
          浅色实线是各材料在当前坐标下的最小二乘拟合，R² 越接近 1 说明实测点越接近直线；
          数据点用「颜色 + 形状」双编码，黑白打印或色弱也能分辨。
          Y 轴上限固定 {fmtH(CMP_Y_TOP)} h，另有 50,000 h 虚线参考线。
          <b>悬停</b>可沿趋势读值，<b>点击</b>固定后会在 X 轴上方标出该寿命下各材料对应的温度，
          <b>右键</b>单击固定点取消。需要按 Arrhenius 关系外推并给出置信区间时，请到「RTI 耐热指数」页。
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
