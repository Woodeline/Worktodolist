// AI 配置的共享读取入口。
//
// 为什么需要它：配置本身存在 localStorage（唯一真相），兜底前 useChatAgent
// 会重新读一遍，所以「设置页保存后立刻生效」天然成立。但如果状态行、设置页
// 各存一份 React state，改完配置后界面就会各说各话 —— 那才是"改了没生效"的观感。
// 这里订阅保存/清除事件，让所有读取点在配置变化后一起刷新。
import { useEffect, useState } from 'react';
import {
  DEFAULT_AI_CONFIG,
  aiHost,
  isAiConfigured,
  loadAiConfig,
  subscribeAiConfig,
} from '../lib/aiFallback';

// 「本机有没有落盘配置」必须与「配置是否启用」分开算：
// 用户可能填了地址与 Key 却没打开开关，这时它仍然是一份含明文 Key 的
// 落盘数据 —— 必须允许清除，否则那份 Key 就永远删不掉了。
const read = () => {
  const stored = loadAiConfig();
  return { cfg: stored || { ...DEFAULT_AI_CONFIG }, stored: stored !== null };
};

/**
 * @returns {{aiCfg:object, hasStoredConfig:boolean, aiOn:boolean, aiTarget:string}}
 *   aiCfg           完整配置（未配置时为默认值）
 *   hasStoredConfig 本机是否已存有配置（决定"能不能清除"）
 *   aiOn            是否已配置且启用 —— 决定"要不要发网络请求"的同一判据
 *   aiTarget        会发往的主机名（未启用时为空串）
 */
export default function useAiSettings() {
  const [state, setState] = useState(read);

  useEffect(() => subscribeAiConfig(() => setState(read())), []);

  return {
    aiCfg: state.cfg,
    hasStoredConfig: state.stored,
    aiOn: isAiConfigured(state.cfg),
    aiTarget: aiHost(state.cfg),
  };
}
