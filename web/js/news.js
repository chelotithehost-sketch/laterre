/* news.js — real-time news & trends. Publisher headlines (server RSS) + Wikipedia "In the news" and most-read
   (server + live browser refresh) are tagged to countries by name / capital / demonym, and drive:
   hotspots on capital flags, the News panel, the ticker and the "In the news" card of every country. */
const NEWS = { items: [] };
let newsTab = 'news', newsStamp = D.updated || '';
const TABS = [['news', 'Headlines'], ['wiki', 'Wikipedia'], ['trend', 'Trending']];
const wikiUrl = t => 'https://en.wikipedia.org/wiki/' + encodeURIComponent(String(t).replace(/ /g, '_'));

const ALIAS = {
  USA: ['U.S.', 'US', 'United States', 'America', 'American', 'Americans', 'White House', 'Pentagon', 'Washington'],
  GBR: ['UK', 'U.K.', 'Britain', 'British', 'England', 'Scotland', 'Wales', 'London', 'Downing Street'],
  RUS: ['Russian', 'Russians', 'Kremlin', 'Moscow'], UKR: ['Ukrainian', 'Ukrainians', 'Kyiv', 'Kiev'],
  CHN: ['Chinese', 'Beijing', 'Hong Kong'], ISR: ['Israeli', 'Israelis', 'Tel Aviv', 'Jerusalem'],
  PSE: ['Gaza', 'Palestinian', 'Palestinians', 'West Bank', 'Hamas'], IRN: ['Iranian', 'Iranians', 'Tehran'],
  FRA: ['French', 'Paris', 'Macron'], DEU: ['German', 'Germans', 'Berlin'], ITA: ['Italian', 'Italians'],
  ESP: ['Spanish', 'Madrid'], JPN: ['Japanese', 'Tokyo'], IND: ['Indian', 'Indians', 'Delhi', 'New Delhi', 'Mumbai'],
  PAK: ['Pakistani', 'Islamabad'], AUS: ['Australian', 'Australians', 'Sydney', 'Melbourne'],
  CAN: ['Canadian', 'Canadians', 'Ottawa', 'Toronto'], BRA: ['Brazilian', 'Brasília', 'Brasilia'],
  MEX: ['Mexican', 'Mexicans'], ZAF: ['South African', 'South Africans'], KEN: ['Kenyan', 'Kenyans', 'Nairobi'],
  NGA: ['Nigerian', 'Nigerians', 'Lagos', 'Abuja'], EGY: ['Egyptian', 'Cairo'], TUR: ['Turkish', 'Turkey', 'Istanbul', 'Ankara'],
  SAU: ['Saudi', 'Riyadh'], KOR: ['South Korea', 'South Korean', 'Seoul'], PRK: ['North Korea', 'North Korean', 'Pyongyang'],
  TWN: ['Taiwan', 'Taiwanese', 'Taipei'], SYR: ['Syrian', 'Damascus'], IRQ: ['Iraqi', 'Baghdad'],
  AFG: ['Afghan', 'Kabul', 'Taliban'], SDN: ['Sudan', 'Sudanese', 'Khartoum'], ETH: ['Ethiopian', 'Addis Ababa'],
  COD: ['DR Congo', 'Congolese', 'Kinshasa'], VEN: ['Venezuelan', 'Caracas'], ARG: ['Argentine', 'Argentinian', 'Buenos Aires'],
  LBN: ['Lebanese', 'Beirut'], YEM: ['Yemeni', 'Houthi', 'Houthis']
};
let tagRe = null, tagMap = {};
function buildTagger() {
  tagMap = {};
  const add = (term, iso) => { if (term && iso && !(term in tagMap)) tagMap[term] = iso; };
  const STOP = new Set(['Washington', 'Victoria', 'Kingston', 'Georgetown', 'Hamilton']);   // capitals that are mostly something else
  Object.entries(ALIAS).forEach(([iso, terms]) => terms.forEach(t => add(t, iso)));
  (D.countries || []).forEach(c => {
    add(c.name, c.cca3);
    if (c.capital && c.capital.length >= 6 && !STOP.has(c.capital)) add(c.capital, c.cca3);
  });
  const terms = Object.keys(tagMap).sort((a, b) => b.length - a.length).map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  tagRe = null;
  if (!terms.length) return;
  try { tagRe = new RegExp('(?<![A-Za-z])(?:' + terms.join('|') + ')(?![A-Za-z])'); }
  catch (e) { tagRe = new RegExp('\\b(?:' + terms.join('|') + ')\\b'); }                 // older browsers: no look-behind
}
const tagIso = text => { const m = tagRe && tagRe.exec(text || ''); return m ? tagMap[m[0]] || null : null; };

function buildFeed() {
  const rss = ((D.news || {}).items || []).map(i => ({ t: i.t, url: i.url, pub: i.pub, ts: i.ts || 0, src: 'news' }));
  const wk = (D.wikinews || []).map(i => ({ t: i.t, url: i.url, pub: 'Wikipedia · In the news', ts: i.ts || 0, src: 'wiki' }));
  const tr = (D.trending || []).filter(t => t && t.t).map(t => ({ t: t.t, url: wikiUrl(t.t), pub: 'Wikipedia · most read', v: t.v, src: 'trend' }));
  NEWS.items = rss.concat(wk, tr);
  NEWS.items.forEach(i => { i.iso = tagIso(i.t); });
  Object.keys(HOT).forEach(k => delete HOT[k]);
  NEWS.items.filter(i => i.src !== 'trend' && i.iso).forEach(i => {
    const h = HOT[i.iso] || (HOT[i.iso] = { n: 0, items: [] }); h.n++; h.items.push(i);
  });
  Object.values(HOT).forEach(h => h.items.sort((a, b) => b.ts - a.ts));
}

