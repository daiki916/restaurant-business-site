#!/usr/bin/env python3
# ネオン・ペイントドリップ風ループ動画ジェネレーター
# 写真1枚から、SNSで自動ループ再生される正方形の短尺アート動画を生成する

import argparse
import math
import subprocess
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

# ネオンストリークに使う配色（マゼンタ・ブルー・イエロー基調）
NEON_PALETTE = [
    (255, 0, 140),
    (200, 0, 255),
    (90, 40, 255),
    (40, 80, 255),
    (255, 40, 90),
    (255, 220, 0),
    (0, 220, 255),
]


# ---------------------------------------------------------------- 入力画像の準備

def load_square(path, size):
    """画像を読み込んで中央基準の正方形にトリミングする"""
    img = Image.open(path).convert("RGB")
    w, h = img.size
    side = min(w, h)
    left = (w - side) // 2
    top = (h - side) // 2
    img = img.crop((left, top, left + side, top + side))
    return img.resize((size, size), Image.LANCZOS)


def make_demo_scene(size, rng):
    """入力画像がない場合に使う、傘をさした人物のデモ画像を自動生成する"""
    img = Image.new("RGB", (size, size), (0, 0, 0))
    draw = ImageDraw.Draw(img)

    # 発光する柱状のエリア（この中だけをネオン色で塗る）
    col_w = int(size * 0.28)
    col_x0 = (size - col_w) // 2
    col_top = int(size * 0.62)

    # 縦のネオンバーをランダムに敷き詰める
    x = col_x0
    while x < col_x0 + col_w:
        bar_w = int(rng.integers(1, 7))
        color = NEON_PALETTE[int(rng.integers(0, len(NEON_PALETTE)))]
        y0 = col_top + int(rng.integers(0, int(size * 0.08)))
        # 中央から離れるほど暗くして、柱に丸みを持たせる
        edge = abs((x + bar_w / 2) - (col_x0 + col_w / 2)) / (col_w / 2)
        gain = max(0.0, 1.0 - edge ** 3)
        shade = tuple(int(c * gain) for c in color)
        draw.rectangle([x, y0, x + bar_w, size], fill=shade)
        x += bar_w

    # 傘のドーム（濃い臙脂）
    dome_h = int(size * 0.085)
    draw.pieslice(
        [col_x0 - int(size * 0.01), col_top - dome_h,
         col_x0 + col_w + int(size * 0.01), col_top + dome_h],
        start=180, end=360, fill=(74, 0, 26),
    )

    # 人物のシルエット（頭＋コート）
    cx = size // 2
    head_r = int(size * 0.018)
    head_y = col_top + int(size * 0.05)
    draw.ellipse([cx - head_r, head_y - head_r, cx + head_r, head_y + head_r],
                 fill=(6, 2, 10))
    body_top = head_y + head_r
    body_hw_top = int(size * 0.022)
    body_hw_bottom = int(size * 0.05)
    body_bottom = col_top + int(size * 0.30)
    draw.polygon(
        [(cx - body_hw_top, body_top), (cx + body_hw_top, body_top),
         (cx + body_hw_bottom, body_bottom), (cx - body_hw_bottom, body_bottom)],
        fill=(10, 2, 14),
    )

    return img.filter(ImageFilter.GaussianBlur(radius=size / 900))


# ---------------------------------------------------------------- エフェクト

def compute_seeds(arr):
    """列ごとに「引き伸ばしの起点になる行」を求める

    被写体の上端（明るさが立ち上がる行）を起点にすることで、
    傘のふちから絵の具が滴り落ちるような streak になる。
    """
    lum = arr @ np.array([0.299, 0.587, 0.114], dtype=np.float32)
    h, w = lum.shape
    lit = lum > (lum.max() * 0.12 + 1e-6)
    # 各列で最初に明るくなる行。明るい画素が無い列は画面外に逃がす
    first = np.where(lit.any(axis=0), lit.argmax(axis=0), h + 1)
    return first.astype(np.int32)


