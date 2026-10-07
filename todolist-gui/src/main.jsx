import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import { ContextMenuProvider } from './hooks/useContextMenu.jsx';
import './index.css';

// Provider 放在最外层：App 内部的任何组件都能挂自己的右键菜单，
// 且"禁用浏览器默认菜单"这条规则由它统一兜底，不需要每个组件各写一遍。
ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ContextMenuProvider>
      <App />
    </ContextMenuProvider>
  </React.StrictMode>
);
