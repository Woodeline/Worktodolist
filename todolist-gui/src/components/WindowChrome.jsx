import { useEffect, useState } from 'react';
import {
  RESIZE_HANDLES,
  closeWindow,
  isWindowMaximized,
  minimizeWindow,
  startResizeDragging,
  toggleMaximizeWindow,
} from '../lib/windowChrome.js';

// 自绘标题栏的状态源：最大化/还原由一个共用查询维持。
// 拖拽区双击、系统贴靠、键盘 Win+↑ 都会走窗口 resize 事件，所以除了挂载时查一次，
// 再监听 resize（80ms 防抖）即可，不需要从拖拽脚本里偷事件。
function useWindowMaximized() {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    let alive = true;
    let timer = 0;
    const sync = () => {
      isWindowMaximized()
        .then((v) => {
          if (alive) setMaximized(v);
        })
        .catch(() => {});
    };
    const onResize = () => {
      clearTimeout(timer);
      timer = setTimeout(sync, 80);
    };

    sync();
    window.addEventListener('resize', onResize);
    return () => {
      alive = false;
      clearTimeout(timer);
      window.removeEventListener('resize', onResize);
    };
  }, []);

  return maximized;
}

function CaptionGlyph({ children }) {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 10 10"
      fill="none"
      stroke="currentColor"
      strokeWidth="1"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

// 窗控只给 Windows 用（macOS 保留系统红绿灯）。按钮必须保持 <button>：
// Tauri 的拖拽脚本把可点击元素排除在拖拽区之外，否则点最小化会先拖窗。
export function WindowControls() {
  const maximized = useWindowMaximized();
  const maxLabel = maximized ? '还原' : '最大化';

  return (
    <div className="win-controls">
      <button
        type="button"
        className="win-caption-btn"
        onClick={() => minimizeWindow().catch(() => {})}
        aria-label="最小化"
        title="最小化"
      >
        <CaptionGlyph>
          <path d="M1 5h8" />
        </CaptionGlyph>
      </button>

      <button
        type="button"
        className="win-caption-btn"
        onClick={() => toggleMaximizeWindow().catch(() => {})}
        aria-label={maxLabel}
        title={maxLabel}
      >
        <CaptionGlyph>
          {maximized ? (
            <>
              <path d="M3 1h6v6H7" />
              <rect x="1" y="3" width="6" height="6" />
            </>
          ) : (
            <rect x="1" y="1" width="8" height="8" />
          )}
        </CaptionGlyph>
      </button>

      <button
        type="button"
        className="win-caption-btn is-close"
        onClick={() => closeWindow().catch(() => {})}
        aria-label="关闭"
        title="关闭"
      >
        <CaptionGlyph>
          <path d="M1 1l8 8M9 1l-8 8" />
        </CaptionGlyph>
      </button>
    </div>
  );
}

// 8 个固定定位的命中区：4 边 + 4 角。z-index 压在所有浮层之上，
// 与系统窗口边框一致 —— 贴着窗口边缘按下时，先缩窗而不是点到底下的内容。
export function WindowResizeHandles() {
  const maximized = useWindowMaximized();
  if (maximized) return null;

  return (
    <>
      {RESIZE_HANDLES.map((h) => (
        <div
          key={h.key}
          className={'resize-handle resize-' + h.key}
          aria-hidden="true"
          onPointerDown={(e) => {
            if (e.button !== 0) return;
            e.preventDefault();
            startResizeDragging(h.direction).catch(() => {});
          }}
        />
      ))}
    </>
  );
}
