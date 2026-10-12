/**
 * AI 密钥的格式识别与校验
 * ══════════════════════════════════════════════════════════════════
 *
 * 纯函数。这一块的价值不在"认出是哪家"，而在**在保存之前就把明显不对的
 * 输入挡下来** —— 一把带换行、带引号、从网页上复制时多带了一个空格的密钥，
 * 存进去之后要到真正调用 AI 时才会以一句含糊的 401 暴露出来。
 *
 * ── 一个必须说清的局限 ──────────────────────────────────────────
 *
 * **无法可靠区分 DeepSeek 与 OpenAI。** 两者的密钥都是 `sk-` 开头，
 * 长度区间也重叠。所以这里刻意不猜：`sk-` 一律归为
 * "openai-compatible"，而 DeepSeek 的接口本来就是 OpenAI 兼容的 ——
 * 归到这一类是正确的，不是含糊其辞。
 *
 * 只有 Anthropic 的前缀（`sk-ant-`）足够独特，能单独认出来。
 */

export const PROVIDERS = ["anthropic", "openai-compatible", "unknown"] as const;
export type Provider = (typeof PROVIDERS)[number];

export const PROVIDER_LABELS: Record<Provider, string> = {
  anthropic: "Anthropic",
  "openai-compatible": "OpenAI 兼容（含 DeepSeek）",
  unknown: "未识别",
};

/** 短于这个长度的密钥必然是错的 —— 真实密钥都在 40 位以上 */
const MIN_LENGTH = 16;
/** 上限：防止把一整篇文档粘进来，也避免超出加密字段的合理长度 */
const MAX_LENGTH = 512;

/**
 * 允许的字符：可见 ASCII，不含空白。
 * 密钥不会包含中文、换行或空格，出现这些一定是复制时带进来的。
 */
const ALLOWED = /^[\x21-\x7e]+$/;

export function detectProvider(key: string): Provider {
  const trimmed = key.trim();
  if (trimmed.startsWith("sk-ant-")) return "anthropic";
  if (trimmed.startsWith("sk-")) return "openai-compatible";
  return "unknown";
}

export type KeyCheck = { ok: true; provider: Provider } | { ok: false; error: string };

/**
 * 校验。**不联网验证密钥是否有效** —— 那需要真的发一次请求，
 * 属于将来的"测试连接"功能，不该混在校验里。
 */
export function validateApiKey(raw: string): KeyCheck {
  const key = (raw ?? "").trim();

  if (!key) return { ok: false, error: "请先填入密钥。" };

  /*
    先查字符集，再查长度 —— 与 handle 校验同样的顺序。
    把顺序反过来，一个从网页复制时带了尾随空格的短密钥会先报"太短"，
    用户加了几个字符后才被告知有空字符，白改一次。
  */
  if (!ALLOWED.test(key)) {
    return {
      ok: false,
      error: "密钥里有空格、换行或非 ASCII 字符 —— 多半是复制时多带了内容，请重新复制。",
    };
  }

  if (key.length < MIN_LENGTH) {
    return { ok: false, error: `密钥太短了（至少 ${MIN_LENGTH} 位），请检查是否复制完整。` };
  }
  if (key.length > MAX_LENGTH) {
    return { ok: false, error: `密钥太长了（上限 ${MAX_LENGTH} 位）。` };
  }

  if (!key.startsWith("sk-")) {
    /*
      不认识的厂商仍然允许保存（自建网关、代理服务都可能用别的格式），
      但明确告诉用户"没认出来"，让他自己确认一次。
      直接拒绝会把合法的自建部署挡在门外。
    */
    return { ok: true, provider: "unknown" };
  }

  return { ok: true, provider: detectProvider(key) };
}

/** 默认的接口地址。自建网关可以覆盖。 */
export const DEFAULT_BASE_URLS: Partial<Record<Provider, string>> = {
  anthropic: "https://api.anthropic.com/v1",
  "openai-compatible": "https://api.deepseek.com/v1",
};

/**
 * 校验自建的接口地址。
 *
 * **只允许 https**（本机地址除外）——
 * 允许 http 意味着密钥会以明文经过网络，
 * 而用户填这个框的时候多半不会想到这一层。
 */
export function validateBaseUrl(raw: string | null | undefined): {
  ok: true;
  url: string | null;
} | { ok: false; error: string } {
  const value = (raw ?? "").trim();
  if (!value) return { ok: true, url: null };

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return { ok: false, error: "接口地址不是有效的 URL。" };
  }

  const isLocal =
    parsed.hostname === "localhost" ||
    parsed.hostname === "127.0.0.1" ||
    parsed.hostname === "::1";

  if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && isLocal)) {
    return {
      ok: false,
      error: "接口地址必须是 https（本机地址除外）—— 用 http 会让密钥明文过网。",
    };
  }

  if (value.length > 300) return { ok: false, error: "接口地址太长了。" };

  // 去掉末尾斜杠，避免拼出 https://host//v1/chat 这种双斜杠
  return { ok: true, url: value.replace(/\/+$/, "") };
}
