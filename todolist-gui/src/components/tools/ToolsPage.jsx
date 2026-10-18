// 工具集外壳：两态 —— 目录态（工具墙）与工作态（当前工具的工作区）。
//
// 这个组件刻意"什么都不知道"：它不认识 RTI，也不认识后面加进来的任何工具。
// 它只读 registry、渲染清单（目录态委托给 ToolsWall）、把选中的那个组件挂上去，
// 外加三件外壳职责：
//   ① 只读投影（snapshot）经它透传 —— 工具拿不到 store，也就没有写入口；
//   ② 提议确认通道（只有 capabilities.writes 授权的工具能拿到 propose）；
//   ③ 崩溃隔离 + 打开/导出这类动作写进会话事件线。
// 于是"继续添加更多工具"不会让它变大：新增工具只改 registry。
//
// 两态的边界：
//   mode='wall'  只渲染 ToolsWall（分组卡片网格 + 搜索 + 收藏/MRU）；
//   mode='tool'  渲染页头（返回 + 面包屑 + 风险徽标）与工具本体，
//                本体部分与改造前一致 —— ToolBoundary / Suspense /
//                懒加载缓存 / propose / logEvent 全部原样。
//   对话页路由（request.id）直达工作态，不经过墙；Esc 或「← 工具集」回墙。
import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { canWrite, findTool, riskBadges, visibleTools } from './registry.js';
import ToolsWall from './ToolsWall.jsx';
import ToolBoundary from './ToolBoundary.jsx';
import ProposalModal from '../ProposalModal.jsx';
import Icon from '../Icon.jsx';
import { dispatch } from '../../lib/actions.js';
import { proposalToIntent } from '../../lib/proposals.js';
import { logToolEvent } from '../../lib/toolEvents.js';
import { loadToolMeta, saveToolMeta, toggleFavorite, touchMru } from '../../lib/toolStorage.js';

// 懒加载组件必须保持稳定的标识，否则每次渲染 React 都会当成新组件、重新挂载
// （状态全丢）。所以按 id 缓存，绝不在渲染里现调 lazy()。
const LAZY = new Map();
function lazyFor(tool) {
  if (!LAZY.has(tool.id)) LAZY.set(tool.id, lazy(tool.load));
  return LAZY.get(tool.id);
}

