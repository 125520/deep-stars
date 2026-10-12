#!/usr/bin/env node
/**
 * 深星截图与布局体检工具
 * ════════════════════════════════════════════════════════════════════
 *
 * 为什么不用 `chrome --screenshot`：
 *   1. 那个模式只能截「视口高度」，页面比视口长就被裁掉，得靠猜一个够大的
 *      --window-size，既浪费像素又容易漏掉底部内容。
 *   2. 它拿不到任何布局数据。响应式有没有横向溢出、是哪个元素溢出的，
 *      只能靠人肉看截图猜 —— 实测这么猜会绕远路。
 *
 * 这里走 Chrome DevTools Protocol：
 *   · Page.captureScreenshot({ captureBeyondViewport: true }) 拿真正的整页图
 *   · Runtime.evaluate 遍历 DOM，回报所有右边界超出视口的元素
 *   · Emulation.setDeviceMetricsOverride 精确模拟移动端视口
 *
 * 一个 Chrome 实例服务多张截图，减少启动开销（也减少需要提权的次数）。
 *
 * 用法：
 *   node tools/shoot.mjs \
 *     --shot "landing-desktop|http://127.0.0.1:3210/|1440|1000" \
 *     --shot "landing-mobile|http://127.0.0.1:3210/|390|844|mobile" \
 *     --out-dir .cache/shots
 *
 * 每张图会输出一行 JSON：视口宽度、文档滚动宽度、溢出的元素清单。
 */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { parseArgs } from "node:util";

const CHROME_CANDIDATES = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
];

/** 遍历 DOM，找出所有横向越界的元素 —— 响应式问题的定位器 */
const MEASURE = `(() => {
  const vw = document.documentElement.clientWidth;
  const bad = [];
  let skippedDecorative = 0;
  for (const el of document.querySelectorAll("body *")) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    if (r.right <= vw + 1 && r.left >= -1) continue;
    // 纯装饰层（星野背景、天球网格）本来就故意画到视口外，由 overflow:hidden 裁掉。
    // 把它们报成「越界元素」只会淹没真正的问题，所以按 aria-hidden 祖先跳过。
    if (el.closest('[aria-hidden="true"]')) { skippedDecorative++; continue; }
    const cls = typeof el.className === "string" ? el.className : "";
    bad.push({
      tag: el.tagName.toLowerCase(),
      cls: cls.slice(0, 80),
      left: Math.round(r.left),
      right: Math.round(r.right),
      w: Math.round(r.width),
    });
  }
  /*
    水合检测。
    React **只在真正接管了这棵 DOM 之后**才会给节点挂上 __reactFiber$ / __reactProps$。
    所以只要在页面里找到这两个键中的任意一个，就说明客户端 JS 跑起来并完成水合了。

    为什么值得每次都报：水合失败时页面**看起来完全正常** —— 服务端渲染的
    HTML 与 CSS 都在，只是所有依赖 JS 的东西静默失效（Canvas 不绘制、
    计时器不走、进度条不动）。这个项目真实踩过一次（CSP 拦掉 Next 的内联
    引导脚本），当时靠"查 DOM 里有没有某个元素"来判断，那在服务端渲染的
    HTML 里本来就有，属于空转断言。
  */
  const hydration = (() => {
    const nodes = document.querySelectorAll("body, body *");
    let bound = 0;
    let checked = 0;
    for (const el of nodes) {
      checked++;
      if (checked > 400) break;
      for (const key of Object.keys(el)) {
        if (key.startsWith("__reactFiber$") || key.startsWith("__reactProps$")) {
          bound++;
          break;
        }
      }
    }
    return { hydrated: bound > 0, boundNodes: bound };
  })();

  return JSON.stringify({
    viewport: vw,
    scrollWidth: document.documentElement.scrollWidth,
    bodyScrollWidth: document.body.scrollWidth,
    scrollHeight: document.documentElement.scrollHeight,
    overflowCount: bad.length,
    skippedDecorative,
    overflowing: bad.slice(0, 20),
    ...hydration,
  });
})()`;

