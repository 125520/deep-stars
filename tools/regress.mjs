#!/usr/bin/env node
/**
 * 端到端回归扫描
 * ══════════════════════════════════════════════════════════════════
 *
 * 用法：
 *   pnpm regress                        # 用默认测试账号（密码走环境变量）
 *   pnpm regress --password '…'         # 或直接给密码
 *
 * 逐个访问所有页面，检查每页该有的标志文本、控制台是否干净、
 * 以及星野 canvas 是否真的画出了东西。最后打印一张表，以退出码表示成败。
 *
 * ── 为什么要有这个脚本 ──────────────────────────────────────────
 *
 * 各功能是分批验证的，但**分批通过不等于同时可用** ——
 * 后加的东西会影响先加的（例如每次进仪表盘都会同步通知）。
 *
 * ── 三个踩过的坑，都写在这里免得再踩 ────────────────────────────
 *
 * 1. **必须把所有页面放进同一次 shoot 调用。**
 *    每次 spawn 一个 shoot 就是启动一个新浏览器、一个新的 cookie 罐，
 *    于是"登录成功"（日志里明明是 200）却每个页面都 307 回登录页，
 *    还顺带把认证接口打到 429。一次调用、多个 --shot，共用同一个浏览器。
 *
 * 2. **登录只做一次。** 认证接口限流 10 次/分钟；
 *    每页都尝试登录的话，从第二页起就全是失败，看起来像页面挂了。
 *
 * 3. **探针必须返回字符串。** shoot 打印对象时不加引号，
 *    打印字符串时才加引号 —— 解析端按后者写，就必须让探针 JSON.stringify。
 *
 * 4. **`--eval` 是单值，不能一页一个。** 传多次只有最后一个生效，
 *    于是所有页面都在检查最后一页的标志文本（12 页全部报"缺少管理后台"）。
 *    改成**一个按路径分派的通用探针**，页面清单烘焙进字符串。
 */

import { spawn } from "node:child_process";
import path from "node:path";
import process from "node:process";

const BASE = process.env.REGRESS_BASE ?? "http://127.0.0.1:3210";

const args = process.argv.slice(2);
const argOf = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const EMAIL = argOf("email", "e2e987115@example.com");
const PASSWORD = argOf("password", process.env.REGRESS_PASSWORD ?? "");
const HANDLE = argOf("handle", "e2e-star-8176");

/*
  视口尺寸。默认桌面；`--width 390 --height 844` 可以按手机跑一遍。
  用户的硬要求是"任何人在自己设备上打开就能用"，而手机是绝大多数人的设备 ——
  只在桌面尺寸下验证等于没验证这一条。
*/
const WIDTH = Number(argOf("width", "1280"));
const HEIGHT = Number(argOf("height", "900"));
const LABEL = argOf("label", `${WIDTH}×${HEIGHT}`);

if (!PASSWORD) {
  console.error("缺少密码。用 --password '…' 或设 REGRESS_PASSWORD 环境变量。");
  console.error("（密码忘了可以跑 pnpm reset-password <邮箱> 重置）");
  process.exit(2);
}

/**
 * 要访问的页面。`markers` 是这页必须出现的标志文本。
 * 第一条是登录页 —— 只在它这里登录一次。
 */
const PAGES = [
  { path: "/login", markers: [], isLogin: true },
  { path: "/dashboard", markers: ["观测台", "点亮今天的星"], canvas: true },
  { path: "/plans", markers: ["计划"] },
  { path: "/review", markers: ["复习"] },
  { path: "/focus", markers: ["专注"], canvas: true },
  { path: "/todos", markers: ["待办"] },
  { path: "/stats", markers: ["统计"], canvas: true },
  { path: "/notifications", markers: ["需要你知道的事"] },
  { path: "/settings", markers: ["头像"] },
  { path: "/report/2026", markers: ["2026"], canvas: true },
  { path: `/u/${HANDLE}`, markers: ["星图"], canvas: true },
  { path: "/admin", markers: ["管理后台"], requiresAdmin: true },
];