export default function ToolsPage({ snapshot, store, request }) {
  const list = useMemo(() => visibleTools(), []);
  const [activeId, setActiveId] = useState(
    () => (findTool(request && request.id) ? request.id : list[0] && list[0].id) || null
  );
  // 目录态是"家"：刷新回落在这里；只有带 request.id（对话页路由 / QA 直达视图）
  // 才一进来就在工作态。
  const [mode, setMode] = useState(() =>
    request && request.id && findTool(request.id) ? 'tool' : 'wall'
  );
  const [meta, setMeta] = useState(() => loadToolMeta());
  const [pending, setPending] = useState(null);
  const [busy, setBusy] = useState(false);
  const [params, setParams] = useState(null);

  const paneRef = useRef(null);
  const consumedSeq = useRef(0);

  const active = useMemo(() => findTool(activeId) || null, [activeId]);
  const Active = active ? lazyFor(active) : null;
  const handleRef = useRef(null);
  handleRef.current = store && store.dirHandleRef ? store.dirHandleRef.current : null;

  /* --- 元数据（最近使用 / 收藏）：写 localStorage，属于墙的排序，不是新页面 --- */
  const persistMeta = useCallback((next) => {
    saveToolMeta(next);
    return next;
  }, []);

  const rememberUse = useCallback(
    (id) => setMeta((m) => persistMeta(touchMru(m, id))),
    [persistMeta]
  );

  const toggleFav = useCallback(
    (id) => setMeta((m) => persistMeta(toggleFavorite(m, id))),
    [persistMeta]
  );

  const logEvent = useCallback(async (type, payload) => {
    await logToolEvent(handleRef.current, type, payload, snapshot && snapshot.today);
  }, [snapshot]);

  const activate = useCallback(
    (id, source) => {
      setActiveId(id);
      setMode('tool');
      setParams(null);
      rememberUse(id);
      logEvent('tool.open', { toolId: id, source });
    },
    [logEvent, rememberUse]
  );

  const backToWall = useCallback(() => setMode('wall'), []);

  // 切页后聚焦：目标组件要等设置页卸载 / Suspense 解析完才挂载，
  // 所以按帧重试（沿用「切页后聚焦」的既有做法），不是只等一次 setTimeout。
  const focusFirstField = useCallback(() => {
    const tryFocus = (left) => {
      const el = paneRef.current && paneRef.current.querySelector('.tool-input, .tool-textarea');
      if (el && typeof el.focus === 'function') {
        el.focus();
        return;
      }
      if (left > 0) requestAnimationFrame(() => tryFocus(left - 1));
    };
    requestAnimationFrame(() => tryFocus(4));
  }, []);

  // 对话页路由进来（tool.open）：切到指定工具 + 预填参数 + 聚焦。
  // 用 seq 去重：同一次请求只消费一次，React 重渲染不会重复触发。
  useEffect(() => {
    if (!request || !request.id) return;
    if (request.seq === consumedSeq.current) return;
    consumedSeq.current = request.seq;
    if (findTool(request.id)) {
      setActiveId(request.id);
      setMode('tool');
      rememberUse(request.id);
    }
    setParams(request.params ? { ...request.params } : null);
    logEvent('tool.open', { toolId: request.id, source: 'chat' });
    focusFirstField();
  }, [request, rememberUse, logEvent, focusFirstField]);

  /* --- 提议确认通道 --- */
  const propose = useMemo(() => (canWrite(active) ? (p) => setPending(p) : null), [active]);

  /* --- 文件访问通道已随 T2 工具一并移除 ---
     原先这里按 capabilities.files 注入 createFilesApi(dirHandle)。现清单里已无
     files 消费者，故整条通道撤掉：外壳少一个注入点，工具也少一个可获得的能力。
     将来若重新引入读盘工具，把这条通道连同 lib/filePicker.js 一起加回即可。 */

  const confirmProposal = useCallback(() => {
    if (!pending || busy) return;
    const intent = proposalToIntent(pending);
    if (!intent) {
      setPending(null);
      return;
    }
    setBusy(true);
    let result;
    try {
      // 执行路径与对话页完全一致：同一张 ACTIONS 表，不新增旁路。
      result = dispatch(intent, {
        store,
        tasks: (snapshot && snapshot.tasks) || [],
        today: snapshot && snapshot.today,
      });
    } catch (err) {
      result = { ok: false, reply: `执行出错：${(err && err.message) || err}` };
    }
    setBusy(false);
    const applied = pending;
    setPending(null);
    if (result && result.ok) {
      logEvent('tool.apply', {
        toolId: active ? active.id : null,
        kind: applied.kind,
        count: applied.count,
        action: result.tool ? result.tool.name : null,
      });
    }
    if (store && store.showToast) store.showToast(result ? result.reply : '已完成');
  }, [pending, busy, store, snapshot, active, logEvent]);

  /* --- Esc 回墙：只在工作态生效；表单聚焦与模态打开时不拦截 --- */
  useEffect(() => {
    if (mode !== 'tool') return;
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      if (pending) return; // 提议确认框自己收尾，别被一层 Esc 连关两层
      const t = e.target;
      if (
        t &&
        (t.tagName === 'INPUT' ||
          t.tagName === 'TEXTAREA' ||
          t.tagName === 'SELECT' ||
          t.isContentEditable)
      ) {
        return;
      }
      setMode('wall');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mode, pending]);

  return (
    <div className="tools">
      {mode === 'wall' ? (
        <ToolsWall tools={list} meta={meta} onOpen={activate} onToggleFav={toggleFav} />
      ) : (
        <section className="tool-pane" ref={paneRef}>
          {active && (
            <header className="tool-head">
              <div className="tool-head-main">
                <button
                  type="button"
                  className="btn btn-soft tool-back"
                  onClick={backToWall}
                  title="返回工具集（Esc）"
                >
                  <Icon name="chevron-left" size={13} />
                  工具集
                </button>
                <span className="tool-head-icon">
                  <Icon name={active.icon} size={15} />
                </span>
                <nav className="tool-crumb" aria-label="所在位置">
                  <span className="tool-crumb-prefix">工具集</span>
                  <Icon name="chevron-right" size={11} />
                  <h2 className="tool-title" title={active.detail}>
                    {active.name}
                  </h2>
                </nav>
                <span className="spacer" />
                <span className="tool-status">
                  {riskBadges(active).map((b) => (
                    <span key={b.label} className={'tool-risk is-' + b.tone}>
                      {b.label}
                    </span>
                  ))}
                </span>
              </div>
            </header>
          )}
          <ToolBoundary toolId={activeId}>
            <Suspense fallback={<div className="tool-loading">正在载入工具…</div>}>
              {Active && (
                <Active
                  snapshot={snapshot}
                  params={params}
                  propose={propose}
                  logEvent={logEvent}
                />
              )}
            </Suspense>
          </ToolBoundary>
        </section>
      )}

      {pending && (
        <ProposalModal
          proposal={pending}
          busy={busy}
          onConfirm={confirmProposal}
          onCancel={() => setPending(null)}
        />
      )}
    </div>
  );
}
