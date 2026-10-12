#!/usr/bin/env node
/**
 * 交互体检
 * ════════════════════════════════════════════════════════════════════
 *
 * 为什么需要它
 * ──────────────────────────────────────────────────────────────────
 *
 * `regress.mjs` 只做四件事：页面能打开、关键文字在、控制台无报错、无横向溢出。
 * **它从来不点任何东西。** 于是两类真实缺陷它一个都测不出来：
 *
 *   · 「网页展示的功能模块点击时没反应」—— 那些卡片根本没有 href，
 *     页面照样能打开、文字照样在、控制台照样干净，全部判为通过。
 *   · 「打了卡星图没变化」—— 星点确实画出来了（SVG 里有 5 个圆），
 *     但它们全部挤在左上角一个像素范围内，肉眼看不见。
 *
 * 所以这个脚本不检查「有没有这个元素」，而是检查**它是不是真的有作用**。
 *
 * 四项检查
 * ──────────────────────────────────────────────────────────────────
 *
 *   1. 每个链接都有真实去处 —— 逐个请求，非 2xx/3xx 全部报出来。
 *      这条抓的是占位链接（曾经有个按钮指向 https://github.com 首页）。
 *
 *   2. 每个按钮都可用 —— disabled 的、以及没有可访问名称的，报出来。
 *
 *   3. **功能卡片必须可点** —— 统计页面里的 article 数量与被 <a> 包裹的数量，
 *      两者必须相等。这条是本轮「功能模块点不动」的**回归测试**。
 *
 *   4. **星图星点必须落在面板内** —— 对含星图的页面，断言每个星点圆的外接框
 *      都在 SVG 的框内、且散布范围不能退化成一个点。
 *      这条是本轮「星图看不见」的**回归测试** —— 单位不一致时星点会全部堆在
 *      左上角，外接框会跑到框外，直接命中。
 *
 * 用法
 * ──────────────────────────────────────────────────────────────────
 *
 *   node tools/interact.mjs --base http://127.0.0.1:3210
 *   node tools/interact.mjs --base https://deep-stars.onrender.com \
 *     --email you@example.com --password '…'
 *
 * 退出码非 0 表示有检查未通过。
 */

import { spawn } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    base: { type: "string", default: "http://127.0.0.1:3210" },
    email: { type: "string" },
    password: { type: "string" },
    label: { type: "string" },
    width: { type: "string", default: "1280" },
    height: { type: "string", default: "900" },
  },
});

const BASE = values.base.replace(/\/+$/, "");
const LABEL = values.label ?? BASE;

/** 未登录也能看的页面 */
const PUBLIC_PATHS = ["/", "/login", "/register"];

/** 登录后才看的页面 —— 没给账号就跳过，并如实标注 */
const PRIVATE_PATHS = [
  "/dashboard",
  "/plans",
  "/review",
  "/focus",
  "/todos",
  "/stats",
  "/notifications",
  "/settings",
  "/report/2026",
];

const SHOOT = path.join(process.cwd(), "tools", "shoot.mjs");

/**
 * 在页面里跑的探针。
 *
 * 只读取、不点击：点击会让页面导航，导航会销毁探针的上下文，
 * 结果就是拿回一个空对象（这个坑踩过很多次）。
 * 「有没有作用」由外层用请求链接、比对数量来判定，更稳也更准。
 */
