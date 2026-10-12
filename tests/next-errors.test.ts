import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { isFrameworkSignal, shouldHandle } from "../src/lib/next-errors.ts";

/**
 * 这些断言看起来琐碎，但它们锁住的是**一类静默故障**：
 * 把框架的控制流信号当成普通错误吞掉，重定向与 notFound 就会无声失效。
 * 生产构建实测踩过一次（见 src/lib/next-errors.ts 的说明）。
 */
describe("isFrameworkSignal() 认得出框架信号", () => {
  it("DYNAMIC_SERVER_USAGE（动态渲染检测）", () => {
    assert.equal(isFrameworkSignal({ digest: "DYNAMIC_SERVER_USAGE" }), true);
  });

  it("NEXT_NOT_FOUND", () => {
    assert.equal(isFrameworkSignal({ digest: "NEXT_NOT_FOUND" }), true);
  });

  it("NEXT_REDIRECT（digest 后面还带着分号分隔的参数）", () => {
    assert.equal(
      isFrameworkSignal({ digest: "NEXT_REDIRECT;replace;/dashboard;307;" }),
      true,
    );
  });

  it("NEXT_HTTP_ERROR_FALLBACK", () => {
    assert.equal(isFrameworkSignal({ digest: "NEXT_HTTP_ERROR_FALLBACK;404" }), true);
  });
});

describe("isFrameworkSignal() 不误判普通错误", () => {
  it("普通 Error 没有 digest", () => {
    assert.equal(isFrameworkSignal(new Error("数据库连接失败")), false);
  });

  it("Prisma 的唯一约束错误（code 而不是 digest）", () => {
    assert.equal(isFrameworkSignal({ code: "P2002", message: "unique" }), false);
  });

  it("digest 是别的字符串时不误判", () => {
    assert.equal(isFrameworkSignal({ digest: "something-else" }), false);
    assert.equal(isFrameworkSignal({ digest: "next_redirect" }), false, "大小写敏感");
  });

  it("digest 不是字符串时不误判", () => {
    assert.equal(isFrameworkSignal({ digest: 123 }), false);
    assert.equal(isFrameworkSignal({ digest: null }), false);
  });

  it("**不能把任何带 digest 的东西都当成信号** —— 那会让所有错误都被吞掉", () => {
    assert.equal(isFrameworkSignal({ digest: "P2002" }), false);
  });
});

describe("isFrameworkSignal() 对畸形输入不抛错", () => {
  it("null / undefined / 原始值", () => {
    for (const value of [null, undefined, 0, "", "字符串", true, Symbol("s")]) {
      assert.equal(isFrameworkSignal(value), false, `不该抛错: ${String(value)}`);
    }
  });

  it("数组与函数", () => {
    assert.equal(isFrameworkSignal([]), false);
    assert.equal(isFrameworkSignal(() => {}), false);
  });
});

describe("shouldHandle() 是 isFrameworkSignal 的取反", () => {
  it("框架信号不处理（交给框架继续抛）", () => {
    assert.equal(shouldHandle({ digest: "NEXT_REDIRECT;push;/x;303;" }), false);
  });

  it("普通错误应当处理", () => {
    assert.equal(shouldHandle(new Error("boom")), true);
  });

  it("与 isFrameworkSignal 始终相反", () => {
    for (const value of [{ digest: "NEXT_NOT_FOUND" }, new Error("x"), null, {}]) {
      assert.equal(shouldHandle(value), !isFrameworkSignal(value));
    }
  });
});
