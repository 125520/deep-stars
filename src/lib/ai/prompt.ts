import type { CoachMessage } from "../coach.ts";

/**
 * 教练措辞的 AI 改写提示词
 * ══════════════════════════════════════════════════════════════════
 *
 * ── 分工：规则决定「说什么」，模型只决定「怎么说」 ──────────────
 *
 * 该不该提醒、提醒哪一件事，**全部由 lib/coach.ts 的规则决定**，模型不参与。
 * 理由不是保守，是这样才对：
 *   · 规则可测 —— 每条分支都有断言，不会今天提醒复习、明天忘了
 *   · 模型不适合做"要不要打扰用户"这种判断，它没有连续的状态
 *
 * 模型拿到的是一句已经写好的话 + 一小撮数字，任务是换一种说法。
 * 于是即使模型胡言乱语，用户看到的也只是一句措辞奇怪的正确建议，
 * 而不是一条莫名其妙的打扰。
 *
 * ── 隐私边界 ────────────────────────────────────────────────────
 *
 * 只送**统计数字与已经生成好的那句话**，绝不送打卡正文、待办标题、
 * 计划名称这些用户自己写的内容。少送一点，用户就不必为了用这个功能
 * 先读一遍隐私政策。
 */

/** 送给模型的上下文。全是数字，没有用户自己写的文本。 */
export type CoachFacts = {
  /** 连续天数 */
  streak: number;
  /** 星图上总共多少枚星 */
  stars: number;
  /** 最近 7 天有几天记了 */
  activeDays: number;
  /** 到期复习卡数量 */
  reviewDue: number;
};

export const COACH_SYSTEM_PROMPT = [
  "你是一个学习陪伴产品的文案作者。产品叫「深星」，把每次专注记录成一枚点亮的星。",
  "",
  "你会收到一条已经写好的提醒，以及几个数字。请把它改写得更贴合这个人的处境。",
  "",
  "硬性要求：",
  "1. 只输出改写后的正文，不要标题、不要引号、不要 Markdown、不要解释。",
  "2. 一到两句话，不超过 60 个汉字。",
  "3. 绝不指责、绝不评判人格。说「今天还没记录」，不说「你怎么又没学」。",
  "4. 不承诺奖励、不编造数据 —— 只能用给你的数字。",
  "5. 给出一个足够小的下一步。不要让人感到欠了债。",
  "6. 语气平静、克制，像深夜的一盏台灯，不像健身教练。",
].join("\n");

/**
 * 拼出用户消息。
 *
 * 刻意做得**很短**：上下文越长，模型越容易开始"发挥"，
 * 而这里只需要它换一种说法。
 */
export function buildCoachPrompt(
  message: CoachMessage,
  facts: CoachFacts,
): { system: string; user: string } {
  const lines = [
    `原始提醒：${message.title} —— ${message.body}`,
    "",
    "已知数字：",
    `- 连续打卡：${facts.streak} 天`,
    `- 星图上的星：${facts.stars} 枚`,
    `- 最近 7 天记录了 ${facts.activeDays} 天`,
  ];

  if (facts.reviewDue > 0) {
    lines.push(`- 到期待复习的卡片：${facts.reviewDue} 张`);
  }

  lines.push("", "请改写这条提醒的正文（只输出正文）。");

  return { system: COACH_SYSTEM_PROMPT, user: lines.join("\n") };
}

/**
 * 判断模型的输出能不能用。
 *
 * ⚠️ **必须校验，而且判据要严。** 模型偶尔会：
 *   · 把提示词或要求一起复述出来（"好的，以下是改写后的正文：…"）
 *   · 输出 Markdown、列表、标题
 *   · 长篇大论，把一句提醒写成一段散文
 * 这些都不该出现在仪表盘那张小卡片里。不合格就退回规则文案 ——
 * 规则文案永远是正确且体面的，退回去没有任何损失。
 */
export function acceptRephrase(raw: string | null | undefined): string | null {
  const text = (raw ?? "").trim().replace(/\s+/g, " ");
  if (!text) return null;

  // 太长：一句提醒不该超过这个长度
  if (text.length > 90) return null;
  // 太短：多半是被截断了
  if (text.length < 6) return null;

  // Markdown 与列表痕迹
  if (/[*_`#>\[\]]/.test(text)) return null;
  /*
    列表标记要连「破折号 + 空格」一起拦。
    第一版只写了 `[-•\d]+[.、)]\s` —— 要求标记后面必须跟点号或顿号，
    于是 `- 今天还没记录` 这种最常见的中文列表写法直接漏过去了。
  */
  if (/^\s*(?:[-•]|\d{1,2}[.、)])\s/.test(text)) return null;

  // 复述提示词或元话语
  if (/(以下是|改写后|原始提醒|好的[，,]|作为 AI|提示词)/.test(text)) return null;

  // 换行已经在上面的 replace 里被压平，这里再挡一次模型常用的开场
  if (/^(当然|没问题|收到)/.test(text)) return null;

  return text;
}

/** 供 UI 显示的「这段是 AI 写的」标记用；导出成常量免得两处写不一致 */
export const AI_COACH_MARK = "AI 改写";
