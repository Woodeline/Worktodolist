// 独立设置页：目前是「快捷键速查」+「列表外观」，将来有其它人工填写的参数再往这里追加分组。
//
// 设计约定：
//  1. 设置不是"工作流的一部分"，所以它不是一个页签，而是一张独立页面
//     （从顶栏齿轮 / 应用菜单 / Ctrl+, 进入，Esc 或「返回」退出）。
//  2. 快捷键那一节只读：列的是键盘操作，点不了，也不需要"保存"。
//     列表外观那一节会写本机配置 —— 它是偏好，不是数据，所以不进 todo.txt。
import { PALETTE, colorHex, resolveColorId, useListStyle } from '../lib/listStyle.js';
import Icon from './Icon.jsx';

// 快捷键清单：与各处的实现保持同一份口径（useHotkeys / App 全局键 / ChatPanel 页内键）。
const GROUPS = [
  {
    title: '全局',
    note: '在任意页签都可用。',
    rows: [
      ['Ctrl + 1 / 2 / 3', '切换页签：对话 / 列表 / 工具'],
      ['Ctrl + B', '折叠 / 展开侧栏（列表页）'],
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

// 列表外观：给每个 +项目 挑一个颜色。
//
// **为什么这一节要显示"自动"**：没配过色的项目按名字稳定取色，那个色可能恰好是你想要的。
// 如果不给"回到自动"的出口，用户一旦点过就再也回不去"跟着名字走"，
// 而"显式配成灰色"和"没配过"必须是两种状态 —— 后者会随改名而变化。
function ListStyleSection({ projects }) {
  const { colors, setColor } = useListStyle();

  if (!projects || projects.length === 0) {
    return (
      <section className="settings-group">
        <div className="settings-group-side">
          <h3 className="settings-group-title">列表外观</h3>
          <p className="settings-group-note">
            还没有列表。给任务加上 <code>+项目名</code>，侧栏就会出现一个带色的列表。
          </p>
        </div>
        <div className="settings-fields" />
      </section>
    );
  }

  return (
    <section className="settings-group">
      <div className="settings-group-side">
        <h3 className="settings-group-title">列表外观</h3>
        <p className="settings-group-note">
          每个 +项目 在侧栏显示为一个带色的列表。没挑过的按名字自动取色，同名永远同色。
        </p>
      </div>

      <div className="settings-fields">
        {projects.map(({ name, count }) => {
          const current = resolveColorId(name, colors);
          const pinned = Boolean(colors[name]);
          return (
            <div className="settings-row settings-row-keys" key={name}>
              <span className="settings-label">
                {name}
                {count != null && <span className="settings-label-count">{count}</span>}
              </span>
              <div className="settings-control">
                <div className="swatches" role="group" aria-label={`${name} 的颜色`}>
                  {PALETTE.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      className={'swatch' + (current === p.id ? ' is-on' : '')}
                      style={{ background: colorHex(p.id) }}
                      title={`${p.label}${pinned ? '' : '（当前为自动取色）'}`}
                      aria-label={p.label}
                      aria-pressed={current === p.id}
                      onClick={() => setColor(name, p.id)}
                    />
                  ))}
                  {pinned && (
                    <button
                      type="button"
                      className="swatch-auto"
                      onClick={() => setColor(name, null)}
                      title="回到按名字自动取色"
                    >
                      自动
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

export default function SettingsPage({ onClose, projects }) {
  return (
    <div className="settings">
      <div className="settings-head">
        <button type="button" className="settings-back" onClick={onClose} title="返回（Esc）">
          <Icon name="chevron-left" size={15} />
          <span>返回</span>
        </button>
        <h2 className="settings-title">设置</h2>
        <span className="spacer" />
        <span className="settings-head-note">列表外观存本机 · 快捷键在对应页签内生效</span>
      </div>

      <div className="settings-body">
        <ListStyleSection projects={projects} />
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
          随时可查：活动栏齿轮 / 应用菜单「设置…」/ Ctrl + ,
        </span>
      </div>
    </div>
  );
}