function newsItemHTML(i) {
  const c = i.iso && CTY[i.iso];
  const loc = c && c.cca2 ? `<button class="nl" data-iso="${esc(i.iso)}" title="${esc(c.name)} — open on the globe"><img alt="" src="${esc(flagUrl(c.cca2, 'w40'))}"></button>` : '';
  const meta = i.src === 'trend' ? `${cmpf.format(i.v)} views yesterday` : (i.ts ? ago(i.ts * 1000) : '');
  return `<div class="ni"><a href="${esc(i.url)}" target="_blank" rel="noopener"><b>${esc(i.pub)}</b>${esc(i.t)}${meta ? `<small>${esc(meta)}</small>` : ''}</a>${loc}</div>`;
}
function renderNews() {
  const el = $('#news'); if (!el) return;
  const list = NEWS.items.filter(i => i.src === newsTab);
  el.innerHTML = `<div class="t">Real-time news<span class="live">● live · ${esc(newsStamp)}</span></div>
    <div class="seg" id="newsTabs">${TABS.map(([k, l]) => `<button data-k="${k}" class="${k === newsTab ? 'on' : ''}">${l}</button>`).join('')}</div>
    ${list.length ? list.map(newsItemHTML).join('') : '<div class="ex" style="padding:10px 4px">Nothing from this channel right now — it refreshes by itself.</div>'}
    <div class="ex" style="margin-top:8px;font-size:11px">Headlines belong to their publishers: only titles and links are shown. Wikipedia text is CC BY-SA. TERRA does not verify reports.</div>`;
  $$('#newsTabs button').forEach(b => b.onclick = () => { newsTab = b.dataset.k; renderNews(); });
  $$('#news .nl').forEach(b => b.onclick = () => { const f = feats.find(x => x.properties.ADM0_A3 === b.dataset.iso); if (f) pick(f); });
}

function buildTicker() {
  const a = NEWS.items.filter(i => i.src !== 'trend'), b = NEWS.items.filter(i => i.src === 'trend'), mix = [];
  for (let i = 0; i < Math.max(a.length, b.length); i++) { if (a[i]) mix.push(a[i]); if (b[i]) mix.push(b[i]); }
  const items = mix.slice(0, 40);
  document.body.classList.toggle('no-ticker', !items.length);          // nothing to show → no empty bar
  if (!items.length) return;
  const tk = items.map(i => `<span><i>${esc(i.pub.replace('Wikipedia · ', 'Wiki · '))}</i><a href="${esc(i.url)}" target="_blank" rel="noopener">${esc(i.t.length > 110 ? i.t.slice(0, 108) + '…' : i.t)}</a></span>`).join('');
  const mv = $('#mv'); mv.innerHTML = tk + tk;                          // doubled for a seamless loop
  mv.style.animationDuration = Math.max(60, items.length * 6) + 's';
}

function countryNewsHTML(iso, name) {
  const items = ((HOT[iso] || {}).items || []).slice(0, 6);
  return `<div class="sec"><h4>In the news</h4>${items.length ? newsListHTML(items) : `<div class="ex">No headline in the current feeds mentions ${esc(name)}.</div>`}
    <button class="btn" id="moreNews" style="margin-top:8px">Search more headlines about ${esc(name)}</button></div>`;
}

function refreshAll() {
  buildFeed(); renderNews(); buildTicker();
  if (typeof layerCounts === 'function') layerCounts();
  if (typeof layers === 'function') layers();
  if (typeof redraw === 'function') redraw(true);
}
function onCountries() { buildTagger(); refreshAll(); }        // called when the browser had to fetch the country list itself

/* live refresh of the Wikipedia part every 10 minutes (publisher RSS refreshes server-side every 15 min) */
async function refreshWiki() {
  const z = n => String(n).padStart(2, '0'), txt = h => new DOMParser().parseFromString(String(h || ''), 'text/html').body.textContent.trim();
  for (const back of [0, 1]) {
    const d = new Date(Date.now() - back * 86400000);
    const f = await terraFetch('wiki_featured', { path: { yyyy: String(d.getUTCFullYear()), mm: z(d.getUTCMonth() + 1), dd: z(d.getUTCDate()) }, ttl: 300 });
    if (!f) continue;
    const news = (f.news || []).slice(0, 10).map(s => ({ t: txt(s.story).slice(0, 260), url: (((((s.links || [])[0] || {}).content_urls || {}).desktop) || {}).page, ts: 0 })).filter(x => x.t && x.url);
    const trend = ((f.mostread || {}).articles || []).filter(a => a.title && a.title !== 'Main_Page' && !/^(Special|Wikipedia|Portal|Help|File|Category|Talk):/.test(a.title))
      .slice(0, 12).map(a => ({ t: a.normalizedtitle || a.title.replace(/_/g, ' '), v: a.views }));
    if (!news.length && !trend.length) continue;
    if (news.length) D.wikinews = news;
    if (trend.length) D.trending = trend;
    newsStamp = new Date().toISOString().substr(11, 5) + ' UTC';
    refreshAll();
    return;
  }
}

buildTagger(); buildFeed(); renderNews();
setTimeout(refreshWiki, 4000); setInterval(refreshWiki, 600000);
