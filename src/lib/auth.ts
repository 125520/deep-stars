import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";

import { databaseProviderFromUrl } from "@/lib/db-provider";
import { checkEnv, formatEnvProblems } from "@/lib/env-check";
import { prisma } from "@/lib/prisma";
import { pickSiteUrl } from "@/lib/site-url";

/**
 * Better Auth 服务端实例
 * ══════════════════════════════════════════════════════════════════
 *
 * 挂载点见 src/app/api/auth/[...all]/route.ts，客户端见 src/lib/auth-client.ts。
 *
 * 表结构早已在 prisma/schema.template.prisma 里备好（User / Session /
 * Account / Verification，且 @@map 到 better-auth 约定的表名），
 * 所以这里不需要动 schema。
 */

/*
  ── 启动自检：宁可部署失败，也不要上线一个不能登录的站点 ──────────
 
  这不是假想的场景。缺 BETTER_AUTH_SECRET 时线上真实表现是：
    · 所有页面正常打开（readSession 把异常吞掉、当成"未登录"）
    · 只有登录和注册返回 500，响应体还是空的（生产模式不暴露详情）
    · 真正的原因只在服务端日志里
  于是现象是「网站好好的，就是登不进去」，与真正原因毫无关系。
 
  Better Auth 拒绝用默认密钥启动 —— 这个行为是对的。这里只是把它的
  报错从"运行期某次请求的日志"提前到"构建/启动阶段"，让它拦住部署。
*/
const envProblems = checkEnv(process.env, process.env.NODE_ENV === "production");
if (envProblems.fatal.length > 0) {
  throw new Error(formatEnvProblems(envProblems));
}
for (const item of envProblems.degraded) {
  // 站点能用，但对应功能会坏 —— 必须说清楚，否则几天后才发现
  console.warn(`[env] ${item.key}：${item.reason}`);
}

/**
 * 站点自身的地址。
 *
 * ⚠️ **不能直接把环境变量拿来用。** 平台注入的往往是**裸主机名**
 * （Render 的 RENDER_EXTERNAL_HOSTNAME 就是 `xxx.onrender.com`，没有 `https://`），
 * 而来源校验比的是完整字符串 —— 差一个协议头就永远匹配不上，
 * 表现为"登录按钮点了没反应"，且报错发生在库内部、页面上看不到任何线索。
 *
 * 优先级：显式配置 > 平台注入。补协议头与去尾斜杠的逻辑在 lib/site-url.ts，
 * 那里有测试覆盖（包括 localhost 要补 http 而不是 https 这个特例）。
 */
const siteUrl = pickSiteUrl(
  process.env.BETTER_AUTH_URL,
  process.env.RENDER_EXTERNAL_HOSTNAME,
);

export const auth = betterAuth({
  /**
   * 数据库类型必须从连接串推，**不能写死**：本地是 SQLite、线上是 Neon 的
   * PostgreSQL，同一份模型定义要同时服务两端，写死任何一边另一边就直接跑不起来。
   *
   * 判断收在 databaseProviderFromUrl 里，与 src/lib/prisma.ts 共用 ——
   * 两处必须得出同一个答案，否则 PrismaClient 按一种方言建、
   * Better Auth 按另一种生成 SQL，报出来的是一句含糊的语法错误。
   */
  database: prismaAdapter(prisma, {
    provider: databaseProviderFromUrl(process.env.DATABASE_URL),
  }),

  /**
   * secret 不设默认值：开发环境 Better Auth 会自己兜底并打警告，
   * 生产环境缺失则直接报错 —— **这是想要的行为**，
   * 悄悄用一个内置密钥上线比崩溃危险得多。
   */
  secret: process.env.BETTER_AUTH_SECRET,
  baseURL: siteUrl,

  /**
   * 可信来源（顶层选项，不在 advanced 下 —— 1.7 的 API 是这样）。
   *
   * 开发端口是 3210（见 next.config.ts 的 allowedDevOrigins）。
   * 不登记的话，Better Auth 的 CSRF 校验会直接拒掉表单提交，
   * 而且报错发生在库内部，从页面上只会看到"登录没反应"。
   *
   * 线上那条来自 siteUrl —— 它是**归一化之后**的完整地址
   * （补过协议头、去过尾斜杠），所以与浏览器发的 Origin 能对上。
   */
  trustedOrigins: [
    "http://127.0.0.1:3210",
    "http://localhost:3210",
    ...(siteUrl ? [siteUrl] : []),
  ],

  emailAndPassword: {
    enabled: true,
    /**
     * 不做邮箱验证。
     *
     * 这个项目的硬要求是「克隆下来两条命令就能跑」—— 而邮箱验证需要 SMTP，
     * 那是一条外部依赖，正好是它承诺不要的东西。所以注册即用。
     * 需要验证的生产部署可以后面开，schema 里的 Verification 表已经留好了。
     */
    requireEmailVerification: false,
    minPasswordLength: 8,
  },

  session: {
    // 30 天有效期、每天续期一次：学习类产品不该动不动把人踢下线
    expiresIn: 60 * 60 * 24 * 30,
    updateAge: 60 * 60 * 24,
  },

  /**
   * 认证接口限流
   * ══════════════════════════════════════════════════════════════════
   *
   * **这是暴力破解的真正入口，也是全站最需要限流的地方。**
   * 邮箱 + 密码的登录接口不限流，等于把口令强度当成唯一防线。
   *
   * Better Auth 在生产环境默认就开着限流，这里显式写出来有三个理由：
   *   · 开发环境默认**关着**，不显式开就没法在本地验证它真的生效
   *   · 默认窗口对登录来说偏宽松，这里收紧到 10 次/分钟
   *   · 写在代码里比"依赖库的默认值"可靠 —— 库升级改了默认值不会通知你
   *
   * ⚠️ 存储同样是进程内存（见 src/lib/rate-limit.ts 里关于多实例的说明）。
   * Better Auth 支持传自定义 storage，将来换共享存储时改这里即可。
   */
  rateLimit: {
    enabled: true,
    window: 60,
    max: 10,
    /**
     * 登录成功不计数。
     *
     * 否则一个正常用户连续登录几次就会把配额用光，
     * 而真正该被限制的是**失败**的尝试 —— 那才是攻击的特征。
     */
    customRules: {
      "/sign-in/email": { window: 60, max: 10 },
      "/sign-up/email": { window: 300, max: 5 },
    },
  },

  user: {
    /**
     * 暴露给客户端的**额外**字段。
     *
     * 这里只放公开分享页要用的三个；role / banned / vip / aiTokenLimit
     * 刻意**不放** —— 它们是权限与计费字段，出现在客户端 session 对象里
     * 等于把内部状态送到前端，虽然可读但没必要，将来加了校验也容易忘。
     */
    additionalFields: {
      handle: { type: "string", required: false },
      isPublic: { type: "boolean", required: false, defaultValue: false },
      bio: { type: "string", required: false },
      /*
        生日（YYYY-MM-DD），注册时可选填。
        它决定首次打卡时点亮哪一套黄道星座模板，也用来推断学习计划该用
        简约档还是完整档 —— 所以必须能在注册时一起写进去，
        否则用户要走一趟设置页才能看到属于自己的星图。
        不填也能用：首次打卡退回默认星座。
      */
      birthday: { type: "string", required: false },
    },
  },
});

export type Auth = typeof auth;
