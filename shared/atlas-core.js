// Shared data and content layer for the two ISCA SIG Atlas concepts.
// Both pages read the same data.json that the original Atlas publishes every day,
// so the content never diverges from the maintained directory. The snapshot is
// only a fallback for offline use.

export const LIVE_URL = 'https://speechlab0210.github.io/isca-sig-directory/data.json';
export const CLASSIC_URL = 'https://speechlab0210.github.io/isca-sig-directory/';
export const CONTACT = 'speechlab0210@gmail.com';
export const ISCA_LIST_URL = 'https://isca-speech.org/Special-Interest-Groups';

const validShape = d => d && Array.isArray(d.sigs) && d.sigs.length > 0 &&
  d.sigs.every(s => s && s.acronym && s.fullName) && Array.isArray(d.events) &&
  d.editorial && Array.isArray(d.editorial.series) && d.editorial.maintenance &&
  Array.isArray(d.editorial.maintenance.steps) && d.editorial.maintenance.roster &&
  d.checks && Array.isArray(d.checks.sources);

const normalise = d => ({
  ...d,
  sigs: d.sigs.map(s => ({ activities: [], series: [], videos: [], ...s })),
  updates: d.updates || [],
});

export async function loadAtlas({ timeoutMs = 3500 } = {}) {
  const forceSnapshot = new URLSearchParams(location.search).get('data') === 'snapshot';
  if (!forceSnapshot) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(LIVE_URL, { signal: ctrl.signal, cache: 'no-cache' });
      if (res.ok) {
        const data = await res.json();
        if (validShape(data)) return { data: normalise(data), source: 'live' };
      }
    } catch { /* fall through to the snapshot */ } finally { clearTimeout(timer); }
  }
  // the saved copy is only downloaded when the live file cannot be read
  const { default: snapshot, snapshotTakenAt } = await import('./atlas-snapshot.js');
  return { data: normalise(snapshot), source: 'snapshot', takenAt: snapshotTakenAt };
}

/* ---------- small helpers (same rules as the original Atlas) ---------- */
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const safeUrl = u => {
  try {
    const p = new URL(u);
    return ['https:', 'http:'].includes(p.protocol) && !p.username && !p.password &&
      !/(^|\.)synsig\.org$/i.test(p.hostname) ? p.href : null;
  } catch { return null; }
};
export const link = (u, t, cls = '') => safeUrl(u)
  ? `<a${cls ? ` class="${cls}"` : ''} href="${esc(safeUrl(u))}" target="_blank" rel="noopener noreferrer">${esc(t)}<span class="sr-only"> (opens in a new tab)</span></a>`
  : esc(t);
const linkRow = xs => (xs || []).length ? `<div class="ax-links">${xs.map(x => link(x.href, x.label)).join('')}</div>` : '';
const mailto = subject => `mailto:${CONTACT}?subject=${encodeURIComponent(subject)}`;

