import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  allowsInlineScript,
  allowsInlineStyle,
  describeDirective,
  parseCsp,
  resolveDirective,
} from "../src/lib/csp.ts";

/**
 * 安全响应头的回归测试
 * ══════════════════════════════════════════════════════════════════
 *
 * 断言的对象是**最终产出的响应头**，不是源码文本 ——
 * 这样将来把 CSP 挪到别处、或改成拼接生成，测试依然有效。
 *
 * 最重要的一条是 `allowsInlineStyle`：它按规范解析回退链，
 * 因此只要行内样式会失效就必然失败。这条断言正是为一次真实事故加的
 * （漏写 style-src → 流星、行星带、星座连线、进度条一起静默消失）。
 *
 * ── 为什么要动态导入 next.config.ts ─────────────────────────────
 *
 * 那个文件里有一道**构建期环境变量自检**（缺密钥就让部署失败）。
 * `node --test` 不读 `.env`，所以测试进程里 DATABASE_URL 是缺的 ——
 * 静态 import 会在模块加载阶段就抛错，把整个测试文件打挂，
 * 而报错内容（"环境变量不完整"）与 CSP 毫无关系。
 *
 * 所以先补一个占位连接串，再动态导入。这也正是 CI 里做的事
 * （见 .github/workflows/ci.yml 的 DATABASE_URL 占位）。
 */
process.env.DATABASE_URL ??= "file:./test-placeholder.db";
const { default: nextConfig } = await import("../next.config.ts");

async function readHeaders(): Promise<Map<string, string>> {
  const rules = await nextConfig.headers?.();
  const first = rules?.[0];
  assert.ok(first, "next.config.ts 必须提供 headers() 规则");

  const map = new Map<string, string>();
  for (const header of first.headers) map.set(header.key.toLowerCase(), header.value);
  return map;
}

function cspOf(headers: Map<string, string>): string {
  const csp = headers.get("content-security-policy");
  assert.ok(csp, "必须发送 Content-Security-Policy");
  return csp;
}

describe("CSP 的语义判断（纯函数）", () => {
  it("显式声明的指令优先于 default-src", () => {
    const csp = "default-src 'self'; img-src 'self' data:";
    assert.deepEqual(resolveDirective(csp, "img-src"), ["'self'", "data:"]);
  });

  it("**未声明的取指指令回退到 default-src** —— 回退是这次事故的机制", () => {
    const csp = "default-src 'self'";
    assert.deepEqual(resolveDirective(csp, "style-src"), ["'self'"]);
    assert.deepEqual(resolveDirective(csp, "script-src"), ["'self'"]);
  });

  it("**不回退的指令**（base-uri / form-action / frame-ancestors）没写就是 null", () => {
    const csp = "default-src 'self'";
    for (const name of ["base-uri", "form-action", "frame-ancestors"]) {
      assert.equal(resolveDirective(csp, name), null, `${name} 不该回退到 default-src`);
    }
  });

  it("行内样式走三级链：style-src-attr → style-src → default-src", () => {
    // 只写 style-src-attr 也是合法写法，必须能认出来
    assert.equal(allowsInlineStyle("default-src 'self'; style-src-attr 'unsafe-inline'"), true);
    // 只写 style-src
    assert.equal(allowsInlineStyle("default-src 'self'; style-src 'unsafe-inline'"), true);
    // 回退到 default-src
    assert.equal(allowsInlineStyle("default-src 'unsafe-inline'"), true);
    // 都没有 → 拦截
    assert.equal(allowsInlineStyle("default-src 'self'"), false);
  });

  it("**这一条就是本次事故的复现**：只写 default-src 时行内样式被拦", () => {
    const broken = "default-src 'self'; img-src 'self' data:; frame-ancestors 'none'";
    assert.equal(
      allowsInlineStyle(broken),
      false,
      "缺少 style-src 的 CSP 必然拦截行内样式，这正是流星消失的原因",
    );
  });

  it("nonce 与 hash 不能放行行内属性，只有 'unsafe-inline' 可以", () => {
    assert.equal(allowsInlineStyle("default-src 'self'; style-src 'nonce-abc123'"), false);
    assert.equal(allowsInlineStyle("default-src 'self'; style-src 'sha256-abc'"), false);
    assert.equal(allowsInlineStyle("default-src 'self'; style-src 'unsafe-inline'"), true);
  });

  it("大小写不敏感", () => {
    assert.equal(allowsInlineStyle("STYLE-SRC 'UNSAFE-INLINE'"), true);
  });

  it("空 CSP 不抛错，且判定为拦截", () => {
    assert.equal(allowsInlineStyle(""), false);
    assert.equal(allowsInlineStyle("   "), false);
  });

  it("parseCsp 忽略多余空白与空段", () => {
    const map = parseCsp("  default-src   'self' ;;  img-src 'self' data:  ; ");
    assert.deepEqual(map.get("default-src"), ["'self'"]);
    assert.deepEqual(map.get("img-src"), ["'self'", "data:"]);
  });

  it("describeDirective 对不回退的缺失指令给出可读说明", () => {
    assert.match(describeDirective("default-src 'self'", "form-action"), /未声明/);
  });
});

