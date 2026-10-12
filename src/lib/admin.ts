/**
 * 管理权限判断
 * ══════════════════════════════════════════════════════════════════
 *
 * 纯函数。管理后台最怕的不是"权限不够严"，而是**把自己锁在门外**：
 * 一个误操作把最后一个管理员降级或封禁，之后谁也进不去，
 * 只能去数据库里手改 —— 而这一步需要的人恰好进不去后台。
 *
 * 所以下面每一条约束都对应一个真实的锁死路径。
 */

export type AdminUser = {
  email?: string | null;
  role?: string | null;
};

/**
 * 是不是管理员。
 *
 * 除了 `role === "admin"`，还支持用环境变量指定一个邮箱 ——
 * 这是**引导问题**的解法：全新部署时数据库里一个管理员都没有，
 * 而"第一个管理员"没法由后台自己产生。
 * 设置在服务端环境变量里，客户端无法影响。
 */
export function isAdminUser(user: AdminUser | null | undefined, bootstrapEmail?: string): boolean {
  if (!user) return false;
  if (user.role === "admin") return true;

  const boot = bootstrapEmail?.trim().toLowerCase();
  if (!boot) return false;
  return (user.email ?? "").trim().toLowerCase() === boot;
}

export type ModerationTarget = {
  email?: string | null;
  role?: string | null;
  banned?: boolean;
};

export type ModerationCheck = { ok: true } | { ok: false; reason: string };

/**
 * 能不能对某个用户执行降级 / 封禁这类**会削弱其权限**的操作。
 *
 * @param actorEmail  执行者邮箱
 * @param target      被操作者
 * @param adminCount  当前管理员总数（含被操作者）
 */
export function canRestrict(
  actorEmail: string,
  target: ModerationTarget,
  adminCount: number,
): ModerationCheck {
  const actor = actorEmail.trim().toLowerCase();
  const targetEmail = (target.email ?? "").trim().toLowerCase();

  // ① 不能对自己动手。这是最容易被忽略、也最容易发生的一条：
  //    管理员在列表里点到自己那一行，把"封禁"当成了"查看"。
  if (actor && targetEmail && actor === targetEmail) {
    return { ok: false, reason: "不能对自己执行这个操作。" };
  }

  // ② 最后一个管理员不能被降级或封禁 —— 否则后台从此无人能进
  const targetIsAdmin = target.role === "admin";
  if (targetIsAdmin && adminCount <= 1) {
    return { ok: false, reason: "这是最后一个管理员，降级或封禁后没人能再进后台。" };
  }

  return { ok: true };
}

/** 授予管理员：没有额外约束，但需要防止重复授予 */
export function canPromote(target: ModerationTarget): ModerationCheck {
  if (target.role === "admin") {
    return { ok: false, reason: "该用户已经是管理员。" };
  }
  return { ok: true };
}

/** 把用户列表折成后台要显示的几个数字 */
export function summarizeUsers(
  users: readonly {
    role?: string | null;
    banned?: boolean | null;
    isPublic?: boolean | null;
    createdAt: Date | string;
  }[],
  now: Date,
  /** 趋势要看多少周。默认 12 周 ≈ 一个季度 */
  weeks = 12,
): {
  total: number;
  admins: number;
  banned: number;
  newThisWeek: number;
  publicProfiles: number;
  /** 从最早到最近，每周的注册数。最后一格是本周 */
  weeklySignups: number[];
} {
  const weekAgo = now.getTime() - 7 * 86_400_000;
  const buckets = Math.max(1, Math.trunc(weeks));
  const weeklySignups = new Array<number>(buckets).fill(0);

  let admins = 0;
  let banned = 0;
  let fresh = 0;
  let publicProfiles = 0;

  for (const user of users) {
    if (user.role === "admin") admins += 1;
    if (user.banned) banned += 1;
    if (user.isPublic) publicProfiles += 1;

    const created = user.createdAt instanceof Date ? user.createdAt.getTime() : Date.parse(user.createdAt);
    // 解析不出来的时间不当成"本周新增"，宁可少算
    if (!Number.isFinite(created)) continue;
    if (created >= weekAgo) fresh += 1;

    /*
      落在第几个格子。now 是"本周的现在"，所以第 0 格是 (weeks-1) 周之前，
      最后一格是本周 —— 用户看趋势时默认从旧到新，与直觉一致。
      早于窗口的直接丢掉，超出窗口的不会出现（created 不可能在未来，
      但真出现了也夹到最后一格，而不是算出一个越界下标把数组撑大）。
    */
    const age = now.getTime() - created;
    const index = buckets - 1 - Math.floor(age / (7 * 86_400_000));
    const slot = index >= buckets ? buckets - 1 : index;
    if (slot >= 0) {
      // 显式 ?? 0：tsconfig 开了 noUncheckedIndexedAccess，下标访问是 number | undefined
      weeklySignups[slot] = (weeklySignups[slot] ?? 0) + 1;
    }
  }

  return { total: users.length, admins, banned, newThisWeek: fresh, publicProfiles, weeklySignups };
}
