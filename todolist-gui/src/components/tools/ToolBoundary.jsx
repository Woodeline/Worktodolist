// 工具级错误边界：任何一个工具抛异常都不许带走整个页面。
//
// 为什么这是必需而非可选：用户在列表页存在未保存改动时，一个工具抛异常会把
// 整棵 React 树带走 —— 改动一起没了。工具数量从 1 涨到 10 之后，这是必然会发生
// 的事故，不是概率问题。越往后工具越可能吃"外部输入"（用户文件、网络响应），
// 越需要隔离。
//
// 边界是**按工具**的：切换工具即换一个出错现场，必须复位，否则"重试"按钮
// 永远只在最初坏掉的那个工具上有意义。
import { Component } from 'react';
import Icon from '../Icon.jsx';

export default class ToolBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null, where: '' };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // 原始堆栈留给控制台
    // eslint-disable-next-line no-console
    console.error('[tool crash]', this.props.toolId, error, info);
    // 组件栈留在 state 里：出错页只说一句 message 等于没定位能力，
    // 而"哪个子组件挂的"恰好是错误对象本身不带的信息。
    // 只取最相关的 3 层，避免把整页菜单写成一大坨。
    const frames = String((info && info.componentStack) || '')
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 3)
      .join(' ← ');
    if (frames) this.setState({ where: frames });
  }

  componentDidUpdate(prev) {
    if (prev.toolId !== this.props.toolId && this.state.error) this.setState({ error: null });
  }

  render() {
    if (this.state.error) {
      const err = this.state.error;
      return (
        <div className="tool-crash" role="alert">
          <div className="tool-crash-main">
            <span className="tool-crash-icon">
              <Icon name="alert-triangle" size={18} />
            </span>
            <div>
              <p className="tool-crash-title">这个工具刚刚出错了</p>
              <p className="tool-crash-msg">{String((err && err.message) || err)}</p>
              {this.state.where && <p className="tool-crash-where">出错的组件：{this.state.where}</p>}
            </div>
          </div>
          <div className="tool-crash-actions">
            <button type="button" className="btn btn-primary" onClick={() => this.setState({ error: null })}>
              重试
            </button>
            <span className="tool-hint">
              只影响这一个工具：你的 todo.txt 没有被改动，换别的工具可以照常用。
            </span>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
