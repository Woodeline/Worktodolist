// 独立设置页：本机偏好 + 数据动作 + 只读快捷键速查。
//
// 设计约定：
//  1. 设置不是"工作流的一部分"，所以它不是一个页签，而是一张独立页面
//     （从活动栏「设置」/ Ctrl+, 进入，Esc 或「返回」退出）。
//  2. 2026-11-19 起入口从应用菜单剥离：活动栏「应用菜单」旁单列一枚设置按钮；
//     页内用左侧分类导航，一档只展示该大类的设置内容。
//  3. 快捷键那三组只读：列的是键盘操作，点不了，也不需要"保存"。
//     外观 / 阅读 / 窗口 / 数据四类会写本机配置 —— 它们是偏好，不是数据，所以不进 todo.txt。
//  4. 「数据」分类（2026-11-14 从底栏搬来）是页面里唯一带真动作的地方：
//     保存状态读数 + 手动重载 / 切换目录。主界面不再常驻这两颗按钮。
//  5. 分类顺序即应用菜单剥离后的收纳顺序：外观（明暗 + 皮肤）、列表与阅读、
//     窗口、数据、快捷键。原应用菜单「外观」「窗口与数据」两组不再存在。
import { useEffect, useRef, useState } from 'react';
import dayjs from 'dayjs';
import { PALETTE, colorHex, resolveColorId, useListStyle } from '../lib/listStyle.js';
import { useListMode } from '../lib/listMode.js';
import {
  CHILD_FONT_VARS,
  DENSITY_FIELDS,
  FONT_TIERS,
  FONT_VARS,
  LIST_ROW_PX,
  NAV_ROW_PX,
  ROW_GLYPH_GAP,
  ROW_TIERS,
  useReadingDensity,
} from '../lib/readingDensity.js';
import Icon from './Icon.jsx';
import { SKINS, SKIN_LABELS, useSkin } from '../lib/skin.js';
import { THEME_ICONS, THEME_LABELS, THEME_MODES } from '../lib/theme.js';

// 键帽：把 "Ctrl + 1 / 2 / 3" 拆成一枚枚可扫的键，分隔符留在中间。
// 纯函数，便于单测与复用；不改变原有字符串内容（速查表的断言仍成立）。
export function splitKeys(text) {
  return text.split(/(\s*[+/]\s*|\s+)/).filter(Boolean);
}

function Keycaps({ text }) {
  return splitKeys(text).map((part, i) =>
    /^\s*[+/]\s*$|^\s+$/.test(part) ? (
      <span className="keycap-sep" key={i}>{part}</span>
    ) : (
      <kbd className="keycap" key={i}>{part}</kbd>
    )
  );
}

// 快捷键清单：与各处的实现保持同一份口径（useHotkeys / App 全局键）。
const GROUPS = [
  {
    title: '全局',
    note: '在任意页签都可用。',
    rows: [
      ['Ctrl + 1 / 2', '切换页签：列表 / 工具'],
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
      ['E', '编辑当前选中任务'],
      ['Ctrl + Z', '撤销上一步操作'],
      ['Esc', '清空搜索 / 取消选中 / 隐藏到托盘'],
    ],
  },
  {
    title: '日历',
    note: '焦点在日期格子上时生效；日详情里的任务行仍按「列表页」那组键操作。',
    rows: [
      ['← / →', '选中日期前后移一天'],
      ['↑ / ↓', '前后移一周（在日详情里改为上下移行）'],
      ['PageUp / PageDown', '上一月 / 下一月'],
      ['Home', '回到今天'],
      ['N / Enter', '在选中那天新建（预填 due:）'],
      ['空格', '选中当前日期'],
    ],
  },
];