function findChrome() {
  for (const c of CHROME_CANDIDATES) {
    if (existsSync(c)) return c;
  }
  return null;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 极简 CDP 客户端：按 id 派发请求，按 sessionId 支持扁平化会话 */
class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = [];
    ws.addEventListener("message", (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(`${msg.error.message} (${msg.error.code})`));
        else resolve(msg.result);
      } else if (msg.method) {
        for (const fn of this.listeners) fn(msg);
      }
    });
  }

  send(method, params = {}, sessionId) {
    const id = this.nextId++;
    const payload = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify(payload));
    });
  }

  /**
   * 持续监听某个事件，返回取消订阅的函数。
   *
   * 与 once 的区别是它不自动摘除 —— 控制台与异常事件会来很多次，
   * 每次都要重新挂的话会漏掉两次挂之间的消息。
   */
  on(method, handler, sessionId) {
    const fn = (msg) => {
      if (msg.method !== method) return;
      if (sessionId && msg.sessionId !== sessionId) return;
      handler(msg.params ?? {});
    };
    this.listeners.push(fn);
    return () => {
      this.listeners = this.listeners.filter((f) => f !== fn);
    };
  }

  /** 等待某个事件（可按 sessionId 过滤） */
  once(method, sessionId, timeoutMs = 30000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.listeners = this.listeners.filter((f) => f !== fn);
        reject(new Error(`等待事件超时：${method}`));
      }, timeoutMs);
      const fn = (msg) => {
        if (msg.method !== method) return;
        if (sessionId && msg.sessionId !== sessionId) return;
        clearTimeout(timer);
        this.listeners = this.listeners.filter((f) => f !== fn);
        resolve(msg.params);
      };
      this.listeners.push(fn);
    });
  }
}

