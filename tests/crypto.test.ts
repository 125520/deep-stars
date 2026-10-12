import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";

import { decryptSecret, encryptSecret, fingerprint, keyHint } from "../src/lib/crypto.ts";

const ORIGINAL = process.env.DEEP_STARS_SECRET;
const STRONG = "a".repeat(48);

beforeEach(() => {
  process.env.DEEP_STARS_SECRET = STRONG;
});

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.DEEP_STARS_SECRET;
  else process.env.DEEP_STARS_SECRET = ORIGINAL;
});

describe("加密与解密的往返", () => {
  it("能原样取回", () => {
    const secret = "sk-abcdef0123456789";
    assert.equal(decryptSecret(encryptSecret(secret)), secret);
  });

  it("中文与 emoji 也能往返（UTF-8 边界）", () => {
    for (const value of ["密钥🔑", "中文密文测试", "a".repeat(5000)]) {
      assert.equal(decryptSecret(encryptSecret(value)), value);
    }
  });

  it("空串也能往返（不该被当成 null）", () => {
    assert.equal(decryptSecret(encryptSecret("")), "");
  });

  it("**同一明文两次加密得到不同密文** —— 随机 IV 的作用", () => {
    const a = encryptSecret("same-input");
    const b = encryptSecret("same-input");
    assert.notEqual(a, b, "IV 重复会彻底瓦解 GCM 的保密性");
    assert.equal(decryptSecret(a), decryptSecret(b));
  });

  it("密文里不含明文", () => {
    const secret = "sk-super-secret-value";
    assert.ok(!encryptSecret(secret).includes(secret));
  });

  it("带 v1 版本前缀，便于将来轮换密钥", () => {
    const payload = encryptSecret("x");
    assert.ok(payload.startsWith("v1:"), `实际: ${payload.slice(0, 8)}`);
    assert.equal(payload.split(":").length, 4);
  });
});

describe("篡改检测（GCM 认证）", () => {
  it("**改动密文一个字符就解不出来**", () => {
    const payload = encryptSecret("sk-original-value");
    const parts = payload.split(":");
    // 改最后一个字符，保持 base64 结构
    const data = parts[3]!;
    const tampered = [...parts.slice(0, 3), data.slice(0, -2) + (data.endsWith("A") ? "BB" : "AA")].join(":");
    assert.equal(decryptSecret(tampered), null, "被篡改的密文必须解不出来");
  });

  it("改动 authTag 也解不出来", () => {
    const payload = encryptSecret("sk-original-value");
    const parts = payload.split(":");
    const tampered = [parts[0], parts[1], "AAAAAAAAAAAAAAAAAAAAAA==", parts[3]].join(":");
    assert.equal(decryptSecret(tampered), null);
  });

  it("改动 IV 也解不出来", () => {
    const payload = encryptSecret("sk-original-value");
    const parts = payload.split(":");
    const tampered = [parts[0], "AAAAAAAAAAAAAAAA", parts[2], parts[3]].join(":");
    assert.equal(decryptSecret(tampered), null);
  });
});

describe("换主密钥之后", () => {
  it("**旧密文解不出来，且返回 null 而不是抛错**", () => {
    const payload = encryptSecret("sk-value");
    process.env.DEEP_STARS_SECRET = "b".repeat(48);

    // 返回 null 而不是抛错：一条坏密文不该让整个设置页 500
    assert.equal(decryptSecret(payload), null);
  });

  it("换回来之后又能解开（派生密钥随来源串重算）", () => {
    const payload = encryptSecret("sk-value");
    process.env.DEEP_STARS_SECRET = "b".repeat(48);
    assert.equal(decryptSecret(payload), null);
    process.env.DEEP_STARS_SECRET = STRONG;
    assert.equal(decryptSecret(payload), "sk-value");
  });
});

describe("主密钥缺失或过弱", () => {
  it("**加密时抛错**，不静默回退到某个默认密钥", () => {
    delete process.env.DEEP_STARS_SECRET;
    assert.throws(() => encryptSecret("x"), /DEEP_STARS_SECRET/);
  });

  it("主密钥过短同样拒绝（默认密钥等于没加密）", () => {
    process.env.DEEP_STARS_SECRET = "short";
    assert.throws(() => encryptSecret("x"), /过短/);
  });

  it("缺失时解密返回 null，不抛错", () => {
    const payload = encryptSecret("x");
    delete process.env.DEEP_STARS_SECRET;
    assert.equal(decryptSecret(payload), null);
  });
});

describe("decryptSecret() 对坏输入的处理", () => {
  it("null / undefined / 空串都返回 null", () => {
    assert.equal(decryptSecret(null), null);
    assert.equal(decryptSecret(undefined), null);
    assert.equal(decryptSecret(""), null);
  });

  it("段数不对、版本不认识、base64 乱码都返回 null", () => {
    for (const bad of [
      "不是密文",
      "v1:only-three:parts",
      "v1:a:b:c:d",
      "v2:aXY=:dGFn:ZGF0YQ==",
      "v1:!!!:!!!:!!!",
    ]) {
      assert.equal(decryptSecret(bad), null, `应当拒绝: ${bad}`);
    }
  });
});

describe("keyHint()", () => {
  it("只保留末 4 位", () => {
    assert.equal(keyHint("sk-abcdef0123456789"), "••••6789");
  });

  it("**绝不返回完整密钥**", () => {
    const secret = "sk-very-long-secret-value-here";
    const hint = keyHint(secret);
    assert.ok(!hint.includes(secret));
    assert.ok(hint.length <= 8, `提示串过长: ${hint}`);
  });

  it("短于 4 位时全部遮住", () => {
    assert.equal(keyHint("ab"), "••••");
    assert.equal(keyHint(""), "••••");
  });

  it("两侧空白不影响末位判断", () => {
    assert.equal(keyHint("  sk-abcdef1234  "), "••••1234");
  });
});

describe("fingerprint()", () => {
  it("稳定：同一输入永远同一结果", () => {
    assert.equal(fingerprint("sk-abc"), fingerprint("sk-abc"));
  });

  it("忽略两侧空白", () => {
    assert.equal(fingerprint("  sk-abc  "), fingerprint("sk-abc"));
  });

  it("不同输入不碰撞（在此长度下）", () => {
    assert.notEqual(fingerprint("sk-abc"), fingerprint("sk-abd"));
  });

  it("定长 16 位十六进制，不含原文", () => {
    const value = "sk-original-secret";
    const fp = fingerprint(value);
    assert.match(fp, /^[0-9a-f]{16}$/);
    assert.ok(!fp.includes(value));
  });
});
