// 对话面板：消息流 + 常驻输入框（/ 指令提示 / ↑ 历史）+ 右侧任务快照列。
import { useEffect, useMemo, useRef, useState } from 'react';
import dayjs from 'dayjs';
import { useChatAgent } from '../hooks/useChatAgent';
import { COMMAND_HINTS } from '../lib/nlRules';
import {
  DEFAULT_AI_CONFIG,
  aiHost,
  clearAiConfig,
  loadAiConfig,
  saveAiConfig,
  testAiConnection,
} from '../lib/aiFallback';
import Icon from './Icon.jsx';
import ToolCallCard from './ToolCallCard.jsx';

// 新手示例：点一下填进输入框，再按 Enter 就行
const SAMPLES = [
  '加一条 明天 交周报',
  '后天上午9点有月报会议要开',
  '有哪些任务',
  '完成 第1条',
  '有哪些任务已完成',
  '把 回测报告 延到下周三',
  '标为高 回测报告',
  '列出 回测',
  '撤销',
];

// 等待回复时的提示语：三种 pending 语义不同，提示不能都写成"回复候选序号"。
const PENDING_HINT = {
  create: '（等你确认是否新建这条任务…）',
  confirmTarget: '（等你确认是哪一条…）',
  clarify: '（等待你回复候选序号…）',
};

function MessageText({ message }) {
  return (
    <div className="msg-body">
      {message.text}
      {message.streaming && <span className="typing-cursor">▍</span>}
    </div>
  );
}

