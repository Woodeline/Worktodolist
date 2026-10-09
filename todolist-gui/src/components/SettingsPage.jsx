// 独立设置页：集中管理所有需要人工填写的参数。
//
// 设计约定：
//  1. 设置不是"工作流的一部分"，所以它不是一个页签，而是一张独立页面
//     （从顶栏齿轮 / 应用菜单 / Ctrl+, 进入，Esc 或「返回」退出）。
//  2. 草稿与已保存配置分离：改动中的值只活在本组件里，点保存才落盘，
//     所以不存在"边打字边生效"的不确定状态；未保存时页头会明示。
//  3. 「测试连接」故意测草稿而非已保存值 —— 填完先验证，再决定要不要保存。
//
// 范围收紧（2026-10-07）：原先这里还有第二组「联网工具」（总闸 / 主机白名单 /
// 超时 / 响应上限）供 T4 联网工具使用。该工具已移除，整组连同 lib/net/ 一并撤掉 ——
// 现在设置页只剩 AI 兜底一组，"本机会不会把数据发出去"的答案收敛成一个开关。
import { useEffect, useMemo, useState } from 'react';
import {
  AI_LIMITS,
  DEFAULT_AI_CONFIG,
  aiHost,
  clearAiConfig,
  loadAiConfig,
  normalizeAiConfig,
  saveAiConfig,
  testAiConnection,
} from '../lib/aiFallback';
import useAiSettings from '../hooks/useAiSettings';
import Icon from './Icon.jsx';

const readDraft = () => normalizeAiConfig(loadAiConfig() || DEFAULT_AI_CONFIG);

function sameAi(a, b) {
  return (
    a.enabled === b.enabled &&
    a.baseUrl === b.baseUrl &&
    a.apiKey === b.apiKey &&
    a.model === b.model &&
    a.timeoutMs === b.timeoutMs &&
    a.maxRetries === b.maxRetries
  );
}

