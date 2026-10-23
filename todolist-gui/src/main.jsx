import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import AppBoundary from './components/AppBoundary.jsx';
import { ContextMenuProvider } from './hooks/useContextMenu.jsx';
import './index.css';

// Provider 放在最外层：App 内部的任何组件都能挂自己的右键菜单，
// 且"禁用浏览器默认菜单"这条规则由它统一兜底，不需要每个组件各写一遍。
//
// AppBoundary 再包一层：渲染期异常在没有边界时会被 React 当成"整棵树不能要了"，
// 表现是白屏 + 点哪都没反应（跟卡死一样）。有了它，出错时用户至少看得到现场。
ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <AppBoundary>
      <ContextMenuProvider>
        <App />
      </ContextMenuProvider>
    </AppBoundary>
  </React.StrictMode>
);