// 设置分类：左侧导航与右侧面板共用的唯一顺序来源。
// 分类只负责收纳，具体字段仍按各节自己的组件渲染；不把设置值写进这里。
export const SETTINGS_CATEGORIES = [
  { id: 'appearance', label: '外观', icon: 'palette' },
  { id: 'reading', label: '列表与阅读', icon: 'list-tree' },
  { id: 'window', label: '窗口', icon: 'pin' },
  { id: 'data', label: '数据', icon: 'database' },
  { id: 'shortcuts', label: '快捷键', icon: 'keyboard' },
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

// 阅读密度：侧栏 / 列表的字号与行距。
//
// 交互上不做数值输入 —— 每档按钮自带样张（字号按该档真实字号画「A」，
// 行距按该档真实疏密画三线），点之前看到的就是点之后的；下方迷你登记簿
// 按当前组合实时渲染。档位与映射的单一真相源在 lib/readingDensity.js。
function DensityColumn({ scope, name, cfg, pick }) {
  return (
    <div className="density-col">
      <span className="density-col-name">{name}</span>
      {DENSITY_FIELDS.filter((f) => f.scope === scope).map((f) => {
        const tiers = f.kind === 'font' ? FONT_TIERS : ROW_TIERS;
        return (
          <div className="density-line" key={f.key}>
            <span className="density-line-label">{f.kind === 'font' ? '字号' : '行距'}</span>
            <div className="density-seg" role="group" aria-label={f.label}>
              {tiers.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  className={'density-opt' + (cfg[f.key] === t.id ? ' is-on' : '')}
                  aria-pressed={cfg[f.key] === t.id}
                  onClick={() => pick(f.key, t.id)}
                >
                  {f.kind === 'font' ? (
                    <span className={`density-a density-a-${t.id}`} aria-hidden="true">A</span>
                  ) : (
                    <span
                      className="density-rows"
                      style={{ gap: `${ROW_GLYPH_GAP[t.id]}px` }}
                      aria-hidden="true"
                    >
                      <i /><i /><i />
                    </span>
                  )}
                  <span>{t.label}</span>
                </button>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// 迷你登记簿：左目录右列表，行高 / 字号全按当前档位真实渲染 ——
// 含子任务（小一档）与逾期行（唯一强色），换档时三处一起变。
function DensityPreview({ cfg }) {
  const navH = NAV_ROW_PX[cfg.navRows];
  const rowH = LIST_ROW_PX[cfg.listRows];
  const navFont = FONT_VARS[cfg.navFont];
  const listFont = FONT_VARS[cfg.listFont];
  const childFont = CHILD_FONT_VARS[cfg.listFont];
  return (
    <div className="density-preview" aria-label="阅读密度实时预览">
      <div className="dp-side">
        <span className="dp-nav is-on" style={{ height: `${navH}px`, fontSize: navFont }}>
          今天<span className="dp-count">3</span>
        </span>
        <span className="dp-nav" style={{ height: `${navH}px`, fontSize: navFont }}>
          全部<span className="dp-count">8</span>
        </span>
        <span className="dp-nav" style={{ height: `${navH}px`, fontSize: navFont }}>
          <i className="dp-dot" style={{ background: colorHex('green') }} />
          回测<span className="dp-count">2</span>
        </span>
      </div>
      <div className="dp-list">
        <span className="dp-row" style={{ height: `${rowH}px` }}>
          <i className="dp-check" />
          <span className="dp-title" style={{ fontSize: listFont }}>交周报</span>
          <span className="dp-date">11/09</span>
        </span>
        <span className="dp-row is-child" style={{ height: `${rowH}px` }}>
          <span className="dp-title" style={{ fontSize: childFont }}>整理数据附录</span>
        </span>
        <span className="dp-row is-overdue" style={{ height: `${rowH}px` }}>
          <i className="dp-check" />
          <span className="dp-title" style={{ fontSize: listFont }}>核对军信股份的周线信号</span>
          <span className="dp-date">11/12</span>
        </span>
      </div>
    </div>
  );
}

function DensitySection() {
  const { cfg, pick, reset, isDefault } = useReadingDensity();
  return (
    <section className="settings-group">
      <div className="settings-group-side">
        <h3 className="settings-group-title">阅读密度</h3>
        <p className="settings-group-note">
          侧栏与列表的字号、行距。本机偏好，不写进 todo.txt。
        </p>
      </div>
      <div className="settings-fields">
        <div className="density-grid">
          <DensityColumn scope="nav" name="侧栏" cfg={cfg} pick={pick} />
          <DensityColumn scope="list" name="列表" cfg={cfg} pick={pick} />
        </div>
        <DensityPreview cfg={cfg} />
        {!isDefault && (
          <div className="density-foot">
            <button type="button" className="density-reset" onClick={reset}>
              恢复默认
            </button>
          </div>
        )}
      </div>
    </section>
  );
}

// 显示模式：与顶栏分段开关、应用菜单读的是同一份 configStore（一个能力一个键）。
// 这里再放一份，是为了让「从设置页进来的人」也能找到它，并且把红线写清楚：
// 选的是本机怎么排任务，不是写进 todo.txt 的字段。
function DisplayModeSection() {
  const [mode, pickMode] = useListMode();
  return (
    <section className="settings-group">
      <div className="settings-group-side">
        <h3 className="settings-group-title">显示模式</h3>
        <p className="settings-group-note">
          清单可以按行读，也可以按日期摊开。这是本机偏好，不写进 todo.txt —— 换台机器打开同一份文件，各看各的。
        </p>
      </div>
      <div className="settings-fields">
        <div className="mode-switch" role="group" aria-label="显示模式（本机偏好）">
          <button
            type="button"
            className={'mode-btn' + (mode === 'list' ? ' active' : '')}
            aria-pressed={mode === 'list'}
            onClick={() => pickMode('list')}
            title="按行看清单"
          >
            <Icon name="list" size={14} />
            <span>列表（按行）</span>
          </button>
          <button
            type="button"
            className={'mode-btn' + (mode === 'calendar' ? ' active' : '')}
            aria-pressed={mode === 'calendar'}
            onClick={() => pickMode('calendar')}
            title="按日期摊开（双击日期新建 · 拖任务改期）"
          >
            <Icon name="calendar" size={14} />
            <span>日历（按日期）</span>
          </button>
        </div>
      </div>
    </section>
  );
}

// 明暗模式：三档直接落档，和活动栏那枚轮换按钮读同一份 configStore。
// 2026-11-19 从应用菜单「外观」组搬来；按钮图标与活动栏共用 THEME_ICONS。
function ThemeSection({ themeMode = 'auto', onPickTheme }) {
  const current = THEME_MODES.includes(themeMode) ? themeMode : 'auto';
  return (
    <section className="settings-group">
      <div className="settings-group-side">
        <h3 className="settings-group-title">明暗模式</h3>
        <p className="settings-group-note">
          跟随系统，或固定浅色 / 深色。与活动栏主题按钮写同一份本机偏好。
        </p>
      </div>
      <div className="settings-fields">
        <div className="mode-switch theme-switch" role="group" aria-label="明暗模式（本机偏好）">
          {THEME_MODES.map((m) => (
            <button
              key={m}
              type="button"
              data-theme-mode={m}
              className={'mode-btn' + (current === m ? ' active' : '')}
              aria-pressed={current === m}
              onClick={() => onPickTheme && onPickTheme(m)}
            >
              <Icon name={THEME_ICONS[m]} size={14} />
              <span>{THEME_LABELS[m]}</span>
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}

// 外观主题：四档皮肤（原版 / 素纸 / 夜航 / 园庭），与明暗档位正交。
// 按钮上那三枚小样读 §1 的 --sw-* 样张令牌：画的是「目标档长什么样」，
// 不是当前生效色 —— 否则在夜航里看夜航的样张就只剩一片黑。
function SkinSection() {
  const [skin, pick] = useSkin();
  return (
    <section className="settings-group">
      <div className="settings-group-side">
        <h3 className="settings-group-title">外观主题</h3>
      </div>
      <div className="settings-fields">
        <div className="skin-switch" role="group" aria-label="外观主题（本机偏好）">
          {SKINS.map((s) => (
            <button
              key={s}
              type="button"
              data-skin={s}
              className={'skin-btn' + (skin === s ? ' active' : '')}
              aria-pressed={skin === s}
              onClick={() => pick(s)}
            >
              <span className="skin-sw" aria-hidden="true">
                <i className="sw-bg" />
                <i className="sw-surface" />
                <i className="sw-accent" />
              </span>
              <span>{SKIN_LABELS[s]}</span>
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}

// 数据：保存状态 + 两个以前挂在底栏上的动作。
//
// 2026-11-14 底栏整行删掉后，主界面不再报「已保存 / 上次保存」，
// 但这件事不能凭空消失 —— 挪到这里，顺手把「手动重载 / 切换目录」也收进来。
// 页面因此不再是纯只读：快捷键三节仍然只读，数据这两颗按钮是真动作。
function DataSection({ store }) {
  if (!store) return null;
  const savedAt = store.lastSavedAt ? dayjs(store.lastSavedAt).format('HH:mm:ss') : '—';
  const stateText = store.conflict
    ? '外部修改待处理'
    : store.saveStatus === 'unsaved'
      ? '未保存'
      : '已保存';
  const lines = (store.todoEntries || []).filter((e) => e.kind === 'task').length;

  return (
    <section className="settings-group">
      <div className="settings-group-side">
        <h3 className="settings-group-title">数据</h3>
        <p className="settings-group-note">
          todo.txt / done.txt 在本机的读写。文件被外部程序改过、或换了数据目录，从这里重来一次。
        </p>
      </div>
      <div className="settings-fields">
        <div className="settings-row">
          <span className="settings-label">保存状态</span>
          <div className="settings-control">
            <span className="settings-range">
              {stateText} · 上次 {savedAt} · {lines} 条任务
            </span>
          </div>
        </div>
        <div className="settings-actions">
          <button type="button" className="btn" onClick={() => store.manualReload()}>
            手动重载
          </button>
          <button type="button" className="btn" onClick={() => store.pickDirectory()}>
            切换目录
          </button>
        </div>
      </div>
    </section>
  );
}

// 窗口置顶：2026-11-19 从应用菜单「窗口与数据」组搬来。
// 状态真相在壳里，设置页只拿 App 投影出来的 onTop 与 toggle；
// 活动栏图钉、托盘菜单、这里三处读同一份广播。
function WindowSection({ alwaysOnTop = false, onToggleTop }) {
  const on = Boolean(alwaysOnTop);
  return (
    <section className="settings-group">
      <div className="settings-group-side">
        <h3 className="settings-group-title">窗口置顶</h3>
        <p className="settings-group-note">
          总在最前。与活动栏图钉、托盘菜单共用同一份状态。
        </p>
      </div>
      <div className="settings-fields">
        <div className="settings-row">
          <span className="settings-label">保持最前</span>
          <div className="settings-control">
            <button
              type="button"
              role="switch"
              aria-checked={on}
              className={'settings-switch' + (on ? ' is-on' : '')}
              onClick={() => onToggleTop && onToggleTop()}
            >
              <span className="settings-switch-track" aria-hidden="true">
                <span className="settings-switch-thumb" />
              </span>
              <span className="settings-switch-text">{on ? '已置顶' : '未置顶'}</span>
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}

export default function SettingsPage({ onClose, projects, store, themeMode = 'auto', onPickTheme, alwaysOnTop = false, onToggleTop }) {
  const firstCategory = SETTINGS_CATEGORIES[0].id;
  const [active, setActive] = useState(firstCategory);
  const paneRef = useRef(null);
  const tabRefs = useRef([]);

  // 分类切换后回到该分类顶部；否则从长分类切到短分类会停在旧滚动位置，像页面空了。
  useEffect(() => {
    if (paneRef.current) paneRef.current.scrollTop = 0;
  }, [active]);

  // 左侧分类是 tablist：↑↓ / ←→ / Home / End 在分类间移动，focus 跟着按下项走。
  const onNavKeyDown = (e, index) => {
    let next = null;
    if (e.key === 'ArrowDown' || e.key === 'ArrowRight') next = (index + 1) % SETTINGS_CATEGORIES.length;
    else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
      next = (index - 1 + SETTINGS_CATEGORIES.length) % SETTINGS_CATEGORIES.length;
    } else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = SETTINGS_CATEGORIES.length - 1;
    if (next == null) return;
    e.preventDefault();
    const category = SETTINGS_CATEGORIES[next];
    setActive(category.id);
    requestAnimationFrame(() => {
      if (tabRefs.current[next]) tabRefs.current[next].focus();
    });
  };

  const is = (id) => active === id;
  const panel = (id) => ({
    id: `settings-panel-${id}`,
    role: 'tabpanel',
    'aria-labelledby': `settings-tab-${id}`,
    hidden: !is(id),
  });

  return (
    <div className="settings">
      <div className="settings-head">
        <button type="button" className="settings-back" onClick={onClose} title="返回（Esc）">
          <Icon name="chevron-left" size={16} />
          <span>返回</span>
        </button>
        <h2 className="settings-title">设置</h2>
        <span className="spacer" />
        <span className="settings-head-note">本机偏好 · 快捷键速查只读</span>
      </div>

      <div className="settings-main">
        <aside className="settings-nav" aria-label="设置分类">
          <div className="settings-nav-list" role="tablist" aria-orientation="vertical">
            {SETTINGS_CATEGORIES.map((category, index) => (
              <button
                key={category.id}
                type="button"
                id={`settings-tab-${category.id}`}
                role="tab"
                aria-selected={is(category.id)}
                aria-controls={`settings-panel-${category.id}`}
                tabIndex={is(category.id) ? 0 : -1}
                className={'settings-nav-item' + (is(category.id) ? ' is-active' : '')}
                onClick={() => setActive(category.id)}
                onKeyDown={(e) => onNavKeyDown(e, index)}
                ref={(el) => { tabRefs.current[index] = el; }}
              >
                <Icon name={category.icon} size={16} className="settings-nav-icon" />
                <span className="settings-nav-label">{category.label}</span>
              </button>
            ))}
          </div>
        </aside>

        <div className="settings-pane" ref={paneRef}>
          <div className="settings-inner">
            <section className="settings-cat" data-category="appearance" {...panel('appearance')}>
              <ThemeSection themeMode={themeMode} onPickTheme={onPickTheme} />
              <SkinSection />
            </section>

            <section className="settings-cat" data-category="reading" {...panel('reading')}>
              <ListStyleSection projects={projects} />
              <DensitySection />
              <DisplayModeSection />
            </section>

            <section className="settings-cat" data-category="window" {...panel('window')}>
              <WindowSection alwaysOnTop={alwaysOnTop} onToggleTop={onToggleTop} />
            </section>

            <section className="settings-cat" data-category="data" {...panel('data')}>
              <DataSection store={store} />
            </section>

            <section className="settings-cat" data-category="shortcuts" {...panel('shortcuts')}>
              {GROUPS.map((g) => (
                <section className="settings-group" key={g.title}>
                  <div className="settings-group-side">
                    <h3 className="settings-group-title">{g.title}</h3>
                    {g.note && <p className="settings-group-note">{g.note}</p>}
                  </div>

                  <div className="settings-fields">
                    {g.rows.map(([keys, desc]) => (
                      <div className="settings-row settings-row-keys" key={keys}>
                        <span className="settings-label"><Keycaps text={keys} /></span>
                        <div className="settings-control">
                          <span className="settings-range">{desc}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              ))}
            </section>
          </div>
        </div>
      </div>

      <div className="settings-foot">
        <span className="spacer" />
        <span className="settings-where">随时可查：活动栏「设置」/ Ctrl + ,</span>
      </div>
    </div>
  );
}
