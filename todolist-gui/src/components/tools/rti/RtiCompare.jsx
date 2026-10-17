// 多材料对比页 · 画布交互"
//
// 这一页保留原来的功能（录入各材料的温度-t₅₀、对数 Y、坐标范围、PNG 导出），
// 但把画布上**原本只写在说明里的手势摆到台面上**：
//   现状：悬停读值 / 点击固定 / 右键取消，全靠一段散文交代，右键还和系统菜单抢。
//   现在：光标旁常驻读数、固定后出现可见的「取消固定」按钮、再点已固定的同一处即取消，
//         彻底不用右键。
//
// 交互态（悬停/固定）刻意存在 ref 里而不是 React state：鼠标移动不该触发整棵子树
// 重渲染，重画一次画布就够了 —— 这也正是原独立工具的做法。chip 这类"要显示成 DOM"
// 的读数是例外，用 state（它的更新频率只跟"命中变化"有关，不是每次移动都变）。
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { cmpSeries, fmtH, fmtR2, normRange, toNum } from '../../../lib/rti/calc.js';
import { CMP_Y_TOP, cmpNearest, cmpValuesAt, drawCmpChart, palette, seriesStyle } from '../../../lib/rti/chart.js';
import { downloadCanvasPNG, stamp } from '../../../lib/rti/files.js';
import NumberCell from './NumberCell.jsx';

/** 两次命中是否指向同一处（用于"再点一次取消固定"） */
function sameHit(a, b) {
  return (
    a &&
    b &&
    a.si === b.si &&
    a.type === b.type &&
    a.pi === b.pi &&
    Math.abs((a.frac || 0) - (b.frac || 0)) < 0.001
  );
}

