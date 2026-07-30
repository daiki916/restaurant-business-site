#!/usr/bin/env node
// アートボードHTML → PNG 書き出し
// 使い方: node render.mjs <artboard.html> <出力dir> [board-id...]
//   board-id を省略すると .board 全部を id 名で書き出す

import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

async function loadPlaywright() {
  try { return await import('playwright'); }
  catch {
    // グローバルインストールへのフォールバック(Claude Code リモート環境など)
    for (const p of ['/opt/node22/lib/node_modules/playwright/index.js',
                     '/usr/local/lib/node_modules/playwright/index.js']) {
      if (existsSync(p)) return (await import(p)).default ?? await import(p);
    }
    throw new Error('playwright が見つかりません: npm i -g playwright するか import パスを追加してください');
  }
}

const [,, htmlPath, outDir, ...ids] = process.argv;
if (!htmlPath || !outDir) {
  console.error('使い方: node render.mjs <artboard.html> <出力dir> [board-id...]');
  process.exit(1);
}

const pw = await loadPlaywright();
const chromium = pw.chromium ?? pw.default?.chromium;
await mkdir(outDir, { recursive: true });

const browser = await chromium.launch();
const page = await (await browser.newContext({
  viewport: { width: 1100, height: 1250 },
  deviceScaleFactor: 2,
})).newPage();

await page.goto('file://' + resolve(htmlPath), { waitUntil: 'load' });
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(300);

const targets = ids.length
  ? ids
  : await page.$$eval('.board[id]', els => els.map(e => e.id));

for (const id of targets) {
  const el = await page.$(`[id="${id.replace(/"/g, '\\"')}"]`);
  if (!el) { console.error(`skip: #${id} が見つかりません`); continue; }
  await el.scrollIntoViewIfNeeded();
  const name = id.replace(/^b-/, '');
  await el.screenshot({ path: `${outDir}/${name}.png` });
  console.log(`${id} -> ${outDir}/${name}.png`);
}

await browser.close();
