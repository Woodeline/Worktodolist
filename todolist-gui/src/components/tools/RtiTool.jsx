// RTI 计算工具 —— 工具集里的第一个小工具，也是 ToolShell 骨架的第一个消费者。
//
// 由一份独立的单文件网页（RTI计算工具.html）移植而来，改动只发生在两侧：
//   · 视觉层：换成 todolist 的令牌体系（系统灰/系统蓝/发丝线/小方角），见 index.css 8.x
//   · 数据层：算法与画图抽到 lib/rti/（纯函数，可单测；数值与 Python 基准对拍一致）
// 功能与交互一律保留：粘贴导入、PNG / Excel 导出、本机自动保存、画布上的悬停读值 / 点击固定。
//
// v1.0.3「答案流」改造：原来是三个页签 —— 页 1 寿命推算、页 2 RTI 耐热指数、页 3 多材料对比 ——
// 各自录各自的数。问题是页 1 与页 2 用的本就是同一批多温度数据，用户得在两页之间来回搬；
// 而且每页都要先点一下「推算」才出结果，改一个数结果就悄悄变成"上一次的"。
// 现在：
//   · 页 1 并进页 2，只剩**两个页签**：耐热指数 / 多材料对比；
//   · 数据只有一份**扁平的 (温度, 时长, 特性值) 表**，温度组由温度推导出来（写在一起就自动成组），
//     原来页 1 那条衰减曲线成为"每个温度下的 t₅₀"表里的下钻视图；
//   · 结果实时重算 —— 没有「推算」按钮、没有 stale 提示，见 lib/rti/model.js 的 compute；
//   · 版式改成 workbench 单列：答案与 Arrhenius 图顶在最上面，录入区折在最后，需要时才展开。
//
// 存档键名仍是 todolist.tool.rti.v1。**不能升到 v2**：loadToolState 按
// todolist.tool.<id>.v<version> 取键，换了版本号，老用户那份 v1 数据会被当成"不存在"而丢失。
// 代价是 applyIn 要同时读懂两种形状：新版 { rti:{name,p0,rows}, cmp } 与旧版三页
// { life, rti:{name,p0,temps}, cmp }（旧数据交给 model.legacyRows 迁移）。
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DEFAULT_TEMP_RANGE, toNum } from '../../lib/rti/calc.js';
import { DEMO_CMP, DEMO_RTI, EMPTY_CMP } from '../../lib/rti/demo.js';
import { dataFromSheets, sheetsFromData } from '../../lib/rti/excel.js';
import { downloadXLSX, readArrayBuffer, stamp } from '../../lib/rti/files.js';
import { compute, emptyRows, legacyRows, rowsFromDemo } from '../../lib/rti/model.js';
import { readXlsx } from '../../lib/rti/xlsx.js';
import ToolShell from './ToolShell.jsx';
import { saveLabel, useRestoredState, useToolAutoSave, useToolPaste, useToolToast } from '../../hooks/useToolShell.js';
import RtiAnswer from './rti/RtiAnswer.jsx';
import RtiCompare from './rti/RtiCompare.jsx';
import RtiEntry from './rti/RtiEntry.jsx';

const TOOL_ID = 'rti';
const STATE_VERSION = 1;

const str = (x) => (x == null ? '' : String(x));
const isEmptyMat = (name) => !(name || '').trim();

const TABS = [
  { id: 'rti', label: '耐热指数' },
  { id: 'cmp', label: '多材料对比' },
];

/* ---------------------------------------------------------------------------
   落盘 / 回读
   ------------------------------------------------------------------------- */

/** 界面状态 → 存档状态（把输入字符串收敛成数字或 null） */
function toStorage(app) {
  return {
    rti: {
      name: app.name,
      p0: toNum(app.p0),
      rows: app.rows.map((r) => ({ T: toNum(r.T), t: toNum(r.t), v: toNum(r.v) })),
    },
    cmp: {
      mats: app.cmp.mats.map((m) => ({
        name: m.name,
        rows: m.rows.map((r) => ({ T: toNum(r.T), t: toNum(r.t) })),
      })),
      xMax: toNum(app.cmp.xMax),
      xMin: toNum(app.cmp.xMin),
      logY: app.cmp.logY,
    },
  };
}

/**
 * 存档状态 → 界面状态。**同时接纳新旧两种形状**：
 *   · 新版：rti.rows 已是扁平行，逐格转回字符串即可；
 *   · 旧版：rti.temps（多温度组）+ life（页 1 的单温度序列）交给 legacyRows 迁成扁平行。
 * 用一个显式判断区分，而不是"先试新版、抛异常再回退"：形状是摆在眼前的事实，不该靠猜。
 */
