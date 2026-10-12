import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { normalizeSiteUrl, pickSiteUrl } from "../src/lib/site-url.ts";

/**
 * 这一组锁住的是一类**没有任何线索的线上故障**：
 * Render 注入的 RENDER_EXTERNAL_HOSTNAME 只有主机名，没有协议头。
 * 直接拿它当 URL 用，Better Auth 的来源校验会不匹配并拒绝请求 ——
 * 表现为"登录按钮点了没反应"，报错还发生在库内部。
 */
describe("normalizeSiteUrl() 补协议头", () => {
  it("**裸主机名补 https** —— Render 注入的就是这种", () => {
    assert.equal(normalizeSiteUrl("deep-stars.onrender.com"), "https://deep-stars.onrender.com");
  });

  it("**本地主机补 http** —— 补成 https 会让本地登录直接失效", () => {
    for (const host of ["localhost", "localhost:3210", "127.0.0.1:3210", "127.0.0.1"]) {
      const result = normalizeSiteUrl(host);
      assert.ok(result?.startsWith("http://"), `${host} 应当补 http://，实际是 ${result}`);
      assert.equal(result, `http://${host}`);
    }
  });

  it("IPv6 回环地址也算本地", () => {
    assert.equal(normalizeSiteUrl("[::1]:3210"), "http://[::1]:3210");
  });

  it("已有协议头的原样返回（含 http 与 https）", () => {
    assert.equal(normalizeSiteUrl("https://a.example.com"), "https://a.example.com");
    assert.equal(normalizeSiteUrl("http://a.example.com"), "http://a.example.com");
  });

  it("协议头大小写不敏感，且不做改写", () => {
    assert.equal(normalizeSiteUrl("HTTPS://A.example.com"), "HTTPS://A.example.com");
  });

  it("去掉结尾斜杠 —— 否则同一个地址会有两种写法", () => {
    // 这正是来源校验最容易踩的地方：`https://a.com/` 与 `https://a.com` 不是同一个字符串
    assert.equal(normalizeSiteUrl("https://a.example.com/"), "https://a.example.com");
    assert.equal(normalizeSiteUrl("https://a.example.com///"), "https://a.example.com");
    assert.equal(normalizeSiteUrl("a.example.com/"), "https://a.example.com");
  });

  it("两侧空白被忽略（从网页复制粘贴时常见）", () => {
    assert.equal(normalizeSiteUrl("  https://a.example.com  "), "https://a.example.com");
  });

  it("保留路径与端口", () => {
    assert.equal(normalizeSiteUrl("a.example.com:8080/app"), "https://a.example.com:8080/app");
  });
});

describe("normalizeSiteUrl() 对空值的处理", () => {
  it("**空值返回 undefined，而不是空字符串**", () => {
    // 空串会被当成一个"来源"塞进 trustedOrigins，让排查变得更难
    for (const value of [null, undefined, "", "   ", "/"]) {
      assert.equal(normalizeSiteUrl(value), undefined, `${String(value)} 应当返回 undefined`);
    }
  });
});

describe("pickSiteUrl() 按顺序取第一个能用的", () => {
  it("显式配置优先于平台注入", () => {
    assert.equal(
      pickSiteUrl("https://custom.example.com", "deep-stars.onrender.com"),
      "https://custom.example.com",
    );
  });

  it("显式配置为空时退回平台注入的，并补齐协议", () => {
    assert.equal(pickSiteUrl(undefined, "deep-stars.onrender.com"), "https://deep-stars.onrender.com");
    assert.equal(pickSiteUrl("", "deep-stars.onrender.com"), "https://deep-stars.onrender.com");
  });

  it("全空时返回 undefined（而不是猜一个地址）", () => {
    assert.equal(pickSiteUrl(undefined, null, "", "  "), undefined);
  });

  it("跳过前面那些无效的，取后面第一个有效的", () => {
    assert.equal(pickSiteUrl("", "  ", "a.example.com"), "https://a.example.com");
  });

  it("不传参数也不抛错", () => {
    assert.equal(pickSiteUrl(), undefined);
  });
});