/* Anywhere-on-Earth date: an event leaves "Upcoming" only after its date has ended everywhere. */
export const todayAoE = () => {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'Etc/GMT+12', year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(new Date()).map(x => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
};
export const fmtDate = d => {
  if (!d) return 'Not yet checked';
  const t = new Date(/^\d{4}-\d{2}-\d{2}$/.test(d) ? d + 'T12:00:00Z' : d);
  return Number.isNaN(t.getTime()) ? String(d)
    : new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Taipei' }).format(t);
};
export const shortDate = d => {
  const t = new Date(d + 'T12:00:00Z');
  return Number.isNaN(t.getTime()) ? String(d) : new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(t);
};

/* ---------- SIG helpers ---------- */
export const kindLabel = s => s.kind === 'language' ? 'Language SIG' : 'Topic SIG';
export const searchText = s => [s.acronym, s.fullName, kindLabel(s), s.description,
  ...s.activities.flatMap(a => [a.name, a.type && a.type.replace(/-/g, ' '), a.cadence, a.last]),
  ...s.series.flatMap(w => [w.name, w.cadence, w.notes]),
  ...s.videos.flatMap(v => [v.title, v.kind && v.kind.replace(/-/g, ' '), v.what])]
  .filter(Boolean).join(' ').toLocaleLowerCase();
export const matchesQuery = (s, q) => !q.trim() || searchText(s).includes(q.trim().toLocaleLowerCase());
export const FILTERS = [['all', 'All groups'], ['topic', 'Topic SIGs'], ['language', 'Language SIGs'], ['recordings', 'With recordings'], ['series', 'Active series']];
export const passesFilter = (s, f) => f === 'all' || s.kind === f ||
  (f === 'recordings' && s.videos.length > 0) || (f === 'series' && !!s.activeSeries);

export function splitEvents(events) {
  const now = todayAoE();
  const sorted = [...events].sort((a, b) => a.start.localeCompare(b.start));
  return {
    future: sorted.filter(e => (e.end || e.start) >= now),
    past: sorted.filter(e => (e.end || e.start) < now).reverse(),
  };
}
export const eventsFor = (data, acronym) => splitEvents(data.events.filter(e => e.sig === acronym));
export const totals = data => ({
  sigs: data.sigs.length,
  series: data.editorial.series.length,
  recordings: data.sigs.reduce((n, s) => n + s.videos.length, 0),
  upcoming: splitEvents(data.events).future.length,
});

export function youTubeId(url) {
  try {
    const u = new URL(url);
    if (/(^|\.)youtu\.be$/.test(u.hostname)) return u.pathname.slice(1).split('/')[0] || null;
    if (/(^|\.)youtube\.com$/.test(u.hostname)) {
      if (u.pathname === '/watch') return u.searchParams.get('v');
      const m = u.pathname.match(/^\/(?:embed|live|shorts)\/([\w-]{6,})/);
      return m ? m[1] : null;
    }
  } catch { /* not a URL */ }
  return null;
}
const KIND_LABEL = { 'youtube-channel': 'YouTube channel', 'youtube-video': 'YouTube video', 'youtube-playlist': 'YouTube playlist', 'video-page': 'Video page', other: 'Recording link' };
const ACT_LABEL = { workshop: 'Workshop', challenge: 'Challenge', 'webinar-series': 'Webinar series', conference: 'Conference', 'special-session': 'Special session', journal: 'Journal', course: 'Course', other: 'Activity' };
const hostOf = url => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; } };

function sourceCheck(data, url) {
  const s = data.checks.sources.find(x => x.url === url);
  if (!s) return '';
  return `<p class="ax-check${s.status === 'retrieved' ? '' : ' is-warning'}">${s.status === 'retrieved' ? 'Page read successfully' : 'Page unavailable at last check'} · ${esc(fmtDate(s.checkedAt))}</p>`;
}

export function eventItem(e, { showSig = true } = {}) {
  return `<li class="ax-event"><time class="ax-event-date" datetime="${esc(e.start)}">${esc(e.displayDate || fmtDate(e.start))}</time>` +
    `<div class="ax-event-body">${showSig ? `<span class="ax-eyebrow">${esc(e.sig)}</span>` : ''}<h4>${link(e.url, e.title)}</h4>` +
    `${e.details ? `<p>${esc(e.details)}</p>` : ''}<p class="ax-fine">${e.verified ? 'Source reviewed' : 'Not fully confirmed; reconfirm before making plans'} · ${esc(fmtDate(e.reviewed))}</p></div></li>`;
}

