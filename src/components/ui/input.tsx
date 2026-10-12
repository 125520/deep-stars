"use client";

import * as React from "react";

import { cn } from "@/lib/utils";

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        "h-10 w-full rounded-xl border border-line-2 bg-canvas px-3.5 text-sm text-ink",
        "placeholder:text-ink-dim",
        "transition-[border-color,box-shadow] duration-200",
        "hover:border-violet-200",
        "focus:border-violet-500 focus:outline-none focus:ring-4 focus:ring-violet-500/12",
        "disabled:cursor-not-allowed disabled:bg-surface-2 disabled:opacity-60",
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = "Input";

export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => (
  <textarea
    ref={ref}
    className={cn(
      "w-full resize-y rounded-xl border border-line-2 bg-canvas px-3.5 py-2.5 text-sm leading-relaxed text-ink",
      "placeholder:text-ink-dim",
      "transition-[border-color,box-shadow] duration-200",
      "hover:border-violet-200",
      "focus:border-violet-500 focus:outline-none focus:ring-4 focus:ring-violet-500/12",
      className,
    )}
    {...props}
  />
));
Textarea.displayName = "Textarea";

export function Label({ className, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <label
      className={cn("mb-1.5 block text-[13px] font-medium text-ink", className)}
      {...props}
    />
  );
}
