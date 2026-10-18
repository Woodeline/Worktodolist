// 工具墙（目录态）—— 分组区 + auto-fill 卡片网格 + 组末预留卡。
//
// 与 ToolsPage 的分工：这里只负责"发现与进入"，不认识任何具体工具。
// 数据来自 props（visibleTools 的产物 + 工具集元数据），动作全部回调给
// 父组件——所以"加一个工具"不会让这个文件变大，registry 加一条就行。
//
// 三个对外承诺：
//   ① 搜索有查询词时平铺不分组（与旧左栏 flat 行为一致），无命中出空态；
//   ② 收藏置顶成独立分区，从原分组消失；组内按 MRU 排序；
//   ③ 预留卡是纯装饰（aria-hidden、不进 Tab 序列），组内工具数
//      达到 RESERVED_SLOT_LIMIT 后自动隐藏——扩展位不变成噪音。
import { useMemo, useState } from 'react';
import { GROUPS, riskBadges } from './registry.js';
import { GROUP_NOTES, GROUP_TONES, RESERVED_SLOT_LIMIT } from './wallConfig.js';
import Icon from '../Icon.jsx';
import { useContextMenu } from '../../hooks/useContextMenu.jsx';

function haystack(tool) {
  return [tool.name, tool.desc, tool.detail, ...(tool.tags || []), ...(tool.keywords || [])]
    .join(' ')
    .toLowerCase();
}

/* ---------------------------------------------------------------------------
   单张工具卡
   ---------------------------------------------------------------------------
   卡片根是 div role="button" 而不是 <button>：卡内还有一个收藏 button，
   <button> 套 <button> 是非法 HTML。Enter / Space 键盘打开自己实现。
--------------------------------------------------------------------------- */
function ToolCard({ tool, isFav, recent, onOpen, onToggleFav, onContextMenu }) {
  const tone = GROUP_TONES[tool.group];
  const open = () => onOpen(tool.id);
  return (
    <div
      className="tools-card"
      style={tone ? { '--tone': tone } : undefined}
      role="button"
      tabIndex={0}
      aria-label={`打开 ${tool.name}`}
      title={tool.detail}
      onClick={open}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          open();
        }
      }}
      onContextMenu={onContextMenu}
    >
      <div className="tools-card-top">
        <span className="tools-card-ico">
          <Icon name={tool.icon} size={16} />
        </span>
        <span className="tools-card-name">{tool.name}</span>
        <button
          type="button"
          className={'tools-card-fav' + (isFav ? ' is-on' : '')}
          aria-pressed={isFav}
          aria-label={isFav ? `取消收藏 ${tool.name}` : `收藏 ${tool.name}`}
          title={isFav ? '取消收藏' : '收藏（置顶到墙顶）'}
          onClick={(e) => {
            e.stopPropagation(); // 别顺带把工具打开
            onToggleFav(tool.id);
          }}
        >
          <Icon name="star" size={14} fill={isFav ? 'currentColor' : 'none'} />
        </button>
      </div>

      <p className="tools-card-desc">{tool.desc}</p>

      {tool.tags.length > 0 && (
        <div className="tools-card-tags">
          {tool.tags.slice(0, 3).map((t) => (
            <span className="tool-tag" key={t}>
              {t}
            </span>
          ))}
        </div>
      )}

      <div className="tools-card-foot">
        {riskBadges(tool).map((b) => (
          <span key={b.label} className={'tool-risk is-' + b.tone}>
            {b.label}
          </span>
        ))}
        {tool.beta && <span className="tools-card-beta">beta</span>}
        {recent && (
          <span className="tools-card-mru">
            <Icon name="clock" size={11} />
            最近
          </span>
        )}
      </div>
    </div>
  );
}

