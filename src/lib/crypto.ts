import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync } from "node:crypto";

/**
 * 对称加密（AES-256-GCM）
 * ══════════════════════════════════════════════════════════════════
 *
 * 用来保护用户自带（BYOK）的 AI 密钥。**数据库泄露不等于密钥泄露** ——
 * 这是这个模块存在的全部意义。
 *
 * ⚠️ **只在服务端运行。** 它依赖 node:crypto，
 * 一旦被客户端组件 import 会在打包期直接报错（这是好事，比静默降级强）。
 *
 * ── 为什么是 GCM 而不是 CBC ─────────────────────────────────────
 *
 * GCM 自带**认证**：密文被改过一个比特，解密就会失败。
 * CBC 不会 —— 它会安静地解出一段垃圾，而调用方以为拿到的是真密钥，
 * 然后拿着它去请求 AI 接口，最终表现为一句莫名其妙的 401。
 *
 * ── 格式 ────────────────────────────────────────────────────────
 *
 *   v1:<iv>:<authTag>:<ciphertext>     三段都是 base64
 *
 * 前缀 `v1:` 不是装饰：**密钥轮换时必须能区分新旧密文**。
 * 没有版本号的话，换密钥那一天所有存量数据都会变成无法解密的垃圾，
 * 而且没有任何办法判断"这条解密失败是因为换了密钥还是因为数据损坏"。
 */

const VERSION = "v1";
const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12; // GCM 的推荐长度，96 bit
const KEY_BYTES = 32; // AES-256

/**
 * 派生密钥用的固定盐。
 *
 * 固定盐在这里是**可以接受**的：scrypt 的盐本来是为了防止
 * "同一口令在不同用户间产生相同密钥"，而这里全应用只有一个密钥、
 * 且它来自环境变量而不是用户口令。
 *
 * 真正的安全性来自 DEEP_STARS_SECRET 的**熵**。所以：
 * 部署时必须用一个足够长的随机串（32 字节以上），
 * 绝不能是 "secret" 这种。下面是 scrypt 的工作因子，
 * 它只增加暴力破解成本，替代不了熵。
 */
const SALT = Buffer.from("deep-stars:byok:v1", "utf8");

let cachedKey: Buffer | null = null;
let cachedFrom: string | null = null;

/**
 * 从主密钥派生 AES 密钥。
 *
 * 用 scrypt 而不是直接 sha256：scrypt 是**慢的**，每次派生都要跑一遍
 * 内存硬函数。这挡住了"主密钥是弱口令"的情况下的离线爆破。
 *
 * 结果做模块级缓存 —— scrypt 一次要几十毫秒，而每个请求都可能需要解密。
 * 缓存同时比对来源串，所以测试里换 env 不会拿到上一个密钥。
 */
function deriveKey(secret: string): Buffer {
  if (cachedKey && cachedFrom === secret) return cachedKey;
  const key = scryptSync(secret, SALT, KEY_BYTES);
  cachedKey = key;
  cachedFrom = secret;
  return key;
}

/**
 * 读取主密钥。
 *
 * 缺失时**抛错而不是回退到某个内置默认值**：
 * 用默认密钥加密等于没加密，而且没人会发现。
 */
function readSecret(): string {
  const secret = process.env.DEEP_STARS_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error(
      "DEEP_STARS_SECRET 缺失或过短（至少 16 字符）。BYOK 密钥无法安全保存，已拒绝写入。",
    );
  }
  return secret;
}

export function encryptSecret(plaintext: string): string {
  const key = deriveKey(readSecret());
  // 每次都用全新的随机 IV：GCM 下 (密钥, IV) 组合重复会**彻底瓦解保密性**
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);

  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return [
    VERSION,
    iv.toString("base64"),
    authTag.toString("base64"),
    ciphertext.toString("base64"),
  ].join(":");
}

/**
 * 解密。**任何失败都返回 null，绝不抛错。**
 *
 * 调用方拿不到密钥时的正确行为是"当作没配"，而不是让整个页面 500 ——
 * 一条坏掉的密文不该让设置页打不开。
 * 但失败原因会打到日志里，否则真出问题时无从查起。
 */
export function decryptSecret(payload: string | null | undefined): string | null {
  if (!payload) return null;

  const parts = payload.split(":");
  if (parts.length !== 4) {
    console.warn("[crypto] 密文格式不对，段数不是 4");
    return null;
  }

  const [version, ivB64, tagB64, dataB64] = parts as [string, string, string, string];
  if (version !== VERSION) {
    console.warn(`[crypto] 不认识的密文版本：${version}`);
    return null;
  }

  try {
    const key = deriveKey(readSecret());
    const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(ivB64, "base64"));
    decipher.setAuthTag(Buffer.from(tagB64, "base64"));

    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(dataB64, "base64")),
      decipher.final(),
    ]);
    return plaintext.toString("utf8");
  } catch (error) {
    // 换过主密钥、数据被篡改、或密文损坏都会走到这里
    console.warn("[crypto] 解密失败（主密钥变更或数据损坏）：", error);
    return null;
  }
}

/**
 * 给界面看的提示串：只留末 4 位。
 *
 * 不要把密钥明文回传给前端 —— 哪怕是"显示出来方便用户核对"也不行：
 * 那会让密钥出现在 HTML、浏览器缓存、以及任何一次截图里。
 */
export function keyHint(plaintext: string): string {
  const trimmed = plaintext.trim();
  if (trimmed.length <= 4) return "••••";
  return `••••${trimmed.slice(-4)}`;
}

/** 稳定的短哈希，用于判断"用户这次提交的是不是同一把密钥"而不必解密 */
export function fingerprint(plaintext: string): string {
  return createHash("sha256").update(plaintext.trim()).digest("hex").slice(0, 16);
}
