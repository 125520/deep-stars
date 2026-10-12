import type { ComponentType } from "react";

import { cn } from "@/lib/utils";

/**
 * 图标砖：把线稿图标装进一枚有体积感的紫色方块。
 *
 * 样式在 globals.css 的 .ds-icon-tile / -ai / -deep 里。
 * 图标用白色 —— 在紫色填充上对比度最高，也最接近「应用图标」的观感。
 *
 * 描边宽度 1.8：默认的 2 在 19px 尺寸下偏粗显笨，但比纯白底的场景调高了一档
 * —— 白色压在紫底上视觉重量更轻，太细会发虚。
 *
 * 三种色：
 *   light  白底卡片上的常规功能（默认）
 *   ai     白底卡片上的 AI 功能，用更深的紫以示区分
 *   deep   厚紫卡片上使用，整体压暗一档，避免在卡面上「浮」出来
 */
export function IconTile({
  icon: Icon,
  ai = false,
  className,
  size = "md",
  tone = "light",
}: {
  icon: ComponentType<{ className?: string; strokeWidth?: number }>;
  ai?: boolean;
  className?: string;
  /** sm 用于紧凑卡片，md 用于常规功能卡 */
  size?: "sm" | "md";
  tone?: "light" | "deep";
}) {
  const dims = size === "sm" ? "size-10 rounded-[12px]" : "size-12 rounded-[14px]";
  const iconDims = size === "sm" ? "size-[18px]" : "size-5";

  const surface =
    tone === "deep" ? "ds-icon-tile-deep" : ai ? "ds-icon-tile ds-icon-tile-ai" : "ds-icon-tile";

  return (
    <span className={cn(surface, "grid place-items-center", dims, className)}>
      <Icon className={cn("relative z-10 text-white", iconDims)} strokeWidth={1.8} />
    </span>
  );
}
