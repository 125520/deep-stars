import { AI_COACH_MARK, acceptRephrase, buildCoachPrompt, type CoachFacts } from "@/lib/ai/prompt";
import { detectProvider } from "@/lib/api-key";
import type { CoachMessage } from "@/lib/coach";
import { decryptSecret } from "@/lib/crypto";
import { prisma } from "@/lib/prisma";

/**
 * 用用户自己的 AI 密钥改写教练文案
 * ══════════════════════════════════════════════════════════════════
 *
 * ── 三条设计约束 ────────────────────────────────────────────────
 *
 * 1. **失败一律退回规则文案。**
 *    这个函数的返回值永远是一句能显示的话。没配密钥、密钥解不开、
 *    请求超时、模型胡说 —— 每一种都退回到 lib/coach.ts 生成的那句。
 *    用户不会因为 AI 出问题而看到空白卡片或错误提示。
 *
 * 2. **只在"每天一次"的时机调用。**
 *    调用点是通知同步（lib/notifications-server.ts），那条路径本身
 *    已经按天去重。所以一个用户一天最多产生一次付费调用 ——
 *    绝不能挂在页面渲染上：那样刷新几次就把用户的额度刷完了。
 *
 * 3. **不改「说什么」，只改「怎么说」。**
 *    提醒哪件事由规则决定（见 lib/ai/prompt.ts 的说明），
 *    模型只拿到一句已经写好的话和一小组数字。
 */

/** 8 秒。文案改写不值得让用户等更久，超时就退回规则文案。 */
const TIMEOUT_MS = 8_000;

export type CoachRewrite = {
  /** 最终要显示的正文（无论来自规则还是模型） */
  body: string;
  /** 是否真的由模型改写 —— 卡片上据此显示标记 */
  byAI: boolean;
};

/** 取出并解开用户的密钥；任何一步不成立都返回 null */
async function readUserKey(userId: string) {
  const row = await prisma.userApiKey.findUnique({
    where: { userId },
    select: { keyCipher: true, baseUrl: true, model: true },
  });
  if (!row) return null;

  // decryptSecret 在任何异常下都返回 null（密钥换了、数据被改过……）
  const key = decryptSecret(row.keyCipher);
  if (!key) return null;

  /*
    ⚠️ 没有配置模型就直接放弃改写，**不要猜一个默认模型名**。
    写死 "gpt-4o-mini" 这类名字，在模型下线或改名之后会变成一个
    每次都失败、且失败原因与用户操作完全无关的隐藏故障。
    让设置页里的「模型」字段成为必需，比猜要诚实。
  */
  const model = row.model?.trim();
  if (!model) {
    console.warn("[ai] 未配置模型，跳过改写（设置页可以填）");
    return null;
  }

  // 服务商按**密钥形态**判断，不是按地址 —— 地址可以是自建网关，
  // 而请求格式（anthropic 还是 openai 兼容）由密钥与地址共同决定
  const provider = detectProvider(key);
  if (provider === "unknown") return null;

  return { key, baseUrl: row.baseUrl, model, provider };
}

/** 按服务商拼请求。两家的字段名没有一处相同，所以分开写清楚。 */
function buildRequest(input: {
  provider: string;
  baseUrl: string;
  model: string;
  key: string;
  system: string;
  user: string;
  signal: AbortSignal;
}): { url: string; init: RequestInit } {
  const base = input.baseUrl.replace(/\/+$/, "");

  if (input.provider === "anthropic") {
    return {
      url: `${base}/v1/messages`,
      init: {
        method: "POST",
        signal: input.signal,
        headers: {
          "content-type": "application/json",
          "x-api-key": input.key,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: input.model,
          max_tokens: 200,
          system: input.system,
          messages: [{ role: "user", content: input.user }],
        }),
      },
    };
  }

  // OpenAI 兼容（含 DeepSeek 等）：system 作为一条普通消息
  return {
    url: `${base}/chat/completions`,
    init: {
      method: "POST",
      signal: input.signal,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${input.key}`,
      },
      body: JSON.stringify({
        model: input.model,
        max_tokens: 200,
        messages: [
          { role: "system", content: input.system },
          { role: "user", content: input.user },
        ],
      }),
    },
  };
}

/** 从两种响应里各取各的文本 */
function extractText(provider: string, payload: unknown): string | null {
  if (typeof payload !== "object" || payload === null) return null;
  const data = payload as Record<string, unknown>;

  if (provider === "anthropic") {
    const content = data.content;
    if (!Array.isArray(content)) return null;
    const first = content.find(
      (part) => typeof part === "object" && part !== null && (part as { type?: string }).type === "text",
    ) as { text?: unknown } | undefined;
    return typeof first?.text === "string" ? first.text : null;
  }

  const choices = data.choices;
  if (!Array.isArray(choices) || choices.length === 0) return null;
  const message = (choices[0] as { message?: { content?: unknown } }).message;
  return typeof message?.content === "string" ? message.content : null;
}

/**
 * 改写教练文案。**永远返回一句可显示的话。**
 */
export async function rewriteCoachMessage(
  userId: string,
  message: CoachMessage,
  facts: CoachFacts,
): Promise<CoachRewrite> {
  const fallback: CoachRewrite = { body: message.body, byAI: false };

  const credential = await readUserKey(userId);
  if (!credential) return fallback;

  const { system, user } = buildCoachPrompt(message, facts);

  /*
    超时用 AbortController 而不是 Promise.race：
    race 只是不再等它，请求本身还在跑，连接与额度都照付。
    abort 才是真的把它掐掉。
  */
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const { url, init } = buildRequest({
      provider: credential.provider,
      baseUrl: credential.baseUrl,
      model: credential.model,
      key: credential.key,
      system,
      user,
      signal: controller.signal,
    });

    const response = await fetch(url, init);

    if (!response.ok) {
      /*
        不把响应体记进日志：它可能回显请求内容，也可能带上游的诊断信息。
        状态码足够定位问题。
      */
      console.warn(`[ai] 改写失败，HTTP ${response.status}，退回规则文案`);
      return fallback;
    }

    const text = acceptRephrase(extractText(credential.provider, await response.json()));
    if (!text) {
      console.warn("[ai] 改写结果不合格，退回规则文案");
      return fallback;
    }

    return { body: text, byAI: true };
  } catch (error) {
    // 超时、网络错误、JSON 解析失败都会走到这里
    const reason = error instanceof Error ? error.name : "unknown";
    console.warn(`[ai] 改写异常（${reason}），退回规则文案`);
    return fallback;
  } finally {
    clearTimeout(timer);
  }
}

export { AI_COACH_MARK };
