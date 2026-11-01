import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const origin = 'https://speechlab0210.github.io';
const fancy = origin + '/isca-sig-atlas-worlds/on-the-record/';
const classic = origin + '/isca-sig-directory/';
const mode = process.env.QA_MODE || 'staged';
const data = JSON.parse(fs.readFileSync('.qa-data/docs/data.json', 'utf8'));
const digest = b => crypto.createHash('sha256').update(b).digest('hex');
const types = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.json':'application/json', '.svg':'image/svg+xml' };
fs.mkdirSync('qa-artifacts', { recursive: true });

test.beforeEach(async ({ context, page }) => {
  if (mode === 'staged') {
    // Serve ONLY these two public checkouts. No private mail, profiles or credentials.
    await context.route(origin + '/**', async route => {
      const u = new URL(route.request().url());
      let root, relative;
      if (u.pathname.startsWith('/isca-sig-atlas-worlds/')) {
        root = path.resolve('.'); relative = u.pathname.slice('/isca-sig-atlas-worlds/'.length);
      } else if (u.pathname.startsWith('/isca-sig-directory/')) {
        root = path.resolve('.qa-data/docs'); relative = u.pathname.slice('/isca-sig-directory/'.length);
      } else return route.abort();
      if (!relative || relative.endsWith('/')) relative += 'index.html';
      const file = path.resolve(root, decodeURIComponent(relative));
      if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile())
        return route.fulfill({status:404,body:'Not found'});
      await route.fulfill({status:200,contentType:types[path.extname(file)] || 'application/octet-stream',body:fs.readFileSync(file)});
    });
  }
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.__siteErrors = errors;
});
test.afterEach(async ({ page }) => { expect(page.__siteErrors).toEqual([]); });

async function openFancy(page, suffix = '') {
  await page.goto(fancy + suffix, {waitUntil:'domcontentloaded'});
  await expect(page.locator('html')).toHaveAttribute('data-source', /live|snapshot/);
  // CI has software WebGL. Render a real initial frame, then step animations
  // explicitly so a continuous GPU workload does not starve interaction checks.
  await page.evaluate(() => {
    if (window.__record) {
      window.__record.renderer.setAnimationLoop(null);
      window.__record.advance(1/30);
    }
  });
  await expect(page.locator('.track')).toHaveCount(data.sigs.length);
  if ((await page.locator('#sleeve-toggle').getAttribute('aria-expanded')) === 'false')
    await page.locator('#sleeve-toggle').click();
  await expect(page.locator('#sleeve-toggle')).toHaveAttribute('aria-expanded','true');
}
async function fits(page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
}

test('release bytes and live data agree with the checked revisions', async ({ request }) => {
  test.skip(mode !== 'live', 'Byte verification applies to the real published site.');
  for (const name of ['index.html','main.js','style.css']) {
    const r = await request.get(fancy + name + '?qa=' + process.env.GITHUB_SHA);
    expect(r.ok()).toBe(true);
    expect(digest(await r.body())).toBe(digest(fs.readFileSync('on-the-record/' + name)));
  }
  for (const name of ['atlas-core.js','atlas-snapshot.js']) {
    const r = await request.get(origin + '/isca-sig-atlas-worlds/shared/' + name + '?qa=' + process.env.GITHUB_SHA);
    expect(r.ok()).toBe(true);
    expect(digest(await r.body())).toBe(digest(fs.readFileSync('shared/' + name)));
  }
  for (const name of ['index.html','app.js','style.css','data.json']) {
    const r = await request.get(classic + name + '?qa=' + process.env.QA_DATA_COMMIT);
    expect(r.ok()).toBe(true);
    expect(digest(await r.body())).toBe(digest(fs.readFileSync('.qa-data/docs/' + name)));
  }
});

