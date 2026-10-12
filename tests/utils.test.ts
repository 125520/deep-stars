import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { cn } from "../src/lib/utils.ts";

/**
 * 使用 Node 内置测试运行器（node:test）而不是 vitest。
 *
 * 原因有二：
 *  1. 零额外依赖 —— vitest 会拖进 vite / rolldown 一整条工具链，
 *     而本项目的单元测试全部是纯逻辑，用不上这套打包器。
 *  2. 可用性 —— vite 在 Windows 上首次运行会执行 `exec("net use")` 探测网络
 *     驱动器，在受限环境（禁止 piped stdio）下直接 spawn EPERM，测试根本跑不起来。
 *     node:test 没有这个前置动作。
 *
 * 因为走的是 Node 原生 ESM 解析，相对导入必须带 .ts 扩展名
 * （tsconfig 里相应开了 allowImportingTsExtensions）。
 */
describe("cn()", () => {
  it("拼接普通类名", () => {
    assert.equal(cn("a", "b"), "a b");
  });

  it("忽略假值", () => {
    assert.equal(cn("a", false && "b", undefined, null, "c"), "a c");
  });

  it("支持条件对象写法", () => {
    assert.equal(cn("base", { on: true, off: false }), "base on");
  });

  it("用 tailwind-merge 消解同族冲突，保留后者", () => {
    // 这是选 tailwind-merge 而不是单纯 clsx 的原因：
    // 组件默认样式与外部传入样式冲突时，外部样式必须胜出。
    assert.equal(cn("px-2 py-1", "px-4"), "py-1 px-4");
    assert.equal(cn("text-ink-muted", "text-ink"), "text-ink");
  });

  it("不误伤不同族的类名", () => {
    assert.equal(cn("px-2", "py-2"), "px-2 py-2");
  });
});
