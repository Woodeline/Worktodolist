// 会话状态机：用户输入 → parseIntent → 命中动作则执行 → 写事件日志 → 生成回复。
// 支持多轮澄清：多命中 / 目标不明时进入 pending，下一条输入若为序号或候选子串
// 则选中对应候选继续执行（澄清过程本身也记入事件日志）。
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import dayjs from 'dayjs';
import { parseIntent } from '../lib/nlRules';
import { ACTIONS, dispatch, pickByReply } from '../lib/actions';
import { activeTasks, sortTasks } from '../lib/sortFilter';
import { appendEvent, loadEvents, makeEvent, replay } from '../lib/eventLog';
import { drainLastToolSeq } from '../lib/toolEvents.js';
import { aiHost, callAiFallback, isAiConfigured, loadAiConfig } from '../lib/aiFallback';

// 需要明确目标才能执行的意图（与 nlRules.NEEDS_TARGET 对应）。
const NEEDS_TARGET = new Set([
  'complete',
  'uncomplete',
  'delete',
  'postpone',
  'setPriority',
  'setDue',
  'star',
  'addContext',
  'addProject',
]);

const UNKNOWN_HINT =
  '抱歉，没听懂这条指令 🙈 你可以试试：\n' +
  '· 加一条 明天 交周报\n' +
  '· 完成 回测报告\n' +
  '· 把 回测报告 延到下周三\n' +
  '· 标为高 回测报告\n' +
  '· 有哪些任务\n' +
  '输入 / 可查看全部可用指令。';

// —— 确认/否认的识别 ——
//
// 前缀匹配就够用（「是的，创建吧」也算同意），但必须先排掉"拖延/反悔"的语气：
// 「嗯这个嘛回头再说吧」以"嗯"开头，纯前缀匹配会当成同意然后凭空多出一条任务。
// 代价不对称（认错要写文件、认少只是多问一轮），所以宁可不认。
const HEDGE_RE = /回头|再说|待会|等会|一会|先不|算了|取消|别/;
const YES_RE = /^(是|是的|对|对的|好|好的|要|创建|新建|确定|确认|可以|行|嗯|yes|ok|y)/i;
const NO_RE = /^(否|不是|不对|不|不用|不要|取消|算了|跳过|no|n)/i;

function readConfirm(text) {
  const t = String(text || '').trim();
  if (!t) return 'other';
  if (HEDGE_RE.test(t)) return 'other';
  if (YES_RE.test(t)) return 'yes';
  if (NO_RE.test(t)) return 'no';
  return 'other';
}

function nowMs() {
  return typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
}

function previewParams(intent) {
  const p = {};
  const t = intent && intent.target;
  if (t) {
    p.target = t.kind === 'index' ? `第${t.value}条` : t.kind === 'context' ? `@${t.value}` : t.value;
  }
  const slots = (intent && intent.slots) || {};
  if (slots.title) p.title = slots.title;
  if (slots.dueDate) p.due = slots.dueDate;
  if (slots.priority) p.priority = slots.priority;
  return p;
}

/**
 * 聊天式本地规则 Agent。
 * @param {object} store useTodoStore() 返回值
 * @param {{tools?:Array<object>, onOpenTool?:Function}} [opts]
 *   tools     registry 工具清单（供 tool.open 意图匹配；不传则该意图不会命中）
 *   onOpenTool(id, plan)  对话页 → 工具页的路由回调（切页 + 预填参数）
 */