function CompareChart({ series, xRange, logY, onError }) {
  const canvasRef = useRef(null);
  const geomRef = useRef(null);
  const hoverRef = useRef(null);
  const pinnedRef = useRef(null);
  const [hoverChip, setHoverChip] = useState(null);
  const [pin, setPin] = useState(null);

  // 图表配色来自样式令牌，而令牌会跟着系统深浅色切换 —— 所以要监听一次偏好变化
  const [pal, setPal] = useState(palette);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const on = () => setPal(palette());
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);

  const redraw = useCallback(() => {
    const cv = canvasRef.current;
    if (!cv || series.length === 0) return;
    geomRef.current = drawCmpChart(cv, { series, xRange, logY, hover: hoverRef.current, pinned: pinnedRef.current, pal });
  }, [series, xRange, logY, pal]);

  // 事件监听只挂一次，始终走 ref 调最新版 redraw（避免闭包拿到旧数据）
  const redrawRef = useRef(redraw);
  useEffect(() => {
    redrawRef.current = redraw;
  }, [redraw]);

  // 数据 / 坐标 / 配色一变就重画，并把"已被画布判定失效"的命中清掉
  // （材料被删、坐标范围缩小都可能在用户没动手的情况下让某个固定点消失）
  useEffect(() => {
    redrawRef.current();
    const g = geomRef.current;
    if (!g) return;
    if (!g.pinned) {
      pinnedRef.current = null;
      setPin(null);
    }
    if (!g.hover) {
      hoverRef.current = null;
      setHoverChip(null);
    }
  }, [redraw]);

  useEffect(() => {
    window.addEventListener('resize', () => redrawRef.current());
    return () => window.removeEventListener('resize', () => redrawRef.current());
  }, []);

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
      const h = cmpNearest(geomRef.current, x, y);
      hoverRef.current = h;
      cv.classList.toggle('tool-canvas-hot', Boolean(h));
      redrawRef.current();
      setHoverChip(h ? { x: h.X, y: h.Y } : null);
    };
    const onLeave = () => {
      if (!geomRef.current) return;
      hoverRef.current = null;
      cv.classList.remove('tool-canvas-hot');
      redrawRef.current();
      setHoverChip(null);
    };
    const onClick = () => {
      if (!geomRef.current || !hoverRef.current) return;
      // 点已固定的同一处 = 取消固定（不用右键，也就不会和系统菜单抢）
      if (sameHit(pinnedRef.current, hoverRef.current)) {
        pinnedRef.current = null;
        setPin(null);
      } else {
        pinnedRef.current = hoverRef.current;
        setHoverChip(null);
        setPin({ x: hoverRef.current.X, y: hoverRef.current.Y });
      }
      redrawRef.current();
    };
    cv.addEventListener('mousemove', onMove);
    cv.addEventListener('mouseleave', onLeave);
    cv.addEventListener('click', onClick);
    return () => {
      cv.removeEventListener('mousemove', onMove);
      cv.removeEventListener('mouseleave', onLeave);
      cv.removeEventListener('click', onClick);
    };
  }, []);

  const cancelPin = () => {
    pinnedRef.current = null;
    setPin(null);
    redrawRef.current();
  };

  // 命中 → 可显示的读数。命中可能已经失效（材料/点被删），所以逐项校验过再返回。
  const readChip = (hit, at) => {
    const chart = geomRef.current;
    if (!chart || !hit) return null;
    const s = chart.series[hit.si];
    if (!s) return null;
    if (hit.type === 'fit' ? !s.fit : !s.pts[hit.pi]) return null;
    const v = cmpValuesAt(chart, hit);
    return { name: s.name, T: v.T, t: v.t, fit: hit.type === 'fit', r2: s.fit ? s.fit.r2 : null, X: at.x, Y: at.y };
  };

  const hoverInfo = hoverChip ? readChip(hoverRef.current, hoverChip) : null;
  const pinInfo = pin ? readChip(pinnedRef.current, pin) : null;

  return (
    <div className="tool-chart">
      <div className="tool-canvas-wrap">
        <canvas ref={canvasRef} className="tool-canvas" />
        {hoverInfo && !pinInfo && (
          <div className="tool-chip is-hover" style={{ left: hoverInfo.X, top: hoverInfo.Y }}>
            <b>{hoverInfo.name}</b>
            <span>T = {Math.round(hoverInfo.T)} °C</span>
            <span>
              t₅₀{hoverInfo.fit ? '（拟合）' : ''} = {fmtH(hoverInfo.t)} h
            </span>
          </div>
        )}
        {pinInfo && (
          <div className="tool-chip is-pin" style={{ left: pinInfo.X, top: pinInfo.Y }}>
            <b>{pinInfo.name}</b>
            <span>T = {Math.round(pinInfo.T)} °C · t₅₀ = {fmtH(pinInfo.t)} h</span>
            <span>已固定 · 沿水平线读其它材料</span>
          </div>
        )}
      </div>

      <p className="tool-chart-title">图 3 · 各材料 t₅₀ ~ 老化温度（虚线为 50,000 h 参考线）</p>

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
        <span className="tool-hint">
          悬停即读值 · 点击固定 · <b>再点一次</b>取消
        </span>
        <span className="tool-toolbar-spring" />
        {pinInfo && (
          <button type="button" className="btn btn-sm" onClick={cancelPin}>
            取消固定
          </button>
        )}
        <button type="button" className="btn btn-sm" onClick={() => downloadCanvasPNG(canvasRef.current, `图3-材料对比-${stamp()}.png`).catch((e) => onError(e))}>
          保存 PNG
        </button>
      </div>
    </div>
  );
}