test('all SIG profiles, sections and edition links work', async ({ page }) => {
  await openFancy(page);
  await expect(page.locator('html')).toHaveAttribute('data-source','live');
  await expect(page.locator('html')).toHaveAttribute('data-webgl','ready');
  await page.locator('#btn-spin').click();
  await page.screenshot({path:'qa-artifacts/fancy-desktop.jpg',type:'jpeg'});
  for (const sig of data.sigs) {
    await page.locator('.tabs [data-view="tracklist"]').click();
    await page.locator('.track').filter({has:page.locator('b', {hasText:new RegExp('^' + sig.acronym + '$')})}).click();
    await expect(page.locator('.ax-sig-acr')).toHaveText(sig.acronym);
    await expect(page.locator('.ax-sig-name')).toHaveText(sig.fullName);
    await expect(page.locator('.ax-sig .ax-lede')).toHaveText(sig.description);
    await expect(page.locator('#classic-edition')).toHaveAttribute('href',classic+'#sig-'+encodeURIComponent(sig.acronym));
  }
  for (const view of ['calendar','series','library','about']) {
    await page.locator('.tabs [data-view="'+view+'"]').click();
    await expect(page.locator('#sleeve-body h2').first()).toBeVisible();
    await expect(page.locator('#sleeve-body .ax-count')).toHaveCount(0);
    await expect(page.locator('#sleeve-body a[href*="scoot"]')).toHaveCount(0);
  }
  await expect(page.locator('#sleeve-body')).toContainText('AI agent');
  await expect(page.locator('#sleeve-body')).toContainText('not an official ISCA');
  await page.locator('#classic-edition').click();
  await expect(page).toHaveURL(classic+'#about');
  await expect(page.locator('#content')).toContainText('AI agent');
  await page.locator('#fancy-edition').click();
  await expect(page).toHaveURL(fancy+'#about');
  await expect(page.locator('#sleeve-body')).toContainText('AI agent');
});

test('whole-page search, reset, filters and turntable controls', async ({ page }) => {
  await openFancy(page);
  await page.locator('#search').fill('five-round');
  await expect(page.locator('.search-hit')).toHaveCount(1);
  await expect(page.locator('.search-hit')).toContainText('Maintenance');
  await page.locator('.tabs [data-view="tracklist"]').click();
  await expect(page.locator('#search')).toHaveValue('');
  await expect(page.locator('.track')).toHaveCount(data.sigs.length);
  await page.locator('[data-filter="language"]').click();
  await expect(page.locator('.track')).toHaveCount(data.sigs.filter(s=>s.kind==='language').length);
  await page.locator('.tabs [data-view="tracklist"]').click();
  await expect(page.locator('.track')).toHaveCount(data.sigs.length);
  await page.locator('#search').fill('no-such-page-qa-718692');
  await expect(page.locator('.search-results')).toContainText('No pages match');
  await page.locator('[data-clear-search]').click();
  await expect(page.locator('.track')).toHaveCount(data.sigs.length);
  await page.locator('#btn-play').click();
  await expect(page.locator('#btn-play')).toHaveAttribute('aria-pressed','true');
  const spin = await page.evaluate(() => {
    const before=window.__record.state.spin;
    window.__record.advance(0.1);
    return {before,after:window.__record.state.spin};
  });
  expect(spin.after).not.toBe(spin.before);
  await page.locator('#btn-play').click();
  await expect(page.locator('#btn-play')).toHaveAttribute('aria-pressed','false');
  await page.locator('#btn-lamp').click();
  await expect(page.locator('#btn-lamp')).toHaveAttribute('aria-pressed','true');
  await expect(page.locator('#btn-sound')).toHaveCount(0);
});

for (const width of [390,320]) test('mobile navigation and search at '+width+'px', async ({ page }) => {
  await page.setViewportSize({width,height:844});
  await openFancy(page);
  await fits(page);
  const boxes = await page.locator('.tabs button').evaluateAll(els=>els.map(e=>{const r=e.getBoundingClientRect();return {left:r.left,right:r.right};}));
  expect(boxes.every(r=>r.left>=0&&r.right<=width+1)).toBe(true);
  await page.locator('#search').fill('five-round');
  await expect(page.locator('.search-hit')).toHaveCount(1);
  await page.locator('.search-hit').click();
  await expect(page.locator('#sleeve-body')).toContainText('AI agent');
  await page.screenshot({path:'qa-artifacts/fancy-mobile-'+width+'.jpg',type:'jpeg'});
  await page.goto(classic, {waitUntil:'domcontentloaded'});
  await expect(page.locator('.sig')).toHaveCount(data.sigs.length);
  await fits(page);
  await page.locator('#search').fill('five-round');
  await expect(page.locator('#page-results')).toContainText('Maintenance');
  await page.screenshot({path:'qa-artifacts/classic-mobile-'+width+'.jpg',type:'jpeg'});
});

test('snapshot and no-WebGL fallbacks still expose the directory', async ({ page }) => {
  await page.addInitScript(() => {
    const original=HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext=function(type,...args){return /webgl/i.test(type)?null:original.call(this,type,...args);};
  });
  await openFancy(page, '?data=snapshot');
  await expect(page.locator('html')).toHaveAttribute('data-source','snapshot');
  await expect(page.locator('#render-status')).toBeVisible();
  await page.locator('.track').first().click();
  await expect(page.locator('.ax-sig-acr')).toBeVisible();
});