export default function ChatPanel({ store, onOpenList }) {
  const agent = useChatAgent(store);
  const [input, setInput] = useState('');
  const [history, setHistory] = useState([]);
  const [histIdx, setHistIdx] = useState(-1);
  const [showAi, setShowAi] = useState(false);
  const [aiCfg, setAiCfg] = useState(() => loadAiConfig() || { ...DEFAULT_AI_CONFIG });
  const [aiTesting, setAiTesting] = useState(false);
  const [aiTest, setAiTest] = useState(null);
  const streamRef = useRef(null);
  const inputRef = useRef(null);

  const aiOn = Boolean(aiCfg.enabled && aiCfg.apiKey && aiCfg.baseUrl);
  const aiTarget = aiHost(aiCfg);

  // P1-2：对话页顶部的「今日概览」。对话页是默认页，但"打开先看今天要干什么"
  // 的需求不该被迫切页签才能满足——摘要条常驻顶部，点击直达列表页。
  const { overdueCount, dueTodayCount } = useMemo(() => {
    let overdue = 0;
    let dueToday = 0;
    for (const t of agent.snapshotTasks) {
      if (t.dueDate && t.dueDate < agent.today) overdue += 1;
      else if (t.dueDate === agent.today) dueToday += 1;
    }
    return { overdueCount: overdue, dueTodayCount: dueToday };
  }, [agent.snapshotTasks, agent.today]);

  const patchAi = (patch) => setAiCfg((c) => ({ ...c, ...patch }));
  const doSaveAi = () => {
    saveAiConfig(aiCfg);
    setShowAi(false);
  };
  const doClearAi = () => {
    clearAiConfig();
    setAiCfg({ ...DEFAULT_AI_CONFIG });
    setShowAi(false);
  };

  // 端到端自检：测的是表单当前值（未保存也能测），走 callAiFallback 的真实链路。
  const doTestAi = async () => {
    setAiTesting(true);
    setAiTest(null);
    try {
      setAiTest(await testAiConnection(aiCfg));
    } catch (err) {
      setAiTest({ ok: false, stage: 'error', detail: `自检本身异常：${(err && err.message) || err}`, latencyMs: 0 });
    } finally {
      setAiTesting(false);
    }
  };

  // 自动滚动到底部
  useEffect(() => {
    const el = streamRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [agent.messages]);

  // 对话页签内：Ctrl+Z 回退最后一步动作（复用 store.undo），Esc 清空输入框
  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        agent.undo();
      } else if (e.key === 'Escape') {
        setInput('');
        setHistIdx(-1);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [agent.undo]);

  const showHints = input.startsWith('/');
  const hintFilter = input.slice(1).trim().toLowerCase();
  const hints = useMemo(() => {
    if (!showHints) return [];
    if (!hintFilter) return COMMAND_HINTS;
    return COMMAND_HINTS.filter(
      (h) =>
        h.intent.includes(hintFilter) ||
        h.label.includes(hintFilter) ||
        h.sample.includes(hintFilter) ||
        h.triggers.includes(hintFilter)
    );
  }, [showHints, hintFilter]);

  const submit = () => {
    const text = input.trim();
    if (!text || agent.busy) return;
    agent.send(text);
    setHistory((h) => (h[h.length - 1] === text ? h : [...h, text]));
    setHistIdx(-1);
    setInput('');
  };

  const onKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
      return;
    }
    if (e.key === 'ArrowUp') {
      if (history.length === 0) return;
      e.preventDefault();
      const next = histIdx < 0 ? history.length - 1 : Math.max(0, histIdx - 1);
      setHistIdx(next);
      setInput(history[next]);
    } else if (e.key === 'ArrowDown') {
      if (histIdx < 0) return;
      e.preventDefault();
      const next = histIdx + 1;
      if (next >= history.length) {
        setHistIdx(-1);
        setInput('');
      } else {
        setHistIdx(next);
        setInput(history[next]);
      }
    }
  };

  return (
    <div className="chat-panel">
      <div className="chat-main">
        {onOpenList && (
          <button
            type="button"
            className={`chat-daybar${overdueCount > 0 ? ' chat-daybar-alert' : ''}`}
            onClick={onOpenList}
            title="打开列表页查看详情"
          >
            <Icon name={overdueCount > 0 ? 'alert-triangle' : 'check-circle'} size={13} />
            <span>
              {overdueCount > 0
                ? `逾期 ${overdueCount} 条 · 今日到期 ${dueTodayCount} 条`
                : dueTodayCount > 0
                  ? `今日到期 ${dueTodayCount} 条 · 无逾期`
                  : '今天没有到期任务'}
            </span>
            <span className="chat-daybar-go">去列表 ›</span>
          </button>
        )}
        <div className="chat-status">
          <span className={`dot ${aiOn ? 'dot-warn' : 'dot-ok'}`}>
            <Icon name="dot" size={13} />
          </span>
          <span>
            {aiOn
              ? `本地规则引擎优先 · 仅在听不懂时发往 ${aiTarget}`
              : '本地规则引擎 · 无网络请求'}
          </span>
          <span className="spacer" />
          <button
            type="button"
            className="chat-status-btn"
            onClick={() => setShowAi((v) => !v)}
            title="AI 兜底设置"
          >
            AI 兜底{aiOn ? ' · 已开' : ' · 关'}
          </button>
          <span>
            事件日志 {agent.logCount} 条 · 最后 seq {agent.lastSeq}
          </span>
        </div>

        {showAi && (
          <div className="ai-cfg">
            <div className="ai-cfg-title">AI 兜底（默认关闭）</div>
            <p className="ai-cfg-note">
              只在本地规则引擎<b>没听懂</b>时才调用它。打开后，这些没被认出来的句子会被发往你填的服务地址；
              能被本地认出来的句子<b>永远不联网</b>。API Key 存在本机 localStorage，仅供浏览器直连，
              请自行评估风险；不填就等于彻底关闭。
            </p>
            <label className="ai-cfg-row">
              <span className="ai-cfg-label">启用</span>
              <input
                type="checkbox"
                checked={Boolean(aiCfg.enabled)}
                onChange={(e) => patchAi({ enabled: e.target.checked })}
              />
              <span className="ai-cfg-hint">
                {aiCfg.enabled && !aiCfg.apiKey ? '还没填 Key，实际仍不会发请求' : ''}
              </span>
            </label>
            <label className="ai-cfg-row">
              <span className="ai-cfg-label">服务地址</span>
              <input
                type="text"
                value={aiCfg.baseUrl}
                onChange={(e) => patchAi({ baseUrl: e.target.value })}
                placeholder="https://api.openai.com/v1"
                spellCheck={false}
              />
            </label>
            <label className="ai-cfg-row">
              <span className="ai-cfg-label">模型</span>
              <input
                type="text"
                value={aiCfg.model}
                onChange={(e) => patchAi({ model: e.target.value })}
                placeholder="gpt-4o-mini"
                spellCheck={false}
              />
            </label>
            <label className="ai-cfg-row">
              <span className="ai-cfg-label">API Key</span>
              <input
                type="password"
                value={aiCfg.apiKey}
                onChange={(e) => patchAi({ apiKey: e.target.value })}
                placeholder="sk-..."
                spellCheck={false}
              />
            </label>
            <div className="ai-cfg-actions">
              <button type="button" className="btn btn-primary" onClick={doSaveAi}>
                保存
              </button>
              <button type="button" className="btn" onClick={doClearAi}>
                清除
              </button>
              <button type="button" className="btn" onClick={doTestAi} disabled={aiTesting}>
                {aiTesting ? '测试中…' : '测试连接'}
              </button>
              <span className="ai-cfg-where">
                {aiOn ? `当前会发往：${aiTarget}` : '当前不会发出任何网络请求'}
              </span>
            </div>
            {aiTest && (
              <div className={`ai-test-result ${aiTest.ok ? 'ok' : 'fail'}`}>
                {aiTest.ok ? '✓ ' : '✕ '}
                {aiTest.detail}
              </div>
            )}
          </div>
        )}

        <div className="chat-stream" ref={streamRef}>
          {agent.messages.length === 0 && (
            <div className="chat-empty">
              <p className="chat-empty-title">用大白话指挥它改你的 todo.txt</p>
              <p className="hint">
                点下面任意一个例子 → 它会填进输入框 → 按 <strong>Enter</strong> 发送。也可以自己随便打字。
              </p>
              <div className="samples">
                {SAMPLES.map((s) => (
                  <button
                    key={s}
                    className="sample-chip"
                    onClick={() => {
                      setInput(s);
                      if (inputRef.current) inputRef.current.focus();
                    }}
                  >
                    {s}
                  </button>
                ))}
              </div>
              <p className="hint">右边那列是你的任务实时快照，序号就是「第 N 条」里的 N。</p>
            </div>
          )}

          {agent.messages.map((m) => {
            if (m.role === 'user') {
              return (
                <div key={m.id} className="msg msg-user">
                  <MessageText message={m} />
                </div>
              );
            }
            if (m.role === 'tool') {
              return (
                <div key={m.id} className="msg msg-tool">
                  <ToolCallCard message={m} />
                </div>
              );
            }
            return (
              <div key={m.id} className={`msg msg-agent${m.kind === 'error' ? ' msg-error' : ''}`}>
                <MessageText message={m} />
              </div>
            );
          })}

          {agent.pending && (
            <div className="msg msg-agent pending-hint">
              <div className="msg-body">
                {PENDING_HINT[agent.pending.kind] || PENDING_HINT.clarify}
              </div>
            </div>
          )}

          {agent.busy && <div className="chat-busy">▍处理中…</div>}
        </div>

        <div className="chat-input-wrap">
          {showHints && (
            <div className="cmd-hint">
              <div className="cmd-hint-title">可用指令（本地规则）</div>
              {hints.length === 0 && <div className="cmd-hint-empty">没有匹配的指令</div>}
              {hints.map((h) => (
                <button
                  key={h.intent}
                  className="cmd-hint-item"
                  onClick={() => {
                    setInput(h.sample);
                    if (inputRef.current) inputRef.current.focus();
                  }}
                >
                  <span className="cmd-hint-label">{h.label}</span>
                  <span className="cmd-hint-sample">{h.sample}</span>
                  <span className="cmd-hint-triggers">{h.triggers}</span>
                </button>
              ))}
            </div>
          )}
          <form
            className="chat-input"
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
          >
            <textarea
              ref={inputRef}
              rows={1}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="用大白话就行，例如：后天上午9点有月报会议要开（Enter 发送）"
            />
            <button className="btn btn-primary" type="submit" disabled={agent.busy || !input.trim()}>
              发送
            </button>
          </form>
        </div>
      </div>

      <aside className="snapshot">
        <div className="snapshot-head">任务快照 · {agent.snapshotTasks.length}</div>
        {agent.snapshotTasks.length === 0 && <div className="snapshot-empty">暂无活跃任务</div>}
        {agent.snapshotTasks.map((t, i) => {
          const overdue = t.dueDate && t.dueDate < agent.today;
          const dueToday = t.dueDate === agent.today;
          return (
            <div key={t.id} className="snapshot-item">
              <span className="snapshot-num">{i + 1}</span>
              <span
                className={`snapshot-prio${t.priority ? '' : ' snapshot-prio-none'}`}
                title={t.priority ? `优先级 ${t.priority}` : '无优先级（默认显示为中）'}
              >
                {t.priority || '中'}
              </span>
              <span className="snapshot-title" title={t.title}>
                {t.title}
              </span>
              {t.dueDate && (
                <span
                  className={`snapshot-due${overdue ? ' overdue' : ''}`}
                  title={overdue ? '已逾期' : dueToday ? '今天到期' : '截止日'}
                >
                  {overdue ? '⚠ ' : ''}
                  {dayjs(t.dueDate).format('M/D')}
                </span>
              )}
            </div>
          );
        })}
      </aside>
    </div>
  );
}
