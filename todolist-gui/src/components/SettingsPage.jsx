// 独立设置页：目前是「快捷键速查」，将来有需要人工填写的参数再往这里追加分组。
//
// 设计约定：
//  1. 设置不是"工作流的一部分"，所以它不是一个页签，而是一张独立页面
//     （从顶栏齿轮 / 应用菜单 / Ctrl+, 进入，Esc 或「返回」退出）。
//  2. 本页只读：列的是键盘操作，不改动任何本机配置，也不需要"保存"。
import Icon from './Icon.jsx';

// 快捷键清单：与各处的实现保持同一份口径（useHotkeys / App 全局键 / ChatPanel 页内键）。
const GROUPS = [
  {
    title: '全局',
    note: '在任意页签都可用。',
    rows: [
      ['Ctrl + 1 / 2 / 3', '切换页签：对话 / 列表 / 工具'],
      ['Ctrl + ,', '打开 / 关闭本设置页'],
      ['Esc', '关闭本设置页'],
    ],
  },
  {
    title: '列表页',
    note: '在输入框里打字时，字母快捷键自动让路，不会抢走你的输入。',
    rows: [
      ['N', '新建任务'],
      ['/', '聚焦搜索框'],
      ['↑ / ↓', '上下移动选中项'],
      ['Enter', '编辑选中任务'],
      ['空格', '完成 / 取消完成当前选中任务'],
      ['E', '编辑当前选中任务'],
      ['Ctrl + Z', '撤销上一步操作'],
      ['Esc', '清空搜索 / 取消选中'],
    ],
  },
  {
    title: '对话页',
    note: '用一句话增删改任务；没听懂时会给出示例指令。',
    rows: [
      ['Enter', '发送（Shift + Enter 换行）'],
      ['↑ / ↓', '翻历史输入'],
      ['Ctrl + Z', '撤销最后一步动作'],
      ['Esc', '清空输入 / 关闭弹窗'],
    ],
  },
];

export default function SettingsPage({ onClose }) {
  return (
    <div className="settings">
      <div className="settings-head">
        <button type="button" className="settings-back" onClick={onClose} title="返回（Esc）">
          <Icon name="chevron-left" size={15} />
          <span>返回</span>
        </button>
        <h2 className="settings-title">设置</h2>
        <span className="spacer" />
        <span className="settings-head-note">本页只读 · 快捷键在对应页签内生效</span>
      </div>

      <div className="settings-body">
        {GROUPS.map((g) => (
          <section className="settings-group" key={g.title}>
            <div className="settings-group-side">
              <h3 className="settings-group-title">{g.title}</h3>
              {g.note && <p className="settings-group-note">{g.note}</p>}
            </div>

            <div className="settings-fields">
              {g.rows.map(([keys, desc]) => (
                <div className="settings-row settings-row-keys" key={keys}>
                  <span className="settings-label">{keys}</span>
                  <div className="settings-control">
                    <span className="settings-range">{desc}</span>
                  </div>
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>

      <div className="settings-foot">
        <span className="spacer" />
        <span className="settings-where">
          随时可查：顶栏齿轮 / 应用菜单「设置…」/ Ctrl + ,
        </span>
      </div>
    </div>
  );
}
