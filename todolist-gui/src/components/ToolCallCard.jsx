// 工具调用卡片：等宽字体标题 ▸ 工具名、参数 chip、状态点、耗时、可折叠原始事件 JSON。
import { useState } from 'react';
import Icon from './Icon.jsx';

// 状态用「图形 + 颜色」双编码，不单靠颜色区分
const STATUS = {
  running: { icon: 'dot', cls: 'status-dot-running', label: '执行中' },
  ok: { icon: 'check', cls: 'status-dot-ok', label: '完成' },
  fail: { icon: 'x', cls: 'status-dot-fail', label: '失败' },
};

export default function ToolCallCard({ message }) {
  const [open, setOpen] = useState(false);
  const tool = (message && message.tool) || {};
  const st = STATUS[tool.status] || STATUS.running;
  const params = tool.params || {};
  const entries = Object.entries(params);
  const rawJson = JSON.stringify((message && message.raw) || {}, null, 2);
  const resultJson = message && message.resultRaw ? JSON.stringify(message.resultRaw, null, 2) : null;

  return (
    <div className={`tool-card tool-${tool.status || 'running'}`}>
      <button
        type="button"
        className="tool-card-head"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        title={open ? '收起原始事件' : '展开原始事件'}
      >
        <span className={`status-dot ${st.cls}`} title={st.label}>
          <Icon name={st.icon} size={14} />
        </span>
        <span className="tool-name">{tool.name || 'agent.noop'}</span>
        <span className="tool-params">
          {entries.map(([k, v]) => (
            <span key={k} className="tool-param">
              <span className="tool-param-key">{k}:</span> {String(v)}
            </span>
          ))}
        </span>
        <span className="spacer" />
        {tool.durationMs != null && <span className="tool-duration">{tool.durationMs} ms</span>}
        <span className="tool-chev">
          <Icon name={open ? 'chevron-down' : 'chevron-right'} size={12} />
        </span>
      </button>
      {open && (
        <pre className="event-json">
          {rawJson}
          {resultJson ? `\n\n// tool_result\n${resultJson}` : ''}
        </pre>
      )}
    </div>
  );
}
