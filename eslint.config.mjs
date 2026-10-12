import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

/**
 * ESLint 扁平配置。
 *
 * 注意：eslint-config-next v16 已经**原生导出 flat config 数组**，
 * 直接展开即可。不要再套 @eslint/eslintrc 的 FlatCompat —— 那条老路会让
 * eslint-plugin-react 的循环引用在 JSON.stringify 时炸掉：
 *   TypeError: Converting circular structure to JSON
 */
const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    /*
      纯领域模块禁止使用 `@/` 路径别名。
    
      原因很具体：`@/` 是 tsconfig 的 paths，**只有打包器认识**，
      Node 的测试运行器不读它。测试直接 import 这些 .ts 文件时，
      一旦领域模块内部用了别名，`node --test` 就会报 ERR_MODULE_NOT_FOUND ——
      而 eslint 与测试是两关，容易先过了 lint 才发现测试挂掉。
    
      ── 为什么只约束一部分文件 ──
      src/lib 下有两类模块，约束只对第一类成立：
        · **纯领域模块**（constellation / todos / focus / plans / heatmap / db-provider …）
          不碰数据库与 Next，必须能被 `node --test` 直接加载 → 只能用相对路径
        · **运行时模块**（prisma / auth / session / focus-store / actions/*）
          依赖 Prisma 客户端、next/headers 等，本来就不可能脱离 Next 跑 → 用别名更清楚
    
      所以用 ignores 把后者排除，而不是把规则放宽到失效。
      **用规则强制，而不是靠记性** —— 这条约束一旦被破坏，报错信息会直接说明原因。
    */
    files: ["src/lib/**/*.ts"],
    ignores: [
      "src/lib/prisma.ts",
      "src/lib/auth.ts",
      "src/lib/session.ts",
      "src/lib/focus-store.ts",
      "src/lib/notifications-server.ts",
      "src/lib/ai/rephrase.ts",
      "src/lib/actions/**",
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@/*"],
              message:
                "纯领域模块请改用相对路径（如 ./constellation）。Node 的测试运行器解析不了 @/ 别名，import 它会直接报 ERR_MODULE_NOT_FOUND。",
            },
          ],
        },
      ],
    },
  },
  globalIgnores([
    // 覆盖 .next / .next-* 所有变体：Next 支持用 NEXT_DIST_DIR 切换输出目录，
    // 只写 ".next/**" 会让 lint 去扫编译产物。
    ".next*/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Prisma 生成的 client 不归我们维护，扫它既慢又无意义
    "prisma/generated/**",
    ".cache/**",
    "coverage/**",
  ]),
]);

export default eslintConfig;