/* ---------- content blocks (each concept styles the ax-* classes its own way) ---------- */
export function sigDetail(data, s) {
  const ev = eventsFor(data, s.acronym);
  const rec = s.videos.map(v => {
    const id = youTubeId(v.url);
    const thumb = id ? `<img src="https://i.ytimg.com/vi/${esc(id)}/mqdefault.jpg" alt="" loading="lazy" referrerpolicy="no-referrer">` : `<span class="ax-rec-host">${esc(hostOf(v.url))}</span>`;
    const href = safeUrl(v.url);
    return `<li class="ax-rec">${href ? `<a class="ax-rec-link" href="${esc(href)}" target="_blank" rel="noopener noreferrer">` : '<div class="ax-rec-link">'}` +
      `<span class="ax-rec-thumb${id ? '' : ' is-generic'}" data-kind="${esc(v.kind || 'other')}">${thumb}</span>` +
      `<span class="ax-rec-kind">${esc(KIND_LABEL[v.kind] || 'Recording link')}</span><span class="ax-rec-title">${esc(v.title)}</span>` +
      `${href ? '<span class="sr-only"> (opens in a new tab)</span></a>' : '</div>'}${v.what ? `<p class="ax-rec-what">${esc(v.what)}</p>` : ''}</li>`;
  }).join('');
  return `<article class="ax-sig">
  <header class="ax-sig-head">
    <p class="ax-eyebrow">${esc(kindLabel(s))}</p>
    <h2 class="ax-sig-acr">${esc(s.acronym)}</h2>
    <p class="ax-sig-name">${esc(s.fullName)}</p>
    <ul class="ax-stats"><li><b>${s.activities.length}</b> activities</li><li><b>${s.videos.length}</b> recording links</li><li><b>${ev.future.length}</b> upcoming</li></ul>
  </header>
  <p class="ax-lede">${esc(s.description)}</p>
  <div class="ax-links">${s.website ? link(s.website, 'SIG website') : ''}${link(s.iscaUrl, 'Official ISCA profile')}</div>
  ${sourceCheck(data, s.website || s.iscaUrl)}
  <p class="ax-fine">${s.contentReviewed ? `Profile reviewed ${esc(fmtDate(s.contentReviewed))}; first compiled ${esc(fmtDate(data.generated))}.` : `Profile first compiled ${esc(fmtDate(data.generated))}.`} A page-access check is not a review of every fact.</p>
  <section class="ax-block"><h3>Activities &amp; recurring events</h3><ul class="ax-acts">${s.activities.map(a => `<li class="ax-act" data-type="${esc(a.type || 'other')}"><span class="ax-act-type">${esc(ACT_LABEL[a.type] || 'Activity')}</span><h4>${a.url ? link(a.url, a.name) : esc(a.name)}</h4>${a.cadence ? `<p>${esc(a.cadence)}</p>` : ''}${a.last ? `<p>${esc(a.last)}</p>` : ''}</li>`).join('')}</ul></section>
  ${s.series.length ? `<section class="ax-block"><h3>Seminars &amp; lecture series</h3><ul class="ax-acts">${s.series.map(w => `<li class="ax-act" data-type="webinar-series"><span class="ax-act-type">${w.active ? 'Series listed' : 'No current schedule found'}</span><h4>${link(w.pageUrl, w.name)}</h4><p>${esc(w.cadence || 'Schedule announced by the organizer')}</p>${w.notes ? `<p>${esc(w.notes)}</p>` : ''}${w.recUrl ? `<p>${link(w.recUrl, 'Recording index')}</p>` : ''}</li>`).join('')}</ul></section>` : ''}
  <section class="ax-block"><h3>Recordings &amp; video</h3>${s.videos.length ? `<ul class="ax-recs">${rec}</ul><p class="ax-fine">Links point to external hosts; this site does not copy or host the videos.</p>` : '<p class="ax-empty">No public recording link has been located in this directory. This does not establish that none exists.</p>'}</section>
  <section class="ax-block"><h3>On the calendar</h3>${ev.future.length ? `<ul class="ax-events">${ev.future.map(e => eventItem(e, { showSig: false })).join('')}</ul>` : '<p class="ax-empty">No upcoming date is listed for this group in the index.</p>'}${ev.past.length ? `<details class="ax-more"><summary>Recently past (${ev.past.length})</summary><ul class="ax-events">${ev.past.map(e => eventItem(e, { showSig: false })).join('')}</ul><p class="ax-fine">A passed date does not confirm that an event took place.</p></details>` : ''}</section>
  <p class="ax-actions"><a href="${esc(mailto(`[ISCA SIG Atlas] ${s.acronym} correction`))}">Suggest a correction for ${esc(s.acronym)}</a></p>
</article>`;
}

