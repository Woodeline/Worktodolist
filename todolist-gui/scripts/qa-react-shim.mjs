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
  if (slots.length <= i) slots[i] = typeof initial === 'function' ? initial() : initial;
  const setState = (value) => {
    slots[i] = typeof value === 'function' ? value(slots[i]) : value;
  };
  return [slots[i], setState];
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