export default function SettingsPage({ onClose }) {
  const { aiCfg, aiOn, aiTarget } = useAiSettings();
  const [draft, setDraft] = useState(readDraft);
  const [testing, setTesting] = useState(false);
  const [test, setTest] = useState(null);

  // 配置在别处被保存/清除时（例如点了「清除配置」），草稿回到已保存状态，
  // 避免界面继续展示一份已经不存在于本机的配置。
  useEffect(() => {
    setDraft(normalizeAiConfig(aiCfg));
  }, [aiCfg]);

  const aiDraft = useMemo(() => normalizeAiConfig(draft), [draft]);
  const dirty = !sameAi(normalizeAiConfig(aiCfg), aiDraft);
  const previewHost = aiHost(aiDraft);
  // 「本机有没有落盘配置」必须与「是否启用」分开算：用户可能填了地址与 Key
  // 却没打开开关，那仍是含明文 Key 的落盘数据 —— 必须允许清除。
  const hasStoredAnything = Boolean(loadAiConfig());

  const patchAi = (p) => {
    setTest(null);
    setDraft((d) => ({ ...d, ...p }));
  };

  const doSave = () => {
    saveAiConfig(draft);
    setDraft(readDraft());
  };

  const doReset = () => {
    setTest(null);
    setDraft(normalizeAiConfig(aiCfg));
  };

  const doClear = () => {
    setTest(null);
    clearAiConfig();
  };

  const doTest = async () => {
    setTesting(true);
    setTest(null);
    try {
      setTest(await testAiConnection(aiDraft));
    } catch (err) {
      setTest({
        ok: false,
        stage: 'error',
        detail: `自检本身异常：${(err && err.message) || err}`,
        latencyMs: 0,
      });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="settings">
      <div className="settings-head">
        <button type="button" className="settings-back" onClick={onClose} title="返回（Esc）">
          <Icon name="chevron-left" size={15} />
          <span>返回</span>
        </button>
        <h2 className="settings-title">设置</h2>
        {dirty && <span className="settings-badge">未保存</span>}
        <span className="spacer" />
        <span className="settings-head-note">配置只存在本机浏览器里，不随 todo.txt 同步</span>
      </div>

      <div className="settings-body">
        <section className="settings-group">
          <div className="settings-group-side">
            <h3 className="settings-group-title">AI 兜底解析</h3>
            <p className="settings-group-note">
              只在本地规则引擎<b>没听懂</b>时才会调用它。打开后，没被认出来的句子会被发往你填的服务地址；
              能被本地认出来的句子<b>永远不联网</b>。
            </p>
            <p className="settings-group-note">
              API Key 以明文存在本机 localStorage，本机上的其它程序可以读到，请自行评估风险；
              不填 Key 就等于彻底关闭。
            </p>
          </div>

          <div className="settings-fields">
            <div className="settings-row">
              <span className="settings-label">启用</span>
              <div className="settings-control">
                <label className="settings-check">
                  <input
                    type="checkbox"
                    checked={Boolean(draft.enabled)}
                    onChange={(e) => patchAi({ enabled: e.target.checked })}
                  />
                  <span className="settings-check-text">本地没听懂时，允许把这句发往远端模型</span>
                </label>
                {aiDraft.enabled && !aiDraft.apiKey && (
                  <span className="settings-warn">还没填 Key，实际仍不会发出任何请求</span>
                )}
              </div>
            </div>

            <div className="settings-row">
              <label className="settings-label" htmlFor="set-baseurl">
                服务地址
              </label>
              <div className="settings-control">
                <input
                  id="set-baseurl"
                  type="text"
                  value={draft.baseUrl}
                  onChange={(e) => patchAi({ baseUrl: e.target.value })}
                  placeholder="https://api.openai.com/v1"
                  spellCheck={false}
                  autoComplete="off"
                />
                <span className="settings-range">OpenAI 兼容接口的 /v1 根地址</span>
              </div>
            </div>

            <div className="settings-row">
              <label className="settings-label" htmlFor="set-model">
                模型
              </label>
              <div className="settings-control">
                <input
                  id="set-model"
                  type="text"
                  value={draft.model}
                  onChange={(e) => patchAi({ model: e.target.value })}
                  placeholder="gpt-4o-mini"
                  spellCheck={false}
                  autoComplete="off"
                />
                <span className="settings-range">写服务商文档里的模型名</span>
              </div>
            </div>

            <div className="settings-row">
              <label className="settings-label" htmlFor="set-key">
                API Key
              </label>
              <div className="settings-control">
                <input
                  id="set-key"
                  type="password"
                  value={draft.apiKey}
                  onChange={(e) => patchAi({ apiKey: e.target.value })}
                  placeholder="sk-..."
                  spellCheck={false}
                  autoComplete="off"
                />
                <span className="settings-range">留空 = 关闭（与「启用」勾选状态无关）</span>
              </div>
            </div>

            <div className="settings-row">
              <label className="settings-label" htmlFor="set-timeout">
                单次超时
              </label>
              <div className="settings-control">
                <input
                  id="set-timeout"
                  type="number"
                  min={AI_LIMITS.timeoutMs.min}
                  max={AI_LIMITS.timeoutMs.max}
                  step="1000"
                  value={draft.timeoutMs}
                  onChange={(e) => patchAi({ timeoutMs: e.target.value })}
                  onBlur={() => setDraft((d) => normalizeAiConfig(d))}
                />
                <span className="settings-range">
                  毫秒（{AI_LIMITS.timeoutMs.min}–{AI_LIMITS.timeoutMs.max}），超出即放弃并退回「没听懂」
                </span>
              </div>
            </div>

            <div className="settings-row">
              <label className="settings-label" htmlFor="set-retries">
                失败重试
              </label>
              <div className="settings-control">
                <input
                  id="set-retries"
                  type="number"
                  min={AI_LIMITS.maxRetries.min}
                  max={AI_LIMITS.maxRetries.max}
                  step="1"
                  value={draft.maxRetries}
                  onChange={(e) => patchAi({ maxRetries: e.target.value })}
                  onBlur={() => setDraft((d) => normalizeAiConfig(d))}
                />
                <span className="settings-range">
                  次（{AI_LIMITS.maxRetries.min}–{AI_LIMITS.maxRetries.max}），只对 5xx 与网络错误重试，
                  4xx（Key 错 / 模型名错）不重试
                </span>
              </div>
            </div>

            {test && (
              <div className={'ai-test-result' + (test.ok ? ' ok' : ' fail')}>
                {test.ok ? '✓ ' : '✕ '}
                {test.detail}
              </div>
            )}
          </div>
        </section>
      </div>

      <div className="settings-foot">
        <button
          type="button"
          className="btn btn-primary"
          onClick={doSave}
          disabled={!dirty}
          title={dirty ? '保存到本机（不影响 todo.txt）' : '没有未保存的改动'}
        >
          保存
        </button>
        <button
          type="button"
          className="btn"
          onClick={doReset}
          disabled={!dirty}
          title={dirty ? '丢弃这次改动，回到已保存的配置' : '没有未保存的改动'}
        >
          放弃改动
        </button>
        <button type="button" className="btn" onClick={doTest} disabled={testing}>
          {testing ? '测试中…' : '测试 AI 连接'}
        </button>
        <button type="button" className="btn btn-danger" onClick={doClear} disabled={!hasStoredAnything}>
          清除配置
        </button>
        <span className="spacer" />
        <span className="settings-where">
          {aiOn ? `AI 兜底会发往：${aiTarget}` : '当前不会发出任何网络请求'}
          {dirty && previewHost && previewHost !== aiTarget ? ` · 保存后发往：${previewHost}` : ''}
        </span>
      </div>
    </div>
  );
}