/**
 * 通用探针：按 `location.pathname` 自己查该检查哪些标志文本。
 *
 * 用**唯一文本**判断，不用 `body > div.fixed` 这类结构选择器 ——
 * 后者会撞上同样铺满视口的星野背景层，断言会变成空转（踩过）。
 */
const PROBE = `
(async function () {
  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function setv(id, v) {
    var e = document.getElementById(id);
    if (!e) return false;
    var d = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
    d.set.call(e, v); e.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  }
  function identity() {
    /*
      导航栏形如：… 设置 <名字> [未读角标] 退出
      直接取「退出」前面那一小段，比写正则稳 —— 名字里可能有空格，
      角标也可能不存在。
    */
    var t = document.body.innerText.replace(/\\s+/g, ' ').trim();
    var i = t.indexOf('退出');
    if (i < 0) return null;
    var before = t.slice(Math.max(0, i - 30), i).trim();
    // 去掉纯数字（那是未读角标，不是名字）
    var parts = before.split(' ').filter((p) => p && !/^\\d+\\+?$/.test(p));
    return parts.length ? parts[parts.length - 1] : null;
  }

  var SPEC = ${JSON.stringify(PAGES.map((p) => ({ path: p.path, markers: p.markers, isLogin: Boolean(p.isLogin) })))};

  await wait(3000);
  var path = location.pathname;
  var spec = null;
  for (var i = 0; i < SPEC.length; i++) if (SPEC[i].path === path) spec = SPEC[i];

  // 登录页：只在这里登一次，后面共用同一个会话
  if (spec && spec.isLogin) {
    setv('email', ${JSON.stringify(EMAIL)});
    setv('password', ${JSON.stringify(PASSWORD)});
    var f = document.querySelector('form');
    if (!f) return JSON.stringify({ step: 'login', error: 'no form' });
    f.requestSubmit();
    await wait(8000);
    return JSON.stringify({ step: 'login', after: location.pathname, ok: location.pathname !== '/login' });
  }

  var want = spec ? spec.markers : [];
  var txt = document.body.innerText.replace(/\\s+/g, ' ');
  var set = document.querySelectorAll('canvas');
  var painted = null;
  if (set.length) {
    painted = 0;
    for (var k = 0; k < set.length; k++) {
      try {
        var d = set[k].getContext('2d').getImageData(0, 0, set[k].width, set[k].height).data;
        for (var p = 3; p < d.length; p += 4) if (d[p] > 0) painted++;
      } catch (e) { painted = -1; }
    }
  }
  return JSON.stringify({
    step: 'page',
    path: path,
    known: Boolean(spec),
    identity: identity(),
    is404: document.title.indexOf('404') >= 0,
    navHasAdmin: txt.indexOf('管理') >= 0,
    markers: want.map(function (m) { return { text: m, found: txt.indexOf(m) >= 0 }; }),
    canvasPixels: painted
  });
})()
`;

/** 所有页面**在同一次 shoot 调用里**（共用浏览器与 cookie），探针只用这一个。 */
const shootArgs = [
  path.join("tools", "shoot.mjs"),
  "--out-dir", path.join(".cache", "regress"),
  "--dpr", "1",
  "--eval", PROBE,
];

for (const page of PAGES) {
  shootArgs.push("--shot", `${page.path.replace(/\W+/g, "_")}|${BASE}${page.path}|${WIDTH}|${HEIGHT}|vp`);
}

const output = await new Promise((resolve) => {
  const child = spawn(process.execPath, shootArgs, { stdio: ["ignore", "pipe", "pipe"] });
  let out = "";
  child.stdout.on("data", (chunk) => (out += chunk));
  child.stderr.on("data", (chunk) => (out += chunk));
  child.on("error", (error) => resolve(`SPAWN_ERROR ${error}`));
  child.on("close", () => resolve(out));
});

