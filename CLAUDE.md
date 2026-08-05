# CLAUDE.md

このリポジトリで作業する AI アシスタント（Claude Code 等）向けのガイドです。

## プロジェクト概要

飲食店向けの「メニュー表作成」「ウェブマーケティング」副業サービスの紹介サイト。
**ビルドツール・パッケージマネージャ・テスト・CI は一切なし**の純粋な静的サイト
（HTML + CSS + バニラ JavaScript）です。`package.json`、`node_modules`、
lint 設定、ワークフロー定義のいずれも存在しません。

サイトのコンテンツはすべて日本語です。UI 文言・コメント・ドキュメントは日本語で書いてください。

## ディレクトリ構成

**重要: サイトのルートはリポジトリのルートではなく `restaurant_business_site/` です。**

```
/                                    ← リポジトリルート
├── CLAUDE.md                        ← このファイル
├── restaurant_business_site.zip     ← 下記ディレクトリの旧スナップショット（2025-03-15）
└── restaurant_business_site/        ← ★ サイト本体（ここが公開ルート）
    ├── index.html                   ホーム
    ├── menu-design.html             メニュー表作成サービス
    ├── web-marketing.html           ウェブマーケティングサービス
    ├── portfolio.html               制作実績（フィルタ付きギャラリー）
    ├── pricing.html                 料金プラン（タブ切替）
    ├── contact.html                 お問い合わせ（フォーム + FAQ + プライバシーポリシー）
    ├── css/style.css                ★ 唯一の実体のあるスタイルシート（739行）
    ├── js/script.js                 ★ 唯一の実体のある JS（193行）
    ├── style.css                    空ファイル（0バイト・未参照）※編集しない
    ├── script.js                    空ファイル（0バイト・未参照）※編集しない
    ├── site_structure.md            サイト構成・デザイン方針の設計ドキュメント
    └── wireframes.md                全ページの ASCII アートワイヤーフレーム
```

### 既知の状態（作業前に把握しておくこと）

これらは「バグ」ではなく現時点のリポジトリの実態です。無断で直さず、必要なら意図を確認してください。

1. **`assets/images/` が存在しない。** 全ページの `<img src="assets/images/...">` と
   `page-header` のインライン背景画像は現状すべてリンク切れです。zip の中には空の
   `assets/images/` があるだけで、画像ファイル自体がリポジトリに含まれていません。
2. **`css/style.css` は index.html 用のスタイルしかない。** 共通のヘッダー・モバイル
   ナビ・フッター・CTA・ボタンと、index.html のセクション（hero / services /
   features / portfolio / testimonials）のみが定義済みです。
   下位ページ固有のクラス — `page-header`, `faq-item`, `process-step`,
   `pricing-card`, `pricing-table`, `form-group`, `case-study`, `option-card`,
   `contact-method` など — には **CSS ルールが 1 行もありません**。
   そのため index.html 以外はほぼ無装飾で表示されます。ここが最大の未完成箇所です。
3. **ルート直下の `style.css` / `script.js` は 0 バイトの残骸。** どの HTML からも
   参照されていません。編集対象は必ず `css/style.css` と `js/script.js` です。
4. **`site_structure.md` は `css/responsive.css` と `assets/fonts/` に言及しているが、
   どちらも存在しない。** レスポンシブ指定は `css/style.css` 末尾
   （`/* ===== レスポンシブデザイン ===== */` 以降、611行目〜）に同居しています。
5. **`restaurant_business_site.zip` はディレクトリの複製。** ソースを変更しても zip は
   自動更新されないため、内容がすぐに乖離します。zip は成果物の配布用スナップショット
   として扱い、**編集は必ず `restaurant_business_site/` 側に対して行ってください。**
   zip の再生成を求められない限り触らないこと。

## 開発ワークフロー

ビルド手順はありません。ファイルを編集して、ブラウザで開けばそれが結果です。

```bash
# ローカルプレビュー（相対パスが効くのでこちらを推奨）
cd restaurant_business_site && python3 -m http.server 8000
# → http://localhost:8000/

# 単純にファイルを直接開いてもよい
```

検証手段（自動テストがないため手動確認が唯一の担保）:

- 変更したページと、共通部分（ヘッダー / モバイルナビ / フッター）を触った場合は **全6ページ**を目視確認する
- 幅 375px / 800px / 1280px の 3 サイズでレスポンシブ崩れを確認する
- ブラウザのコンソールに JS エラーが出ていないことを確認する

## コード規約

### HTML

- 全ページ共通の骨格を持つ。**1〜58行目のヘッダー・モバイルナビ・オーバーレイのマークアップは
  6ページで完全に同一**、末尾のフッターと `<script src="js/script.js"></script>` も同様。
  ここを変更する場合は **6ファイルすべてに同じ変更を適用**すること（インクルード機構はありません）。
- `<html lang="ja">`、インデントは半角スペース4つ。
- セクションの区切りに日本語のコメントを入れる（`<!-- ヒーローセクション -->` など）。
- 各ページの `<head>` には固有の `<title>`（`ページ名 | 飲食店サポート`）と
  `<meta name="description">` を置く。
