// 对话面板：消息流 + 常驻输入框（/ 指令提示 / ↑ 历史）+ 右侧任务快照列。
import { useEffect, useMemo, useRef, useState } from 'react';
import dayjs from 'dayjs';
import { useChatAgent } from '../hooks/useChatAgent';
import { COMMAND_HINTS } from '../lib/nlRules';
import { visibleTools } from './tools/registry.js';
import useAiSettings from '../hooks/useAiSettings';
import Icon from './Icon.jsx';
import ToolCallCard from './ToolCallCard.jsx';
import ProposalModal from './ProposalModal.jsx';
import { useContextMenu, inputMenu, copyMenu } from '../hooks/useContextMenu.jsx';

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

export default function ChatPanel({ store, onOpenList, onOpenTool }) {
  // tools：把 registry 清单交给识别层，`tool.open` 才能落到具体工具上。
  // onOpenTool(id, plan)：对话页 → 工具页的路由回调（切页 + 预填参数）。
  const agent = useChatAgent(store, { tools: visibleTools(), onOpenTool });
  const [input, setInput] = useState('');
  const [history, setHistory] = useState([]);
  const [histIdx, setHistIdx] = useState(-1);
  // 「修改」弹窗当前编辑的提议（来自提议消息上的 proposal 字段；null = 关闭）
  const [editingProposal, setEditingProposal] = useState(null);
  const streamRef = useRef(null);
  const inputRef = useRef(null);
  const { openMenu } = useContextMenu();

  // 引擎状态与配置来自同一份真相（localStorage）：在设置页改完，这里立刻跟着变。
  // 配置项本身已集中到设置页，这里只做「当前会不会联网」的明示。
  const { aiOn, aiTarget } = useAiSettings();

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

  // 自动滚动到底部
  useEffect(() => {
    const el = streamRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [agent.messages]);

  // 对话页签内：Ctrl+Z 回退最后一步动作（复用 store.undo），Esc 关闭修改弹窗或清空输入框
  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        agent.undo();
      } else if (e.key === 'Escape') {
        if (editingProposal) setEditingProposal(null);
        else {
          setInput('');
          setHistIdx(-1);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [agent.undo, editingProposal]);

  // 提议按钮只挂在当前存活的 create 提议消息上：pending 被回复/新命令消费后
  // 按钮随之消失；刷新回放的历史消息没有 proposal 字段，也不会出现按钮。
  const liveProposalMsgId =
    agent.pending && agent.pending.kind === 'create' ? agent.pending.msgId : null;

  // 右键：按落点分派到「输入框编辑菜单 / 消息复制 / 快照复制 / 面板通用动作」。
  // 用事件委托而不是给每条消息挂 handler —— 消息是会持续追加的列表。
  const handleContextMenu = (e) => {
    const el = e.target;
    const field = el.closest && el.closest('input, textarea');
    if (field) {
      openMenu(e, inputMenu(() => field));
      return;
    }
    const snap = el.closest && el.closest('.snapshot-item');
    if (snap) {
      openMenu(e, copyMenu(() => snap.textContent.trim()));
      return;
    }
    const msg = el.closest && el.closest('.msg');
    if (msg) {
      const raw = msg.querySelector('.event-json');
      openMenu(
        e,
        copyMenu(() => (raw ? raw.textContent : (msg.querySelector('.msg-body') || msg).textContent))
      );
      return;
    }
    openMenu(e, [
      {
        type: 'item',
        label: '聚焦输入框',
        onClick: () => inputRef.current && inputRef.current.focus(),
      },
      { type: 'item', label: '清空输入', accel: 'Esc', disabled: !input, onClick: () => setInput('') },
      { type: 'sep' },
      { type: 'item', label: '打开列表页', onClick: () => onOpenList && onOpenList() },
      { type: 'item', label: '重新载入文件', onClick: store.manualReload },
    ]);
  };

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
    <div className="chat-panel" onContextMenu={handleContextMenu}>
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
          <span className={'dot' + (aiOn ? ' dot-warn' : ' dot-ok')}>
            <Icon name="dot" size={13} />
          </span>
          <span>
            {aiOn
              ? `本地规则引擎优先 · 仅在听不懂时发往 ${aiTarget}`
              : '本地规则引擎 · 无网络请求'}
          </span>
          <span className="spacer" />
          <span>
            事件日志 {agent.logCount} 条 · 最后 seq {agent.lastSeq}
          </span>
        </div>

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
                {m.id === liveProposalMsgId && m.proposal && (
                  <div className="proposal-actions">
                    <button
                      className="btn btn-primary"
                      disabled={agent.busy}
                      onClick={() => agent.send('新建')}
                    >
                      新建
                    </button>
                    <button
                      className="btn"
                      disabled={agent.busy}
                      onClick={() => setEditingProposal(m.proposal)}
                    >
                      修改…
                    </button>
                    <button
                      className="btn"
                      disabled={agent.busy}
                      onClick={() => agent.send('跳过')}
                    >
                      跳过
                    </button>
                  </div>
                )}
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

        {editingProposal && (
          <ProposalModal
            proposal={editingProposal}
            busy={agent.busy}
            onCancel={() => setEditingProposal(null)}
            onConfirm={(slots) => {
              setEditingProposal(null);
              agent.confirmCreate(slots);
            }}
          />
        )}

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
