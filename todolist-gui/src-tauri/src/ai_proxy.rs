//! AI 兜底转发代理。逐条移植 `vite.config.js` 里的 `resolveProxyTarget` + `aiProxy`。
//!
//! 为什么必须搬：浏览器版靠 Vite 的 proxy 中间件绕 CORS；Tauri 下页面来源是
//! `tauri://localhost`，既没有 Vite 也没有同源 localhost，所以出机这件事只能在壳里做。
//!
//! 两条防线与浏览器版完全一致，一条不多一条不少：
//!   1. 只接受绝对的 http(s) URL；
//!   2. 拒绝回环 / 内网网段目标（防 SSRF 跳板），除非在 `TODOLIST_AI_ALLOW_HOSTS`
//!      里显式放行（逗号分隔的精确主机名）——本地大模型走这条例外通道。
//!
//! 有意保留的行为细节：被拒绝时返回 **403 + 固定文案 `target rejected…`**，
//! 而不是返回 Err。因为前端 `testAiConnection` 正是靠「状态码 403 + 正文含
//! target rejected」把「本地代理拒绝」与「上游自己的 403」区分开的，换一种
//! 错误传递方式会让那一档诊断失效。

use std::time::Duration;

use serde::Serialize;

#[derive(Serialize)]
pub struct AiResponse {
    pub ok: bool,
    pub status: u16,
    pub body: String,
}

const REJECT_BODY: &str = "ai-proxy: target rejected (not in allowlist / not public http[s])";

fn allowed_hosts() -> Vec<String> {
    std::env::var("TODOLIST_AI_ALLOW_HOSTS")
        .unwrap_or_default()
        .split(',')
        .map(|s| s.trim().to_ascii_lowercase())
        .filter(|s| !s.is_empty())
        .collect()
}

/// 判断主机名是否属于「回环 / 内网 / 链路本地」。
/// 与 JS 版一致地覆盖 IPv4、IPv4-mapped IPv6、IPv6 回环；另外补了 ULA 与
/// 链路本地 IPv6 前缀——这两类同样只可能是内网。
fn is_private_host(raw: &str) -> bool {
    let h = raw.trim().to_ascii_lowercase();
    let h = h.trim_start_matches('[').trim_end_matches(']');
    if h.is_empty() {
        return true;
    }
    if h == "localhost" || h.ends_with(".localhost") {
        return true;
    }
    if h == "::1" || h == "::" || h == "0.0.0.0" {
        return true;
    }
    if h.starts_with("127.") || h.starts_with("10.") || h.starts_with("192.168.") {
        return true;
    }
    if h.starts_with("169.254.") || h.starts_with("::ffff:127.") {
        return true;
    }
    if h.starts_with("fc") || h.starts_with("fd") || h.starts_with("fe80:") {
        return true;
    }
    if let Some(rest) = h.strip_prefix("172.") {
        if let Some(octet) = rest.split('.').next() {
            if let Ok(n) = octet.parse::<u16>() {
                if (16..=31).contains(&n) {
                    return true;
                }
            }
        }
    }
    false
}

/// 计算真实转发目标。返回 None 表示拒绝。
pub fn resolve_target(raw: &str) -> Option<String> {
    let value = raw.trim();
    if value.is_empty() {
        return None;
    }
    let url = reqwest::Url::parse(value).ok()?;
    if !matches!(url.scheme(), "http" | "https") {
        return None;
    }
    let host = url.host_str().unwrap_or("").to_ascii_lowercase();
    if !is_private_host(&host) {
        return Some(value.to_string());
    }
    if allowed_hosts().iter().any(|h| h == &host) {
        return Some(value.to_string());
    }
    None
}

/// 转发一次 OpenAI 兼容的 chat/completions 请求。
///
/// 参数由前端的传输层从原来的 fetch 调用里原样取出：
///   * `target` = `x-ai-target` 头（服务地址前缀）
///   * `path`   = 去掉 `/ai-proxy` 前缀后的上游路径，如 `/chat/completions`
///   * `api_key`= `Authorization: Bearer …` 里的 Key
///   * `body`   = 原样透传的 JSON 字符串
#[tauri::command]
pub async fn ai_chat(
    target: String,
    api_key: String,
    path: String,
    body: String,
) -> Result<AiResponse, String> {
    let Some(base) = resolve_target(&target) else {
        return Ok(AiResponse {
            ok: false,
            status: 403,
            body: REJECT_BODY.to_string(),
        });
    };

    let url = format!("{}{}", base.trim_end_matches('/'), path);
    // 超时给到 130s：配置上限是 120s，真正的超时判定由前端的 AbortSignal 负责，
    // 这里只是防止连接永远挂着。
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(130))
        .build()
        .map_err(|e| format!("HTTP 客户端构建失败：{e}"))?;

    let mut req = client
        .post(&url)
        .header("Content-Type", "application/json")
        .body(body);
    if !api_key.is_empty() {
        req = req.header("Authorization", format!("Bearer {api_key}"));
    }

    let resp = req
        .send()
        .await
        .map_err(|e| format!("AI 兜底请求失败：{e}"))?;
    let status = resp.status().as_u16();
    let text = resp
        .text()
        .await
        .map_err(|e| format!("读取上游响应失败：{e}"))?;

    Ok(AiResponse {
        ok: (200..300).contains(&status),
        status,
        body: text,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_loopback_and_private() {
        for host in [
            "http://localhost:11434/v1",
            "http://127.0.0.1:8000/v1",
            "http://10.0.0.5/v1",
            "http://192.168.1.9/v1",
            "http://172.16.3.4/v1",
            "http://172.31.255.1/v1",
            "http://169.254.1.1/v1",
            "http://[::1]:8080/v1",
        ] {
            assert!(resolve_target(host).is_none(), "应拒绝：{host}");
        }
    }

    #[test]
    fn accepts_public_https() {
        assert!(resolve_target("https://api.openai.com/v1").is_some());
        // 172.32 已不在私网段内
        assert!(resolve_target("http://172.32.0.1/v1").is_some());
    }

    #[test]
    fn rejects_non_http_scheme() {
        assert!(resolve_target("file:///C:/secret").is_none());
        assert!(resolve_target("not a url").is_none());
    }
}