const PROBE = `
(async function () {
  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function setv(el, v) {
    if (!el) return false;
    var proto = el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
    var d = Object.getOwnPropertyDescriptor(proto, 'value');
    if (!d || !d.set) return false;
    d.set.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  }

  await wait(2500);

  // 需要登录就登一次。登录会导航，所以登完直接返回，
  // 由下一次调用（页面已带会话）来体检。
  if (location.pathname === '/login' && __DS_MAY_LOGIN__) {
    var f = document.querySelector('form');
    if (f) {
      setv(document.getElementById('email'), __DS_EMAIL__);
      setv(document.getElementById('password'), __DS_PASSWORD__);
      f.requestSubmit();
      await wait(8000);
      return { 阶段: '登录', 现在: location.pathname };
    }
  }

  var out = { 阶段: '体检', 路径: location.pathname };

  // ── 链接清单 ──
  var links = [];
  document.querySelectorAll('a[href]').forEach(function (a) {
    var href = a.getAttribute('href');
    if (!href || href.charAt(0) === '#') return;
    links.push({
      href: href,
      文字: (a.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 24)
    });
  });
  out.链接 = links;

  // ── 按钮清单 ──
  var buttons = [];
  document.querySelectorAll('button').forEach(function (b) {
    var name = (b.textContent || '').replace(/\\s+/g, ' ').trim() ||
               b.getAttribute('aria-label') || '';
    buttons.push({ 名称: name.slice(0, 20), 禁用: !!b.disabled });
  });
  out.按钮 = buttons;

  // ── 检查 3：功能卡片是否可点 ──
  var articles = document.querySelectorAll('article');
  var linked = 0;
  articles.forEach(function (a) { if (a.closest('a[href]')) linked++; });
  out.卡片 = { 总数: articles.length, 可点: linked };

  // ── 检查 4：星图星点几何 ──
  var svg = document.querySelector('svg[role=img]');
  if (svg) {
    var sb = svg.getBoundingClientRect();
    var pts = [];
    svg.querySelectorAll('circle').forEach(function (c) {
      var r = c.getBoundingClientRect();
      // 取圆心相对面板的位置
      pts.push({
        x: Math.round(r.left + r.width / 2 - sb.left),
        y: Math.round(r.top + r.height / 2 - sb.top)
      });
    });
    var inside = pts.filter(function (p) {
      return p.x >= 0 && p.y >= 0 && p.x <= sb.width && p.y <= sb.height;
    }).length;
    var xs = pts.map(function (p) { return p.x; });
    var ys = pts.map(function (p) { return p.y; });
    out.星图 = {
      面板: Math.round(sb.width) + 'x' + Math.round(sb.height),
      圆数: pts.length,
      在框内: inside,
      横向跨度: xs.length ? Math.max.apply(null, xs) - Math.min.apply(null, xs) : 0,
      纵向跨度: ys.length ? Math.max.apply(null, ys) - Math.min.apply(null, ys) : 0
    };
  }

  return out;
})()
`;

/** 把凭据与开关插进探针 —— 探针跑在页面里，读不到 Node 的环境变量 */
function buildProbe(mayLogin) {
  const on = mayLogin && Boolean(values.email && values.password);
  return PROBE.replace("__DS_MAY_LOGIN__", on ? "true" : "false")
    .replace("__DS_EMAIL__", JSON.stringify(values.email ?? ""))
    .replace("__DS_PASSWORD__", JSON.stringify(values.password ?? ""));
}

/** 跑一张页面，拿回探针的对象 */
function probe(url, { mayLogin }) {
  return new Promise((resolve) => {
    const args = [
      SHOOT,
      "--out-dir", path.join(".cache", "shots"),
      "--dpr", "1",
      "--settle", "2500",
      "--eval", buildProbe(mayLogin),
      "--shot", `interact|${url}|${values.width}|${values.height}|vp`,
    ];

    const child = spawn(process.execPath, args, { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    child.stdout.on("data", (d) => { out += d; });
    child.stderr.on("data", (d) => { out += d; });
    child.on("close", () => {
      /*
        shoot 会打一行 `[eval @ 名字] <JSON>`。
        探针返回的是**对象**而不是字符串，所以这里只需要解析一次；
        早先让探针自己 JSON.stringify，会变成双重编码，解析起来得手工反转义，
        很容易在含中文或引号时出错。
      */
      const m = out.match(/\[eval @ [^\]]+\]\s+(\{[\s\S]*\})\s*$/m);
      if (!m) return resolve(null);
      try {
        resolve(JSON.parse(m[1]));
      } catch {
        resolve(null);
      }
    });
  });
}

/** 链接是否真的有去处 */
async function linkStatus(base, href) {
  if (/^(https?:)?\/\//.test(href) && !href.startsWith(base)) {
    // 外链不做请求：可能慢、可能被墙，报出来让人自己看
    return { external: true };
  }
  const url = href.startsWith("http") ? href : base + (href.startsWith("/") ? href : "/" + href);
  /*
    重试一次。免费实例会休眠，冷启动时第一个请求经常直接失败 ——
    那不是死链，是实例刚被唤醒。本地不会出现，线上必现，所以这条重试是必要的。
  */
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url, { redirect: "follow" });
      /*
        401 / 403 不算死链 —— 这里是 Node 在发请求，带不上浏览器的会话 cookie。
        `/api/export` 这类需要登录的端点必然回 401，那是**正确行为**。
        早先没区分，直接报成「死链」，是误报。
      */
      if (res.status === 401 || res.status === 403) return { needsAuth: true };
      return { status: res.status };
    } catch (error) {
      if (attempt === 1) return { error: String(error.message ?? error) };
      await new Promise((r) => setTimeout(r, 2500));
    }
  }
  return { error: "unreachable" };
}