export default function ToolsWall({ tools, meta, onOpen, onToggleFav }) {
  const [query, setQuery] = useState('');
  const { openMenu } = useContextMenu();

  const mruRank = (id) => {
    const i = meta.mru.indexOf(id);
    return i === -1 ? 999 : i;
  };
  const byMru = (a, b) => mruRank(a.id) - mruRank(b.id);
  const favoriteSet = new Set(meta.favorites);

  const q = query.trim().toLowerCase();
  const matched = useMemo(
    () => (q ? tools.filter((t) => haystack(t).includes(q)) : tools),
    [tools, q]
  );

  const onCardContextMenu = (e, tool) => {
    const isFav = favoriteSet.has(tool.id);
    openMenu(e, [
      { type: 'header', label: tool.name },
      { type: 'item', label: '打开', onClick: () => onOpen(tool.id) },
      {
        type: 'item',
        label: isFav ? '取消收藏' : '收藏（置顶到墙顶）',
        checked: isFav,
        onClick: () => onToggleFav(tool.id),
      },
    ]);
  };

  // 分区：收藏（有才出）→ registry 分组 → 未登记分组的兜底"其它"。
  // 有查询词时整体平铺：分组头在过滤态只会挡住结果。
  const sections = useMemo(() => {
    if (q) {
      return [{ id: '__flat', label: null, note: null, tools: matched.slice().sort(byMru) }];
    }
    const out = [];
    const favorites = meta.favorites.map((id) => tools.find((t) => t.id === id)).filter(Boolean);
    if (favorites.length) {
      out.push({ id: '__fav', label: '收藏', note: '置顶常用工具', tools: favorites });
    }
    for (const g of GROUPS) {
      const list = matched.filter((t) => t.group === g.id && !favoriteSet.has(t.id)).sort(byMru);
      if (list.length) out.push({ id: g.id, label: g.label, note: GROUP_NOTES[g.id] || null, tools: list });
    }
    const known = new Set(GROUPS.map((g) => g.id));
    const orphan = matched.filter((t) => !known.has(t.group) && !favoriteSet.has(t.id)).sort(byMru);
    if (orphan.length) out.push({ id: '__other', label: '其它', note: '未登记分组', tools: orphan });
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, matched, meta.favorites, meta.mru]);

  const renderCards = (list, withSlot) => (
    <div className="tools-cards">
      {list.map((tool) => (
        <ToolCard
          key={tool.id}
          tool={tool}
          isFav={favoriteSet.has(tool.id)}
          recent={!favoriteSet.has(tool.id) && mruRank(tool.id) < 3}
          onOpen={onOpen}
          onToggleFav={onToggleFav}
          onContextMenu={(e) => onCardContextMenu(e, tool)}
        />
      ))}
      {withSlot && list.length < RESERVED_SLOT_LIMIT && (
        <div className="tools-slot" aria-hidden="true">
          <span className="tools-slot-plus">＋</span>
          <span>预留模块，登记后自动出现</span>
        </div>
      )}
    </div>
  );

  return (
    <div className="tools-wall">
      <div className="tools-wall-head">
        <div>
          <h2 className="tools-wall-title">工具集</h2>
          <p className="tools-wall-sub">{tools.length} 个模块 · 点卡片进入</p>
        </div>
        <div className="tools-wall-search">
          <Icon name="search" size={13} />
          <input
            type="search"
            value={query}
            placeholder="搜索工具"
            aria-label="搜索工具"
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setQuery('');
            }}
          />
        </div>
      </div>

      {tools.length === 0 ? (
        <div className="tools-none">工具集是空的。在 tools/registry.js 里登记一个工具就能用。</div>
      ) : q && matched.length === 0 ? (
        <div className="tools-none">没有匹配「{query.trim()}」的工具</div>
      ) : (
        sections.map((sec) => (
          <section className="tools-sec" key={sec.id}>
            {sec.label && (
              <div className="tools-sec-head">
                {sec.id === '__fav' ? (
                  <span className="tools-sec-star">
                    <Icon name="star" size={12} fill="currentColor" />
                  </span>
                ) : (
                  <span className="tools-sec-bar" />
                )}
                <h3 className="tools-sec-name">{sec.label}</h3>
                <span className="tools-sec-count">{sec.tools.length}</span>
                {sec.note && <span className="tools-sec-note">{sec.note}</span>}
              </div>
            )}
            {/* 预留卡只给注册表分组：收藏区是用户自选的子集，"这里会长出新工具"
                不成立；搜索平铺态也不给 —— 过滤结果里混一张虚线位只会误导。 */}
            {renderCards(sec.tools, !q && sec.id !== '__fav')}
          </section>
        ))
      )}
    </div>
  );
}
