// QA 专用：极简 React hooks 运行时替身，用于在 Node 无 DOM 环境下驱动真实 useTodoStore。
// 仅实现 useTodoStore 用到的 hooks：useState / useRef / useMemo / useCallback / useEffect。
// 由 qa-react-loader.mjs 把裸说明符 'react' 重定向到本文件，源文件不做任何改动。
// ⚠ 仅供 vi.mock('react') / register-qa-loader.mjs 消费；请勿被依赖真实 React 渲染的测试引用。

let slots = [];
let cursor = 0;
let effectsQueue = [];

function depsEqual(a, b) {
  if (!a || !b) return false;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (!Object.is(a[i], b[i])) return false;
  }
  return true;
}

export function __beginRender() {
  cursor = 0;
  effectsQueue = [];
}

export function __flushEffects() {
  const queue = effectsQueue;
  effectsQueue = [];
  for (const fn of queue) fn();
}

export function __resetHooks() {
  slots = [];
  cursor = 0;
  effectsQueue = [];
}

export function useState(initial) {
  const i = cursor++;
  // 捕获本次渲染所属的 slots 数组实例，而不是闭包引用模块级变量 ——
  // __resetHooks() 会换一个新数组，旧实例（上一个 store）的 setState 闭包
  // （例如一个还没 firing 的 toast 定时器）必须写进已经死掉的旧数组，
  // 否则它会写进当前测试的 state，把正在跑的用例状态搅乱。
  // 这与 React 一致：卸载后的 setState 是无效操作，不会污染别人。
  const host = slots;
  if (host.length <= i) host[i] = typeof initial === 'function' ? initial() : initial;
  const setState = (value) => {
    host[i] = typeof value === 'function' ? value(host[i]) : value;
  };
  return [host[i], setState];
}

export function useRef(initial) {
  const i = cursor++;
  if (slots.length <= i) slots[i] = { current: initial };
  return slots[i];
}

export function useCallback(fn, deps) {
  const i = cursor++;
  const prev = slots[i];
  if (prev && depsEqual(prev.deps, deps)) return prev.fn;
  slots[i] = { fn, deps };
  return fn;
}

export function useMemo(fn, deps) {
  const i = cursor++;
  const prev = slots[i];
  if (prev && depsEqual(prev.deps, deps)) return prev.value;
  const value = fn();
  slots[i] = { value, deps };
  return value;
}

export function useEffect(fn, deps) {
  const i = cursor++;
  const prev = slots[i];
  const changed = !prev || !depsEqual(prev.deps, deps);
  slots[i] = { deps };
  if (changed) effectsQueue.push(fn);
}
