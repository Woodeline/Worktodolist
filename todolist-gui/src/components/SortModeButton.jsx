// 排序档位的图标钮：自动 = 上下箭头，手动 = 抓手（文件行序）。
//
// 2026-11-23：从上下文条移到快录条右端 —— 排序只作用于列表，跟"写一行"放在同一排，
// 不再占页眉。样式与行内快捷按钮同一套焦点态（22px 圆角底），不是浮窗卡片。
import Icon from './Icon.jsx';

export default function SortModeButton({ store }) {
  if (!store) return null;
  const isManual = store.sortMode === 'manual';
  const toggle = () => store.setSortMode(isManual ? 'auto' : 'manual');
  return (
    <button
      type="button"
      className="quick-sort"
      data-sort={isManual ? 'manual' : 'auto'}
      onClick={toggle}
      title={
        isManual
          ? '排序：手动（文件行序 · 可拖拽）· 点按换自动'
          : '排序：自动（优先级 · 日期）· 点按换手动'
      }
      aria-label={'排序：' + (isManual ? '手动' : '自动')}
    >
      <Icon name={isManual ? 'grip-vertical' : 'arrow-up-down'} size={16} />
    </button>
  );
}