export default function RtiCompare({ state, setState, onDemo, onClear, onPaste, onToast }) {
  const series = useMemo(() => cmpSeries(state.mats, state.logY), [state.mats, state.logY]);
  const xRange = useMemo(() => normRange(state.xMin, state.xMax), [state.xMin, state.xMax]);

  const patchMat = (mi, fn) => setState((s) => ({ ...s, mats: s.mats.map((m, j) => (j === mi ? fn(m) : m)) }));
  const setRow = (mi, ri, key, val) => patchMat(mi, (m) => ({ ...m, rows: m.rows.map((r, j) => (j === ri ? { ...r, [key]: val } : r)) }));
  const addRow = (mi) => patchMat(mi, (m) => ({ ...m, rows: [...m.rows, { T: '', t: '' }] }));
  const delRow = (mi, ri) => patchMat(mi, (m) => ({ ...m, rows: m.rows.filter((_, j) => j !== ri) }));
  const addMat = () =>
    setState((s) => ({
      ...s,
      mats: [
        ...s.mats,
        { name: `材料 ${String.fromCharCode(65 + (s.mats.length % 26))}`, rows: [{ T: '', t: '' }, { T: '', t: '' }, { T: '', t: '' }] },
      ],
    }));
  const delMat = (mi) => setState((s) => ({ ...s, mats: s.mats.filter((_, j) => j !== mi) }));

  const clipped = useMemo(() => series.reduce((n, s) => n + s.pts.filter((p) => p.t > CMP_Y_TOP).length, 0), [series]);
  const rangeDirty = xRange.min !== toNum(state.xMin) || xRange.max !== toNum(state.xMax);

  return (
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
            <div className="tool-group" key={mi}>
              <div className="tool-group-head">
                <span className="tool-group-label">材料名称</span>
                <input
                  className="tool-input tool-input-wide"
                  type="text"
                  value={m.name}
                  aria-label={`第 ${mi + 1} 种材料的名称`}
                  onChange={(e) => patchMat(mi, (mm) => ({ ...mm, name: e.target.value }))}
                />
                <span className="tool-group-meta">{m.rows.length} 个温度点</span>
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
                              <NumberCell value={r.T} onChange={(v) => setRow(mi, ri, 'T', v)} />
                            </td>
                            <td>
                              <NumberCell value={r.t} onChange={(v) => setRow(mi, ri, 't', v)} />
                            </td>
                            <td className="tool-td-act">
                              <button type="button" className="tool-row-del" onClick={() => delRow(mi, ri)} title="删除该行" aria-label={`删除第 ${ri + 1} 行`}>
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
              也可以在「耐热指数」页算出结果后直接「加入多材料对比」。
            </div>
          )}
        </div>

        <div className="tool-toolbar">
          <label className="tool-check">
            <input type="checkbox" checked={state.logY} onChange={(e) => setState((s) => ({ ...s, logY: e.target.checked }))} />
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
          <button type="button" className="btn btn-sm" onClick={() => setState((s) => ({ ...s, xMin: '60', xMax: '160' }))}>
            恢复默认
          </button>
        </div>
        {rangeDirty && <p className="tool-hint">输入的范围不完整或上下限颠倒，图里暂按 60–160 °C 显示；离开输入框会自动写回。</p>}
      </section>

      <section className="tool-sec">
        {series.length === 0 ? (
          <div className="tool-empty">
            <b>对比图会画在这里</b>上面录入各材料的（温度, t₅₀）后即刻成图；也可以在「耐热指数」页算出结果后直接「加入多材料对比」。
          </div>
        ) : (
          <>
            {clipped > 0 && (
              <ul className="tool-warns">
                <li>有 {clipped} 个数据点的 t₅₀ 超过 Y 轴上限 {fmtH(CMP_Y_TOP)} h，未显示在图中</li>
              </ul>
            )}
            <CompareChart
              series={series}
              xRange={xRange}
              logY={state.logY}
              onError={(err) => onToast && onToast(`保存图片失败：${(err && err.message) || err}`)}
            />
          </>
        )}
        <p className="tool-note">
          <b>怎么读这张图：</b>浅色实线是各材料在当前坐标下的最小二乘拟合，R² 越接近 1 说明实测点越接近直线；数据点用「颜色 +
          形状」双编码，黑白打印或色弱也能分辨。Y 轴上限固定 {fmtH(CMP_Y_TOP)} h，另有 50,000 h 虚线参考线。<b>悬停</b>
          即读值，<b>点击</b>固定后沿水平线读出其它材料的对应温度，<b>再点一次</b>取消。需要按 Arrhenius 关系外推并给出置信区间时，
          请到「耐热指数」页。
        </p>
      </section>
    </div>
  );
}
