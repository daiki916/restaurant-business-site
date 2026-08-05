# 品書き（SHINAGAKI）— 飲食店専門 メニューデザイン＆集客支援サイト

静的な HTML / CSS / JavaScript のみで構成された、飲食店向けサービスサイトです。
ビルドツールや外部ライブラリは使用していません。ファイルをそのままサーバーへアップロードすれば公開できます。

設計の意図・参考サイトの分析結果は [DESIGN.md](./DESIGN.md) にまとめています。

## ファイル構成

```
.
├── index.html            トップページ
├── menu-design.html      メニューデザイン（サービス詳細）
├── web-marketing.html    Web集客支援（サービス詳細）
├── works.html            制作事例・お客様の声
├── pricing.html          料金プラン
├── about.html            運営者について
├── contact.html          お問い合わせ（無料相談フォーム）
├── privacy.html          プライバシーポリシー
├── sitemap.xml
├── robots.txt
├── DESIGN.md             設計書（分析・コンセプト・改善案）
└── assets/
    ├── css/style.css     デザインシステム一式
    ├── js/main.js        ナビ／スクロール演出／フォーム検証
    └── img/*.svg, og-image.png
```

## ローカルで確認する

```bash
npx http-server . -p 8080
# → http://localhost:8080
```

`file://` で直接開いても動作しますが、`sitemap.xml` の確認などは HTTP サーバー経由を推奨します。

## 公開前に差し替えが必要なもの

| 対象 | 内容 |
| --- | --- |
| ドメイン | 全ページの `<link rel="canonical">`、OGP の `og:url` / `og:image`、`sitemap.xml`、`robots.txt` に `https://shinagaki.example.jp` を仮置きしています |
| 事業者情報 | フッター、`about.html` のプロフィール、`privacy.html` の窓口（`<!-- SAMPLE -->` コメント付き） |
| 実績数値・事例・お客様の声 | `index.html` と `works.html` の該当箇所（`<!-- SAMPLE -->` コメント付き）。実データに置き換えてください |
| SNS リンク | フッターの `href="#"` を実際の URL に |
| フォームの送信先 | 下記参照 |

`SAMPLE` の箇所はまとめて確認できます。

```bash
grep -rn "SAMPLE" *.html
```

## お問い合わせフォームについて

現状はフロントエンドの入力チェックと送信完了表示までを実装しています（サーバーへは送信されません）。
実運用では次のいずれかの方法で送信先を設定してください。

1. `contact.html` の `<form action="#" method="post">` を、利用するメールフォームサービスの
   エンドポイントに変更する
2. `assets/js/main.js` の「送信のデモ実装です」とコメントしたブロックを `fetch(form.action, {...})` に
   置き換え、成功時に完了パネルを表示する

いずれの場合も、送信前の入力チェックはそのまま動作します。

## 実装上の方針

- **依存なし** — フレームワーク、CSS ライブラリ、アイコンフォントを使用していません。アイコンはインライン SVG スプライトです
- **画像はすべて SVG** — ラスタ画像は OGP 用の 1 枚のみ。`width` / `height` と `aspect-ratio` を指定し、CLS を抑えています
- **アクセシビリティ** — スキップリンク、`aria-*` 属性、キーボード操作（Esc でメニューを閉じる）、
  フォーカスリング、`prefers-reduced-motion` に対応
- **FAQ は `<details>`** — JavaScript を無効にしても開閉できます
- **JavaScript が無効でも読める** — スクロール演出は `.no-js` クラスでフォールバックします

## ブラウザ対応

`:has()`、`aspect-ratio`、`IntersectionObserver` を使用しているため、
2023 年以降の Chrome / Edge / Safari / Firefox を対象としています。