async function main() {
  const { values } = parseArgs({
    options: {
      shot: { type: "string", multiple: true, default: [] },
      "out-dir": { type: "string", default: ".cache/shots" },
      settle: { type: "string", default: "1200" },
      port: { type: "string", default: "9333" },
      "chrome-path": { type: "string" },
      // 设备像素比。默认 2 —— 与主流笔记本/手机一致，
      // 1x 渲染会让 1px 的星点几乎看不见，看不出真实的视觉密度。
      dpr: { type: "string", default: "2" },
      // 只看首屏时加 --viewport-only：不截整页，得到的是视口那一块，
      // 同样的 token 预算下细节多得多（适合盯某个组件的视觉）
      "viewport-only": { type: "boolean", default: false },
      // 在页面里执行一段表达式并打印结果。
      // 排查「看起来没渲染」这类问题时，量一下比盯着截图猜快得多。
      eval: { type: "string" },
      /*
        在**应用脚本执行之前**注入的一段脚本（每个新文档都会跑）。

        与 --eval 的区别是时机：--eval 在页面加载完之后才执行，
        那时该跑的东西早跑过了，只能看到结果 —— 看不到过程。
        要查「某个 effect 到底有没有执行」，必须抢先接管
        getContext / requestAnimationFrame 这类原语并记账。
      */
      pre: { type: "string" },
    },
    allowPositionals: false,
  });

  const dpr = Math.max(1, Math.min(3, Number(values.dpr) || 2));

  if (values.shot.length === 0) {
    console.error("至少需要一个 --shot \"名称|URL|宽|高[|mobile]\"");
    process.exit(2);
  }

  const chromePath = values["chrome-path"] || findChrome();
  if (!chromePath) {
    console.error("找不到 Chrome / Edge 可执行文件，可用 --chrome-path 指定");
    process.exit(2);
  }

  const outDir = path.resolve(values["out-dir"]);
  await mkdir(outDir, { recursive: true });

  const port = Number(values.port);
  const userDataDir = path.join(outDir, "..", "chrome-cdp-profile");
  await mkdir(userDataDir, { recursive: true });

  // stdio: "ignore" —— 不建立管道。受限环境禁止命名管道，
  // 用 pipe 会让子进程直接 EPERM。
  const chrome = spawn(
    chromePath,
    [
      "--headless=new",
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${userDataDir}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-extensions",
      "--disable-gpu",
      "--hide-scrollbars",
      "--mute-audio",
      "about:blank",
    ],
    { stdio: "ignore", detached: false },
  );

  const cleanup = () => {
    try {
      spawn("taskkill", ["/PID", String(chrome.pid), "/T", "/F"], { stdio: "ignore" });
    } catch {
      chrome.kill();
    }
  };
  process.on("exit", cleanup);

  // 等 DevTools 端点就绪
  let wsUrl = null;
  for (let i = 0; i < 60; i++) {
    await sleep(400);
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/version`);
      const j = await res.json();
      if (j.webSocketDebuggerUrl) {
        wsUrl = j.webSocketDebuggerUrl;
        break;
      }
    } catch {
      /* 还没起来 */
    }
  }
  if (!wsUrl) {
    console.error("Chrome DevTools 端点未就绪");
    cleanup();
    process.exit(1);
  }

  const ws = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", () => reject(new Error("CDP WebSocket 连接失败")), {
      once: true,
    });
  });

  const cdp = new Cdp(ws);
  const results = [];

  for (const raw of values.shot) {
    const [name, url, w, h, flagStr] = raw.split("|");
    const width = Number(w) || 1440;
    const height = Number(h) || 1000;

    // 第 5 段是逗号分隔的镜头开关，可组合：
    //   mobile        模拟移动端视口
    //   vp            只截视口（不截整页），细节多得多
    //   scroll=1200   截图前先滚到指定位置
    //   hover=x:y     截图前把鼠标移到该坐标（用来验证 hover 交互）
    //   offline       导航**之前**就断网（用来验证 Service Worker 的离线兜底）
    const flags = new Set(
      (flagStr ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    );
    const mobile = flags.has("mobile");
    const offline = flags.has("offline");
    const viewportOnly = flags.has("vp") || values["viewport-only"];
    const scrollY = Number([...flags].find((f) => f.startsWith("scroll="))?.slice(7) ?? 0) || 0;
    const hoverFlag = [...flags].find((f) => f.startsWith("hover="));

    const { targetId } = await cdp.send("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });

    await cdp.send("Page.enable", {}, sessionId);

    /*
      抓控制台与未捕获异常。

      没有这个就只能靠"量出来不对"反推原因 —— 而 hydration 失败、
      组件抛错、CSP 拦截这类问题**在控制台里是一句话，在图上看却是"少了点东西"**，
      极容易误判成设计调整。默认只在有内容时打印，不干扰原有输出。
    */
    await cdp.send("Runtime.enable", {}, sessionId);
    const logs = [];
    const offLog = cdp.on("Runtime.consoleAPICalled", (params) => {
      const text = (params.args ?? [])
        .map((a) => a.value ?? a.description ?? a.type)
        .join(" ");
      logs.push(`[${params.type}] ${text}`);
    }, sessionId);
    const offErr = cdp.on("Runtime.exceptionThrown", (params) => {
      const d = params.exceptionDetails ?? {};
      logs.push(`[exception] ${d.text ?? ""} ${d.exception?.description ?? ""}`.trim());
    }, sessionId);

    await cdp.send(
      "Emulation.setDeviceMetricsOverride",
      { width, height, deviceScaleFactor: dpr, mobile },
      sessionId,
    );

    /*
      断网必须在 **Page.navigate 之前** 生效，否则页面已经从网络拿到了响应，
      测的就不是离线兜底了。用 CDP 的 Network 域模拟，比拔网线可靠。
    */
    if (offline) {
      await cdp.send("Network.enable", {}, sessionId);
      await cdp.send(
        "Network.emulateNetworkConditions",
        { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 },
        sessionId,
      );
    }

    // 注入必须发生在导航之前，否则应用脚本已经跑完了，什么都记不到
    if (values.pre) {
      await cdp.send(
        "Page.addScriptToEvaluateOnNewDocument",
        { source: values.pre },
        sessionId,
      );
    }

    const loaded = cdp.once("Page.loadEventFired", sessionId, 45000);
    await cdp.send("Page.navigate", { url }, sessionId);
    try {
      await loaded;
    } catch {
      /* 超时也继续，尽量出图 */
    }
    // 等字体、CSS 动画与 Canvas 首帧稳定
    await sleep(Number(values.settle));

    if (scrollY > 0) {
      await cdp.send(
        "Runtime.evaluate",
        { expression: `window.scrollTo(0, ${scrollY})`, awaitPromise: true },
        sessionId,
      );
      // 滚动会触发懒加载与动画，再等一拍
      await sleep(600);
    }

    if (hoverFlag) {
      const [hx, hy] = hoverFlag.slice(6).split(":").map(Number);
      await cdp.send(
        "Input.dispatchMouseEvent",
        { type: "mouseMoved", x: hx, y: hy, buttons: 0 },
        sessionId,
      );
      // 悬停过渡动辄 500ms，不等完就会截到动画中间态
      await sleep(900);
    }

    const measured = await cdp.send(
      "Runtime.evaluate",
      { expression: MEASURE, returnByValue: true },
      sessionId,
    );

    if (values.eval) {
      const probe = await cdp.send(
        "Runtime.evaluate",
        { expression: values.eval, returnByValue: true, awaitPromise: true },
        sessionId,
      );
      console.log(`\n[eval @ ${name}] ${JSON.stringify(probe.result?.value ?? probe.result)}`);
    }

    const shot = await cdp.send(
      "Page.captureScreenshot",
      {
        format: "png",
        captureBeyondViewport: !viewportOnly,
        fromSurface: true,
      },
      sessionId,
    );

    const file = path.join(outDir, `${name}.png`);
    await writeFile(file, Buffer.from(shot.data, "base64"));
    await cdp.send("Target.closeTarget", { targetId });

    // 事件监听要显式摘掉，否则跑多张图时会重复累积
    offLog();
    offErr();

    const metrics = JSON.parse(measured.result.value);
    results.push({ name, file, url, width, height, mobile, logs, ...metrics });
  }

  ws.close();
  cleanup();

  for (const r of results) {
    console.log(
      `\n▸ ${r.name}  [${r.width}x${r.height}${r.mobile ? " mobile" : ""}]  ${r.file}`,
    );
    console.log(
      `  视口 ${r.viewport}px · 文档滚动宽 ${r.scrollWidth}px · 页高 ${r.scrollHeight}px` +
        (r.scrollWidth > r.viewport ? `  ⚠ 横向溢出 ${r.scrollWidth - r.viewport}px` : "  ✓ 无横向溢出"),
    );
    console.log(
      r.hydrated
        ? `  ✓ 已水合（React 接管了 ${r.boundNodes} 个节点）`
        : `  ✗ 未水合 —— 页面上的 JS 交互与 Canvas 全部失效。` +
            `常见原因：CSP 的 script-src 拦掉了 Next 的内联引导脚本`,
    );
    if (r.overflowCount > 0) {
      console.log(`  越界元素 ${r.overflowCount} 个：`);
      for (const o of r.overflowing) {
        console.log(`    <${o.tag}> right=${o.right} w=${o.w}  class="${o.cls}"`);
      }
    }

    /*
      控制台只在有内容时打印，且 error / exception 排在前面 ——
      这类消息通常是"图上少了点东西"的真正原因，值得先看到。
    */
    if (r.logs?.length) {
      const rank = (line) => (line.startsWith("[exception]") || line.startsWith("[error]") ? 0 : 1);
      const sorted = [...r.logs].sort((a, b) => rank(a) - rank(b));
      console.log(`  ⚠ 控制台 ${sorted.length} 条：`);
      for (const line of sorted.slice(0, 12)) {
        console.log(`    ${line.replace(/\s+/g, " ").slice(0, 220)}`);
      }
      if (sorted.length > 12) console.log(`    …（还有 ${sorted.length - 12} 条）`);
    }
  }
  console.log("");
}

main().catch((e) => {
  console.error("shoot 失败：", e.message);
  process.exit(1);
});