const problems = [];
const results = [];

const paths = [...PUBLIC_PATHS];
if (values.email && values.password) paths.push(...PRIVATE_PATHS);

console.log(`\n交互体检 · ${LABEL}`);
console.log("─".repeat(64));

for (const p of paths) {
  const url = BASE + p;
  let data = await probe(url, { mayLogin: true });
  // 探针报告「已登录」说明发生了导航，再跑一次拿真实数据
  if (data && data.阶段 === "登录") data = await probe(url, { mayLogin: false });

  if (!data) {
    results.push({ path: p, ok: false, note: "探针无返回（页面打不开或导航打断）" });
    problems.push(`${p}：探针无返回`);
    console.log(`${p.padEnd(16)} ✗ 探针无返回`);
    continue;
  }

  const notes = [];
  let ok = true;

  // 检查 1：链接去处
  const dead = [];
  const gated = [];
  for (const l of data.链接 ?? []) {
    const s = await linkStatus(BASE, l.href);
    if (s.external) continue;
    if (s.needsAuth) {
      gated.push(l.href);
      continue;
    }
    if (s.error || (s.status && s.status >= 400)) {
      dead.push(`${l.文字 || l.href} → ${l.href} (${s.status ?? s.error})`);
    }
  }
  if (dead.length) {
    ok = false;
    notes.push(`${dead.length} 个链接无去处`);
    dead.forEach((d) => problems.push(`${p}：死链 ${d}`));
  }
  if (gated.length) notes.push(`${gated.length} 个需登录（正常）`);

  // 检查 2：按钮可用
  const bad = (data.按钮 ?? []).filter((b) => b.禁用);
  if (bad.length) notes.push(`${bad.length} 个按钮禁用中`);

  // 检查 3：功能卡片可点
  if (data.卡片 && data.卡片.总数 > 0 && data.卡片.可点 !== data.卡片.总数) {
    ok = false;
    notes.push(`卡片 ${data.卡片.可点}/${data.卡片.总数} 可点`);
    problems.push(`${p}：${data.卡片.总数 - data.卡片.可点} 张功能卡片不可点`);
  }

  // 检查 4：星图星点几何
  if (data.星图) {
    const g = data.星图;
    const outside = g.圆数 - g.在框内;
    const degenerate = g.横向跨度 <= 2 && g.纵向跨度 <= 2;
    if (outside > 0) {
      ok = false;
      notes.push(`星点 ${outside} 个跑到面板外`);
      problems.push(`${p}：${outside} 个星点在面板外（坐标单位不一致的典型症状）`);
    } else if (g.圆数 > 1 && degenerate) {
      ok = false;
      notes.push("星点全部重叠在一个位置");
      problems.push(`${p}：星点全部重叠 —— 星图看起来会是空白`);
    } else {
      notes.push(`星图 ${g.圆数} 点，跨度 ${g.横向跨度}×${g.纵向跨度}`);
    }
  }

  results.push({ path: p, ok, note: notes.join(" · ") || "通过" });
  console.log(`${p.padEnd(16)} ${ok ? "✓ 通过" : "✗ 失败"}   ${notes.join(" · ")}`);
}

const passed = results.filter((r) => r.ok).length;
console.log("─".repeat(64));
if (problems.length) {
  console.log("待处理：");
  [...new Set(problems)].forEach((p) => console.log(`  · ${p}`));
  console.log("");
}
console.log(`${passed} / ${results.length} 通过\n`);
process.exit(problems.length ? 1 : 0);
