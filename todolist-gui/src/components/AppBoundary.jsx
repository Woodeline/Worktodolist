// 应用级错误边界：任何一次渲染异常都不许把界面变成一块白板。
//
// 为什么必须有：React 18 在渲染期抛异常、而树上没有边界时，会**卸载整棵 root** ——
// 用户看到的不是报错，而是"界面没了、点什么都没反应"，跟卡死一模一样，而且控制台
// 之外没有任何线索（桌面应用没有 F12 的习惯）。v1.1.0 在 Windows 上「点编辑 → 卡死
// 且看不到界面」就是这个形态：一个组件里的 Hooks 违规抛了错，整棵树被带走。
//
// 根因当然要修，但边界要留着：下一次再出错时，用户至少能看到"出了什么事"、
// 能自己点一下恢复，而不是对着白窗口猜。工具页那边已有 ToolBoundary 做同样的事，
// 那一层按工具隔离，这一层是最后一道 —— 它兜的是工具之外的一切。
//
// 恢复只给「重新载入」：出错后组件树的状态已经不可信，原地重试多半会立刻再崩一次，
// 那时用户只会觉得"这个按钮也是坏的"。
import { Component } from 'react';
import Icon from './Icon.jsx';

export default class AppBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null, where: '' };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // eslint-disable-next-line no-console
    console.error('[app crash]', error, info);
    // 组件栈留在 state 里：message 只说"more hooks"这种黑话，而"哪个组件挂的"
    // 恰好是错误对象本身不带的信息。只取最相关的 3 层。
    const frames = String((info && info.componentStack) || '')
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 3)
      .join(' ← ');
    if (frames) this.setState({ where: frames });
  }

  render() {
    if (!this.state.error) return this.props.children;
    const err = this.state.error;
    return (
      <div className="app-crash" role="alert">
        <div className="app-crash-card">
          <div className="app-crash-main">
            <span className="app-crash-icon">
              <Icon name="alert-triangle" size={20} />
            </span>
            <div>
              <p className="app-crash-title">界面刚刚出错了</p>
              <p className="app-crash-msg">{String((err && err.message) || err)}</p>
              {this.state.where ? (
                <p className="app-crash-where">出错的组件：{this.state.where}</p>
              ) : null}
            </div>
          </div>
          <p className="app-crash-hint">
            你的 todo.txt 没有被改动 —— 出错发生在界面绘制这一步，没碰过磁盘上的文件。
            重新载入即可继续用；如果这个错误反复出现，把上面这行字发出来就够了。
          </p>
          <div className="app-crash-actions">
            <button type="button" className="btn btn-primary" onClick={() => window.location.reload()}>
              重新载入
            </button>
          </div>
        </div>
      </div>
    );
  }
}