export function eventsBlock(data) {
  const { future, past } = splitEvents(data.events);
  return `<section class="ax-section"><p class="ax-eyebrow">On the calendar</p><h2>Upcoming &amp; in progress <span class="ax-count">${future.length}</span></h2>
  <p class="ax-note">Dates keep the organizer’s stated timezone. Registration pages remain authoritative.</p>
  ${future.length ? `<ul class="ax-events">${future.map(e => eventItem(e)).join('')}</ul>` : '<p class="ax-empty">No upcoming event has been confirmed in the current index.</p>'}
  <details class="ax-more"><summary>Recently past (${past.length})</summary><p class="ax-fine">Past dates move here automatically. A passed date does not confirm that an event took place.</p><ul class="ax-events">${past.map(e => eventItem(e)).join('')}</ul></details></section>`;
}


function talkList(data, query='', group='', order='newest') {
 const q=query.trim().toLocaleLowerCase();
 return [...(data.editorial.talks||[])].filter(t=>(!group||t.sig===group)&&(!q||[t.title,t.speaker,t.series,t.sig].filter(Boolean).join(' ').toLocaleLowerCase().includes(q))).sort((a,b)=>{
  if(order==='title') return a.title.localeCompare(b.title);
  if(!a.date||!b.date) return Number(!a.date)-Number(!b.date)||a.title.localeCompare(b.title);
  return (order==='oldest'?1:-1)*a.date.localeCompare(b.date)||a.title.localeCompare(b.title);
 });
}
function talkControls(data) {
 const groups=[...new Set((data.editorial.talks||[]).map(t=>t.sig))].sort();
 return `<div class="talk-controls"><label>Find a talk<input id="talk-search" type="search" placeholder="Title, speaker or topic…"></label><label>SIG / series<select id="talk-group"><option value="">All SIGs & series</option>${groups.map(s=>`<option>${esc(s)}</option>`).join('')}</select></label><label>Sort<select id="talk-order"><option value="newest">Newest dated first</option><option value="oldest">Oldest dated first</option><option value="title">Title A–Z</option></select></label></div>`;
}
function talkRows(rows) {
 return rows.map(t=>`<article class="talk-row" data-talk-url="${esc(t.url)}" data-date="${esc(t.date||'')}"><p class="talk-meta">${esc(t.sig)} · ${esc(t.series)}${t.date?` · <time datetime="${esc(t.date)}">${esc(fmtDate(t.date))}</time>`:' · Date not listed'}</p><h3>${link(t.url,t.title)}</h3>${t.speaker?`<p>${esc(t.speaker)}</p>`:''}<p class="talk-source">${link(t.source,'Source')}</p></article>`).join('')||'<p>No talks match. Try another keyword or SIG.</p>';
}
function talkIndex(data) {
 const rows=talkList(data);
 return `<section class="talk-index"><h2>Individual talks & tutorials</h2><p>Open an indexed talk directly. Dated talks come first; undated recordings follow. Browse the series collections below.</p>${talkControls(data)}<p id="talk-count" role="status">${rows.length} talks & sessions</p><div id="talk-results">${talkRows(rows)}</div></section>`;
}
function refreshTalks(data) {
 const box=document.getElementById('talk-results');if(!box)return;
 const rows=talkList(data,document.getElementById('talk-search').value,document.getElementById('talk-group').value,document.getElementById('talk-order').value);
 box.innerHTML=talkRows(rows);document.getElementById('talk-count').textContent=`${rows.length} talks & sessions`;
}