function applyIn(s) {
  const rti = (s && s.rti) || {};
  const cmp = (s && s.cmp) || {};
  const mats = Array.isArray(cmp.mats) ? cmp.mats : [];
  const rows = Array.isArray(rti.rows)
    ? rti.rows.map((r) => ({ T: str(r && r.T), t: str(r && r.t), v: str(r && r.v) }))
    : legacyRows(s && s.life, rti.temps);
  return {
    name: rti.name ?? '',
    p0: str(rti.p0),
    rows: rows.length ? rows : emptyRows(),
    cmp: {
      mats: mats.map((m) => ({
        name: String((m && m.name) ?? ''),
        rows: ((m && m.rows) || []).map((r) => ({ T: str(r && r.T), t: str(r && r.t) })),
      })),
      xMax: str(cmp.xMax ?? DEFAULT_TEMP_RANGE.max),
      xMin: str(cmp.xMin ?? DEFAULT_TEMP_RANGE.min),
      logY: cmp.logY !== false,
    },
  };
}

/** 存档结构校验（工具自己最清楚什么算合法）。新旧两种形状都算合法。 */
function isValidArchive(s) {
  if (!s || !s.rti || !s.cmp || !Array.isArray(s.cmp.mats)) return false;
  const newShape = Array.isArray(s.rti.rows);
  const legacyShape = Array.isArray(s.rti.temps) && s.life && Array.isArray(s.life.pts);
  return newShape || legacyShape;
}

/** 示例数据 → 界面状态（数字转字符串；四个温度组摊平成唯一那张扁平行表） */
function demoState() {
  return {
    name: DEMO_RTI.name,
    p0: str(DEMO_RTI.p0),
    rows: rowsFromDemo(DEMO_RTI),
    cmp: {
      mats: DEMO_CMP.mats.map((m) => ({
        name: m.name,
        rows: m.rows.map((r) => ({ T: str(r.T), t: str(r.t) })),
      })),
      xMax: str(DEMO_CMP.xMax),
      xMin: str(DEMO_CMP.xMin),
      logY: DEMO_CMP.logY,
    },
  };
}

