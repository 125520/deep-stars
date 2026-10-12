"use server";

import { revalidatePath } from "next/cache";

import { DEFAULT_BASE_URLS, PROVIDER_LABELS, validateApiKey, validateBaseUrl } from "@/lib/api-key";
import { encryptSecret, keyHint } from "@/lib/crypto";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";

/**
 * BYOK：保存 / 删除用户自带的 AI 密钥
 * ══════════════════════════════════════════════════════════════════
 *
 * ── 三条纪律 ────────────────────────────────────────────────────
 *
 * 1. **明文只在这一次请求的内存里存在。** 加密后立刻写库，
 *    函数返回的任何内容都不含明文，也不含密文 ——
 *    密文回传给前端同样没意义，而且会留在浏览器的网络面板里。
 *
 * 2. **返回值里绝不出现密钥。** 包括错误信息：校验失败时只说
 *    "格式不对"，不能把用户输入回显出来（错误信息常被日志收集）。
 *
 * 3. **一人一把，用 upsert。** 不允许多把并存：选择哪一把去调用
 *    会变成一个额外的心智负担，而收益为零。
 */

export type KeyState = { ok: true; message: string } | { ok: false; error: string } | null;

const MAX_LABEL = 40;
const MAX_MODEL = 80;

export async function saveApiKey(_prev: KeyState, formData: FormData): Promise<KeyState> {
  const session = await requireSession();
  if (!session) return { ok: false, error: "登录状态已过期，请重新登录。" };

  // ── 校验密钥 ──
  const rawKey = String(formData.get("apiKey") ?? "");
  const check = validateApiKey(rawKey);
  if (!check.ok) return { ok: false, error: check.error };

  // ── 校验接口地址 ──
  const rawBase = String(formData.get("baseUrl") ?? "");
  const baseCheck = validateBaseUrl(rawBase);
  if (!baseCheck.ok) return { ok: false, error: baseCheck.error };

  const baseUrl =
    baseCheck.url ?? DEFAULT_BASE_URLS[check.provider] ?? DEFAULT_BASE_URLS["openai-compatible"]!;

  // ── 展示名与模型 ──
  const label = String(formData.get("label") ?? "").trim().slice(0, MAX_LABEL);
  const model = String(formData.get("model") ?? "").trim().slice(0, MAX_MODEL) || null;

  const key = rawKey.trim();

  /*
    加密放在最靠近写库的地方。
    在这之前的所有分支（校验、展示名处理）都不会让明文离开内存，
    而加密之后这个作用域里就只剩密文了。
  */
  let cipher: string;
  try {
    cipher = encryptSecret(key);
  } catch (error) {
    /*
      主密钥缺失或过弱时 encryptSecret 会抛错。
      这里**不能**把原始错误抛给用户（可能包含环境变量名之类的内部信息），
      但要让管理员能在服务端日志里看到真正的原因。
    */
    console.error("[byok] 加密失败：", error);
    return { ok: false, error: "服务端未正确配置加密密钥，暂时无法保存。请联系管理员。" };
  }

  const userId = session.user.id;
  const data = {
    label: label || PROVIDER_LABELS[check.provider],
    baseUrl,
    model,
    keyCipher: cipher,
    keyHint: keyHint(key),
  };

  /*
    一人一把，靠 userId 上的唯一约束保证（见 schema 的注释）。
    所以这里可以放心用 upsert —— 并发保存时数据库会拒绝第二行，
    而不是像"先删后建"那样漏出一个重复。
  */
  await prisma.userApiKey.upsert({
    where: { userId },
    create: { userId, ...data },
    update: data,
  });

  revalidatePath("/settings");
  return {
    ok: true,
    message: `已保存（${PROVIDER_LABELS[check.provider]} · ${keyHint(key)}）。密钥已加密存储。`,
  };
}

export async function deleteApiKey(): Promise<void> {
  const session = await requireSession();
  if (!session) return;

  // deleteMany 才接受 userId 之外的过滤条件
  await prisma.userApiKey.deleteMany({ where: { userId: session.user.id } });
  revalidatePath("/settings");
}