export function useChatAgent(store, opts = {}) {
  const today = dayjs().format('YYYY-MM-DD');
  const tools = Array.isArray(opts.tools) ? opts.tools : [];
  const onOpenTool = typeof opts.onOpenTool === 'function' ? opts.onOpenTool : null;

  const [messages, setMessages] = useState([]);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState(null);
  const [logCount, setLogCount] = useState(0);
  const [lastSeq, setLastSeq] = useState(0);
  const [restored, setRestored] = useState(false);

  const seqRef = useRef(0);
  const callSeqRef = useRef(0);
  const restoredRef = useRef(false);
  const typingTimerRef = useRef(null);
  const tasksRef = useRef([]);

  // 任务快照：与 NL 序号指代一致（活跃任务 + 当前排序）。
  const snapshotTasks = useMemo(
    () => sortTasks(activeTasks(store.todoEntries), store.sortMode),
    [store.todoEntries, store.sortMode]
  );
  tasksRef.current = snapshotTasks;

  const pushMessage = useCallback((msg) => setMessages((prev) => [...prev, msg]), []);
  const patchMessage = useCallback(
    (id, patch) => setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, ...patch } : m))),
    []
  );

  // 追加事件到磁盘日志（append-only），同时维护 seq / 计数。
  //
  // seq 是**全日志唯一**的：工具事件（tool.open / tool.run / tool.export / tool.apply）
  // 也写进同一份 NDJSON，因此这里在自增前先看工具侧有没有写过 ——
  // 有就把计数器抬到它之上，避免同一份日志出现重号（回放顺序会因此不稳）。
  const persist = useCallback(
    async (type, payload) => {
      const toolSeq = drainLastToolSeq();
      if (toolSeq) seqRef.current = Math.max(seqRef.current, toolSeq);
      seqRef.current += 1;
      const event = makeEvent(seqRef.current, type, payload);
      setLastSeq(event.seq);
      setLogCount((c) => c + 1);
      try {
        const handle = store.dirHandleRef && store.dirHandleRef.current;
        await appendEvent(handle, event);
      } catch {
        // 日志写入失败不影响对话本身
      }
      return event;
    },
    [store]
  );

  // 打字机效果：逐字显示（约 15ms/字，长文本加快）。
  //
  // 尊重系统的「减少动态效果」偏好：开启时直接把全文写进去，不做逐字动画。
  // 这既是可访问性要求（前庭敏感用户），也让自动化测试不必真的等动画跑完。
  const typeInto = useCallback(
    (id, text) =>
      new Promise((resolve) => {
        const settle = () => {
          setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, text, streaming: false } : m)));
          typingTimerRef.current = null;
          resolve();
        };

        let reduce = false;
        try {
          reduce =
            typeof window !== 'undefined' &&
            typeof window.matchMedia === 'function' &&
            window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        } catch {
          reduce = false;
        }
        if (reduce) {
          settle();
          return;
        }

        let i = 0;
        const tickMs = text.length > 160 ? 4 : 15;
        const timer = setInterval(() => {
          i += 1;
          setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, text: text.slice(0, i) } : m)));
          if (i >= text.length) {
            clearInterval(timer);
            settle();
          }
        }, tickMs);
        typingTimerRef.current = timer;
      }),
    []
  );

  // 生成一条 Agent 文本回复（先落事件，再流式展示）。
  //
  // extra：附加到消息对象上的"纯内存"字段（如按钮所需的 proposal），不写入事件日志。
  // 刷新回放后这些字段消失 —— 与澄清态（pending）不持久化的语义一致，
  // 历史提议消息上不会出现还能点的按钮。
  const respond = useCallback(
    async (text, kind = 'text', extra = null) => {
      const event = await persist('agent', { text, kind });
      const id = `a-${event.seq}`;
      pushMessage({
        id,
        seq: event.seq,
        ts: event.ts,
        role: 'agent',
        kind,
        text: '',
        full: text,
        streaming: true,
        raw: event,
        ...(extra || {}),
      });
      await typeInto(id, text);
      return id;
    },
    [persist, pushMessage, typeInto]
  );

  // 执行一个（高置信度）意图：写 intent / tool_call / tool_result 事件并渲染工具卡片。
  const executeIntent = useCallback(
    async (intent) => {
      const startedAt = nowMs();
      const callId = `call-${(callSeqRef.current += 1)}`;
      const action = ACTIONS[intent.intent];
      const toolName = action ? action.id : 'agent.noop';
      const params = previewParams(intent);

      await persist('intent', {
        intent: intent.intent,
        confidence: intent.confidence,
        target: intent.target || null,
        source: intent.source || 'local',
      });

      const callEvent = await persist('tool_call', { callId, tool: { name: toolName, params } });
      const toolMsgId = `t-${callEvent.seq}`;
      pushMessage({
        id: toolMsgId,
        seq: callEvent.seq,
        ts: callEvent.ts,
        role: 'tool',
        tool: { name: toolName, params, status: 'running', durationMs: null },
        raw: callEvent,
      });

      // 让出一次事件循环，使“执行中”状态可见。
      await new Promise((r) => setTimeout(r, 0));

      let result;
      try {
        result = dispatch(intent, { store, tasks: tasksRef.current, today });
      } catch (err) {
        result = {
          ok: false,
          reply: `执行出错：${(err && err.message) || err}`,
          tool: { name: toolName, params, status: 'fail' },
        };
      }

      const durationMs = Math.max(1, Math.round(nowMs() - startedAt));
      const resultEvent = await persist('tool_result', {
        callId,
        status: result.tool.status,
        durationMs,
        reply: result.reply,
        params: result.tool.params,
      });
      patchMessage(toolMsgId, {
        tool: { name: toolName, params: result.tool.params, status: result.tool.status, durationMs },
        resultRaw: resultEvent,
      });

      await respond(result.reply);
      return result;
    },
    [persist, pushMessage, patchMessage, respond, store]
  );

  // 澄清：把候选编号列表回复给用户。
  //
  // 候选有两条来源：强匹配（matches）与弱匹配（nearMatches）。强匹配为空时若
  // 一句话都不给，用户看到的就是"请确认："后面空无一物 —— 所以用弱匹配兜底。
  const askClarify = useCallback(
    async (intent, candidates, headText) => {
      let list = (candidates || []).filter(Boolean);
      if (!list.length && intent && intent.nearMatches && intent.nearMatches.length) {
        list = intent.nearMatches
          .map((id) => tasksRef.current.find((t) => t.id === id))
          .filter(Boolean);
      }
      if (!list.length) {
        await respond('没能定位到具体是哪一条任务。可以换个说法，或直接用「第 N 条」（序号见右侧快照）。');
        return;
      }
      setPending({ intent, candidates: list });
      const body = list.map((t, i) => `${i + 1}. ${t.title}`).join('\n');
      const head =
        headText ||
        (intent.matches.length ? '找到多个候选，请回复序号：' : '没找到精确匹配，这几个里有没有？请回复序号：');
      await respond(`${head}\n${body}`);
    },
    [respond]
  );

  // 隐式新增：句子里没有动词，但形态就是一条待办（「后天上午9点有月报会议要开」）。
  //
  // 只反问、不落盘 —— 认错了用户回一句「不是」就结束，认对了省掉一次
  // "加一条"的输入。反问时把解析结果白盒展示（标题/截止/优先级/标签），
  // 用户一眼就能看出它到底认成了什么。
  const askCreate = useCallback(
    async (intent) => {
      const slots = (intent && intent.slots) || {};
      const title = String(slots.title || '').trim();

      const lines = [`· 标题：${title}`];
      if (slots.dueDate) lines.push(`· 截止：${slots.dueDate}`);
      if (slots.priority) lines.push(`· 优先级：${slots.priority}`);
      if (slots.contexts && slots.contexts.length) lines.push(`· 分类：@${slots.contexts.join(' @')}`);
      if (slots.projects && slots.projects.length) lines.push(`· 标签：+${slots.projects.join(' +')}`);
      if (intent && intent.note) lines.push(`· 提示：${intent.note}`);
      lines.push('回「是」新建，回「不是」跳过；也可以直接点下方按钮（确认前不改动文件）。');

      // proposal 挂在内存消息上，按钮由 ChatPanel 按 pending.msgId 匹配渲染；
      // setPending 放在 respond 之后以拿到消息 id —— 期间 busy 为真，不会有输入插进来。
      const msgId = await respond(`这句听着像一条待办，要我新建吗？\n${lines.join('\n')}`, 'text', {
        proposal: {
          title,
          dueDate: slots.dueDate || '',
          priority: slots.priority || '',
          contexts: [...(slots.contexts || [])],
          projects: [...(slots.projects || [])],
        },
      });
      setPending({ kind: 'create', keyword: title, slots, note: (intent && intent.note) || null, msgId });
    },
    [respond]
  );

  // 可选 AI 兜底 —— 只在本地返回 unknown 时才会被调用。
  // 未配置时立刻返回 null，一行网络请求都不发；调用失败也静默退回"没听懂"，
  // 绝不因为网络的锅让用户看到报错。
  const tryFallback = useCallback(
    async (text) => {
      const cfg = loadAiConfig();
      if (!isAiConfigured(cfg)) return null;
      try {
        return await callAiFallback(text, { tasks: tasksRef.current, today, config: cfg });
      } catch {
        return null;
      }
    },
    [today]
  );

  // 解析一条文本并分发到对应动作 —— 正常路径与「澄清态里用户又说了新命令」共用同一份。
  //
  // 抽成一个内部函数是为了不再复制第二份解析逻辑：当处于 create 澄清态、用户却改主意
  // 直接说了另一条命令（例如「加一条 明天 交周报」）时，这句话应当按一条全新输入走完
  // 完整路由（suggestAdd / unknown / needsConfirm / 低置信度澄清 / 直接执行），
  // 而不是被当作"没确认"丢弃。
  //
  // 返回值是结果标识，供调用方决定后续收尾：
  //   'suggestAdd' 已反问是否新建 | 'confirm' 已请求确认目标
  //   'clarify'    已给出候选列表 | 'done' 已执行或已由 AI 兜底
  //   'unknown'    本地无意图（AI 也没兜住）—— 是否打印通用提示由 fallbackHint 决定
  const route = useCallback(
    async (text, opts = {}) => {
      const { fallbackHint = true } = opts;
      const intent = parseIntent(text, { tasks: tasksRef.current, today, tools });

      // —— 打开工具：只切页，不动数据 ——
      // 无副作用意图，所以不走澄清框架：认到哪个就开哪个。工具页收到 id + 预填参数后，
      // 自己会往事件日志里写一条 tool.open（来源标 chat），这里不再重复记一笔。
      if (intent.intent === 'tool.open') {
        const slots = intent.slots || {};
        if (onOpenTool) {
          onOpenTool(slots.toolId, slots.plan || '');
          const tail = slots.plan ? `，并把你说的「${slots.plan}」填了进去` : '';
          await respond(`好，已经在「工具」页打开「${slots.toolName}」${tail}。`, 'hint');
        } else {
          await respond(`识别到你想用「${slots.toolName}」，但工具页现在不可用。`, 'hint');
        }
        return 'done';
      }

      // —— 隐式新增：只建议，不执行 ——
      if (intent.intent === 'suggestAdd') {
        await askCreate(intent);
        return 'suggestAdd';
      }

      if (intent.intent === 'unknown') {
        const ai = await tryFallback(text);
        if (ai) {
          // 联网这件事必须当场说清楚：哪一句、发到哪个域。
          await respond(`本地没认出来，改用 AI 兜底解析（这一句已发往 ${aiHost()}）`, 'hint');
          await executeIntent(ai);
          return 'done';
        }
        // 正常路径给通用的"没听懂"指令清单；但从澄清态重入时（fallbackHint:false）不打印它，
        // 改由调用方补一句"带上被打断的那条待建议"的收尾 —— 否则用户读完整条消息，
        // 仍不知道刚才那条待建议到底建没建（第三态必须明确收尾，不能静默丢弃）。
        if (fallbackHint) await respond(UNKNOWN_HINT, 'hint');
        return 'unknown';
      }

      // —— 唯一命中，但查询词只是标题里某个更长词的片段 ——
      // 「完成 报告」只命中 1 条，可这个唯一性是假象，直接执行等于替用户做决定。
      if (intent.needsConfirm) {
        const hit = tasksRef.current.find((t) => t.id === intent.matches[0]);
        if (hit) {
          setPending({ kind: 'confirmTarget', intent, candidates: [hit] });
          await respond(
            `只想确认一下，你说的是这一条吗？\n1. ${hit.title}\n回「是」继续，回「不是」取消。`
          );
          return 'confirm';
        }
      }

      if (NEEDS_TARGET.has(intent.intent) && intent.confidence === 'low') {
        const candidates = intent.matches
          .map((id) => tasksRef.current.find((t) => t.id === id))
          .filter(Boolean);
        await askClarify(intent, candidates);
        return 'clarify';
      }

      const result = await executeIntent(intent);
      // 查询 0 命中且含残余关键词 → 进入「是否新建」澄清。
      if (result && result.clarify && result.clarify.kind === 'create') {
        setPending({ kind: 'create', keyword: result.clarify.keyword, slots: null });
      }
      return 'done';
    },
    [today, tools, onOpenTool, askCreate, askClarify, tryFallback, respond, executeIntent]
  );

  // 发送一条用户消息。
  const send = useCallback(
    async (textInput) => {
      const text = String(textInput == null ? '' : textInput).trim();
      if (!text || busy) return;

      setBusy(true);
      try {
        const userEvent = await persist('user', { text });
        pushMessage({
          id: `u-${userEvent.seq}`,
          seq: userEvent.seq,
          ts: userEvent.ts,
          role: 'user',
          text,
          raw: userEvent,
        });

        // —— 澄清回包 ——
        if (pending) {
          const carried = pending;
          setPending(null);

          // 子类 A：询问是否新建（查询 0 命中 / 隐式新增）→ 回「是」落盘。
          if (carried.kind === 'create') {
            const title = String(carried.keyword || '').trim();
            const reply = readConfirm(text);
            if (reply === 'yes') {
              await executeIntent({
                intent: 'add',
                target: null,
                slots: carried.slots || { title },
                matches: [],
                nearMatches: [],
                confidence: 'high',
                note: carried.note || null,
                raw: text,
                needsConfirm: false,
              });
            } else if (reply === 'no') {
              await respond('好的，已跳过，文件没动。');
            } else {
              // 三态契约的第三态：既非「是」也非「不是」。
              // 先把这句话当作一条全新输入重新解析分发（用户很可能改主意、说了新命令）；
              // fallbackHint:false 表示不要由 route 打通用"没听懂"清单 —— 那会盖住下文收尾。
              // 若重新解析仍是 unknown（既非是/否、又解析不出任何意图），则必须明确收尾：
              // 刚才那条待建议没有被创建、文件没动，并带上它的标题，不能静默丢弃。
              const res = await route(text, { fallbackHint: false });
              if (res === 'unknown') {
                const closed = title
                  ? `没有新建「${title}」，文件没动。想让我做事可以直接说，或输入 / 看可用指令。`
                  : '没有新建，文件没动。想让我做事可以直接说，或输入 / 看可用指令。';
                await respond(closed);
              }
            }
            return;
          }

          // 子类 B：唯一命中但查询词只是标题片段 → 先确认"是不是这一条"。
          if (carried.kind === 'confirmTarget') {
            const top = (carried.candidates || [])[0];
            if (readConfirm(text) === 'yes' && top) {
              await executeIntent({
                ...carried.intent,
                matches: [top.id],
                confidence: 'high',
                needsConfirm: false,
              });
              return;
            }
            const picked = pickByReply(carried.candidates, text);
            if (picked) {
              await executeIntent({
                ...carried.intent,
                matches: [picked.id],
                confidence: 'high',
                needsConfirm: false,
              });
              return;
            }
            await respond('好的，已取消本次操作。');
            return;
          }

          // 子类 C：多候选 / 目标不明 → 回复序号选中。
          const chosen = pickByReply(carried.candidates, text);
          if (!chosen) {
            await respond('没有识别到对应的候选序号，已取消本次澄清。可重新描述目标。');
            return;
          }
          await executeIntent({ ...carried.intent, matches: [chosen.id], confidence: 'high' });
          return;
        }

        // 无澄清态：按一条新输入正常解析分发（与 create 澄清态里重新解析共用 route）。
        await route(text);
      } finally {
        setBusy(false);
      }
    },
    [busy, pending, persist, pushMessage, executeIntent, respond, route]
  );

  // 「修改」弹窗确认后：带着编辑过的槽位直接落盘新建。
  //
  // 不走 send() —— readConfirm 识别不了"改过的内容"，而这里的用户意图就是明确的
  // 同意+改写。执行路径与 create 澄清态的 yes 分支完全同一条（executeIntent('add')），
  // 工具卡片 / 事件日志 / 回复文案全部复用；日志里另记一条可读的 user 事件，
  // 回放时能看出这条任务是按钮修改后新建的，而不是凭空出现。
  const confirmCreate = useCallback(
    async (patch) => {
      const carried = pending;
      if (!carried || carried.kind !== 'create' || busy) return;
      const slots = { ...(carried.slots || { title: carried.keyword }), ...patch };
      slots.title = String(slots.title || '').trim();
      if (!slots.title) return; // 与弹窗的禁用态双保险：没标题就不消费提议
      setPending(null);
      setBusy(true);
      try {
        const text = `修改后新建「${slots.title}」`;
        const userEvent = await persist('user', { text });
        pushMessage({
          id: `u-${userEvent.seq}`,
          seq: userEvent.seq,
          ts: userEvent.ts,
          role: 'user',
          text,
          raw: userEvent,
        });
        await executeIntent({
          intent: 'add',
          target: null,
          slots,
          matches: [],
          nearMatches: [],
          confidence: 'high',
          note: carried.note || null,
          raw: text,
          needsConfirm: false,
        });
      } finally {
        setBusy(false);
      }
    },
    [pending, busy, persist, pushMessage, executeIntent]
  );

  // 撤销最后一步动作（复用 store.undo），并写入撤销事件。
  const undo = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      const callId = `call-${(callSeqRef.current += 1)}`;
      const startedAt = nowMs();
      const callEvent = await persist('tool_call', { callId, tool: { name: 'todo.undo', params: {} } });
      const toolMsgId = `t-${callEvent.seq}`;
      pushMessage({
        id: toolMsgId,
        seq: callEvent.seq,
        ts: callEvent.ts,
        role: 'tool',
        tool: { name: 'todo.undo', params: {}, status: 'running', durationMs: null },
        raw: callEvent,
      });
      store.undo();
      const durationMs = Math.max(1, Math.round(nowMs() - startedAt));
      const resultEvent = await persist('tool_result', {
        callId,
        status: 'ok',
        durationMs,
        reply: '已撤销最后一步操作。',
        params: {},
      });
      patchMessage(toolMsgId, {
        tool: { name: 'todo.undo', params: {}, status: 'ok', durationMs },
        resultRaw: resultEvent,
      });
      await respond('已撤销最后一步操作。');
    } finally {
      setBusy(false);
    }
  }, [busy, persist, pushMessage, patchMessage, respond, store]);

  // 启动：目录就绪后从当日日志回放历史（无副作用）。
  useEffect(() => {
    if (!store.dirReady || restoredRef.current) return;
    restoredRef.current = true;
    let cancelled = false;
    (async () => {
      try {
        const handle = store.dirHandleRef && store.dirHandleRef.current;
        const events = await loadEvents(handle, today);
        if (cancelled) return;
        if (events.length) {
          setMessages(replay(events));
          seqRef.current = events[events.length - 1].seq;
          setLastSeq(seqRef.current);
          setLogCount(events.length);
        }
      } catch {
        // 回放失败时保持空会话
      } finally {
        if (!cancelled) setRestored(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [store.dirReady, store.dirHandleRef, today]);

  // 卸载时清理打字机定时器。
  useEffect(
    () => () => {
      if (typingTimerRef.current) clearInterval(typingTimerRef.current);
    },
    []
  );

  return {
    messages,
    busy,
    pending,
    send,
    confirmCreate,
    undo,
    snapshotTasks,
    logCount,
    lastSeq,
    today,
    restored,
  };
}
