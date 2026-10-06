// 动作表：把 parseIntent 得到的意图映射为对 useTodoStore 的调用。
//
// 硬性约束：所有副作用必须复用现有 store 方法（addTask / toggleComplete /
// deleteTask / updateTask / undo），绝不直接读写文件。
//
// 每个动作：{ id, label, run(ctx, intent) -> { ok, reply, tool } }
//   ctx   : { store, tasks, today }
//   tool  : { name, params, status }  —— 用于渲染工具调用卡片
import dayjs from 'dayjs';

const PRIORITY_CN = { A: '高', B: '中', C: '低' };

function findTaskById(ctx, id) {
  return (ctx.tasks || []).find((t) => t.id === id) || null;
}

// 按 target 在给定任务池中解析候选（与 nlRules.resolveTarget 语义一致）。
function resolveInPool(pool, target) {
  if (!target) return [];
  if (target.kind === 'index') {
    const t = pool[target.value - 1];
    return t ? [t] : [];
  }
  if (target.kind === 'context') {
    const name = String(target.value).replace(/^@/, '');
    return pool.filter((t) => (t.contexts || []).includes(name));
  }
  const kw = String(target.value).toLowerCase();
  return pool.filter((t) => String(t.title || '').toLowerCase().includes(kw));
}

// 目标的人类可读文案（用于工具卡片参数 chip）。
function targetLabel(intent) {
  const t = intent.target;
  if (!t) return '—';
  if (t.kind === 'index') return `第${t.value}条`;
  if (t.kind === 'context') return `@${t.value}`;
  return t.value;
}

function fail(name, params, reply) {
  return { ok: false, reply, tool: { name, params, status: 'fail' } };
}

function ok(name, params, reply, extra) {
  return { ok: true, reply, tool: { name, params, status: 'ok' }, ...(extra || {}) };
}

function taskChip(task) {
  return { target: `第?条`, title: task.title };
}

// —— 具体动作 —— //

function runAdd(ctx, intent) {
  const { store } = ctx;
  const slots = intent.slots || {};
  const title = String(slots.title || '').trim();
  const params = {};
  if (slots.dueDate) params.due = slots.dueDate;
  if (slots.contexts && slots.contexts.length) params.contexts = slots.contexts.join(' ');
  if (slots.projects && slots.projects.length) params.projects = slots.projects.join(' ');
  if (slots.priority) params.priority = slots.priority;
  if (title) params.title = title;

  if (!title) {
    return fail('todo.add', params, '没听清要添加什么内容，试试「加一条 明天 交周报」。');
  }

  // 与列表页 QuickAdd 完全同构：不写默认优先级，仅在用户显式指定时才带 (X)。
  const parts = [];
  if (slots.priority) parts.push(`(${slots.priority})`);
  parts.push(title);
  (slots.contexts || []).forEach((c) => parts.push(`@${c}`));
  (slots.projects || []).forEach((p) => parts.push(`+${p}`));
  if (slots.dueDate) parts.push(`due:${slots.dueDate}`);

  const task = store.addTask(parts.join(' '));
  if (!task) return fail('todo.add', params, '创建任务失败，请检查标题。');

  const dueText = slots.dueDate ? `，截止 ${slots.dueDate}` : '';
  const noteText = intent.note ? `（${intent.note}）` : '';
  return ok('todo.add', params, `已添加任务：${task.title}${dueText}${noteText}`);
}

function runComplete(ctx, intent) {
  const task = findTaskById(ctx, intent.matches[0]);
  const params = { target: targetLabel(intent), title: task ? task.title : '' };
  if (!task) return fail('todo.complete', params, '没有找到要完成的任务。');
  ctx.store.toggleComplete(task);
  return ok('todo.complete', params, `已完成：${task.title}`);
}

function runUncomplete(ctx, intent) {
  const donePool = (ctx.store.doneEntries || []).filter((e) => e.kind === 'task');
  const hits = resolveInPool(donePool, intent.target);
  const params = { target: targetLabel(intent), title: hits[0] ? hits[0].title : '' };
  if (hits.length !== 1) {
    return fail('todo.uncomplete', params, '没有唯一匹配的已完成任务，无法取消完成。');
  }
  ctx.store.toggleComplete(hits[0]);
  return ok('todo.uncomplete', params, `已取消完成：${hits[0].title}`);
}

