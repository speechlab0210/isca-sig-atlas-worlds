import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const origin = 'https://speechlab0210.github.io';
const fancy = origin + '/isca-sig-atlas-worlds/';
const legacyFancy = fancy + 'on-the-record/';
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

async function openFancy(page, suffix = '', entry = fancy) {
  await page.goto(entry + suffix, {waitUntil:'domcontentloaded'});
  await expect(page.locator('html')).toHaveAttribute('data-source', /live|snapshot/);
  // CI has software WebGL. Render a real initial frame, then step animations
  // explicitly so a continuous GPU workload does not starve interaction checks.
  await page.evaluate(() => {
    if (window.__record) {
      window.__record.renderer.setAnimationLoop(null);
      window.__record.advance(1/30);
    }
  });
  if (!suffix.includes('#')) await expect(page.locator('.track')).toHaveCount(data.sigs.length);
  if ((await page.locator('#sleeve-toggle').getAttribute('aria-expanded')) === 'false')
    await page.locator('#sleeve-toggle').click();
  await expect(page.locator('#sleeve-toggle')).toHaveAttribute('aria-expanded','true');
}
async function fits(page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
}

test('release bytes and live data agree with the checked revisions', async ({ request }) => {
  test.skip(mode !== 'live', 'Byte verification applies to the real published site.');
  const root = await request.get(fancy + '?qa=' + process.env.GITHUB_SHA);
  expect(root.ok()).toBe(true);
  expect(digest(await root.body())).toBe(digest(fs.readFileSync('index.html')));
  for (const name of ['index.html','main.js','style.css']) {
    const r = await request.get(legacyFancy + name + '?qa=' + process.env.GITHUB_SHA);
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

test('root and legacy entries preserve direct links and the same live directory', async ({ page }) => {
  for (const entry of [fancy,legacyFancy]) {
    await openFancy(page, '?entry-check=1#sig-SLaTE', entry);
    await expect(page).toHaveURL(entry+'?entry-check=1#sig-SLaTE');
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href',fancy);
    await expect(page.locator('html')).toHaveAttribute('data-source','live');
    await expect(page.locator('html')).toHaveAttribute('data-webgl','ready');
    await expect(page.locator('.ax-sig-acr')).toHaveText('SLaTE');
    await page.locator('.tabs [data-view="series"]').click();
    await expect(page).toHaveURL(entry+'?entry-check=1#series');
    await expect(page.locator('.talk-row')).toHaveCount(data.editorial.talks.length);
    await page.locator('#classic-edition').click();
    await expect(page).toHaveURL(classic+'#series');
    await page.locator('#fancy-edition').click();
    await expect(page).toHaveURL(fancy+'#series');
    await expect(page.locator('.talk-row')).toHaveCount(data.editorial.talks.length);
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
  for (const view of ['calendar','series','about']) {
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
  await page.locator('#search').fill('extra search');
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
  await page.locator('#search').fill('extra search');
  await expect(page.locator('.search-hit')).toHaveCount(1);
  await page.locator('.search-hit').click();
  await expect(page.locator('#sleeve-body')).toContainText('AI agent');
  await page.screenshot({path:'qa-artifacts/fancy-mobile-'+width+'.jpg',type:'jpeg'});
  await page.goto(classic, {waitUntil:'domcontentloaded'});
  await expect(page.locator('.sig')).toHaveCount(data.sigs.length);
  await fits(page);
  await page.locator('#search').fill('extra search');
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
  await page.locator('[data-view="about"]').click();
  await expect(page.locator('#sleeve-body')).toContainText('Xiaojin, the AI agent maintaining this Atlas, checked');
  await page.locator('[data-view="series"]').click();
  await expect(page.getByRole('heading', {name:/Workshop & conference recordings/})).toHaveCount(0);
});


test('plain maintenance copy and direct talk index in both editions', async ({ page }) => {
  await openFancy(page);
  await expect(page.locator('.brand a[href="#about"]')).toHaveCount(0);
  await expect(page.locator('.tabs [data-view="tracklist"]')).toHaveText('SIGs');
  for (const edition of ['fancy','classic']) {
    if (edition==='fancy') await page.locator('[data-view="about"]').click();
    else await page.goto(classic+'#about');
    const body=page.locator(edition==='fancy'?'#sleeve-body':'#content');
    await expect(body).toContainText('not an official ISCA service yet');
    await expect(body).toContainText('all 20 SIGs');
    await expect(body).toContainText('page read successfully');
    await expect(body).toContainText('organizer’s page');
    await expect(body).toContainText('“Content reviewed” means Xiaojin, the AI agent maintaining this Atlas, checked the entry’s information against the source page on that date.');
    await expect(body).toContainText('It does not mean that ISCA or a SIG representative has reviewed or approved the entry.');
    await page.screenshot({path:'qa-artifacts/'+edition+'-maintenance-reviewer.jpg',type:'jpeg'});
    await expect(body).not.toContainText('Research notes');
    await expect(body).not.toContainText('SALTMIL and SLIM');
    if (edition==='fancy') await page.locator('[data-view="series"]').click();
    else await page.locator('[data-section="series"]').click();
    await expect(page.getByRole('heading', {name:/Workshop & conference recordings/})).toHaveCount(0);
    await expect(page.locator('.ax-archives,.archive-grid')).toHaveCount(0);
    await expect(page.locator('.talk-row')).toHaveCount(data.editorial.talks.length);
    await expect(page.locator('.talk-row[data-talk-url="https://www.youtube.com/watch?v=6lMs1VcUrYc"] .talk-meta')).toContainText('SPCC 2016');
    await expect(page.locator('.talk-row[data-talk-url="https://www.youtube.com/watch?v=lsKGeUk2aF8"] .talk-meta')).toContainText('IWSLT 2016 sessions');
    const actual=await page.locator('.talk-row').evaluateAll(els=>els.map(el=>({url:el.dataset.talkUrl,date:el.dataset.date})));
    expect(new Set(actual.map(t=>t.url)).size).toBe(data.editorial.talks.length);
    expect(actual.map(t=>t.url).sort()).toEqual(data.editorial.talks.map(t=>t.url).sort());
    const dated=actual.filter(t=>t.date).map(t=>t.date);
    expect(dated).toEqual([...dated].sort().reverse());
    expect(actual.slice(dated.length).every(t=>!t.date)).toBe(true);
    await expect(page.locator('.talk-row h3 a').first()).toHaveAttribute('target','_blank');
    const layout=await page.evaluate(()=>({talk:document.querySelector('.talk-index').getBoundingClientRect().top,series:document.querySelector('.ax-series,.series-row').getBoundingClientRect().top}));
    expect(layout.talk).toBeLessThan(layout.series);
    await page.locator('#talk-group').selectOption('SIGML');
    await expect(page.locator('.talk-row')).toHaveCount(21);
    await page.locator('#talk-search').fill('Segmental Pronunciation');
    await expect(page.locator('.talk-row')).toHaveCount(1);
    await expect(page.locator('.talk-row')).toContainText('Charles McGhee');
    await page.locator('#talk-search').fill('');
    await page.locator('#talk-order').selectOption('oldest');
    const dates=await page.locator('.talk-row').evaluateAll(els=>els.map(el=>el.dataset.date));
    const knownDates=dates.filter(Boolean);
    expect(knownDates).toEqual([...knownDates].sort());
    expect(dates.slice(knownDates.length).every(d=>!d)).toBe(true);
    await page.locator('#talk-group').selectOption('');
    await page.locator('#talk-order').selectOption('newest');
    await page.screenshot({path:'qa-artifacts/'+edition+'-talk-index.jpg',type:'jpeg'});
  }
  await expect(page.locator('.brand-small')).toHaveCount(0);
  await expect(page.locator('.mail-link')).toHaveText('Write to the AI agent maintaining this website');
});

test('automatic spin and robot run, with an obvious reversible camera', async ({ page }) => {
  await openFancy(page);
  await expect(page.locator('html')).toHaveAttribute('data-webgl','ready');
  const motion=await page.evaluate(()=>{
    const r=window.__record;const spin=r.state.spin;const robot=r.curator.position.clone();
    r.advance(.2,.2);
    return {spinning:r.state.spinning,spin:r.state.spin-spin,walk:r.curator.position.distanceTo(robot)};
  });
  expect(motion.spinning).toBe(true);expect(Math.abs(motion.spin)).toBeGreaterThan(0);expect(motion.walk).toBeGreaterThan(.1);
  await page.locator('.track').first().click();
  await page.evaluate(()=>window.__record.advance(2,1));
  const close=await page.evaluate(()=>window.__record.camera.position.distanceTo(window.__record.controls.target));
  await expect(page.locator('#btn-reset')).toBeVisible();
  await page.locator('#btn-reset').click();
  await page.evaluate(()=>window.__record.advance(2,1));
  const reset=await page.evaluate(()=>({distance:window.__record.camera.position.distanceTo(window.__record.controls.target),selected:window.__record.state.selected}));
  expect(reset.selected).toBe(-1);expect(reset.distance).toBeGreaterThan(close+10);
  await expect(page.locator('.track')).toHaveCount(data.sigs.length);
  await page.locator('.track').nth(1).click();
  await page.keyboard.press('Escape');
  expect(await page.evaluate(()=>window.__record.state.selected)).toBe(-1);
  await page.locator('#btn-spin').click();
  const paused=await page.evaluate(()=>{const r=window.__record;r.advance(2,1);const robot=r.curator.position.clone();r.advance(.2,.2);return {walking:r.state.walking,delta:r.curator.position.distanceTo(robot)};});
  expect(paused.walking).toBe(false);expect(paused.delta).toBe(0);
  await page.locator('#btn-spin').click();
  await page.screenshot({path:'qa-artifacts/fancy-whole-record.jpg',type:'jpeg'});
});

for(const width of [390,320]) test('talk controls and whole-record return fit at '+width+'px', async ({page})=>{
  await page.setViewportSize({width,height:844});await openFancy(page);
  await page.locator('.track').first().click();
  await page.locator('#btn-reset').click();
  expect(await page.evaluate(()=>window.__record.state.selected)).toBe(-1);
  await page.locator('[data-view="series"]').click();
  await page.locator('#talk-group').selectOption('SLaTE');
  await expect(page.locator('.talk-row')).toHaveCount(8);
  await fits(page);
  const boxes=await page.locator('.tabs button,#btn-reset,.talk-controls input,.talk-controls select').evaluateAll(els=>els.map(el=>{const r=el.getBoundingClientRect();return {left:r.left,right:r.right};}));
  expect(boxes.every(b=>b.left>=0&&b.right<=width+1)).toBe(true);
  await page.screenshot({path:'qa-artifacts/fancy-talk-mobile-'+width+'.jpg',type:'jpeg'});
  await page.goto(classic+'#series');await expect(page.locator('.talk-row')).toHaveCount(data.editorial.talks.length);await fits(page);
  await page.screenshot({path:'qa-artifacts/classic-talk-mobile-'+width+'.jpg',type:'jpeg'});
  await page.locator('[data-section="about"]').click();await fits(page);
  await expect(page.locator('#content')).toContainText('Xiaojin, the AI agent maintaining this Atlas, checked');
  await page.screenshot({path:'qa-artifacts/classic-reviewer-mobile-'+width+'.jpg',type:'jpeg'});
  await openFancy(page);await page.locator('[data-view="about"]').click();await fits(page);
  await expect(page.locator('#sleeve-body')).toContainText('Xiaojin, the AI agent maintaining this Atlas, checked');
  await page.screenshot({path:'qa-artifacts/fancy-reviewer-mobile-'+width+'.jpg',type:'jpeg'});
});

for (const width of [1024,768]) test('section tabs stay inside the sleeve at '+width+'px', async ({ page }) => {
  await page.setViewportSize({width,height:900});
  await openFancy(page);
  const sleeve=await page.locator('.sleeve').boundingBox();
  const boxes=await page.locator('.tabs button').evaluateAll(els=>els.map(e=>{const r=e.getBoundingClientRect();return {left:r.left,right:r.right,width:r.width};}));
  expect(boxes.length).toBe(4);
  expect(boxes.every(b=>b.width>0&&b.left>=sleeve.x-1&&b.right<=sleeve.x+sleeve.width+1)).toBe(true);
  for (const view of ['series','about']) {
    await page.locator('.tabs [data-view="'+view+'"]').click();
    await expect(page.locator('#sleeve-body h2').first()).toBeVisible();
  }
  await fits(page);
  await page.screenshot({path:'qa-artifacts/fancy-tabs-'+width+'.jpg',type:'jpeg'});
});

test('the open sheet leaves the header and the Whole record control uncovered on a short phone', async ({ page }) => {
  await page.setViewportSize({width:320,height:568});
  await openFancy(page);
  const sheet=await page.locator('.sleeve').boundingBox();
  const reset=await page.locator('#btn-reset').boundingBox();
  const editions=await page.locator('.brand .edition-switch').boundingBox();
  expect(sheet.y).toBeGreaterThanOrEqual(reset.y+reset.height);
  expect(sheet.y).toBeGreaterThanOrEqual(editions.y+editions.height);
  await expect(page.locator('.tabs [data-view="about"]')).toBeVisible();
  await fits(page);
  await page.screenshot({path:'qa-artifacts/fancy-short-phone-320x568.jpg',type:'jpeg'});
});

for (const width of [1440,390,320]) test('matching sections and playable lecture previews at '+width+'px', async ({ page }) => {
  await page.setViewportSize({width,height:1000});
  for (const edition of ['fancy','classic']) {
    if (edition === 'fancy') await openFancy(page);
    else await page.goto(classic);
    const nav=page.locator(edition==='fancy'?'.tabs button':'.sidebar [data-section] span');
    await expect(nav).toHaveText(['Upcoming','Lectures','SIGs','Maintenance']);
    await expect(page.locator('[data-view="library"],[data-section="resources"]')).toHaveCount(0);
    await page.screenshot({path:`qa-artifacts/${edition}-sections-${width}.jpg`,type:'jpeg'});
    await page.locator(edition==='fancy'?'[data-view="series"]':'[data-section="series"]').click();
    await expect(page.getByRole('heading',{name:'Lectures',exact:true})).toBeVisible();
    await expect(page.locator('.talk-row')).toHaveCount(data.editorial.talks.length);
    const previews=await page.locator('.talk-row').evaluateAll(rows=>rows.map(row=>({
      url:row.dataset.talkUrl, href:row.querySelector('.talk-thumb')?.href,
      src:row.querySelector('.talk-thumb img')?.getAttribute('src'),
      label:row.querySelector('.talk-thumb')?.getAttribute('aria-label'),
      fallback:row.querySelector('.talk-thumb')?.classList.contains('is-unavailable'),
      fallbackText:row.querySelector('.talk-thumb-fallback')?.textContent
    })));
    for (const preview of previews) {
      expect(preview.href).toBe(preview.url);
      const talk=data.editorial.talks.find(t=>t.url===preview.url);
      expect(talk).toBeTruthy();
      expect(preview.label.replace(/\s+/g,' ')).toBe(`Watch: ${talk.title.replace(/\s+/g,' ')} (opens in a new tab)`);
      const u=new URL(preview.url);
      const videoId=u.searchParams.get('v');
      if(u.hostname==='www.youtube.com' && /^[A-Za-z0-9_-]{11}$/.test(videoId||'')) {
        expect(preview.src).toBe('https://i.ytimg.com/vi/'+videoId+'/hqdefault.jpg');
      } else {
        expect(preview.src).toBeUndefined();
        expect(preview.fallback).toBe(true);
        expect(preview.fallbackText).toBe('Recording on the source site');
      }
    }
    const first=page.locator('.talk-thumb img').first();
    await first.scrollIntoViewIfNeeded();
    await expect.poll(()=>first.evaluate(img=>img.complete&&img.naturalWidth>120)).toBe(true);
    await fits(page);
    await page.screenshot({path:`qa-artifacts/${edition}-lecture-previews-${width}.jpg`,type:'jpeg'});
    await page.locator('#talk-group').selectOption('SIGML');
    await page.locator('#talk-search').fill('Segmental Pronunciation');
    await expect(page.locator('.talk-row')).toHaveCount(1);
    await expect(page.locator('.talk-thumb')).toHaveCount(1);
    await expect(page.locator('.talk-thumb')).toHaveAttribute('href',await page.locator('.talk-row h3 a').getAttribute('href'));
    await page.locator('#talk-search').fill('no-matching-lecture-92815');
    await expect(page.locator('#talk-results')).toContainText('No talks match');
    await expect(page.locator('.talk-thumb')).toHaveCount(0);
  }
});

test('retired resource links lead to Lectures and unavailable previews retain a recording link', async ({ page }) => {
  await page.route('https://i.ytimg.com/**',route=>route.abort());
  for (const edition of ['fancy','classic']) {
    if(edition==='fancy')await openFancy(page,'#library');
    else await page.goto(classic+'#resources');
    await expect(page).toHaveURL((edition==='fancy'?fancy:classic)+'#series');
    await expect(page.getByRole('heading',{name:'Lectures',exact:true})).toBeVisible();
    const card=page.locator('.talk-thumb').first();
    await card.scrollIntoViewIfNeeded();
    await expect(card).toHaveClass(/is-unavailable/);
    await expect(card.locator('img')).toBeHidden();
    await expect(card).toContainText('Preview unavailable');
    await expect(card).toHaveAttribute('href',await page.locator('.talk-row h3 a').first().getAttribute('href'));
  }
});
