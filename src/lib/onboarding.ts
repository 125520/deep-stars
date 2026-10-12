/**
 * 新手引导
 * ══════════════════════════════════════════════════════════════════
 *
 * 纯函数。两件事：
 *   · 判断"这人是不是新来的"（决定要不要显示引导）
 *   · 从计划模板的 Markdown 文档里解析出任务
 *
 * ── 为什么不加一个 `onboarded` 字段 ─────────────────────────────
 *
 * 那样就要处理"标记了但没做任何事"的状态，还要考虑跨设备同步。
 * 而**"有没有留下任何痕迹"本身就是最准的判据**：一旦用户点亮了一枚星
 * 或建了一个计划，引导就该消失 —— 他已经在用了，不需要再被教。
 */

/** 新用户的判据：星图空着，且没有任何计划 */
export function isNewUser(input: { starCount: number; planCount: number }): boolean {
  return input.starCount === 0 && input.planCount === 0;
}

export type ParsedTask = {
  title: string;
  /** 从「第 N 天」里读出来的排期；读不到就是 null */
  dayNumber: number | null;
};

/** 一次最多解析出这么多条 —— 模板文档可能很长，全变成任务反而没法用 */
export const MAX_PARSED_TASKS = 30;

/** 列表项：`- xxx` / `* xxx` / `+ xxx` / `1. xxx`，允许前置缩进 */
const LIST_ITEM = /^\s{0,6}(?:[-*+]|\d{1,2}[.)])\s+(.*)$/;
/** 复选框标记，出现时去掉 */
const CHECKBOX = /^\[[ xX]\]\s*/;
/** 「第 N 天」「Day N」「D3」都认。**不认区间**（「第 1–35 天」是阶段，不是某一天） */
const DAY_HINT = /(?:第\s*(\d{1,3})\s*天|Day\s*(\d{1,3})|D(\d{1,3})\b)/i;
/** 任务段的标题。schema 里把这条写成了契约：文档应含「## 任务安排」 */
const TASK_SECTION = /^#{2,4}\s*任务安排\s*$/;
/** 任意标题 —— 用来判断任务段在哪里结束 */
const ANY_HEADING = /^#{1,6}\s+/;

/**
 * 取出「## 任务安排」这一段；没有这一段就返回 null。
 *
 * ── 为什么要分节，而不是把全文的列表项都当任务 ──────────────────
 *
 * 实测踩到过：模板文档里除了任务，还有「阶段安排」「每日节奏」这类
 * 叙述性列表。全都解析成任务的话，用户拿到手的计划里会混进
 * 「上午：数学」「第 1–35 天：基础轮」这种根本没法打勾的条目 ——
 * 19 条任务里 0 条带排期，就是这个原因。
 *
 * schema 里已经把「含任务安排段落」写成了模板的契约，这里照着它分节；
 * 没写的文档退回全文解析，行为与从前一致。
 */
function extractTaskSection(document: string): string | null {
  const lines = document.split("\n");
  const start = lines.findIndex((line) => TASK_SECTION.test(line.trim()));
  if (start < 0) return null;

  const body: string[] = [];
  for (let i = start + 1; i < lines.length; i += 1) {
    // 遇到下一个标题就结束（同级或更高级都算）
    if (ANY_HEADING.test(lines[i]!.trim())) break;
    body.push(lines[i]!);
  }
  return body.join("\n");
}

/**
 * 从 Markdown 里解析任务。
 *
 * 优先只解析「## 任务安排」那一节；没有这一节时退回全文。
 *
 * ⚠️ **围栏代码块里的内容必须跳过**：模板文档里常有示例代码，
 * 而代码里的注释也长得像列表项（`# 步骤一`、`- item`）。
 * 把它们当成任务会产生一批莫名其妙的待办。
 */
export function parseTasksFromDocument(
  document: string | null | undefined,
  limit: number = MAX_PARSED_TASKS,
): ParsedTask[] {
  const source = document ?? "";
  if (!source.trim()) return [];

  const section = extractTaskSection(source);
  const scan = section ?? source;

  const tasks: ParsedTask[] = [];
  let inFence = false;

  for (const rawLine of scan.split("\n")) {
    const line = rawLine.trimEnd();

    // 切换围栏状态。``` 与 ~~~ 都算
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;

    const match = LIST_ITEM.exec(line);
    if (!match) continue;

    const title = match[1]!.replace(CHECKBOX, "").trim();
    // 太短的（"是"、"好"）或过长的都不像一条任务
    if (title.length < 2 || title.length > 200) continue;

    const day = DAY_HINT.exec(title);
    const dayNumber = day ? Number(day[1] ?? day[2] ?? day[3]) : null;

    tasks.push({
      title,
      dayNumber: Number.isInteger(dayNumber) && dayNumber! > 0 ? dayNumber : null,
    });

    if (tasks.length >= limit) break;
  }

  return tasks;
}

/** 引导的三步。放在这里而不是组件里，方便将来加步骤时一并被测试覆盖 */
export const ONBOARDING_STEPS = [
  {
    title: "点亮第一枚星",
    body: "写下今天做了什么。专注时长决定星的亮度，连续的日子会连成星座。",
    href: "/dashboard",
  },
  {
    title: "建一个计划",
    body: "把长目标拆成能做的步子。也可以直接从模板开始。",
    href: "/plans",
  },
  {
    title: "开一段专注",
    body: "计时在浏览器里跑，切去别的标签页也不会走慢。",
    href: "/focus",
  },
] as const;