- 下位ページは冒頭に `page-header` セクションを持ち、背景画像を **インライン `style` 属性**で
  指定している（`linear-gradient(rgba(0,0,0,.5), ...), url('assets/images/xxx-header.jpg')`）。
  セクション背景色の上書き（`style="background-color: var(--light-gray);"`）も同様にインラインで
  行われている。既存の書き方に合わせるか、CSS へ移すなら全ページ一括で。
- 外部依存はすべて CDN 読み込み（ローカルにコピーは持たない）:
  - Google Fonts: Noto Sans JP (400/500/700), Noto Serif JP (400/700)
  - Font Awesome 6.0.0（`<i class="fas fa-...">` / `fab` でアイコン表示）

### CSS（`css/style.css`）

- **単一ファイル・レイヤーなし。** `/* ===== セクション名 ===== */` の日本語コメントで
  区切られたフラットな構成。新しいスタイルは対応するセクションに追記し、なければ
  同じ形式の見出しコメントを付けて末尾（レスポンシブブロックの手前）に追加する。
- インデントは半角スペース2つ。
- **デザイントークンは `:root` のカスタムプロパティに集約。色・フォントサイズ・余白・
  角丸・影・トランジションは必ず変数を使い、生の値をハードコードしない。**

  | 変数 | 値 | 用途 |
  |---|---|---|
  | `--main-color` | `#D32F2F` | メイン（深い赤） |
  | `--sub-color` | `#FF9800` | サブ（オレンジ） |
  | `--accent-color` | `#388E3C` | アクセント（緑） |
  | `--base-color` | `#FAFAFA` | 背景 |
  | `--text-color` | `#333333` | 本文 |
  | `--light-gray` / `--dark-gray` / `--white` | `#EEEEEE` / `#757575` / `#FFFFFF` | 区切り・サブテキスト |
  | `--font-xl`〜`--font-xs` | `2.5rem` / `2rem` / `1.5rem` / `1rem` / `0.875rem` | 見出し〜注釈 |
  | `--spacing-xs`〜`--spacing-xl` | `0.5` / `1` / `2` / `4` / `8` rem | 余白 |
  | `--border-radius` / `--box-shadow` / `--transition` | `4px` / `0 2px 5px rgba(0,0,0,.1)` / `all 0.3s ease` | その他 |

- **クラス命名**: BEM ではなくフラットなハイフン区切りの `ブロック-要素` 形式
  （`.service-card`, `.service-title`, `.footer-social-link`）。
  状態は `.active` の付け外しで表現する。
- **ブレイクポイントは 2 つだけ**、ファイル末尾にまとめて記述:
  - `@media (max-width: 1023px)` … タブレット
  - `@media (max-width: 767px)` … スマートフォン。**`.hamburger` / `.mobile-nav` /
    `.overlay` のスタイルはこのブロック内にのみ存在する**（＝モバイルナビはここでしか効かない）。

### JavaScript（`js/script.js`）

- ES5〜ES6 のバニラ JS。ビルド・モジュール・依存ライブラリなし。全処理が単一の
  `document.addEventListener('DOMContentLoaded', ...)` の中にある。
- **全ページで同じ 1 ファイルを読み込む**ため、ページ固有の機能は要素の存在チェックで
  ガードする規約:

  ```js
  const contactForm = document.querySelector('#contact-form');
  if (contactForm) { /* contact.html だけで動く */ }
  ```

  ガードされている機能: コンタクトフォーム検証（`#contact-form`）、
  ポートフォリオフィルタ（`.portfolio-filter[data-filter]`）、
  料金プラン切替（`.pricing-toggle[data-pricing]` ↔ `.pricing-table[data-pricing]`）、
  画像遅延読み込み（`img[data-src]` + IntersectionObserver）。
- **逆に `.hamburger` / `.mobile-nav` / `.overlay` / `.mobile-nav-close` は
  ガードなしで `addEventListener` を呼んでいる。** これらのマークアップを 1 ページでも
  削除すると、そのページで JS 全体が例外で停止し、以降の機能がすべて動かなくなります。
  削除する場合は null チェックの追加が必須。
- コメントは日本語、インデントは半角スペース4つ。

### フォーム / バックエンド

サーバーサイドは存在しません。`contact.html` のフォームは `action="#" method="post"` で、
JS が `submit` を `preventDefault()` し、必須項目とメール形式を検証して `alert()` を出し
`reset()` するだけです。実際の送信は行われません。バックエンド連携を実装する場合は
`js/script.js` の「フォーム送信処理」コメント箇所（118行目付近）が差し込みポイントです。

## ドキュメント

- `restaurant_business_site/site_structure.md` — サイト全体構成、各ページの掲載内容、
  デザイン方針（カラーパレット、タイポグラフィ、ブレイクポイント）。
- `restaurant_business_site/wireframes.md` — 全6ページ + モバイルレイアウト +
  ナビゲーションの ASCII ワイヤーフレーム。

**ページ構成やデザイン方針を変更したら、この 2 つのドキュメントも合わせて更新してください。**
実装より先に設計されたドキュメントのため、すでに実装と乖離している箇所があります（上記「既知の状態」参照）。

## Git 運用

- デフォルトブランチ: `main`
- 作業ブランチ: `claude/<説明>-<接尾辞>` 形式（例: `claude/claude-md-docs-gfigud`）
- コミットメッセージは変更内容が分かる説明的なものにする
- push は `git push -u origin <branch-name>`
- **プルリクエストは明示的に依頼された場合のみ作成する**
