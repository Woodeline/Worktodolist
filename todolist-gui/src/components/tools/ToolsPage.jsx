// 工具集外壳：左栏是工具清单，右栏是当前工具的工作区。
//
// 这个组件刻意"什么都不知道"：它不认识 RTI，也不认识后面加进来的任何工具。
// 它只读 registry、渲染清单、把选中的那个组件挂上去，外加三件外壳职责：
//   ① 只读投影（snapshot）经它透传 —— 工具拿不到 store，也就没有写入口；
//   ② 提议确认通道（只有 capabilities.writes 授权的工具能拿到 propose）；
//   ③ 崩溃隔离 + 打开/导出这类动作写进会话事件线。
// 于是"继续添加更多工具"不会让它变大：新增工具只改 registry。
import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { GROUPS, canWrite, findTool, riskBadges, visibleTools } from './registry.js';
import ToolBoundary from './ToolBoundary.jsx';
import ProposalModal from '../ProposalModal.jsx';
import Icon from '../Icon.jsx';
import { useContextMenu } from '../../hooks/useContextMenu.jsx';
import useMediaQuery from '../../hooks/useMediaQuery.js';
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

function haystack(tool) {
  return [tool.name, tool.desc, tool.detail, ...(tool.tags || []), ...(tool.keywords || [])]
    .join(' ')
    .toLowerCase();
}