def pixel_stretch(arr, seeds, lengths, strength):
    """列ごとに起点の色を下方向へ引き伸ばす（ピクセルストレッチ）"""
    h, w, _ = arr.shape
    ys = np.arange(h, dtype=np.float32)[:, None]
    s = seeds[None, :].astype(np.float32)
    ln = np.maximum(lengths[None, :], 1.0)

    # 起点の画素色を列単位で取り出す
    safe = np.clip(seeds, 0, h - 1)
    seed_rgb = arr[safe, np.arange(w)]              # (W, 3)
    streak = np.broadcast_to(seed_rgb[None, :, :], arr.shape)

    # 起点から下へ、距離に応じて減衰させながら合成する
    dist = ys - s
    inside = (dist >= 0) & (dist < ln)
    # np.where は両方の分岐を評価するため、先に 0-1 に収めてから累乗する
    ramp = np.clip(1.0 - dist / ln, 0.0, 1.0) ** 1.5
    alpha = np.where(inside, ramp, 0.0) * strength
    alpha = alpha[:, :, None].astype(np.float32)
    return arr * (1.0 - alpha) + streak * alpha


def neon_grade(arr, sat):
    """彩度を持ち上げ、マゼンタ／ブルー寄りに色を振る"""
    lum = (arr @ np.array([0.299, 0.587, 0.114], dtype=np.float32))[:, :, None]
    out = lum + (arr - lum) * sat
    return out * np.array([1.06, 0.94, 1.16], dtype=np.float32)


def add_glow(arr, radius, amount):
    """明るい部分だけをぼかして重ね、ネオンの発光感を出す"""
    if amount <= 0:
        return arr
    bright = np.clip((arr - 110.0) * 2.2, 0, 255).astype(np.uint8)
    blur = Image.fromarray(bright).filter(ImageFilter.GaussianBlur(radius=radius))
    b = np.asarray(blur, dtype=np.float32) * amount
    # スクリーン合成
    return 255.0 - (255.0 - arr) * (255.0 - np.clip(b, 0, 255)) / 255.0


def add_grain(arr, rng, amount):
    """毎フレーム更新されるフィルムグレイン＋縦方向のスクラッチノイズ"""
    h, w, _ = arr.shape
    speckle = rng.normal(0.0, amount, (h, w, 1)).astype(np.float32)
    scratch = rng.normal(0.0, amount * 0.7, (1, w, 1)).astype(np.float32)
    return arr + speckle + scratch


# ---------------------------------------------------------------- フレーム生成

def render_frames(base, cfg, rng):
    """シームレスにループする全フレームを生成する"""
    arr0 = np.asarray(base, dtype=np.float32)
    h, w, _ = arr0.shape
    seeds0 = compute_seeds(arr0)

    # 列ごとの streak の長さと、揺れの位相をあらかじめ決めておく
    base_len = rng.uniform(0.25, 1.0, w).astype(np.float32) ** 2 * (h * cfg.stretch)
    phase = rng.uniform(0.0, 2 * math.pi, w).astype(np.float32)

    # 起点を列ごとにずらして、滴りの立ち上がりをギザギザにする
    jitter = (rng.uniform(0.0, 1.0, w) ** 2 * (h * cfg.jitter)).astype(np.int32)
    seeds0 = seeds0 + jitter

    frames = []
    for i in range(cfg.frames):
        t = i / cfg.frames                      # 0.0 → 1.0 でちょうど一周
        ang = 2 * math.pi * t

        # 被写体をわずかに上下させる（sin なので始点と終点が一致＝ループが繋がる）
        bob = int(round(math.sin(ang) * h * cfg.bob))
        arr = np.roll(arr0, bob, axis=0)
        # np.roll は端を反対側に巻き込むので、はみ出した行は黒で潰す
        if bob > 0:
            arr[:bob] = 0.0
        elif bob < 0:
            arr[bob:] = 0.0
        seeds = seeds0 + bob

        # streak の長さを周期的に伸縮させて、絵の具が流れているように見せる
        lengths = base_len * (1.0 + 0.35 * np.sin(ang + phase))

        arr = pixel_stretch(arr, seeds, lengths, cfg.strength)
        arr = neon_grade(arr, cfg.sat)
        arr = add_glow(arr, radius=w / 90, amount=cfg.glow)
        arr = add_grain(arr, rng, cfg.grain)

        frames.append(np.clip(arr, 0, 255).astype(np.uint8))
        print(f"  frame {i + 1}/{cfg.frames}", end="\r", file=sys.stderr)

    print(file=sys.stderr)
    return frames


