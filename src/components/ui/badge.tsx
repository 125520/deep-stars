import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-medium tracking-tight",
  {
    variants: {
      tone: {
        neutral: "border-line bg-surface-2 text-ink-muted",
        violet: "border-violet-200 bg-violet-50 text-violet-700",
        ok: "border-ok/25 bg-ok/8 text-ok",
        warn: "border-warn/25 bg-warn/10 text-warn",
        danger: "border-danger/25 bg-danger/8 text-danger",
        /** 深空面板内部使用 */
        deep: "border-white/15 bg-white/8 text-[#c9c2f0]",
      },
    },
    defaultVariants: { tone: "neutral" },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, tone, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
}
