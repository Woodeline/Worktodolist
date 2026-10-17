// 数据录入（折叠区）：一张扁平表就是唯一入口 —— 温度、时长、特性值三列。
//
// 三处交互是这一版的重点：
//   ① **表格即输入**：不再有"温度卡 + 组内小表"两层结构，写在一起就自动成一组；
//   ② **键盘录入**：Enter 下移到同一列的下一行（末行自动补一行），↑ / ↓ 在列内移动，Tab 走默认顺序；
//   ③ **直接粘贴**：从 Excel 框一段（制表符分隔）直接 Ctrl+V 落到当前格，整块铺开。
//
// 数据一律以**字符串**存在表单里（与 calc.js 的 toNum 约定一致）：
// 受控的 number 输入会在 "76." 这种中间态吞掉小数点，所以用 text + inputMode="decimal"。
import { useEffect, useRef, useState } from 'react';

const COLS = ['T', 't', 'v'];
const COL_LABEL = { T: '老化温度 T（°C）', t: '老化时长 t（h）', v: '特性值' };

/** 一行剪贴板文本 → 单元格数组：制表符 → 逗号 → 空白，逐级容错 */
function splitCells(line) {
  if (line.includes('\t')) return line.split('\t').map((s) => s.trim());
  if (line.includes(',')) return line.split(',').map((s) => s.trim());
  return line.trim().split(/\s+/);
}

function GridEditor({ rows, setRows }) {
  const wrapRef = useRef(null);
  const [focus, setFocus] = useState(null);

  // 光标是"命令"：设一个目标格，effect 里把它聚焦并全选。
  // 全选是为了让"贴完接着敲"直接覆盖，而不是插在旧值前面。
  useEffect(() => {
    if (focus == null) return;
    const el = wrapRef.current && wrapRef.current.querySelector(`[data-cell="${focus}"]`);
    if (el) {
      el.focus();
      if (el.select) el.select();
    }
    setFocus(null);
  }, [focus]);

  const setCell = (i, k, v) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  const insertRow = (at) =>
    setRows((rs) => {
      const n = rs.slice();
      n.splice(at, 0, { T: '', t: '', v: '' });
      return n;
    });
  const delRow = (i) => setRows((rs) => rs.filter((_, j) => j !== i));

  const onKeyDown = (i, k) => (e) => {
    const ci = COLS.indexOf(k);
    if (e.key === 'Enter') {
      e.preventDefault();
      if (i === rows.length - 1) {
        insertRow(rows.length);
        setFocus(rows.length * 3 + ci);
      } else {
        setFocus((i + 1) * 3 + ci);
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setFocus(Math.min(rows.length - 1, i + 1) * 3 + ci);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setFocus(Math.max(0, i - 1) * 3 + ci);
    }
  };

  // 直接从剪贴板铺开：Excel 里框一段 T,t,v → Ctrl+V 落到当前格
  const onPaste = (i, k) => (e) => {
    const text = e.clipboardData.getData('text');
    if (!text) return;
    const lines = text.replace(/\r/g, '').split('\n').filter((l) => l.trim() !== '');
    if (lines.length === 0) return;
    const grid = lines.map(splitCells);
    if (grid.length === 1 && grid[0].length === 1) return; // 单格 → 走浏览器默认粘贴
    e.preventDefault();
    const startCol = COLS.indexOf(k);
    setRows((rs) => {
      const next = rs.map((r) => ({ ...r }));
      grid.forEach((cells, dr) => {
        const ri = i + dr;
        while (next.length <= ri) next.push({ T: '', t: '', v: '' });
        cells.forEach((val, dc) => {
          const ci = startCol + dc;
          if (ci < COLS.length) next[ri][COLS[ci]] = val;
        });
      });
      return next;
    });
    setFocus((i + grid.length - 1) * 3 + Math.min(2, startCol + grid[0].length - 1));
  };

  const isGroupStart = (i) => i === 0 || (rows[i - 1].T || '').trim() !== (rows[i].T || '').trim();

  if (rows.length === 0) {
    return (
      <div className="tool-empty">
        <b>还没有数据</b>点「填入示例」，或直接在这里粘贴一块（温度、时长、特性值，每行一组）。
      </div>
    );
  }

  return (
    <div className="tool-table-wrap" ref={wrapRef}>
      <table className="tool-table tool-grid">
        <thead>
          <tr>
            <th>#</th>
            <th>老化温度 T（°C）</th>
            <th>老化时长 t（h）</th>
            <th>特性值</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className={isGroupStart(i) ? 'tool-group-start' : ''}>
              <td className="tool-td-idx">{i + 1}</td>
              {COLS.map((k, ci) => (
                <td key={k}>
                  <input
                    data-cell={i * 3 + ci}
                    className="tool-input"
                    type="text"
                    inputMode="decimal"
                    autoComplete="off"
                    spellCheck={false}
                    value={r[k]}
                    aria-label={`第 ${i + 1} 行 · ${COL_LABEL[k]}`}
                    onChange={(e) => setCell(i, k, e.target.value)}
                    onKeyDown={onKeyDown(i, k)}
                    onPaste={onPaste(i, k)}
                  />
                </td>
              ))}
              <td className="tool-td-act">
                <button type="button" className="tool-row-del" onClick={() => delRow(i)} title="删除该行" aria-label={`删除第 ${i + 1} 行`}>
                  ✕
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="tool-hint tool-grid-hint">
        平均一行 = 温度 / 时长 / 特性值 · <b>Enter</b> 下一行（末行自动加）· <b>Tab</b> 下一格 · 直接粘贴 Excel 区块
      </p>
    </div>
  );
}

export default function RtiEntry({ open, onToggle, name, setName, p0, setP0, rows, setRows, onDemo, onClear, onPaste }) {
  return (
    <section className="tool-sec">
      <div className="tool-toolbar">
        <h3 className="tool-sec-title">录入 / 粘贴数据</h3>
        <span className="tool-toolbar-spring" />
        <button type="button" className="btn btn-sm" onClick={onToggle}>
          {open ? '收起' : '展开'}
        </button>
      </div>
      {open && (
        <>
          <div className="tool-toolbar">
            <button type="button" className="btn btn-sm" onClick={onDemo}>
              填入示例
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
                  value={name}
                  placeholder="未命名材料"
                  onChange={(e) => setName(e.target.value)}
                />
              </div>
            </div>

            <div className="tool-field">
              <label className="tool-field-label" htmlFor="rti-p0">
                初始特性值 P₀
              </label>
              <div className="tool-field-body">
                <input
                  id="rti-p0"
                  className="tool-input"
                  type="text"
                  inputMode="decimal"
                  autoComplete="off"
                  spellCheck={false}
                  value={p0}
                  onChange={(e) => setP0(e.target.value)}
                />
                <span className="tool-hint">留空 = 取各温度里最早那些点的最大特性值</span>
              </div>
            </div>
          </div>

          <GridEditor rows={rows} setRows={setRows} />
        </>
      )}
    </section>
  );
}
