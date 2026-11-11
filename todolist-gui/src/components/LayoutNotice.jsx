// 窄边降级的可见解释。
//
// 三处模式开关显示的仍是「用户选的」持久化偏好，这一条负责说清
// 「此刻画面为什么不一样」，并给一个一键切回的出口 —— 否则会出现
// 「开关显示日历、画面却是列表」这种最刺眼的矛盾。
// 提示里也点明「列表口径」：两种排布的取数链本就不同（today 放宽、
// 已完成按完成日期锚定、页眉计数来源不同），任务集合变化需要一个解释。
export default function LayoutNotice({ state, onUseCalendar, onRestoreAuto }) {
  if (!state) return null;
  const auto = state === 'auto-list';

  return (
    <div className="layout-notice" role="status">
      <span className="layout-notice-text">
        {auto ? '窗口较窄 · 已按列表排布（列表口径）' : '窗口较窄 · 仍按日历排布'}
      </span>
      <button
        type="button"
        className="layout-notice-btn"
        onClick={auto ? onUseCalendar : onRestoreAuto}
        title={auto ? '本次仍用日历，窗口变宽后自动恢复' : '交回自动判定'}
      >
        {auto ? '仍用日历' : '恢复自动'}
      </button>
    </div>
  );
}