export default function ToolsPage({ snapshot, store, request }) {
  const list = useMemo(() => visibleTools(), []);
  const [activeId, setActiveId] = useState(
    () => (findTool(request && request.id) ? request.id : list[0] && list[0].id) || null
  );
  const [query, setQuery] = useState('');
  const [collapsed, setCollapsed] = useState(() => new Set());
  const [meta, setMeta] = useState(() => loadToolMeta());
  const [pending, setPending] = useState(null);
  const [busy, setBusy] = useState(false);
  const [params, setParams] = useState(null);
  const narrow = useMediaQuery('(max-width: 768px)');
  const { openMenu } = useContextMenu();

  const paneRef = useRef(null);
  const consumedSeq = useRef(0);

  const active = useMemo(() => findTool(activeId) || null, [activeId]);
  const Active = active ? lazyFor(active) : null;
  const handleRef = useRef(null);
  handleRef.current = store && store.dirHandleRef ? store.dirHandleRef.current : null;

  /* --- 元数据（最近使用 / 收藏）：写 localStorage，属于左栏排序，不是新页面 --- */
  const persistMeta = useCallback((next) => {
    saveToolMeta(next);
    return next;
  }, []);

  const rememberUse = useCallback(
    (id) => setMeta((m) => persistMeta(touchMru(m, id))),
    [persistMeta]
  );

  const logEvent = useCallback(async (type, payload) => {
    await logToolEvent(handleRef.current, type, payload, snapshot && snapshot.today);
  }, [snapshot]);

  const activate = useCallback(
    (id, source) => {
      setActiveId(id);
      setParams(null);
      rememberUse(id);
      logEvent('tool.open', { toolId: id, source });
    },
    [logEvent, rememberUse]
  );

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

  /* --- 左栏：检索 + 分组折叠 + 收藏/最近 --- */
  const q = query.trim().toLowerCase();
  const matched = useMemo(
    () => (q ? list.filter((t) => haystack(t).includes(q)) : list),
    [list, q]
  );

  const mruRank = (id) => {
    const i = meta.mru.indexOf(id);
    return i === -1 ? 999 : i;
  };
  const byMru = (a, b) => mruRank(a.id) - mruRank(b.id);
  const favoriteSet = new Set(meta.favorites);
  const favorites = meta.favorites.map((id) => findTool(id)).filter(Boolean).filter((t) => matched.includes(t));

  // 窄屏（≤768）段控条上 **不做折叠也不分组**：折叠头会把高度撑成两层，
  // 而被折叠那组的工具会连入口一起消失。这里是一个行为降级，不是样式降级。
  const flat = narrow || Boolean(q);
  const sections = useMemo(() => {
    if (flat) return [{ id: '__flat', label: '', tools: matched.slice().sort(byMru) }];
    const out = [];
    if (favorites.length) out.push({ id: '__fav', label: '收藏', tools: favorites });
    for (const g of GROUPS) {
      const tools = matched.filter((t) => t.group === g.id && !favoriteSet.has(t.id)).sort(byMru);
      if (tools.length) out.push({ id: g.id, label: g.label, tools });
    }
    const known = new Set(GROUPS.map((g) => g.id));
    const orphan = matched.filter((t) => !known.has(t.group) && !favoriteSet.has(t.id)).sort(byMru);
    if (orphan.length) out.push({ id: '__other', label: '其它', tools: orphan });
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flat, matched, meta.favorites, meta.mru, favorites.length]);

  const toggleCollapse = (id) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const onItemContextMenu = (e, tool) => {
    const isFav = favoriteSet.has(tool.id);
    openMenu(e, [
      { type: 'header', label: tool.name },
      { type: 'item', label: '打开', onClick: () => activate(tool.id, 'nav') },
      {
        type: 'item',
        label: isFav ? '取消收藏' : '收藏（置顶到左栏）',
        checked: isFav,
        onClick: () => setMeta((m) => persistMeta(toggleFavorite(m, tool.id))),
      },
    ]);
  };

  const renderItem = (tool) => {
    const on = tool.id === activeId;
    const isFav = favoriteSet.has(tool.id);
    const recent = !isFav && mruRank(tool.id) < 3;
    return (
      <li className="tools-entry" key={tool.id}>
        <button
          type="button"
          className={'tools-item' + (on ? ' is-on' : '')}
          onClick={() => activate(tool.id, 'nav')}
          onContextMenu={(e) => onItemContextMenu(e, tool)}
          aria-current={on ? 'true' : undefined}
        >
          <span className="tools-item-icon">
            <Icon name={tool.icon} size={15} />
          </span>
          <span className="tools-item-text">
            <span className="tools-item-name">{tool.name}</span>
            <span className="tools-item-desc">{tool.desc}</span>
          </span>
          {(isFav || recent || tool.beta) && (
            <span className="tools-item-flag" title={isFav ? '已收藏' : recent ? '最近用过' : '测试中'}>
              {isFav ? <Icon name="star" size={12} /> : recent ? <Icon name="clock" size={12} /> : null}
              {tool.beta && <span className="tools-item-beta">beta</span>}
            </span>
          )}
        </button>
      </li>
    );
  };

  if (!list.length) {
    return (
      <div className="tools">
        <div className="tools-nav">
          <div className="tools-nav-head">
            <Icon name="toolbox" size={13} />
            <span>工具集</span>
          </div>
        </div>
        <div className="tool-pane">
          <div className="tool-loading">工具集是空的。在 tools/registry.js 里登记一个工具就能用。</div>
        </div>
      </div>
    );
  }

  return (
    <div className="tools">
      <nav className="tools-nav">
        <div className="tools-nav-head">
          <Icon name="toolbox" size={13} />
          <span>工具集</span>
          <span className="tools-nav-count">{list.length}</span>
        </div>
        <div className="tools-search">
          <input
            className="tools-search-input"
            type="search"
            value={query}
            placeholder="搜索工具"
            aria-label="搜索工具"
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <div className="tools-list">
          {sections.map((sec) => {
            const isDone = !flat && collapsed.has(sec.id);
            return (
              <div className="tools-group" key={sec.id || '__all'}>
                {sec.label && (
                  <button
                    type="button"
                    className="tools-group-head"
                    aria-expanded={!isDone}
                    onClick={() => toggleCollapse(sec.id)}
                  >
                    <Icon name={isDone ? 'chevron-right' : 'chevron-down'} size={12} />
                    <span className="tools-group-label">{sec.label}</span>
                    <span className="tools-group-count">{sec.tools.length}</span>
                  </button>
                )}
                {!isDone && <ul className="tools-sublist">{sec.tools.map(renderItem)}</ul>}
              </div>
            );
          })}
          {q && matched.length === 0 && <div className="tools-none">没有匹配「{query.trim()}」的工具</div>}
        </div>
        <div className="tools-nav-foot">
          <p className="tools-note">
            新增工具：放一个组件到 <code>components/tools/</code>，再到 <code>tools/registry.js</code>{' '}
            里加一条即可。右键条目可收藏置顶。
          </p>
        </div>
      </nav>

      <section className="tool-pane" ref={paneRef}>
        {active && (
          <header className="tool-head">
            <div className="tool-head-main">
              <span className="tool-head-icon">
                <Icon name={active.icon} size={17} />
              </span>
              <h2 className="tool-title">{active.name}</h2>
              <span className="spacer" />
              <span className="tool-status">
                {riskBadges(active).map((b) => (
                  <span key={b.label} className={'tool-risk is-' + b.tone}>
                    {b.label}
                  </span>
                ))}
              </span>
              {active.tags && active.tags.length > 0 && (
                <span className="tool-tags">
                  {active.tags.map((tag) => (
                    <span key={tag} className="tool-tag">
                      {tag}
                    </span>
                  ))}
                </span>
              )}
            </div>
            <p className="tool-head-sub">{active.detail}</p>
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
