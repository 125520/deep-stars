/**
 * CSP 解析与语义判断
 * ══════════════════════════════════════════════════════════════════
 *
 * 纯函数。存在的理由是一次真实事故：
 *
 *   CSP 里只写了 `default-src 'self'`，没写 `style-src`。
 *   按规范 `style-src` 回退到 `default-src`，而行内 `style` 属性
 *   需要 `'unsafe-inline'` 才放行 —— 于是 React 的 `style={{...}}`
 *   与行内 CSS 变量被**静默拦截**：
 *   流星塌到原点、行星间距归零、星座连线高度为 0、进度条变平。
 *
 * 当时的"冒烟测试"只检查了 CSS 文件有没有加载、水合是否正常，
 * **唯独没检查行内样式是否真的生效**，所以给出了通过的结论。
 *
 * 所以这里不做字符串匹配（`csp.includes("style-src")` 这种），
 * 而是**按规范解析回退链**再判断。无论 CSP 怎么写，
 * 只要行内样式会失效，allowsInlineStyle 就返回 false。
 */

/**
 * 会回退到 `default-src` 的指令。
 *
 * ⚠️ 不是所有指令都有回退。`base-uri` / `form-action` / `frame-ancestors`
 * 是独立指令，没写就是不限制 —— 把它们也当成"回退到 default-src"
 * 会得出错误结论。这份名单按规范维护。
 */
const FALLBACK_TO_DEFAULT = new Set([
  "child-src",
  "connect-src",
  "font-src",
  "frame-src",
  "img-src",
  "manifest-src",
  "media-src",
  "object-src",
  "prefetch-src",
  "script-src",
  "script-src-attr",
  "script-src-elem",
  "style-src",
  "style-src-attr",
  "style-src-elem",
  "worker-src",
]);

/**
 * 行内 `style` 属性实际受哪条指令管辖。
 *
 * 这是一条**三级链**：style-src-attr → style-src → default-src。
 * 只查 style-src 是不够的 —— 只写 style-src-attr 也是合法的写法。
 */
const STYLE_ATTR_CHAIN = ["style-src-attr", "style-src"] as const;
/** 行内 `<script>` 元素：script-src-elem → script-src → default-src */
const SCRIPT_ELEM_CHAIN = ["script-src-elem", "script-src"] as const;

/** 把 CSP 头解析成 `指令名 → 来源列表`。指令名统一小写。 */
export function parseCsp(csp: string): Map<string, string[]> {
  const map = new Map<string, string[]>();

  for (const part of (csp ?? "").split(";")) {
    const trimmed = part.trim();
    if (!trimmed) continue;

    const [rawName, ...sources] = trimmed.split(/\s+/);
    if (!rawName) continue;

    // 同名指令重复出现时后者覆盖前者（浏览器行为是取第一个，
    // 但我们自己生成的 CSP 不会重复；这里选"后者覆盖"以便测试里能覆盖默认值）
    map.set(rawName.toLowerCase(), sources);
  }

  return map;
}

/**
 * 解析某条指令的**有效**来源列表。
 *
 * 返回 `null` 表示"没有任何指令管辖它"（既没显式写、也没有 default-src）——
 * 那意味着不限制，与"限制为空"是两回事。
 */
export function resolveDirective(csp: string, name: string): string[] | null {
  const map = parseCsp(csp);
  const key = name.toLowerCase();

  const explicit = map.get(key);
  if (explicit !== undefined) return explicit;

  if (!FALLBACK_TO_DEFAULT.has(key)) return null;

  const fallback = map.get("default-src");
  return fallback ?? null;
}

/** 沿一条回退链找第一个被显式声明的指令，取其来源列表 */
function resolveChain(csp: string, chain: readonly string[]): string[] | null {
  const map = parseCsp(csp);

  for (const name of chain) {
    const sources = map.get(name);
    if (sources !== undefined) return sources;
  }

  const fallback = map.get("default-src");
  return fallback ?? null;
}

/** 来源列表里是否放行了行内内容 */
function permitsInline(sources: string[] | null): boolean {
  if (!sources) return false;
  // 只有 'unsafe-inline' 能放行行内**属性**；
  // hash 与 nonce 对属性无效（规范如此），所以不把它们算进来。
  return sources.some((s) => s.toLowerCase() === "'unsafe-inline'");
}

/**
 * 行内 `style` 属性是否会被放行。
 *
 * 这个应用大量依赖它：React 的 `style={{...}}`、行内 CSS 变量
 * （流星的 top/left/width 与三个 --ds-meteor-* 变量）。
 * **返回 false 就意味着一大批视觉效果会静默消失。**
 */
export function allowsInlineStyle(csp: string): boolean {
  return permitsInline(resolveChain(csp, STYLE_ATTR_CHAIN));
}

/** 行内 `<script>` 是否会被放行。目前 Next 用外链脚本，应当保持 false。 */
export function allowsInlineScript(csp: string): boolean {
  return permitsInline(resolveChain(csp, SCRIPT_ELEM_CHAIN));
}

/** 取某条指令的有效来源，供断言可读性更好的报错信息 */
export function describeDirective(csp: string, name: string): string {
  const sources = resolveDirective(csp, name);
  if (sources === null) return "(未声明，且该指令不回退到 default-src)";
  return sources.length > 0 ? sources.join(" ") : "(声明为空)";
}
