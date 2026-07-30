# 制作パイプライン — HTML/CSS → PNG

デザインはHTML/CSSのアートボードとして組み、Playwright(Chromium)でPNGに書き出す。
Canva等のGUIより速く、ピクセル単位で規則を守れて、差分管理もできる。

## 1. フォント(最初に1回)

CDNは使えない環境が多いので、npmで取得してローカル参照する:

```bash
mkdir -p /tmp/fonts && cd /tmp/fonts
npm i --no-save @fontsource/noto-sans-jp @fontsource/noto-serif-jp
```

アートボードのCSSで woff2 を直接参照:

```css
@font-face { font-family:'NSans';  src:url('/tmp/fonts/node_modules/@fontsource/noto-sans-jp/files/noto-sans-jp-japanese-400-normal.woff2') format('woff2'); font-weight:400; }
@font-face { font-family:'NSans';  src:url('.../noto-sans-jp-japanese-700-normal.woff2') format('woff2'); font-weight:700; }
@font-face { font-family:'NSerif'; src:url('.../noto-serif-jp-japanese-400-normal.woff2') format('woff2'); font-weight:400; }
@font-face { font-family:'NSerif'; src:url('.../noto-serif-jp-japanese-700-normal.woff2') format('woff2'); font-weight:700; }
```

## 2. アートボードの約束事

```html
<div class="board" id="b-<名前>"> ... </div>
```

```css
* { margin:0; padding:0; box-sizing:border-box; }
body { font-family:'NSans',sans-serif; background:#222; display:flex; flex-direction:column; gap:20px; padding:20px;
       font-feature-settings:"palt"; }
.board { width:800px; height:600px; position:relative; overflow:hidden; flex:none; }
```

- サイズ: 画面用 800×600 / 正方形 800×800 / A4縦 794×1123
- 1ファイルに複数ボードを並べてよい(#id で個別書き出しする)
- 位置は absolute で決め打ちしてよい(レスポンシブ不要。紙面は固定寸)

## 3. 質感の作り方(写真が無いとき)

実写が無い段階では、CSS/SVGで「素材感」を作る:

- **木目**: `repeating-linear-gradient(90deg, rgba(0,0,0,.14) 0 2px, transparent 2px 118px)` を木色のグラデに重ねる
- **和紙**: 生成り地(#f6efdd)に `radial-gradient` で淡いムラを1〜2個
- **ボケ(店内の雰囲気)**: 暗色地に `border-radius:50%; filter:blur(6px)` の暖色円を3〜4個
- **ビネット**: `radial-gradient(中心色, 端は最暗色)` で主役に光を集める
- **料理モチーフ**: インラインSVGで幾何学的に描く(丼・皿・湯気)。リアル志向にせず記号として割り切る
- 影は `box-shadow: 0 18px 45px rgba(0,0,0,.45)` 程度の大きく柔らかい1発。重ね掛けしない

実写を受け取ったら `object-fit: cover` で角版配置に差し替える。

## 4. 書き出し

`scripts/render.mjs` を使う:

```bash
node scripts/render.mjs <artboard.html> <出力dir> [board-id...]
```

- 全ボード書き出し(id省略時)or 指定idのみ
- deviceScaleFactor 2 で 800×600 → 1600×1200 PNG
- `document.fonts.ready` を待ってから撮影するのでフォント欠けは起きない

Playwright が無い環境では: `PLAYWRIGHT_BROWSERS_PATH` 済みのグローバル playwright を
`import pw from '<global path>/playwright/index.js'` で読む(render.mjs が対応済み)。

## 5. 印刷入稿の注意(施主に伝えること)

- このパイプラインの出力は **RGB**。印刷所でCMYK変換されると彩度が落ちる(赤・緑・青が顕著)
- ラクスル等はRGB入稿可だが、鮮やかな赤は沈む前提で1段暗い赤(#c62f24等)を使っておくと落差が小さい
- 塗り足し必須の入稿は各辺+12px(3mm相当)広げたボードで別途書き出す
- 文字の最小サイズ: 印刷 10px(A4@96dpi換算)以下は潰れる危険