# ---------------------------------------------------------------- 書き出し

def ffmpeg_exe():
    import imageio_ffmpeg
    return imageio_ffmpeg.get_ffmpeg_exe()


def encode(frames, out_path, fps, gif=False):
    """rawvideo を ffmpeg に流し込んで mp4 / gif を書き出す"""
    h, w, _ = frames[0].shape
    common = [
        ffmpeg_exe(), "-y", "-loglevel", "error",
        "-f", "rawvideo", "-pix_fmt", "rgb24",
        "-s", f"{w}x{h}", "-r", str(fps), "-i", "-",
    ]
    if gif:
        args = common + [
            "-filter_complex",
            "[0:v]split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer",
            "-loop", "0", out_path,
        ]
    else:
        args = common + [
            "-an", "-c:v", "libx264", "-pix_fmt", "yuv420p",
            "-crf", "16", "-preset", "slow", "-movflags", "+faststart",
            out_path,
        ]

    proc = subprocess.Popen(args, stdin=subprocess.PIPE)
    for f in frames:
        proc.stdin.write(f.tobytes())
    proc.stdin.close()
    if proc.wait() != 0:
        raise RuntimeError(f"ffmpeg failed for {out_path}")


# ---------------------------------------------------------------- CLI

def main():
    p = argparse.ArgumentParser(
        description="写真1枚からネオン・ペイントドリップ風のループ動画を作る")
    p.add_argument("input", nargs="?", help="元画像。省略するとデモ画像を自動生成")
    p.add_argument("-o", "--out", default="neon_loop.mp4", help="出力ファイル")
    p.add_argument("--gif", action="store_true", help="mp4 と一緒に GIF も出す")
    p.add_argument("--size", type=int, default=1280, help="出力解像度（正方形）")
    p.add_argument("--frames", type=int, default=24, help="フレーム数")
    p.add_argument("--fps", type=float, default=33.33, help="フレームレート")
    p.add_argument("--stretch", type=float, default=0.55,
                   help="streak の最大長（画面高さに対する比）")
    p.add_argument("--strength", type=float, default=0.92,
                   help="streak の濃さ 0.0-1.0")
    p.add_argument("--sat", type=float, default=1.9, help="彩度")
    p.add_argument("--glow", type=float, default=0.55, help="発光の強さ")
    p.add_argument("--grain", type=float, default=7.0, help="グレインの粒立ち")
    p.add_argument("--jitter", type=float, default=0.05,
                   help="streak 起点のばらつき（画面高さに対する比）")
    p.add_argument("--bob", type=float, default=0.004, help="上下の揺れ幅")
    p.add_argument("--seed", type=int, default=7, help="乱数シード")
    p.add_argument("--save-source", help="加工前の元画像も保存する")
    cfg = p.parse_args()

    rng = np.random.default_rng(cfg.seed)

    if cfg.input:
        base = load_square(cfg.input, cfg.size)
    else:
        print("入力画像がないのでデモ画像を生成します", file=sys.stderr)
        base = make_demo_scene(cfg.size, rng)

    if cfg.save_source:
        base.save(cfg.save_source)

    print("フレームを生成中...", file=sys.stderr)
    frames = render_frames(base, cfg, rng)

    encode(frames, cfg.out, cfg.fps)
    print(f"書き出し完了: {cfg.out}", file=sys.stderr)

    if cfg.gif:
        gif_path = cfg.out.rsplit(".", 1)[0] + ".gif"
        encode(frames, gif_path, cfg.fps, gif=True)
        print(f"書き出し完了: {gif_path}", file=sys.stderr)


if __name__ == "__main__":
    main()