function runDelete(ctx, intent) {
  const task = findTaskById(ctx, intent.matches[0]);
  const params = { target: targetLabel(intent), title: task ? task.title : '' };
  if (!task) return fail('todo.delete', params, '没有找到要删除的任务。');
  ctx.store.deleteTask(task);
  return ok('todo.delete', params, `已删除：${task.title}`);
}

function runSetDate(ctx, intent, toolName, verb) {
  const task = findTaskById(ctx, intent.matches[0]);
  const params = { target: targetLabel(intent), title: task ? task.title : '' };
  const date = intent.slots && intent.slots.dueDate;
  if (!task) return fail(toolName, params, '没有找到对应的任务。');
  if (!date) return fail(toolName, params, `没听清要${verb}到哪天，试试「${verb}到 下周三」。`);
  params.due = date;
  ctx.store.updateTask(task.id, { dueDate: date });
  const noteText = intent.note ? `（${intent.note}）` : '';
  return ok(toolName, params, `已将「${task.title}」${verb}至 ${date}${noteText}`);
}

function runSetPriority(ctx, intent) {
  const task = findTaskById(ctx, intent.matches[0]);
  const params = { target: targetLabel(intent), title: task ? task.title : '' };
  const p = intent.slots && intent.slots.priority;
  if (!task) return fail('todo.setPriority', params, '没有找到对应的任务。');
  if (!p) return fail('todo.setPriority', params, '没听清要设为哪一级，试试「标为高」。');
  params.priority = p;
  ctx.store.updateTask(task.id, { priority: p });
  return ok('todo.setPriority', params, `已将「${task.title}」优先级设为 (${p}) ${PRIORITY_CN[p] || ''}`);
}

function runStar(ctx, intent) {
  const task = findTaskById(ctx, intent.matches[0]);
  const params = { target: targetLabel(intent), title: task ? task.title : '' };
  if (!task) return fail('todo.star', params, '没有找到要星标的任务。');
  ctx.store.updateTask(task.id, { starValue: '1' });
  return ok('todo.star', params, `已星标：${task.title}`);
}

function runAddContext(ctx, intent) {
  const task = findTaskById(ctx, intent.matches[0]);
  const params = { target: targetLabel(intent), title: task ? task.title : '' };
  const c = intent.slots && intent.slots.context;
  if (!task) return fail('todo.tag', params, '没有找到对应的任务。');
  if (!c) return fail('todo.tag', params, '没听清要归到哪个分类，试试「归到 @工作」。');
  params.context = `@${c}`;
  const contexts = Array.from(new Set([...(task.contexts || []), c]));
  ctx.store.updateTask(task.id, { contexts });
  return ok('todo.tag', params, `已将「${task.title}」加入分类 @${c}`);
}

function runAddProject(ctx, intent) {
  const task = findTaskById(ctx, intent.matches[0]);
  const params = { target: targetLabel(intent), title: task ? task.title : '' };
  const p = intent.slots && intent.slots.project;
  if (!task) return fail('todo.tag', params, '没有找到对应的任务。');
  if (!p) return fail('todo.tag', params, '没听清要加哪个标签，试试「打标签 +复盘」。');
  params.project = `+${p}`;
  const projects = Array.from(new Set([...(task.projects || []), p]));
  ctx.store.updateTask(task.id, { projects });
  return ok('todo.tag', params, `已为「${task.title}」添加标签 +${p}`);
}

