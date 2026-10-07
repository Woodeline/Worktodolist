// 工具集外壳：左栏是工具清单，右栏是当前工具的工作区。
//
// 这个组件刻意"什么都不知道"：它不认识 RTI，也不知道工具内部有几个页面。
// 它只做三件事 —— 读 registry、渲染清单、把选中的那个组件挂上去。
// 于是"继续添加更多工具"不会让它变大：新增工具只改 registry。
import { Suspense, lazy, useMemo, useState } from 'react';
import { TOOLS } from './registry.js';
import Icon from '../Icon.jsx';

// 懒加载组件必须保持稳定的标识，否则每次渲染 React 都会当成新组件、重新挂载
// （状态全丢）。所以按 id 缓存，绝不在渲染里现调 lazy()。
const LAZY = new Map();
function lazyFor(tool) {
  if (!LAZY.has(tool.id)) LAZY.set(tool.id, lazy(tool.load));
  return LAZY.get(tool.id);
}

export default function ToolsPage({ initialToolId }) {
  const [activeId, setActiveId] = useState(
    () => (TOOLS.some((t) => t.id === initialToolId) ? initialToolId : TOOLS[0]?.id) || null
  );

  const active = useMemo(() => TOOLS.find((t) => t.id === activeId) || null, [activeId]);
  const Active = active ? lazyFor(active) : null;

  if (!TOOLS.length) {
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
        </div>
        <ul className="tools-list">
          {TOOLS.map((tool) => (
            <li key={tool.id}>
              <button
                type="button"
                className={'tools-item' + (tool.id === activeId ? ' is-on' : '')}
                onClick={() => setActiveId(tool.id)}
                aria-current={tool.id === activeId ? 'true' : undefined}
              >
                <span className="tools-item-icon">
                  <Icon name={tool.icon} size={15} />
                </span>
                <span className="tools-item-text">
                  <span className="tools-item-name">{tool.name}</span>
                  <span className="tools-item-desc">{tool.desc}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
        <div className="tools-nav-foot">
          <p className="tools-note">
            新增工具：放一个组件到 <code>components/tools/</code>，再到 <code>tools/registry.js</code>{' '}
            里加一条即可。
          </p>
        </div>
      </nav>

      <section className="tool-pane">
        {active && (
          <header className="tool-head">
            <div className="tool-head-main">
              <span className="tool-head-icon">
                <Icon name={active.icon} size={17} />
              </span>
              <h2 className="tool-title">{active.name}</h2>
              <span className="spacer" />
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
        <Suspense fallback={<div className="tool-loading">正在载入工具…</div>}>
          {Active && <Active />}
        </Suspense>
      </section>
    </div>
  );
}
