"use client";

import * as React from "react";
import type { VariantProps } from "class-variance-authority";

import { buttonVariants } from "@/components/ui/button-variants";
import { cn } from "@/lib/utils";

/**
 * 按钮
 *
 * 样式定义在 ./button-variants.ts（**不带 "use client"**）。
 * 服务端组件若只需要类名（比如给 <a> 或 <Link> 套按钮外观），
 * 请从那里导入 —— 从这个文件导入会拿不到（它属于客户端边界）。
 */

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, type = "button", ...props }, ref) => (
    <button
      ref={ref}
      type={type}
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  ),
);
Button.displayName = "Button";