function runQuery(ctx, intent) {
  const today = ctx.today || dayjs().format('YYYY-MM-DD');
  const keyword = intent && intent.slots ? intent.slots.keyword : null;

  const matchKeyword = (t) =>
    !keyword || String(t.title || '').toLowerCase().includes(String(keyword).toLowerCase());

  // 0 命中分支：有残余关键词 → 询问是否新建（交由 useChatAgent 的澄清框架处理）。
  const emptyReply = (scope) => {
    if (keyword) {
      return {
        reply: `没找到匹配「${keyword}」的任务。你是想新建一条「${keyword}」吗？（回"是"创建）`,
        clarify: { kind: 'create', keyword },
      };
    }
    if (scope === 'done') return { reply: '还没有已完成的任务。' };
    return { reply: '没有匹配的任务。' };
  };

  // done 分支：只读 doneEntries（不改文件），按完成日期倒序。
  if (intent && intent.scope === 'done') {
    const done = (ctx.store.doneEntries || []).filter((e) => e.kind === 'task').filter(matchKeyword);
    const sorted = [...done].sort((a, b) =>
      String(b.completedAt || '').localeCompare(String(a.completedAt || ''))
    );
    const params = { scope: 'done', count: sorted.length };
    if (keyword) params.keyword = keyword;
    if (sorted.length === 0) {
      const e = emptyReply('done');
      return ok('todo.query', params, e.reply, e.clarify ? { clarify: e.clarify } : undefined);
    }
    const lines = sorted.map((t, i) => {
      const n = i + 1;
      const prio = t.priority ? `(${t.priority}) ` : '';
      const when = t.completedAt ? ` · ${t.completedAt} 完成` : '';
      return `${n}. ${prio}${t.title}${when}`;
    });
    return ok('todo.query', params, `共 ${sorted.length} 条已完成任务：\n${lines.join('\n')}`);
  }

  // active 分支：可选按 @分类 + 残余关键词过滤。
  const contextName = intent && intent.slots ? intent.slots.context : null;
  const tasks = (ctx.tasks || [])
    .filter((t) => !contextName || (t.contexts || []).includes(contextName))
    .filter(matchKeyword);
  const params = { scope: 'active', count: tasks.length };
  if (contextName) params.context = `@${contextName}`;
  if (keyword) params.keyword = keyword;

  if (tasks.length === 0) {
    if (keyword) {
      const e = emptyReply('active');
      return ok('todo.query', params, e.reply, { clarify: e.clarify });
    }
    const tail = contextName ? ` @${contextName}` : '';
    return ok('todo.query', params, `当前没有活跃任务${tail} 🎉`);
  }

  const lines = tasks.map((t, i) => {
    const n = i + 1;
    const prio = t.priority ? `(${t.priority}) ` : '';
    let due = '';
    if (t.dueDate) {
      due = t.dueDate < today ? ` ⚠逾期 ${t.dueDate}` : t.dueDate === today ? ' 今天到期' : ` due:${t.dueDate}`;
    }
    return `${n}. ${prio}${t.title}${due}`;
  });
  return ok('todo.query', params, `共 ${tasks.length} 条活跃任务：\n${lines.join('\n')}`);
}

function runUndo(ctx) {
  ctx.store.undo();
  return ok('todo.undo', {}, '已撤销最后一步操作。');
}

// 动作表：键为 intent 名。
export const ACTIONS = {
  add: { id: 'todo.add', label: '新增任务', run: runAdd },
  complete: { id: 'todo.complete', label: '完成任务', run: runComplete },
  uncomplete: { id: 'todo.uncomplete', label: '取消完成', run: runUncomplete },
  delete: { id: 'todo.delete', label: '删除任务', run: runDelete },
  postpone: { id: 'todo.postpone', label: '延期', run: (ctx, intent) => runSetDate(ctx, intent, 'todo.postpone', '延期') },
  setPriority: { id: 'todo.setPriority', label: '设置优先级', run: runSetPriority },
  setDue: { id: 'todo.setDue', label: '设置截止日', run: (ctx, intent) => runSetDate(ctx, intent, 'todo.setDue', '设置截止') },
  star: { id: 'todo.star', label: '星标', run: runStar },
  addContext: { id: 'todo.tag', label: '加分类', run: runAddContext },
  addProject: { id: 'todo.tag', label: '打标签', run: runAddProject },
  query: { id: 'todo.query', label: '查询任务', run: runQuery },
  undo: { id: 'todo.undo', label: '撤销', run: runUndo },
};

/**
 * 执行一个意图。
 * @param {object} intent parseIntent 的结果
 * @param {{store:object, tasks:Array, today:string}} ctx
 * @returns {{ok:boolean, reply:string, tool:{name:string, params:object, status:string}}}
 */
export function dispatch(intent, ctx) {
  const action = ACTIONS[intent && intent.intent];
  if (!action) {
    return {
      ok: false,
      reply: '没听懂这条指令，可以试试：加一条 / 完成 X / 有哪些任务。',
      tool: { name: 'agent.noop', params: {}, status: 'fail' },
    };
  }
  return action.run(ctx, intent, action.id);
}

// 多命中澄清时，根据用户回复的序号/文本选定候选。
export function pickByReply(candidates, replyText) {
  const text = String(replyText || '').trim();
  const m = text.match(/\d+/);
  if (m) {
    const idx = Number(m[0]) - 1;
    return idx >= 0 && idx < candidates.length ? candidates[idx] : null;
  }
  const kw = text.toLowerCase();
  const hits = candidates.filter((c) => String(c.title || '').toLowerCase().includes(kw));
  return hits.length === 1 ? hits[0] : null;
}
