"""生成 PWA 图标。

设计语言与站点一致：深空底 + 紫色四角星（sparkle）+ 两枚伴星。
用几何画法而不是位图素材 —— 图标要出 5 个尺寸，
矢量推导能保证每个尺寸都锐利，也方便以后调色。

四角星的做法：8 个顶点，长半径与短半径交替。
短半径不能取太小，否则星会细成一根针，缩到 48px 就看不见了。
"""

from __future__ import annotations

import math
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
PUBLIC_ICONS = ROOT / "public" / "icons"
APP_DIR = ROOT / "src" / "app"

# 与 globals.css 的 @theme 令牌保持一致
CANVAS = (5, 4, 18)
VIOLET_HI = (167, 139, 250)
VIOLET_LO = (109, 40, 217)
STAR_CORE = (245, 243, 255)

# 超采样倍数：先按 4 倍画再缩小，边缘才不会有锯齿
SS = 4


def four_point_star(cx: float, cy: float, outer: float, inner: float) -> list[tuple[float, float]]:
    """四角星：8 个顶点，长/短半径交替，尖角落在正上下左右。"""
    points: list[tuple[float, float]] = []
    for i in range(8):
        # 从正上方开始（-90°），每 45° 一个顶点
        angle = math.radians(-90 + i * 45)
        radius = outer if i % 2 == 0 else inner
        points.append((cx + radius * math.cos(angle), cy + radius * math.sin(angle)))
    return points


def radial_gradient(size: int) -> Image.Image:
    """从左上偏亮的紫色径向渐变，用作星的填充。"""
    grad = Image.new("RGB", (size, size))
    pixels = grad.load()
    assert pixels is not None
    center = size * 0.40
    max_dist = math.hypot(size * 0.60, size * 0.60)

    for y in range(size):
        for x in range(size):
            dist = math.hypot(x - center, y - center) / max_dist
            t = min(1.0, max(0.0, dist))
            pixels[x, y] = tuple(
                round(VIOLET_HI[i] + (VIOLET_LO[i] - VIOLET_HI[i]) * t) for i in range(3)
            )
    return grad


def make_icon(size: int, *, maskable: bool) -> Image.Image:
    """画一枚图标。

    maskable 版本要留安全边距：Android 会把图标裁成圆形/方形/水滴形，
    内容超出中心 80% 的圆就可能被切掉，所以星要画得更小。
    """
    big = size * SS
    base = Image.new("RGB", (big, big), CANVAS)
    draw = ImageDraw.Draw(base)

    scale = 0.62 if maskable else 0.78
    outer = big * scale / 2
    inner = outer * 0.30  # 太小会细成针；0.30 在 48px 下仍能看出四角

    # 背后加一团极淡的紫雾，让图标在浅色背景上也有边界感
    glow = Image.new("RGB", (big, big), CANVAS)
    glow_draw = ImageDraw.Draw(glow)
    r = outer * 1.55
    glow_draw.ellipse(
        (big / 2 - r, big / 2 - r, big / 2 + r, big / 2 + r),
        fill=(34, 22, 78),
    )
    glow = glow.filter(ImageFilter.GaussianBlur(big * 0.06))
    base = Image.blend(base, glow, 0.85)
    draw = ImageDraw.Draw(base)

    # 主星：用渐变做填充遮罩
    mask = Image.new("L", (big, big), 0)
    ImageDraw.Draw(mask).polygon(four_point_star(big / 2, big / 2, outer, inner), fill=255)
    base.paste(radial_gradient(big), (0, 0), mask)

    # 中心一点高光，让星有一个"亮核"
    core = outer * 0.16
    draw.ellipse(
        (big / 2 - core, big / 2 - core, big / 2 + core, big / 2 + core),
        fill=STAR_CORE,
    )

    # 两枚伴星：一大一小、错开角度，避免对称得死板
    for dx, dy, rad in ((-0.30, -0.26, 0.055), (0.28, 0.20, 0.038)):
        cxx, cyy = big / 2 + big * dx, big / 2 + big * dy
        rr = big * rad
        draw.ellipse((cxx - rr, cyy - rr, cxx + rr, cyy + rr), fill=(196, 181, 253))

    return base.resize((size, size), Image.LANCZOS)


def main() -> None:
    PUBLIC_ICONS.mkdir(parents=True, exist_ok=True)

    targets = [
        (PUBLIC_ICONS / "icon-192.png", 192, False),
        (PUBLIC_ICONS / "icon-512.png", 512, False),
        (PUBLIC_ICONS / "maskable-512.png", 512, True),
        # Next 的文件约定：app/icon.png 会被当作 favicon 自动注入
        (APP_DIR / "icon.png", 512, False),
        (APP_DIR / "apple-icon.png", 180, False),
    ]

    for path, size, maskable in targets:
        make_icon(size, maskable=maskable).save(path, "PNG", optimize=True)
        print(f"{path.relative_to(ROOT)}  {size}x{size}  maskable={maskable}")


if __name__ == "__main__":
    main()
