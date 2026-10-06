import { useMemo } from 'react';
import QuickAdd from './QuickAdd.jsx';
import Icon from './Icon.jsx';

// 保存状态：图形与颜色都编码状态，不只靠颜色（色觉障碍下仍可辨）
function StatusDot({ status, conflict }) {
  if (conflict) {
    return (
      <span className="status-dot danger">
        <Icon name="alert-triangle" size={13} />
        外部修改待处理
      </span>
    );
  }
  if (status === 'unsaved') {
    return (
      <span className="status-dot warn">
        <Icon name="circle-half" size={13} />
        未保存
      </span>
    );
  }
  return (
    <span className="status-dot ok">
      <Icon name="dot" size={13} />
      已保存
    </span>
  );
}

export default function TopBar({ store }) {
  const doneCount = useMemo(
    () => store.doneEntries.filter((e) => e.kind === 'task').length,
    [store.doneEntries]
  );

  return (
    <header className="topbar">
      <QuickAdd store={store} inputRef={store.quickAddRef} />
      <div className="search">
        <Icon name="search" size={15} />
        <input
          ref={store.searchRef}
          value={store.search}
          onChange={(e) => store.setSearch(e.target.value)}
          placeholder="搜索（/）"
        />
        {store.search && (
          <button className="icon-btn" onClick={() => store.setSearch('')} title="清空搜索">
            <Icon name="x" size={13} />
          </button>
        )}
      </div>
      <div className="sort-toggle" title="排序模式：手动 = 文件行序（可拖拽），自动 = 优先级/日期">
        <button
          className={store.sortMode === 'manual' ? 'active' : ''}
          onClick={() => store.setSortMode('manual')}
        >
          手动
        </button>
        <button
          className={store.sortMode === 'auto' ? 'active' : ''}
          onClick={() => store.setSortMode('auto')}
        >
          自动
        </button>
      </div>
      <StatusDot status={store.saveStatus} conflict={store.conflict} />
      <span className="topbar-done-count">
        <Icon name="check" size={13} />
        {doneCount}
      </span>
    </header>
  );
}
