import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  DEFAULT_BASE_URLS,
  PROVIDERS,
  PROVIDER_LABELS,
  detectProvider,
  validateApiKey,
  validateBaseUrl,
} from "../src/lib/api-key.ts";

const GOOD = "sk-" + "a".repeat(40);

describe("detectProvider()", () => {
  it("认出 Anthropic 的 sk-ant- 前缀", () => {
    assert.equal(detectProvider("sk-ant-api03-abcdefghijklmnop"), "anthropic");
  });

  it("**sk- 一律归为 OpenAI 兼容** —— 无法可靠区分 DeepSeek 与 OpenAI", () => {
    // 两者前缀相同、长度区间重叠。归到 openai-compatible 是正确的：
    // DeepSeek 的接口本来就是 OpenAI 兼容的
    assert.equal(detectProvider(GOOD), "openai-compatible");
    assert.equal(detectProvider("sk-proj-abcdefghijklmnop"), "openai-compatible");
  });

  it("其它前缀归为未识别", () => {
    assert.equal(detectProvider("gsk_somethingelse"), "unknown");
    assert.equal(detectProvider(""), "unknown");
  });

  it("两侧空白不影响判断", () => {
    assert.equal(detectProvider("  sk-ant-xxxxxxxx  "), "anthropic");
  });
});

describe("validateApiKey() 的接受路径", () => {
  it("接受典型密钥并给出厂商", () => {
    const result = validateApiKey(GOOD);
    assert.ok(result.ok);
    if (!result.ok) return;
    assert.equal(result.provider, "openai-compatible");
  });

  it("**不认识的厂商仍然允许保存** —— 自建网关不该被挡在门外", () => {
    const result = validateApiKey("my-gateway-token-0123456789");
    assert.ok(result.ok, "直接拒绝会把合法的自建部署挡掉");
    if (!result.ok) return;
    assert.equal(result.provider, "unknown");
  });

  it("两侧空白被去掉后接受（复制时常见的多余空格）", () => {
    assert.ok(validateApiKey(`  ${GOOD}  `).ok);
  });

  it("**尾部换行被 trim 掉后接受** —— 从文件里复制密钥几乎总会带上它", () => {
    // 这不是漏洞，是在帮忙：拒绝它只会让用户对着一个看不见的换行符干瞪眼。
    // 内部换行仍然拒绝，见下面的用例。
    const result = validateApiKey(`${GOOD}\n`);
    assert.ok(result.ok, "尾随换行应当被去掉而不是报错");
  });

  it("恰好等于长度下限与上限都接受（边界包含）", () => {
    assert.ok(validateApiKey("a".repeat(16)).ok);
    assert.ok(validateApiKey("a".repeat(512)).ok);
  });
});

describe("validateApiKey() 的拒绝路径", () => {
  const cases: [string, string, RegExp][] = [
    ["空串", "", /请先填入密钥/],
    ["只有空格", "   ", /请先填入密钥/],
    ["太短", "sk-abc", /太短/],
    ["太长", "a".repeat(513), /太长/],
    ["内部有空格", "sk-abc def ghijklmnop", /空格、换行或非 ASCII/],
    ["内部有换行", "sk-abcdefghij\nklmnopqrst", /空格、换行或非 ASCII/],
    ["有中文", "sk-密钥密钥密钥密钥密钥", /空格、换行或非 ASCII/],
    ["有制表符", "sk-abc\tdefghijklmnop", /空格、换行或非 ASCII/],
  ];

  for (const [name, raw, pattern] of cases) {
    it(`拒绝：${name}`, () => {
      const result = validateApiKey(raw);
      assert.equal(result.ok, false, `不该接受: ${JSON.stringify(raw)}`);
      if (result.ok) return;
      assert.match(result.error, pattern);
    });
  }

  it("**字符集错误优先于长度错误**，提示才是可操作的", () => {
    // 一个带尾随空格的短密钥若先报"太短"，用户加几个字符后才被告知有空字符
    const result = validateApiKey("sk-a b");
    assert.ok(!result.ok);
    if (result.ok) return;
    assert.match(result.error, /空格、换行/, "应当先报字符集问题");
  });
});

describe("validateBaseUrl()", () => {
  it("空值表示用默认地址", () => {
    assert.deepEqual(validateBaseUrl(""), { ok: true, url: null });
    assert.deepEqual(validateBaseUrl(null), { ok: true, url: null });
    assert.deepEqual(validateBaseUrl(undefined), { ok: true, url: null });
  });

  it("接受 https 地址", () => {
    const result = validateBaseUrl("https://api.example.com/v1");
    assert.ok(result.ok);
    if (!result.ok) return;
    assert.equal(result.url, "https://api.example.com/v1");
  });

  it("**去掉末尾斜杠**，避免拼出双斜杠的路径", () => {
    const result = validateBaseUrl("https://api.example.com/v1///");
    assert.ok(result.ok);
    if (!result.ok) return;
    assert.equal(result.url, "https://api.example.com/v1");
  });

  it("**拒绝 http** —— 那会让密钥明文过网", () => {
    const result = validateBaseUrl("http://api.example.com/v1");
    assert.ok(!result.ok);
    if (result.ok) return;
    assert.match(result.error, /https/);
  });

  it("本机地址允许 http（本地跑模型服务是常见需求）", () => {
    for (const url of ["http://localhost:11434/v1", "http://127.0.0.1:8000/v1"]) {
      assert.ok(validateBaseUrl(url).ok, `应当接受: ${url}`);
    }
  });

  it("不是 URL 的输入被拒绝", () => {
    const result = validateBaseUrl("不是地址");
    assert.ok(!result.ok);
    if (result.ok) return;
    assert.match(result.error, /有效的 URL/);
  });

  it("过长被拒绝", () => {
    const result = validateBaseUrl(`https://example.com/${"a".repeat(400)}`);
    assert.ok(!result.ok);
  });
});

describe("常量表", () => {
  it("每个厂商都有中文标签，没有漏掉的", () => {
    for (const provider of PROVIDERS) {
      assert.ok(PROVIDER_LABELS[provider]?.length > 0, `${provider} 缺少标签`);
    }
  });

  it("默认地址都是 https", () => {
    for (const url of Object.values(DEFAULT_BASE_URLS)) {
      assert.ok(url?.startsWith("https://"), `默认地址不是 https: ${url}`);
    }
  });
});