export default function RtiTool() {
  // 首次挂载时读一次存档；读到了就用存档（可能是旧版三页数据，由 applyIn 迁移），
  // 没读到就载入示例。
  //
  // ⚠ useRestoredState 必须在**顶层**，不能把 useRestoredState 塞进 useState 的初始化器里：
  // 初始化器是在 mountState 内部被调用的，此时它往"正在挂载的 hook 链表"里再插一个
  // hook，链表就比后续渲染多出一节 —— 第二次渲染起整条链表错位，
  // useCallback / useEffect 会读到别的 hook 的状态，报出
  // "Cannot read properties of undefined (reading 'length')" 这种跟现场毫无关系的错。
  const saved = useRestoredState(TOOL_ID, STATE_VERSION, { isValid: isValidArchive });
  const [app, setApp] = useState(() => (saved ? applyIn(saved) : demoState()));

  const [pane, setPane] = useState('rti');
  // 录入区默认收起：打开工具第一眼该看到答案，而不是一张要滚很久的表。
  const [entryOpen, setEntryOpen] = useState(false);

  // 骨架提供的三件公共设施：toast / 粘贴弹窗 / 自动保存
  const { toast, showToast } = useToolToast();
  const { paste, open: openPaste } = useToolPaste(showToast);
  const { savedAt } = useToolAutoSave(TOOL_ID, STATE_VERSION, toStorage(app));

  // 「已从本机存档恢复」是持久提示（说清这份数据从哪来）。用户一动手改数据就该消失 ——
  // 它挂在 ToolShell 的提示行上，而不是 3.4 秒就消失的 toast。
  // 首次渲染必须放过：否则 mount 后的第一个 effect 就会把它抹掉，提示永远看不到。
  const [resumed, setResumed] = useState(Boolean(saved));
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    setResumed(false);
  }, [app]);

  /* --- 实时重算 ---------------------------------------------------------------
     数据一变结果就跟着变，所以是 useMemo 而不是 setState + 按钮。
     compute 内部只调不抛异常的纯函数（失败返回 { error }），每次按键都能安全调用；
     这也是"没有 stale 提示"的底气 —— 结果永远是当前数据的。 */
  const model = useMemo(() => compute(app.rows, app.name, app.p0), [app.rows, app.name, app.p0]);

  const setName = useCallback((v) => setApp((s) => ({ ...s, name: v })), []);
  const setP0 = useCallback((v) => setApp((s) => ({ ...s, p0: v })), []);
  const setRows = useCallback((fn) => setApp((s) => ({ ...s, rows: typeof fn === 'function' ? fn(s.rows) : fn })), []);
  const setCmp = useCallback((fn) => setApp((s) => ({ ...s, cmp: typeof fn === 'function' ? fn(s.cmp) : fn })), []);

  /* --- 跨页：把耐热指数页的答案送进对比页 ------------------------------------- */
  /** 一种材料（名称 + 若干 (T, t₅₀)）写进对比页：同名覆盖，新名追加。 */
  const upsertMat = (name, rows) =>
    setCmp((c) => {
      const i = c.mats.findIndex((m) => !isEmptyMat(m.name) && (m.name || '').trim() === name.trim());
      const mats = i >= 0 ? c.mats.map((m, j) => (j === i ? { ...m, rows } : m)) : [...c.mats, { name, rows }];
      return { ...c, mats };
    });

  const rtiToCmp = () => {
    const R = model.out.result;
    if (!R) {
      showToast('还没有结果，先填够 2 个老化温度再加对比');
      return;
    }
    const name = R.name.trim();
    upsertMat(name, R.perT.map((p) => ({ T: str(p.T), t: str(Math.round(p.t50 * 10) / 10) })));
    setPane('cmp');
    showToast(`已把「${name}」的 ${R.perT.length} 个温度点 t₅₀ 加入多材料对比`);
  };

  /* --- 粘贴导入（弹窗外壳由 ToolShell 渲染，这里只给解析规则） ------------------ */

  /**
   * 多温度数据：每行 T, t, v。
   * 同一温度的行**覆盖**表里已有的同温度行（"同名温度覆盖、新温度追加"，与旧版页 2 一致）；
   * 温度解析不出数字的行（用户填坏了的）原样保留 —— 粘贴不该顺手删掉用户没提到的内容。
   */
  const pasteRti = (rows) => {
    const parsed = [];
    let skip = 0;
    rows.forEach((r) => {
      if (r.length < 3) {
        skip += 1;
        return;
      }
      const T = toNum(r[0]);
      const t = toNum(r[1]);
      const v = toNum(r[2]);
      if (T == null || t == null || v == null || t <= 0) {
        skip += 1;
        return;
      }
      parsed.push({ T: String(T), t: String(t), v: String(v) });
    });
    if (!parsed.length) return null;

    const touched = new Set(parsed.map((p) => toNum(p.T)));
    setRows((rs) => [
      ...rs.filter((r) => {
        const T = toNum(r.T);
        return T == null || !touched.has(T);
      }),
      ...parsed,
    ]);
    return `已导入 ${parsed.length} 行，覆盖 ${touched.size} 个温度组${skip ? `，跳过 ${skip} 行` : ''}`;
  };

  /** 对比页数据：每行 材料名, 温度, t₅₀（三列）或 温度, t₅₀（两列，归入第一个材料）。 */
  const pasteCmp = (rows) => {
    const byName = new Map();
    let skip = 0;
    rows.forEach((r) => {
      let name = '';
      let T;
      let t;
      if (r.length >= 3) {
        name = (r[0] || '').trim();
        T = toNum(r[1]);
        t = toNum(r[2]);
      } else {
        T = toNum(r[0]);
        t = toNum(r[1]);
      }
      if (T == null || t == null || t <= 0) {
        skip += 1;
        return;
      }
      if (!byName.has(name)) byName.set(name, []);
      byName.get(name).push({ T: String(T), t: String(t) });
    });
    if (!byName.size) return null;

    let added = 0;
    let updated = 0;
    let total = 0;
    setCmp((c) => {
      const mats = c.mats.map((m) => ({ ...m, rows: m.rows.map((r) => ({ ...r })) }));
      byName.forEach((rs, name) => {
        total += rs.length;
        const matName = name || (mats.length ? (mats[0].name || '材料 A').trim() : '导入材料');
        const i = mats.findIndex((m) => (m.name || '').trim() === matName);
        if (i >= 0) {
          mats[i] = { ...mats[i], rows: rs };
          updated += 1;
        } else {
          mats.push({ name: matName, rows: rs });
          added += 1;
        }
      });
      return { ...c, mats };
    });
    return `已导入 ${total} 行（新增 ${added} 种材料、更新 ${updated} 种${skip ? `，跳过 ${skip} 行` : ''}）`;
  };

  /* --- 清空 / 示例 / 导出 / 导入 --------------------------------------------- */
  const clearRti = () => setApp((s) => ({ ...s, name: '', p0: '', rows: emptyRows() }));
  const demoRti = () => setApp((s) => ({ ...s, name: DEMO_RTI.name, p0: str(DEMO_RTI.p0), rows: rowsFromDemo(DEMO_RTI) }));
  const clearCmp = () => setCmp({ ...EMPTY_CMP, mats: [] });
  const demoCmp = () => setCmp(demoState().cmp);

  /** 一份数据直接落进界面（导入的两条通路 —— Excel 与老 JSON 备份 —— 共用） */
  const applyData = (s) => {
    setApp(applyIn(s));
    setResumed(false);
  };

  const exportData = async () => {
    const result = model.out.result;
    const saved = await downloadXLSX(`RTI工具数据-${stamp()}.xlsx`, sheetsFromData(toStorage(app), result));
    if (!saved) return; // 用户在「另存为」里取消了 —— 不报"已导出"，也不偷偷下载
    showToast(
      result
        ? '数据已导出为 Excel：耐热指数 / 推算结果 / 多材料对比 / 对比图设置 四张工作表'
        : '数据已导出为 Excel：耐热指数 / 多材料对比 / 对比图设置 三张工作表（还没有算得出结果）'
    );
  };

  /**
   * 导入。按**文件内容**判断格式，而不是看扩展名：
   *   · xlsx 是 ZIP（头 4 字节 PK\x03\x04）—— 现役格式；
   *   · 老版本导出的是 JSON 文本（以 { 开头）—— 继续读得懂，别让用户的旧备份作废。
   */
  const importData = async (input) => {
    try {
      const buf = await readArrayBuffer(input);
      if (!buf) return;
      const bytes = new Uint8Array(buf);

      if (bytes[0] === 0x7b) {
        const s = JSON.parse(new TextDecoder('utf-8').decode(bytes));
        if (!isValidArchive(s)) throw new Error('数据结构不匹配');
        applyData(s);
        showToast('数据已从 JSON 备份导入（结果按新数据实时算出）');
        return;
      }

      const data = dataFromSheets(readXlsx(bytes));
      if (!data || !isValidArchive(data)) throw new Error('没找到「耐热指数」工作表，请选本工具导出的 xlsx');
      applyData(data);
      showToast('数据已从 Excel 导入，结果按新数据实时算出');
    } catch (err) {
      showToast(`导入失败：${(err && err.message) || err}`);
    }
  };

  /* --- 两个页签 --------------------------------------------------------------- */
  const body =
    pane === 'cmp' ? (
      <RtiCompare
        state={app.cmp}
        setState={setCmp}
        onDemo={demoCmp}
        onClear={clearCmp}
        onPaste={() =>
          openPaste(
            '粘贴导入对比数据',
            '每行三列：材料名, 温度, t₅₀；或两列：温度, t₅₀（填入第一个材料）。相同材料名会覆盖原有数据点。',
            pasteCmp
          )
        }
        onToast={showToast}
      />
    ) : (
      <>
        <RtiAnswer model={model} onToCmp={rtiToCmp} onToast={showToast} />
        <RtiEntry
          open={entryOpen}
          onToggle={() => setEntryOpen((v) => !v)}
          name={app.name}
          setName={setName}
          p0={app.p0}
          setP0={setP0}
          rows={app.rows}
          setRows={setRows}
          onDemo={demoRti}
          onClear={clearRti}
          onPaste={() =>
            openPaste(
              '粘贴导入多温度数据',
              '每行三列：老化温度 T（°C）, 老化时长 t（h）, 特性值。相同温度会自动归到一组（同名温度覆盖，新温度追加）。也可以直接在录入表里 Ctrl+V 粘贴一块。',
              pasteRti
            )
          }
        />
      </>
    );

  return (
    <ToolShell
      layout="workbench"
      tabs={TABS}
      activeTab={pane}
      onTabChange={setPane}
      saveText={saveLabel(savedAt)}
      hint={resumed ? '已从本机存档恢复上次的数据；结果按当前数据实时算出。' : null}
      hintTone="info"
      actions={[{ label: '导出数据', title: '把当前数据与推算结果导出为 Excel 文件（.xlsx）', onClick: exportData }]}
      importAccept=".xlsx,.json,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/json"
      onImport={importData}
      importLabel="导入数据"
      toast={toast}
      paste={paste}
    >
      {body}
    </ToolShell>
  );
}