describe("实际产出的安全响应头", () => {
  it("**行内样式必须被放行** —— 全站大量依赖 React 的 style={{...}}", async () => {
    const csp = cspOf(await readHeaders());
    assert.equal(
      allowsInlineStyle(csp),
      true,
      `当前 CSP 会拦截行内样式，流星/行星带/星座连线/进度条都会消失。\n` +
        `style-src 的有效来源是：${describeDirective(csp, "style-src")}`,
    );
  });

  it("**行内脚本必须被放行** —— 否则整个应用没有客户端 JavaScript", async () => {
    const csp = cspOf(await readHeaders());
    /*
      这条看起来"放松了安全"，其实是在陈述一个事实：
      Next 会注入 `<script id="_R_">self.__next_r="…"</script>`，
      而 `script-src 'self'` 会拦掉它 → 客户端运行时抛 InvariantError
      → **水合中止** → Canvas 星野不绘制、计时器不走、进度条不动，
      而页面外观完全正常，控制台只有一条语焉不详的内部异常。

      真实发生过一次，排查了很久。**不要因为"看起来更安全"就把它改回 'self'。**
      要收紧必须走 nonce 方案（见 next.config.ts 里的步骤说明）。
    */
    assert.equal(
      allowsInlineScript(csp),
      true,
      `行内脚本被禁会导致水合中止、整站失去客户端 JS。\n` +
        `script-src 的有效来源是：${describeDirective(csp, "script-src")}`,
    );
  });

  it("头像用的 data: 被放行", async () => {
    const csp = cspOf(await readHeaders());
    assert.ok(
      resolveDirective(csp, "img-src")?.includes("data:"),
      "头像存的是 data URL，img-src 不放行 data: 会导致头像全部裂开",
    );
  });

  it("点击劫持与注入面被关掉", async () => {
    const csp = cspOf(await readHeaders());
    assert.deepEqual(resolveDirective(csp, "frame-ancestors"), ["'none'"]);
    assert.deepEqual(resolveDirective(csp, "object-src"), ["'none'"]);
    assert.deepEqual(resolveDirective(csp, "base-uri"), ["'self'"]);
    assert.deepEqual(resolveDirective(csp, "form-action"), ["'self'"]);
  });

  it("**每条取指指令都显式声明，不依赖回退**", async () => {
    const csp = cspOf(await readHeaders());
    for (const name of ["style-src", "script-src", "img-src", "font-src", "connect-src"]) {
      assert.ok(
        parseCsp(csp).has(name),
        `${name} 应当显式写出。依赖 default-src 回退正是上次事故的成因`,
      );
    }
  });

  it("常规防护头齐全", async () => {
    const headers = await readHeaders();
    assert.equal(headers.get("x-content-type-options"), "nosniff");
    assert.equal(headers.get("x-frame-options"), "DENY");
    assert.equal(headers.get("referrer-policy"), "strict-origin-when-cross-origin");
    assert.ok(headers.get("permissions-policy")?.includes("camera=()"));
  });

  it("HSTS 只在生产环境发送（发给 localhost 会把本地开发锁死）", async () => {
    const headers = await readHeaders();
    const isProduction = process.env.NODE_ENV === "production";
    assert.equal(
      headers.has("strict-transport-security"),
      isProduction,
      "开发环境发送 HSTS 会让浏览器强制 https://localhost，且后果持续到 max-age 过期",
    );
  });
});
