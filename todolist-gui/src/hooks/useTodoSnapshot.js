// useTodoSnapshot —— 把唯一 store 投影成只读子集。
//
// 薄封装：派生全在 lib/todoSnapshot.js（纯函数、可单测），这里只负责
// 「依赖变化时重算 + 不在渲染期造第二份状态」。
//
// 注意依赖表：只盯**数据与状态**，不盯列表页的 UI 状态（sortMode / view 只当作
// 输入读取一次）。这样列表页里输入搜索词、聚焦某一行都不会触发工具页重算。
import { useMemo } from 'react';
import dayjs from 'dayjs';
import { buildTodoSnapshot } from '../lib/todoSnapshot.js';

export function useTodoSnapshot(store, today) {
  const todoEntries = store && store.todoEntries;
  const doneEntries = store && store.doneEntries;
  const sortMode = store && store.sortMode;
  const dirReady = store && store.dirReady;
  const saveStatus = store && store.saveStatus;
  const lastSavedAt = store && store.lastSavedAt;
  const view = store && store.view;

  return useMemo(
    () =>
      buildTodoSnapshot({
        todoEntries: todoEntries || [],
        doneEntries: doneEntries || [],
        today: today || dayjs().format('YYYY-MM-DD'),
        sortMode: sortMode || 'auto',
        dirReady: Boolean(dirReady),
        saveStatus: saveStatus || 'saved',
        lastSavedAt: lastSavedAt || null,
        view: view || 'today',
      }),
    [todoEntries, doneEntries, sortMode, dirReady, saveStatus, lastSavedAt, view, today]
  );
}
