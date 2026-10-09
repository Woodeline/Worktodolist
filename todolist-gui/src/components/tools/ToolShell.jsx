// 工具骨架（ToolShell）—— 把"工具页的公共外观"从具体工具里抽出来。
//
// 抽出之前，页签条、保存徽标、导出/导入动作组、滚动容器、stale 提示、
// 工具内 toast、粘贴弹窗外壳，这七件全写在 RtiTool 自己身上（只是用了 rti- 前缀）。
// 第二个数据型工具出现时，它们会被整样复制一遍 —— 那之后两份样式各自演化。
//
// 三种版式（由 registry 的 layout 声明，骨架据此选择主体排布）：
//   instant    单行输入即出结果：窄栏居中，无页签、无保存、无导出
//   inspector  左输入右侧结果（或上输入下结果）：**只有传了 aside 才分栏**，
//              单列时是"上输入下结果"的纵向流 —— 分栏靠 .is-split 显式开启，
//              免得没传 aside 的工具被塞进 280–360px 的第一列、右侧留一整片空白
//   workbench  横向铺开：整幅宽度，适合"文件 + 大文本区 + 过滤 + 结果表"
//
// 硬原则：这个组件**不认识任何具体工具**。它只提供版式与七件公共设施，
// 内容一律由调用方传进来。所以"再加一个工具"不会让它变大。
const LAYOUTS = new Set(['instant', 'inspector', 'workbench']);

export default function ToolShell({
  layout = 'workbench',
  // 页签条（工具自己有多个页面时才传）
  tabs = null,
  activeTab = null,
  onTabChange = null,
  // 右上角的公共动作：保存徽标 → 自定义节点 → 导出/导入
  saveText = null,
  status = null,
  actions = [],
  importAccept = null,
  onImport = null,
  importLabel = '导入数据',
  // 需要用户注意的一行话（结果落后 / 目录未授权 / 降级模式…）
  hint = null,
  hintTone = 'warn',
  toast = null,
  paste = null,
  // inspector 版的左列
  aside = null,
  children,
}) {
  const safeLayout = LAYOUTS.has(layout) ? layout : 'workbench';
  const hasBar = Boolean(tabs || saveText || status || actions.length || importAccept);

  return (
    <div className={'tool tool-' + safeLayout}>
      {hasBar && (
        <div className="tool-bar">
          {tabs && tabs.length > 0 && (
            <div className="tool-tabs" role="tablist">
              {tabs.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  role="tab"
                  aria-selected={activeTab === t.id}
                  className={'tool-tab' + (activeTab === t.id ? ' is-on' : '')}
                  onClick={() => onTabChange && onTabChange(t.id)}
                >
                  {t.label}
                </button>
              ))}
            </div>
          )}
          <span className="tool-spring" />
          {status}
          {saveText && <span className="tool-save">{saveText}</span>}
          {actions.map((a) => (
            <button
              key={a.label}
              type="button"
              className={'btn btn-sm' + (a.primary ? ' btn-primary' : '')}
              title={a.title || a.label}
              disabled={a.disabled}
              onClick={a.onClick}
            >
              {a.label}
            </button>
          ))}
          {importAccept && onImport && (
            <>
              <button type="button" className="btn btn-sm" onClick={(e) => e.currentTarget.nextSibling.click()}>
                {importLabel}
              </button>
              <input
                type="file"
                accept={importAccept}
                hidden
                onChange={(e) => {
                  const input = e.target;
                  onImport(input);
                  // 允许连续导入同一个文件
                  setTimeout(() => {
                    input.value = '';
                  }, 0);
                }}
              />
            </>
          )}
        </div>
      )}

      <div className={'tool-body' + (safeLayout === 'workbench' ? ' is-wide' : '')}>
        {hint && <p className={'tool-hint is-' + hintTone + ' tool-stale'}>{hint}</p>}
        {safeLayout === 'inspector' && aside ? (
          <div className="tool-layout tool-layout-inspector is-split">
            <div className="tool-col tool-col-in">{aside}</div>
            <div className="tool-col tool-col-out">{children}</div>
          </div>
        ) : (
          <div className={'tool-layout tool-layout-' + safeLayout}>{children}</div>
        )}
      </div>

      {/* 粘贴导入弹窗：外壳统一渲染，工具只给标题 / 提示 / 解析回调 */}
      {paste && (
        <div className="modal" onClick={(e) => e.target === e.currentTarget && paste.close()}>
          <div className="modal-card">
            <h3>{paste.title}</h3>
            <textarea
              className="paste-text"
              spellCheck={false}
              value={paste.text}
              autoFocus
              onChange={(e) => paste.setText(e.target.value)}
            />
            <p className="paste-hint">{paste.error || paste.hint}</p>
            <div className="modal-actions">
              <button type="button" className="btn" onClick={paste.close}>
                取消
              </button>
              <button type="button" className="btn btn-primary" onClick={paste.apply}>
                解析并填充
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div className="toast tool-toast">
          <span>{toast}</span>
        </div>
      )}
    </div>
  );
}
