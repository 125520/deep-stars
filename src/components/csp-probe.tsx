"use client";

import * as React from "react";

/**
 * CSP 行内样式探针（仅开发环境）
 * ══════════════════════════════════════════════════════════════════
 *
 * 这个组件只做一件事：**在行内样式被 CSP 拦截时大声报错。**
 *
 * ── 为什么需要它 ────────────────────────────────────────────────
 *
 * 有一次 CSP 漏写了 `style-src`，行内样式被静默拦截，
 * 流星、行星带、星座连线、进度条一起消失 —— **控制台一条报错都没有**。
 * 页面看起来"只是变简单了"，很容易被当成设计调整而不是故障。
 *
 * ── 为什么探针要用服务端渲染的行内属性 ──────────────────────────
 *
 * CSP 的 `style-src` 拦的是**文档里的行内 style 属性与 <style> 元素**，
 * 而通过 CSSOM（`el.style.setProperty(...)`）设置样式**不受拦截**。
 * 所以不能用 JS 现造一个探针 —— 那样永远测不出问题。
 * 必须是服务端渲染出来、带行内 style 属性的真实节点。
 *
 * 仅开发环境执行：生产环境的 CSP 由 tests/csp.test.ts 把关，
 * 不该为了一次自检在线上多跑一段脚本。
 */

const PROBE_ID = "ds-csp-probe";
const PROBE_PROPERTY = "--ds-csp-probe";

export default function CspProbe() {
  React.useEffect(() => {
    if (process.env.NODE_ENV === "production") return;

    const el = document.getElementById(PROBE_ID);
    if (!el) return;

    const applied = getComputedStyle(el).getPropertyValue(PROBE_PROPERTY).trim();
    if (applied === "1") return;

    console.error(
      [
        "[CSP] 行内样式被拦截 —— 页面上的动态视觉会静默消失。",
        "受影响的有：流星的位置与时长、行星带间距、星座连线高度、各进度条、",
        "星野 canvas 尺寸。",
        "",
        "多半是 next.config.ts 里的 Content-Security-Policy 漏写了 style-src，",
        "或写了但没有 'unsafe-inline'（CSP 的 nonce/hash 对 style 属性无效）。",
        "注意：未声明的指令会回退到 default-src，所以「没写 style-src」",
        "同样会拦截行内样式。",
        "改完记得重启 dev server —— next.config.ts 不支持热重载。",
      ].join("\n"),
    );
  }, []);

  return (
    <span
      id={PROBE_ID}
      aria-hidden="true"
      className="hidden"
      style={{ [PROBE_PROPERTY]: "1" } as React.CSSProperties}
    />
  );
}
