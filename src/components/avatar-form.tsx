"use client";

import * as React from "react";
import { Loader2, RotateCcw, Trash2, Upload } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  deleteAvatar,
  rollbackAvatar,
  saveAvatar,
  type AvatarState,
} from "@/lib/actions/avatar";
import { ALLOWED_MIME, AVATAR_SIZE, MAX_DATA_URL_LENGTH, validateAvatarDataUrl } from "@/lib/avatar";
import { cn } from "@/lib/utils";

/**
 * 头像上传
 * ══════════════════════════════════════════════════════════════════
 *
 * ── 为什么必须在浏览器里压缩 ────────────────────────────────────
 *
 * 头像存的是 data URL（零对象存储）。手机拍一张照片 3–5 MB，
 * base64 之后还要 ×1.37 —— 塞进数据库行里，**每一个会显示头像的查询
 * 都要把它读出来**，页面会肉眼可见地变慢。
 *
 * 所以这里先用 canvas 缩到 256×256 再编码成 WebP（通常 15–30 KB），
 * 只把那一段小字符串交给服务端。
 *
 * 服务端仍然会再校验一遍体积与格式 —— **客户端的一切都可以被绕过**，
 * 这里做压缩是为了体验与带宽，不是因为信任它。
 */

export default function AvatarForm({
  currentImage,
  historyCount,
}: {
  currentImage: string | null;
  historyCount: number;
}) {
  const [state, formAction, pending] = React.useActionState<AvatarState, FormData>(
    saveAvatar,
    null,
  );
  const [preview, setPreview] = React.useState<string | null>(null);
  const [localError, setLocalError] = React.useState<string | null>(null);
  const [encoding, setEncoding] = React.useState(false);
  const formRef = React.useRef<HTMLFormElement>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);

  /** 把用户选的图缩到 AVATAR_SIZE 并编码成 data URL */
  async function handleFile(file: File) {
    setLocalError(null);

    if (!(ALLOWED_MIME as readonly string[]).includes(file.type)) {
      setLocalError("只支持 PNG / JPEG / WebP。");
      return;
    }

    setEncoding(true);
    try {
      const bitmap = await createImageBitmap(file);

      // 短边对齐后居中裁剪，避免非正方形图片被拉变形
      const side = Math.min(bitmap.width, bitmap.height);
      const sx = (bitmap.width - side) / 2;
      const sy = (bitmap.height - side) / 2;

      const canvas = document.createElement("canvas");
      canvas.width = AVATAR_SIZE;
      canvas.height = AVATAR_SIZE;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("无法创建画布上下文");

      ctx.drawImage(bitmap, sx, sy, side, side, 0, 0, AVATAR_SIZE, AVATAR_SIZE);
      bitmap.close();

      // WebP 质量 0.85：肉眼与 1.0 无差，体积约为一半
      const dataUrl = canvas.toDataURL("image/webp", 0.85);

      const check = validateAvatarDataUrl(dataUrl);
      if (!check.ok) {
        setLocalError(check.error);
        return;
      }

      setPreview(dataUrl);
    } catch (error) {
      console.error("[avatar] 处理图片失败：", error);
      setLocalError("这张图片读不出来，换一张试试。");
    } finally {
      setEncoding(false);
    }
  }

  React.useEffect(() => {
    /*
      保存成功后清空文件输入。
      **这里不需要清 preview** —— 见下面 shown 的推导：
      保存成功后 currentImage 就等于 preview，界面上自然切到服务端的结果。
      在 effect 里 setState 会触发级联渲染，React 的规则会（正确地）拦下来。
    */
    if (state?.ok) formRef.current?.reset();
  }, [state]);

  const busy = pending || encoding;

  /*
    展示哪张图 —— **推导出来的，不是另存一份状态**。

    服务端保存成功后会把 currentImage 换成刚存的那张（内容与 preview 相同），
    所以"是否还在预览一张尚未保存的图"可以用一次比较得出：
      · 选了新图但没保存 → preview ≠ currentImage → 显示 preview
      · 保存成功           → preview === currentImage → 显示服务端的结果
      · 取消               → preview 置空 → 显示 currentImage
    用一个额外的布尔状态去记"是否已保存"，就又多了一处需要与真相同步的东西。
  */
  const shown = preview && preview !== currentImage ? preview : currentImage;
  const hasUnsavePreview = Boolean(preview && preview !== currentImage);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center gap-4">
        {shown ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={shown}
            alt=""
            className="size-16 shrink-0 rounded-2xl object-cover ring-1 ring-line-2"
          />
        ) : (
          <span className="grid size-16 shrink-0 place-items-center rounded-2xl bg-violet-600/20 ring-1 ring-violet-400/30 text-[20px] text-violet-300">
            ·
          </span>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={inputRef}
            type="file"
            accept={ALLOWED_MIME.join(",")}
            className="sr-only"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void handleFile(file);
            }}
          />
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={() => inputRef.current?.click()}
          >
            {encoding ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
            {encoding ? "处理中…" : shown ? "换一张" : "选择图片"}
          </Button>

          {(currentImage || preview) && (
            <>
              {historyCount > 0 && (
                <form action={rollbackAvatar}>
                  <Button type="submit" variant="ghost" size="sm">
                    <RotateCcw className="size-3.5" />
                    回滚（{historyCount}）
                  </Button>
                </form>
              )}
              <form action={deleteAvatar}>
                <Button type="submit" variant="ghost" size="sm">
                  <Trash2 className="size-3.5" />
                  移除
                </Button>
              </form>
            </>
          )}
        </div>
      </div>

      {/* 选中之后才出现提交按钮：没选图时它只是个多余的控件 */}
      {hasUnsavePreview && preview && (
        <form ref={formRef} action={formAction} className="flex flex-col gap-3">
          <input type="hidden" name="image" value={preview} />
          <p className="text-[11.5px] text-ink-dim">
            已缩到 {AVATAR_SIZE}×{AVATAR_SIZE} · 约 {Math.round(preview.length / 1024)} KB
            （上限 {Math.round(MAX_DATA_URL_LENGTH / 1024)} KB）
          </p>
          <div className="flex gap-2">
            <Button type="submit" disabled={busy}>
              {pending && <Loader2 className="size-4 animate-spin" />}
              保存头像
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setPreview(null);
                if (inputRef.current) inputRef.current.value = "";
              }}
            >
              取消
            </Button>
          </div>
        </form>
      )}

      <p
        role="status"
        aria-live="polite"
        className={cn("min-h-[18px] text-[12.5px]")}
      >
        {localError && <span className="text-danger">{localError}</span>}
        {!localError && state?.ok === false && <span className="text-danger">{state.error}</span>}
        {!localError && state?.ok === true && <span className="text-violet-300">{state.message}</span>}
      </p>
    </div>
  );
}
