import { cva } from "class-variance-authority";

/**
 * 按钮样式表
 * ══════════════════════════════════════════════════════════════════
 *
 * **刻意不放在 button.tsx 里，也不带 "use client"。**
 *
 * 这里只有 cva 的配置对象，是纯数据，没有任何 React 行为。
 * 但它原本和 Button 组件写在同一个文件里，而那个文件顶部有 "use client" ——
 * 于是 `buttonVariants` 变成了一个**客户端函数**，
 * 服务端组件一调用就抛：
 *
 *   Attempted to call buttonVariants() from the server but
 *   buttonVariants is on the client.
 *
 * 这个报错很不好查：它不在构建期出现，只在访问那个页面时炸，
 * 而页面的其余部分看起来毫无问题（离线页就是这么 500 的，
 * 还顺带把 Service Worker 的 install 一起搞挂了）。
 *
 * 把"纯配置"与"客户端组件"分开，服务端与客户端就都能用同一份样式，
 * 不必为了用一个类名把整个页面变成客户端组件。
 */

export const buttonVariants = cva(
  [
    "relative inline-flex items-center justify-center gap-2 whitespace-nowrap",
    "rounded-xl text-sm font-medium tracking-tight",
    // scale 也要在过渡列表里，否则放大是「跳」而不是「长」
    "transition-[background-color,border-color,color,box-shadow,scale] duration-200",
    "outline-none focus-visible:ring-2 focus-visible:ring-violet-500/45 focus-visible:ring-offset-2",
    "focus-visible:ring-offset-canvas",
    "disabled:pointer-events-none disabled:opacity-40",
    // 悬停放大 + 按下回缩：这一对是「可按」最直接的触感。
    // 幅度刻意压到 1.03 —— 再大就会推挤相邻元素，也显廉价。
    "hover:scale-[1.03] active:scale-[0.985]",
  ].join(" "),
  {
    variants: {
      variant: {
        /** 主行动：紫色实底 */
        primary: "bg-violet-600 text-white hover:bg-violet-700 ds-glow-violet",
        /** 次行动：描边。
            悬停底不能用 violet-50 —— 那是浅底时期的取色，
            压在深靛上会变成一块刺眼的亮斑。改用低透明度的紫。 */
        outline:
          "border border-line-2 bg-surface text-ink hover:border-violet-400 hover:bg-violet-500/12",
        /** 幽灵：仅文字 */
        ghost: "text-ink-muted hover:bg-surface-2 hover:text-ink",
        /** 柔紫底：用于强调但不抢主按钮 */
        soft: "bg-violet-500/15 text-violet-200 hover:bg-violet-500/25",
        /** 深空面板内部使用 */
        onDeep:
          "border border-white/15 bg-white/8 text-[#e9e6ff] hover:border-white/30 hover:bg-white/14 backdrop-blur",
        danger: "bg-danger text-white hover:brightness-95",
      },
      size: {
        sm: "h-8 px-3 text-xs",
        md: "h-10 px-4",
        lg: "h-12 px-6 text-base",
        icon: "size-10 p-0",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);