export { refreshTalks };
export function seriesBlock(data) {
  const pill = p => ({ live: 'Series listed', paused: 'Archive', announced: 'Announced' })[p] || p;
  return `<section class="ax-section"><p class="ax-eyebrow">Listen in</p>${talkIndex(data)}<h2>Browse by series <span class="ax-count">${data.editorial.series.length}</span></h2>
  <p class="ax-note">Series status is dated, not a promise of the next session. Follow the organizer’s page for registration and schedule changes.</p>
  <ul class="ax-series">${data.editorial.series.map(s => `<li class="ax-series-item"><p class="ax-eyebrow">${esc(s.sig)} · ${esc(pill(s.pill))}</p><h3>${esc(s.name)}</h3><p class="ax-cadence">${esc(s.cad)}</p><p>${esc(s.text)}</p>${s.next ? `<p>${esc(s.next)}</p>` : ''}${linkRow(s.links)}<p class="ax-fine">Content review: ${esc(fmtDate(s.reviewed || data.generated))}</p></li>`).join('')}</ul></section>`;
}

export function resourcesBlock(data) {
  return `<section class="ax-section"><p class="ax-eyebrow">The wider ISCA library</p><h2>Association-level resources <span class="ax-count">${data.editorial.central.length}</span></h2>
  <ul class="ax-series">${data.editorial.central.map(r => `<li class="ax-series-item"><h3>${r.url ? link(r.url, r.name) : esc(r.name)}</h3><p>${esc(r.what)}</p>${linkRow(r.links)}${r.url ? sourceCheck(data, r.url) : ''}</li>`).join('')}</ul>
  <p class="ax-fine">Inherited resource descriptions: ${esc(fmtDate(data.generated))}; follow original sources for the current extent of each collection.</p></section>`;
}

export function aboutBlock(data, meta = {}) {
  const sources = data.checks.sources, ok = sources.filter(s => s.status === 'retrieved').length;
  const m = data.editorial.maintenance;
  const provenance = meta.source === 'live'
    ? `Both editions read the same maintained ${link(LIVE_URL, 'dataset')}.`
    : `This page is showing a saved copy taken ${esc(fmtDate(meta.takenAt))}.`;
  return `<section class="ax-section ax-about"><h2>How the Atlas is maintained</h2>
  <p class="ax-lede">${esc(data.editorial.disclosure)}</p>
  <p>${esc(m.overview)}</p><p class="ax-note">${provenance}</p>
  <h3>Daily collection and checking</h3>
  <p class="ax-status">Last source check: <b>${esc(fmtDate(data.checks.checkedAt))}</b> · ${ok} of ${sources.length} pages read successfully.</p>
  <ol class="ax-steps">${m.steps.map(x => `<li>${esc(x)}</li>`).join('')}</ol>
  <h3>SIG representative review</h3><p>${esc(m.representativeReview)}</p>
  <h3>Ask the AI maintainer</h3><p>${esc(m.contact)}</p>
  <p><a href="${esc(mailto('[ISCA SIG Atlas] Question or correction'))}">${CONTACT}</a></p>
  <h3>Which SIGs are included?</h3><p>${esc(m.roster.note)} ${link(m.roster.url, 'Official ISCA group list')}</p>
  <h3>Sources collected for each SIG</h3>
  <p>Open a group to see the public pages currently included in its daily collection. Each profile also links to its original activity and recording sources. Groups are listed alphabetically, without a rank.</p>
  <div class="sig-sources">${[...data.sigs].sort((a,b)=>a.acronym.localeCompare(b.acronym)).map(s => {
    const urls = sources.filter(x => (x.groups || []).includes(s.acronym));
    return `<details><summary>${esc(s.acronym)} · ${esc(s.fullName)}</summary><p>${link(s.website || s.iscaUrl,'SIG website / ISCA profile')}</p><ul>${urls.map(x => `<li>${link(x.url,x.url)} · ${x.status === 'retrieved' ? 'page read successfully' : 'page unavailable'} · ${esc(fmtDate(x.checkedAt))}</li>`).join('')}</ul></details>`;
  }).join('')}</div>
  ${meta.concept ? `<div class="ax-concept">${meta.concept}</div>` : ''}
  <h3>Update log</h3><ul class="ax-updates">${data.updates.map(u => `<li><time datetime="${esc(u.date)}">${esc(fmtDate(u.date))}</time><p>${esc(u.text)}</p></li>`).join('')}</ul>

  </section>`;
}
