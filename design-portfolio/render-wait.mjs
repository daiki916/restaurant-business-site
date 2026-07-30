import pw from '/opt/node22/lib/node_modules/playwright/index.js';
const { chromium } = pw;
const [,, htmlPath, outDir] = process.argv;
const b = await chromium.launch();
const pg = await (await b.newContext({ viewport:{width:1100,height:1250}, deviceScaleFactor:2 })).newPage();
await pg.goto('file://' + new URL(htmlPath, 'file://' + process.cwd() + '/').pathname, { waitUntil:'load' });
// unicode-range分割フォントの遅延ロード対策: 全glyphを一度描画に参加させてからloadedを待ち切る
for (let i = 0; i < 20; i++) {
  await pg.evaluate(() => document.fonts.ready);
  const st = await pg.evaluate(() => ({s: document.fonts.status, n: [...document.fonts].filter(f=>f.status==='loading').length}));
  if (st.s === 'loaded' && st.n === 0) { if (i > 1) break; }
  await pg.waitForTimeout(400);
}
await pg.waitForTimeout(800);
const ids = await pg.$$eval('.board[id]', els => els.map(e => e.id));
for (const id of ids) {
  const el = await pg.$(`[id="${id}"]`);
  await el.scrollIntoViewIfNeeded();
  await el.screenshot({ path: `${outDir}/${id.replace(/^b-/,'')}.png` });
  console.log(id, 'ok');
}
await b.close(); process.exit(0);