/**
 * 取出全部 `[eval @ 名字] "…"` 结果。
 * 用跨行匹配：结果是很长的一行 JSON，会被终端折行，按行取会截断。
 */
const results = [];
const pattern = /\[eval @ ([^\]]+)\]\s*"((?:[^"\\]|\\.)*)"/g;
for (const match of output.matchAll(pattern)) {
  const name = match[1].trim();
  let value = null;
  try {
    value = JSON.parse(JSON.parse(`"${match[2]}"`));
  } catch {
    value = null;
  }
  results.push({ name, value });
}

if (results.length === 0) {
  console.error("没有解析到任何探针结果。shoot 的原始输出：");
  console.error(output.slice(0, 1200));
  process.exit(1);
}

const consoleErrors = output
  .split("\n")
  .filter((l) => /\[error\]|Uncaught|⨯/.test(l))
  .map((l) => l.trim());

/*
  ⚠️ **横向溢出是手机端最容易出、也最致命的问题** ——
  页面上任何一个元素宽过视口，整页就能被左右拖动，看起来像坏掉了。
  shoot.mjs 每张图都会量一次"文档滚动宽"，这里把它采集起来：
  **任何一页超出视口宽度就算失败**。
*/
const overflow = [...output.matchAll(/文档滚动宽 (\d+)px/g)]
  .map((m) => Number(m[1]))
  .filter((value) => value > WIDTH);

function judge(page, value) {
  if (!value) return { status: "✗ 无结果", detail: "探针没有返回（页面可能没水合）" };
  if (value.step === "login") {
    return value.ok
      ? { status: "✓ 登录", detail: `会话已建立（→ ${value.after}）` }
      : { status: "✗ 登录失败", detail: `停留在 ${value.after}` };
  }

  const missing = (value.markers ?? []).filter((m) => !m.found).map((m) => m.text);
  const problems = [];
  if (value.is404) problems.push("返回 404");
  if (missing.length) problems.push(`缺少标志文本：${missing.join("、")}`);
  if (page.canvas && !(value.canvasPixels > 0)) problems.push(`星野未绘制（${value.canvasPixels}）`);
  if (page.requiresAdmin && !value.navHasAdmin) problems.push("导航里没有「管理」——当前账号不是管理员");

  return {
    status: problems.length ? "✗ 失败" : "✓ 通过",
    detail: problems.length
      ? problems.join("；")
      : `${value.identity ? `身份 ${value.identity}` : ""}${value.canvasPixels ? ` · 星野 ${value.canvasPixels}px` : ""}` || "—",
  };
}

const width = Math.max(...PAGES.map((p) => p.path.length), 6);
console.log(`\n端到端回归 · ${LABEL}`);
console.log("─".repeat(width + 44));

let failed = 0;
PAGES.forEach((page, index) => {
  const { status, detail } = judge(page, results[index]?.value ?? null);
  if (status.startsWith("✗")) failed += 1;
  console.log(`${page.path.padEnd(width)}  ${status.padEnd(12)}  ${detail}`);
});

console.log("─".repeat(width + 44));
if (overflow.length) {
  console.log(`✗ ${overflow.length} 处横向溢出（文档滚动宽 ${overflow.join(", ")}px > 视口 ${WIDTH}px）`);
  console.log("  用 --shot 的同类页面截图定位是哪个元素撑宽的。");
  failed += 1;
} else {
  console.log(`✓ 全部页面无横向溢出（视口 ${WIDTH}px）`);
}
if (consoleErrors.length) {
  console.log(`控制台报错 ${consoleErrors.length} 条，例如：`);
  console.log(`  ${consoleErrors[0].slice(0, 160)}`);
  failed += 1;
}
console.log(`${PAGES.length - failed} / ${PAGES.length} 通过`);
process.exit(failed ? 1 : 0);
