/* everyday.js — Everyday Mode (TERRA_MASTER_SPEC.md §6.10, §6.11).
   The heart for non-technical users: big friendly cards → guided panels.
   Rules: a short sentence first, details second; fixed visible thresholds;
   "In plain English" templates; every card links back to the globe and to
   Sources; calm tone; never "safe" — only "no warning signs found". */

const STATIC = D.static || {};
const sData = k => (STATIC[k] && STATIC[k].records) || [];
const sAsOf = k => (STATIC[k] && STATIC[k].as_of) || '';
const disclaimer = {
  data: 'Public feeds can lag. For official warnings, follow your local authorities.',
  verify: 'Health, safety, visa and legal rules change — verify with official sources.',
  advice: 'TERRA gives information, not medical, legal or financial advice.'
};

/* ---------------- glossary tooltips (§6.11: dotted underline, ≤ 25 words) ---------------- */
function gl(term, text) {
  const rec = sData('glossary').find(g => g.term.toLowerCase() === term.toLowerCase());
  return rec ? `<abbr class="gl" title="${esc(rec.definition)}">${esc(text || term)}</abbr>` : esc(text || term);
}

/* ---------------- place resolution ---------------- */
async function resolvePlace(q) {
  q = (q || '').trim();
  const f = findC(q);
  if (f) return { kind: 'country', feature: f, name: f.properties.NAME, iso: f.properties.ADM0_A3 };
  const g = await terraFetch('geocode', { query: { name: q, count: 1, language: 'en', format: 'json' } });
  const r = g && g.results && g.results[0];
  if (r) return { kind: 'city', name: r.name, r };
  return null;
}

/* ---------------- shared mini-widgets ---------------- */
function trafficLight(h, m) {           // §6.10 call-time rule: 09–20 green, 07–09/20–22 amber
  const t = h + m / 60;
  return t >= 9 && t < 20 ? ['#3ddc97', 'A good time to call'] :
    ((t >= 7 && t < 9) || (t >= 20 && t < 22)) ? ['#ffb020', 'They may be busy or resting'] :
      ['#ff5a5f', 'Probably asleep — try later'];
}
function moonPhase(d) {                 // approximate, computed locally — no API
  const known = Date.UTC(2000, 0, 6, 18, 14), syn = 29.53058867 * 86400000;
  const age = ((d - known) % syn + syn) % syn, phase = age / syn;
  return phase < .03 || phase > .97 ? 'New moon' : phase < .22 ? 'Waxing crescent' :
    phase < .28 ? 'First quarter' : phase < .47 ? 'Waxing gibbous' : phase < .53 ? 'Full moon' :
      phase < .72 ? 'Waning gibbous' : phase < .78 ? 'Last quarter' : 'Waning crescent';
}
function myCurrency() {                 // guess from the browser region (en-GB → GB → GBP)
  const region = (navigator.language || 'en').split('-')[1];
  const hit = (D.countries || []).find(x => x.cca2 === (region || '').toUpperCase());
  return (hit && hit.cur) || 'USD';
}
const fx = (amt, from, to) => {
  const r = D.fx && D.fx.rates;
  if (!r) return null;
  const usd = amt / (r[from] || 1);
  return usd * (r[to] || 1);
};

function card(title, body) {
  return `<div class="sec"><h4>${title}</h4>${body}</div>`;
}
function plain(text) {
  return `<div class="ex" style="margin-top:8px"><b>In plain English:</b> ${text}</div>`;
}
function globeBtn() {
  return `<div class="sec"><button class="btn" id="homeBtn">⌂ Back to “What do you need today?”</button></div>`;
}

/* ================================ HOME OVERLAY ================================ */
function showHome() {
  const cards = [
    ['✈️', 'Plan a trip', 'Best months to go, plugs, money, phrases', 'trip'],
    ['🌦️', 'Weather, plainly', 'Umbrella? Jacket? Sunscreen?', 'weather'],
    ['🆘', 'Safety & alerts', 'Quakes, hazards, emergency numbers', 'safety'],
    ['🛡️', 'Is this website safe?', 'Check a link before you trust it', 'sitecheck'],
    ['📡', 'Is it down, or just me?', 'Check if a site is working', 'isdown'],
    ['🕐', 'Good time to call?', 'Their local time, at a glance', 'calltime'],
    ['💱', 'Money', 'Convert currencies quickly', 'money'],
    ['📰', 'What’s happening', 'Headlines from many publishers', 'news'],
    ['🛰️', 'Today', 'Launches, aurora, today in history', 'today'],
    ['🎓', 'Learn & play', 'Quizzes and world facts', 'learn'],
    ['📍', 'Around me', 'Use my location (stays on your device)', 'around']
  ];
  openPanel(`<div class="sec" style="border:0;padding:26px 24px 10px"><button id="x">✕</button>
    <div style="font:700 21px Inter;letter-spacing:-.01em">What do you need today?</div>
    <p class="ex" style="margin-top:6px">Pick a card. You can always come back.</p></div>
    <div class="home-grid">${cards.map(([icon, t, s, id]) =>
    `<button class="home-card" data-id="${id}"><span class="hi">${icon}</span><b>${t}</b><small>${s}</small></button>`).join('')}</div>
    <div class="sec"><div class="ex" style="font-size:11px">${esc(disclaimer.data)} ${esc(disclaimer.advice)}</div></div>`);
  $$('#panel .home-card').forEach(b => b.onclick = () => runCard(b.dataset.id, ''));
  const home = document.getElementById('homeBtn'); if (home) home.onclick = showHome;
  try { sessionStorage.setItem('terraHomeSeen', '1'); } catch (e) { }
}

function runCard(id, arg) {
  ({
    trip: () => askPlace('Plan a trip — where to?', openTripCard),
    weather: () => askPlace('Weather, plainly — where?', openWeatherPlainly),
    safety: () => askPlace('Safety & alerts — where?', openSafety),
    sitecheck: () => askDomain('Is this website safe? Paste a link or name', openWebsiteCheck),
    isdown: () => askDomain('Is it down, or just me? Enter a site', openIsDown),
    calltime: () => askPlace('Good time to call — where?', openCallTime),
    money: () => openMoney('', myCurrency(), 'USD'),
    news: () => openHeadlines(null),
    today: () => openToday(),
    learn: () => openLearn(),
    around: () => openAroundMe()
  }[id] || showHome)();
}

function askPlace(label, fn) {
  openPanel(`<div class="sec" style="border:0;padding:26px 24px"><button id="x">✕</button>
    <div style="font:700 17px Inter">${esc(label)}</div>
    <div style="display:flex;gap:8px;margin-top:14px">
      <input id="placeIn" placeholder="city or country" style="flex:1;background:rgba(255,255,255,.05);border:1px solid var(--line);border-radius:8px;color:var(--txt);padding:10px;font:500 13px Inter">
      <button class="btn" id="placeGo" style="width:auto;padding:10px 16px">Go</button></div></div>`);
  const go = () => { const v = $('#placeIn').value.trim(); if (v) fn(v); };
  $('#placeGo').onclick = go;
  $('#placeIn').addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
  $('#placeIn').focus();
}
function askDomain(label, fn) {
  openPanel(`<div class="sec" style="border:0;padding:26px 24px"><button id="x">✕</button>
    <div style="font:700 17px Inter">${esc(label)}</div>
    <div style="display:flex;gap:8px;margin-top:14px">
      <input id="domIn" placeholder="example.com" style="flex:1;background:rgba(255,255,255,.05);border:1px solid var(--line);border-radius:8px;color:var(--txt);padding:10px;font:500 13px Inter">
      <button class="btn" id="domGo" style="width:auto;padding:10px 16px">Check</button></div></div>`);
  const go = () => { const v = $('#domIn').value.trim().replace(/^https?:\/\//, '').split('/')[0]; if (v) fn(v); };
  $('#domGo').onclick = go;
  $('#domIn').addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
  $('#domIn').focus();
}

/* ================================ ✈️ TRIP CARD ================================ */
async function openTripCard(q) {
  const place = await resolvePlace(q);
  if (!place) return openPanel(hint('Place not found', 'Try another spelling, or pick it on the globe.'));
  openPanel(`<div class="sec" style="border:0;padding:24px"><button id="x">✕</button>
    <div style="font:700 19px Inter">✈️ Trip card · ${esc(place.name)}</div><p class="ex">Gathering the essentials…</p></div><div class="sk"></div>`);

  const isCity = place.kind === 'city';
  const lat = isCity ? place.r.latitude : center(place.feature).lat;
  const lng = isCity ? place.r.longitude : center(place.feature).lng;
  const iso = isCity ? (place.r.country_code || '').toUpperCase() : place.iso;
  const cc2 = iso.length === 3 ? ((D.countries.find(c => c.cca3 === iso) || {}).cca2 || '') : iso;
  const countryRec = (D.countries || []).find(c => c.cca3 === iso || c.cca2 === cc2) ||
    (isCity ? (D.countries || []).find(c => c.name === place.r.country) : null);

  const [wx, hol, wk] = await Promise.all([
    terraFetch('openmeteo', { query: { latitude: lat, longitude: lng, current: 'temperature_2m,weather_code', daily: 'temperature_2m_max,temperature_2m_min,precipitation_probability_max,weather_code', timezone: 'auto', forecast_days: 5 } }),
    (countryRec && countryRec.cca2) ? terraFetch('nager', { path: { cca2: countryRec.cca2 } }) : null,
    terraFetch('wikipedia', { path: { title: encodeURIComponent(place.name) } })
  ]);
  const climate = await climateNormals(lat, lng);

  let h = `<div class="hero" style="background-image:url(${countryRec && countryRec.cca2 ? esc(flagUrl(countryRec.cca2)) : ''});background-color:#12263f"><button id="x">✕</button><div class="in"><div>
    <h2>${esc(place.name)}</h2><p>${esc(countryRec ? [countryRec.capital, countryRec.subregion].filter(Boolean).join(' · ') : (place.r.country || ''))}</p></div></div></div>`;

  /* one-sentence answer first */
  h += card('In one sentence', `<div class="ex">${climate.best
    ? `A good time to visit ${esc(place.name)} is <b>${esc(climate.best)}</b> — mild and not too wet.`
    : `We could not build a climate picture for this place — check official sources.`}</div>`);

  /* best months — 12 bars, great / okay / avoid, explained */
  if (climate.months) {
    const col = m => m.rate === 'great' ? '#3ddc97' : m.rate === 'okay' ? '#f2e06a' : '#ef5b4c';
    h += card('Best time to go (monthly average weather)', `
      <div class="fc" style="flex-wrap:wrap">${climate.months.map((m, i) => `<div style="min-width:52px">
        <b style="color:${col(m)}">${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][i]}</b>
        ${Math.round(m.t)}°<br><span style="font-size:10px">${Math.round(m.p)} mm</span></div>`).join('')}</div>
      <div class="ex" style="margin-top:8px;font-size:11.5px">
        <b style="color:#3ddc97">Great</b>: 12–28 °C and under 90 mm rain/month ·
        <b style="color:#f2e06a">Okay</b>: 5–32 °C · <b style="color:#ef5b4c">Avoid</b>: hotter, colder or much wetter.
        ${chip('Open-Meteo archive', 'Historical averages 2020–2024 · CC BY 4.0 · non-commercial')}</div>`);
  }

  /* packing from the forecast */
  if (wx && wx.daily) {
    const mx = Math.max(...wx.daily.temperature_2m_max), mn = Math.min(...wx.daily.temperature_2m_min);
    const wet = wx.daily.precipitation_probability_max && Math.max(...wx.daily.precipitation_probability_max) >= 40;
    h += card('What to pack (next 5 days)', `<div class="ex">
      ${mn < 12 ? 'Bring warm layers. ' : mx > 30 ? 'Pack for heat and light clothes. ' : 'Mild weather — light layers. '}
      ${wet ? 'Rain is likely — take an umbrella or rain jacket.' : 'No heavy rain expected — but a small umbrella never hurts.'}</div>`);
  }

  /* money: 100 of yours ≈ X + purchasing power */
  const mine = myCurrency(), theirs = countryRec && countryRec.cur;
  if (theirs && D.fx && D.fx.rates[theirs]) {
    const conv = fx(100, mine, theirs);
    h += card('Money', `<div class="grid">
      <div class="k"><small>100 ${esc(mine)} ≈</small><b>${conv ? conv.toFixed(conv < 10 ? 2 : 0) : '—'} ${esc(theirs)}</b></div>
      <div class="k"><small>1 ${esc(mine)} ≈</small><b>${fx(1, mine, theirs) ? fx(1, mine, theirs).toFixed(3) : '—'} ${esc(theirs)}</b></div></div>
      ${bigMacNote(theirs)}
      <div class="ex" style="margin-top:8px;font-size:11px">Rates are a daily snapshot (${esc(String(D.fx.date || ''))}). ${esc(disclaimer.advice)}</div>`);
  }

  /* plugs & driving */
  const plug = sData('plugs_voltage').find(p => p.cca2 === cc2);
  const drive = countryRec && countryRec.drive;
  h += card('Plugs, power & driving', `<div class="grid">
    ${plug ? `<div class="k"><small>Plug type${chip('IEC', 'IEC World Plugs · as of ' + sAsOf('plugs_voltage'))}</small><b>${esc(plug.plugs.join(', '))}</b></div>
    <div class="k"><small>Voltage</small><b style="font-size:13px">${esc(plug.voltage)} · ${esc(plug.frequency)}</b></div>` : `<div class="k"><small>Plugs</small><b>Check official sources</b></div>`}
    ${drive ? `<div class="k"><small>They drive on the</small><b style="font-size:13px">${drive === 'left' ? 'left 🇬🇧' : 'right'}</b></div>` : ''}
    <div class="k"><small>Time difference from you</small><b style="font-size:13px">${esc(timeDiffText(place, lat, lng, wx))}</b></div></div>`);

  /* emergency numbers */
  const em = sData('emergency_numbers').find(e => e.cca2 === cc2);
  if (em) {
    const n = em.numbers;
    h += card(`Emergency numbers ${chip('as of ' + sAsOf('emergency_numbers'), em.source_url)}`, `<div class="grid">
      ${n.single ? `<div class="k"><small>Single emergency number</small><b>${esc(n.single)}</b></div>` : ''}
      ${n.police ? `<div class="k"><small>Police</small><b>${esc(n.police)}</b></div>` : ''}
      ${n.ambulance ? `<div class="k"><small>Ambulance</small><b>${esc(n.ambulance)}</b></div>` : ''}
      ${n.fire ? `<div class="k"><small>Fire</small><b>${esc(n.fire)}</b></div>` : ''}</div>`);
  }

  /* languages + phrasebook with read-aloud */
  if (countryRec && countryRec.lang && countryRec.lang.length) {
    h += card(`Say it in their language (${esc(countryRec.lang.join(', '))})`, phrasebookHTML());
  }

  /* holidays */
  if (hol && hol[0]) {
    h += card('Public holidays to plan around', hol.slice(0, 4).map(x =>
      `<div class="row"><span class="nm" style="width:110px;color:var(--txt)">${esc(x.date)}</span><span style="flex:1">${esc(x.name)}</span></div>`).join(''));
  }

  /* official travel advice — links only, never summarised */
  const adv = sData('advisory_links').filter(a => a.cca2 === cc2 || a.cca2 === '*').flatMap(a => a.advisories || []);
  if (adv.length) h += card('Official travel advice (links only)', adv.map(a =>
    `<div class="row"><span style="flex:1"><a class="btn" style="display:inline-block;text-decoration:none;text-align:left" href="${esc(a.url)}" target="_blank" rel="noopener">${esc(a.name)} ↗</a></span></div>`).join('') +
    `<div class="ex" style="font-size:11px">TERRA never summarises or scores travel risk — read the official advice. ${esc(disclaimer.verify)}</div>`);

  if (wk && wk.extract) {
    let t = wk.extract; if (t.length > 340) t = t.slice(0, 340).replace(/\s+\S*$/, '') + '…';
    h += card('About the place', `<div class="ex">${esc(t)} ${chip('Wikipedia', 'CC BY-SA')}</div>`);
  }

  h += `<div class="sec" style="display:flex;gap:8px"><button class="btn" id="printTrip">Print / Save as PDF</button><button class="btn" id="homeBtn">⌂ Home</button></div>`;
  $('#panel').innerHTML = h; xBtn(closeP);
  $('#printTrip').onclick = () => window.print();
  $('#homeBtn').onclick = showHome;
  bindPhrasebook();
}

function bigMacNote(theirs) {
  const bm = D.bigmac && D.bigmac.rows && D.bigmac.rows[theirs];
  if (!bm || !D.fx || !D.fx.rates[theirs]) return '';
  const implied = bm.local / (D.fx.rates[theirs] || 1);
  const us = (D.bigmac.rows.USD || {}).local;
  if (!us) return '';
  const cheaper = implied < us;
  return `<div class="ex" style="margin-top:8px;font-size:11.5px">Does your money go further there?
    A Big Mac costs about <b>${implied.toFixed(2)} USD</b> in ${esc(bm.name || theirs)} vs <b>${us.toFixed(2)} USD</b> in the US
    — everyday prices are ${cheaper ? '<b>lower</b> there' : '<b>higher</b> there'}.
    ${chip('Big Mac index', 'The Economist · data as of ' + (D.bigmac.as_of || 'unknown'))}</div>`;
}

function timeDiffText(place, lat, lng, wx) {
  const tz = (wx && wx.timezone) || (place.r && place.r.timezone) || 'UTC';
  const mine = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  const now = new Date();
  const hHere = +new Intl.DateTimeFormat('en', { timeZone: mine, hour: 'numeric', hour12: false }).format(now);
  const hThere = +new Intl.DateTimeFormat('en', { timeZone: tz, hour: 'numeric', hour12: false }).format(now);
  const diff = ((hThere - hHere + 12) % 24 + 24) % 24 - 12;
  return diff === 0 ? 'same as you' : `${diff > 0 ? '+' : ''}${diff} h from you`;
}

function phrasebookHTML() {
  return `<div style="display:flex;flex-direction:column;gap:6px">${sData('phrasebook').slice(0, 10).map(p =>
    `<div class="row" style="margin:2px 0"><span style="flex:1">${esc(p.en)}</span>
     <button class="btn speak" data-en="${esc(p.en)}" style="width:auto;padding:5px 12px">🔊</button></div>`).join('')}
    </div><div class="ex" style="margin-top:8px;font-size:11px">Read-aloud uses your device’s voice — nothing is sent anywhere. Translations are machine-drafted where available.</div>`;
}
function bindPhrasebook() {
  $$('.speak').forEach(b => b.onclick = () => {
    try {
      const u = new SpeechSynthesisUtterance(b.dataset.en);
      speechSynthesis.cancel(); speechSynthesis.speak(u);
    } catch (e) { toast('Read-aloud is not available in this browser'); }
  });
}

/* monthly climate normals (2020–2024) — one call per place, cached 30 days */
async function climateNormals(lat, lng) {
  const data = await terraFetch('openmeteo_archive', {
    query: {
      latitude: lat, longitude: lng, start_date: '2020-01-01', end_date: '2024-12-31',
      daily: 'temperature_2m_mean,precipitation_sum', timezone: 'auto'
    }, ttl: 30 * 86400
  });
  try {
    const d = data.daily, sums = Array.from({ length: 12 }, () => ({ t: 0, p: 0, n: 0 }));
    d.time.forEach((day, i) => {
      const m = new Date(day).getMonth();
      if (d.temperature_2m_mean[i] != null) { sums[m].t += d.temperature_2m_mean[i]; sums[m].n++; }
      if (d.precipitation_sum[i] != null) sums[m].p += d.precipitation_sum[i];
    });
    const months = sums.map(s => ({ t: s.n ? s.t / s.n : 0, p: s.n ? s.p / (5 * 1) : 0, rate: '' }));
    months.forEach(m => {
      m.rate = (m.t >= 12 && m.t <= 28 && m.p < 90) ? 'great' : (m.t >= 5 && m.t <= 32 && m.p < 160) ? 'okay' : 'avoid';
    });
    const best = months.map((m, i) => [m, i]).filter(x => x[0].rate === 'great').map(x =>
      ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][x[1]]);
    return { months, best: best.length ? best.slice(0, 3).join(', ') : '' };
  } catch (e) { return { months: null, best: '' }; }
}

/* ================================ 🌦️ WEATHER, PLAINLY ================================ */
async function openWeatherPlainly(q) {
  const place = await resolvePlace(q);
  if (!place) return openPanel(hint('Place not found', 'Try another spelling.'));
  openPanel(`<div class="sec" style="border:0;padding:24px"><button id="x">✕</button><div style="font:700 19px Inter">🌦️ Weather in ${esc(place.name)}, plainly</div></div><div class="sk"></div>`);
  const lat = place.kind === 'city' ? place.r.latitude : center(place.feature).lat;
  const lng = place.kind === 'city' ? place.r.longitude : center(place.feature).lng;
  const [wx, aq] = await Promise.all([
    terraFetch('openmeteo', { query: { latitude: lat, longitude: lng, current: 'temperature_2m,apparent_temperature,weather_code,wind_speed_10m,uv_index', daily: 'temperature_2m_max,temperature_2m_min,precipitation_probability_max,uv_index_max,weather_code,sunrise,sunset', timezone: 'auto', forecast_days: 1 } }),
    terraFetch('openmeteo_aq', { query: { latitude: lat, longitude: lng, current: 'european_aqi' } })
  ]);
  const c = (wx && wx.current) || {}, d = (wx && wx.daily) || {};
  const rain = (d.precipitation_probability_max && d.precipitation_probability_max[0]) || 0;
  const uv = (d.uv_index_max && d.uv_index_max[0]) || c.uv_index || 0;
  const feels = c.apparent_temperature ?? c.temperature_2m ?? 0;
  const aqi = aq && aq.current && aq.current.european_aqi;

  const answers = [
    ['☂️ Take an umbrella?', rain >= 40 ? `Yes — there’s about a <b>${Math.round(rain)}%</b> chance of rain.` : `Probably not needed — rain chance is around <b>${Math.round(rain)}%</b>. We count 40% or more as “take one”.`],
    ['🧥 Wear a jacket?', feels < 15 ? `Yes — it feels like <b>${Math.round(feels)}°</b> outside.` : `No jacket needed — it feels like <b>${Math.round(feels)}°</b>. We suggest a jacket below 15°.`],
    ['🏃 Good for a run?', (aqi == null || aqi <= 60) && feels <= 28 && rain < 40 ? 'Yes — the air is fine and the temperature is comfortable.'
      : aqi > 60 ? `Maybe not — the air quality is ${AQ(aqi)} (AQI ${Math.round(aqi)}). We call ≤ 60 fine for exercise.` : `It’s ${feels > 28 ? 'quite hot' : 'likely to rain'} — go easy.`],
    ['🧴 Do I need sunscreen?', uv >= 6 ? `Yes — the UV index reaches <b>${uv.toFixed(1)}</b> today. We say sunscreen at UV 6 or higher.` : `Not essential — UV peaks around <b>${uv.toFixed(1)}</b>. Below 6 is low risk for most people.`]
  ];
  let h = `<div class="hero" style="background:linear-gradient(135deg,#173049,#0d3a52)"><button id="x">✕</button><div class="in"><div>
    <h2>${esc(place.name)}</h2><p>${WX(c.weather_code)} · feels ${Math.round(feels)}°</p></div></div></div>`;
  h += card('Should I…?', answers.map(([q2, a]) => `<div class="ex" style="margin:9px 0"><b>${q2}</b> ${a}</div>`).join(''));
  h += card('Sun & moon', `<div class="grid">
    <div class="k"><small>Sunrise</small><b>${d.sunrise ? esc(String(d.sunrise[0]).slice(11, 16)) : '—'}</b></div>
    <div class="k"><small>Sunset</small><b>${d.sunset ? esc(String(d.sunset[0]).slice(11, 16)) : '—'}</b></div>
    <div class="k"><small>UV max</small><b>${uv.toFixed(1)}</b></div>
    <div class="k"><small>Moon</small><b style="font-size:13px">${moonPhase(new Date())}</b></div></div>`);
  h += card('Air quality', aqi != null
    ? `<div class="ex">The air is <b>${AQ(aqi)}</b> right now (AQI ${Math.round(aqi)}). ${aqi > 100 ? 'Sensitive groups should limit time outside.' : 'Nothing to worry about for most people.'}</div>`
    : `<div class="ex">Air quality data is not available here right now.</div>`);
  h += `<div class="sec"><div class="ex" style="font-size:11px">${esc(disclaimer.data)} ${esc(disclaimer.advice)}</div></div>`;
  h += `<div class="sec"><button class="btn" id="homeBtn">⌂ Home</button></div>`;
  $('#panel').innerHTML = h; xBtn(closeP);
  $('#homeBtn').onclick = showHome;
}

/* ================================ 🆘 SAFETY & ALERTS ================================ */
async function openSafety(q) {
  const place = await resolvePlace(q);
  if (!place) return openPanel(hint('Place not found', 'Try another spelling.'));
  openPanel(`<div class="sec" style="border:0;padding:24px"><button id="x">✕</button><div style="font:700 19px Inter">🆘 Safety in ${esc(place.name)}</div></div><div class="sk"></div>`);
  const lat = place.kind === 'city' ? place.r.latitude : center(place.feature).lat;
  const lng = place.kind === 'city' ? place.r.longitude : center(place.feature).lng;
  const iso = (place.kind === 'city' ? (place.r.country_code || '') : (D.countries.find(c => c.cca3 === place.iso) || {}).cca2 || place.iso || '').toUpperCase();
  const em = sData('emergency_numbers').find(e => e.cca2 === iso);
  const aq = await terraFetch('openmeteo_aq', { query: { latitude: lat, longitude: lng, current: 'european_aqi' } });

  const nearQuakes = (D.quakes || []).filter(q2 => q2.mag >= 2.5 && haversine({ lat, lng }, q2) < 300)
    .sort((a, b) => b.mag - a.mag).slice(0, 5);
  const nearHaz = (D.hazards || []).filter(e2 => haversine({ lat, lng }, e2) < 500).slice(0, 6);
  const aqi = aq && aq.current && aq.current.european_aqi;

  let h = '';
  if (em) {
    const n = em.numbers.single || em.numbers.police;
    h += card(`Emergency number ${chip('as of ' + sAsOf('emergency_numbers'), em.source_url)}`,
      `<div style="font:700 42px Inter;letter-spacing:-.02em">${esc(n || '—')}</div>
       <div class="ex">${Object.entries(em.numbers).filter(([k]) => k !== 'single').map(([k, v]) => `${k}: <b>${esc(v)}</b>`).join(' · ')}</div>`);
  } else {
    h += card('Emergency numbers', `<div class="ex">We don’t have verified numbers here — <b>check official sources</b>. In many countries 112 or 911 works.</div>`);
  }

  h += card('Recent earthquakes (last 7 days, within 300 km)', nearQuakes.length
    ? nearQuakes.map(q2 => `<div class="row"><span class="nm" style="width:auto;flex:1;color:var(--txt)">M ${q2.mag.toFixed(1)} · ${esc(q2.place || '')}</span><span class="vl">${ago(q2.t)}</span></div>`).join('')
    : `<div class="ex">None of note — nothing over M2.5 has been recorded near here this week.</div>`);

  h += card('Active hazards within 500 km', nearHaz.length
    ? nearHaz.map(e2 => `<div class="row"><span class="nm" style="width:auto;flex:1;color:var(--txt)">${esc(e2.cat)} · ${esc(e2.title)}</span><span class="vl" style="width:auto">${esc(e2.src || '')}</span></div>`).join('')
    : `<div class="ex">No active fires, storms, floods or volcanoes are reported near here right now.</div>`);

  h += card('Air quality', aqi != null
    ? `<div class="ex">The air is <b>${AQ(aqi)}</b> (AQI ${Math.round(aqi)}). ${aqi > 100 ? 'Consider limiting hard exercise outside.' : 'Fine for most people.'}</div>`
    : `<div class="ex">No air-quality data here right now.</div>`);

  h += `<div class="sec"><div class="ex" style="font-size:11.5px"><b>Follow your local authorities for official warnings.</b> ${esc(disclaimer.data)} ${esc(disclaimer.verify)}</div></div>`;
  h += `<div class="sec"><button class="btn" id="homeBtn">⌂ Home</button></div>`;
  $('#panel').innerHTML = h; xBtn(closeP);
  $('#homeBtn').onclick = showHome;
}

/* ================================ 🛡️ IS THIS WEBSITE SAFE? ================================ */
async function openWebsiteCheck(domainRaw) {
  const domain = String(domainRaw).trim().toLowerCase().replace(/^https?:\/\//, '').split('/')[0];
  if (!TERRA_NET.toolAllowed()) { toast('Slow down a little — try again in a minute'); return; }
  openPanel(`<div class="sec" style="border:0;padding:24px"><button id="x">✕</button>
    <div style="font:700 19px Inter">🛡️ Checking ${esc(domain)}…</div><p class="ex">Name, registration and hosting — one moment.</p></div><div class="sk"></div>`);

  const flags = [], notes = [];
  const isPuny = domain.startsWith('xn--') || /\.xn--/.test(domain);
  const brandHit = brandLookalike(domain);
  const rdap = await terraFetch('rdap_domain', { path: { domain } });
  const gA = await terraFetch('doh_google', { query: { name: domain, type: 'A' } });
  const firstA = gA && (gA.Answer || []).map(a => a.data)[0];
  const ipinfo = firstA ? await terraFetch('ipwho', { path: { ip: firstA } }) : null;

  if (isPuny) flags.push(['bad', 'This name uses special international characters (punycode). Lookalike names often hide behind them — check the address bar carefully.']);
  if (brandHit) flags.push(['bad', `This name looks like <b>${esc(brandHit.brand)}</b> (${esc(brandHit.domain)}) but is not the real one. Lookalike names are often used in scams.`]);

  let ageDays = null;
  if (rdap && rdap.events) {
    const created = (rdap.events.find(e => e.eventAction === 'registration' || e.eventAction === 'registrar') || {}).eventDate;
    if (created) ageDays = Math.round((Date.now() - new Date(created)) / 86400000);
  }
  if (ageDays != null && ageDays < 30) flags.push(['warn', `The name was registered only <b>${ageDays} days ago</b>. Very new sites are more often used in scams — be careful.`]);
  if (rdap && rdap.status && rdap.status.length) notes.push(`Registration status: ${rdap.status.map(esc).join(' · ')}.`);
  if (ipinfo) notes.push(`Hosted roughly in <b>${esc([ipinfo.city, ipinfo.country].filter(Boolean).join(', ') || 'unknown')}</b> (IP geolocation is approximate).`);

  const verdict = flags.some(f => f[0] === 'bad') ? ['#ff5a5f', 'We found warning signs — be very careful.']
    : flags.length ? ['#ffb020', 'Some things deserve a closer look.']
      : ['#3ddc97', 'We found no warning signs in the name, registration and hosting.'];

  let h = `<div class="hero" style="background:linear-gradient(135deg,#152238,#0c2c40)"><button id="x">✕</button>
    <div class="in"><div><h2>${esc(domain)}</h2><p>Website check</p></div></div></div>`;
  h += card('The short answer', `<div style="display:flex;align-items:center;gap:12px">
    <div style="width:16px;height:16px;border-radius:50%;background:${verdict[0]};box-shadow:0 0 12px ${verdict[0]}"></div>
    <div style="font:600 15px Inter">${verdict[1]}</div></div>
    ${flags.map(([k, t]) => `<div class="ex" style="margin-top:8px;color:${k === 'bad' ? '#ff8a8f' : '#ffd28a'}">${t}</div>`).join('')}
    ${plain(ageDays != null ? `This website’s name ${ageDays < 30 ? 'is very new' : `is about ${Math.round(ageDays / 36.5) / 10} years old`}. ${ageDays < 30 ? 'New sites aren’t automatically bad, but be careful.' : 'Older names are a small good sign — but scammers use old names too.'}` : 'We could not check the age of this name right now.')}`);
  h += card('What we checked', `<div class="ex">
    ${notes.map(n => `<div style="margin:6px 0">• ${n}</div>`).join('') || 'Nothing more to report.'}
    <div style="margin:6px 0">• Certificate and HTTPS details can’t be checked from here — run <b>TLS certificate</b> in the 🛰️ Network Lab tab for that.</div></div>`);
  h += card('Please read this', `<div class="ex" style="color:#ffd28a"><b>We can’t prove a site is safe.</b> If it asks for passwords, card numbers or urgent payment, stop and go to the company’s official site yourself — type the address yourself or use an official app.
    <div style="margin-top:10px;font-size:11.5px">Report a scam: <a href="https://reportfraud.ftc.gov/" target="_blank" rel="noopener" style="color:var(--acc)">FTC (US)</a> · <a href="https://www.econsumer.gov/" target="_blank" rel="noopener" style="color:var(--acc)">eConsumer (international)</a> · <a href="https://www.actionfraud.police.uk/" target="_blank" rel="noopener" style="color:var(--acc)">Action Fraud (UK)</a></div>
    <div style="margin-top:8px">${esc(disclaimer.advice)}</div></div>`);
  h += `<div class="sec"><button class="btn" id="homeBtn">⌂ Home</button></div>`;
  $('#panel').innerHTML = h; xBtn(closeP);
  $('#homeBtn').onclick = showHome;
}

function brandLookalike(domain) {
  const dom = domain.replace(/^www\./, '');
  for (const b of sData('brands')) {
    const real = b.domain.replace(/^www\./, '');
    if (dom === real) return null;                        // it IS the brand — no warning
    if (dom.startsWith('xn--')) continue;
    const strip = s => s.replace(/[^a-z0-9]/g, '');
    const d1 = strip(dom.split('.')[0]), r1 = strip(real.split('.')[0]);
    if (r1.length > 3 && d1 !== r1) {
      /* lookalike: levenshtein ≤ 2 on the label, or digit/letter substitution */
      if (lev(d1, r1) <= 2 && Math.abs(d1.length - r1.length) <= 2) return b;
    }
    if (dom.includes(real.replace('.', '')) && dom !== real) return b;
  }
  return null;
}
function lev(a, b) {
  const m = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 0; j <= b.length; j++) m[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      m[i][j] = Math.min(m[i - 1][j] + 1, m[i][j - 1] + 1, m[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return m[a.length][b.length];
}

/* ================================ 📡 IS IT DOWN, OR JUST ME? ================================ */
async function openIsDown(domainRaw) {
  const domain = String(domainRaw).trim().toLowerCase().replace(/^https?:\/\//, '').split('/')[0];
  openPanel(`<div class="sec" style="border:0;padding:24px"><button id="x">✕</button>
    <div style="font:700 19px Inter">📡 Checking ${esc(domain)}…</div><p class="ex">One moment.</p></div>`);
  /* network-level probe via net.js: no-cors fetch succeeds if the server answers at all */
  const up = await TERRA_NET.probe(`https://${domain}/`);
  const dns = await terraFetch('doh_google', { query: { name: domain, type: 'A' } });
  const hasDns = dns && (dns.Answer || []).length > 0;

  let answer;
  if (up) answer = `<b style="color:#3ddc97">It’s up for us</b> — so the problem is probably on your side: try restarting your router, or open the page in a private window.`;
  else if (!hasDns) answer = `<b style="color:#ffb020">The name doesn’t resolve</b> — the address may be wrong or the site’s DNS is broken.`;
  else answer = `<b style="color:#ffb020">We couldn’t reach it from here</b> — that can mean it’s down, or that it blocks visitors like us. Try again in a minute.`;

  let h = `<div class="hero" style="background:linear-gradient(135deg,#152238,#0c2c40)"><button id="x">✕</button><div class="in"><div><h2>${esc(domain)}</h2><p>Is it down?</p></div></div></div>`;
  h += card('The short answer', `<div class="ex" style="font-size:14px">${answer}</div>`);
  h += card('What we saw', `<div class="ex">
    • The site ${up ? 'answered' : 'did not answer'} our request.<br>
    • Its DNS records ${hasDns ? 'exist' : 'were not found'}.<br>
    • ${esc(disclaimer.data)}</div>`);
  h += card('About you', `<button class="btn" id="myconn">Show my connection (click to check)</button>
    <div class="ex" style="margin-top:8px;font-size:11px">We only look this up when you click — nothing is stored.</div>`);
  h += `<div class="sec"><button class="btn" id="homeBtn">⌂ Home</button></div>`;
  $('#panel').innerHTML = h; xBtn(closeP);
  $('#homeBtn').onclick = showHome;
  $('#myconn').onclick = myConnection;
}

/* ================================ 🕐 GOOD TIME TO CALL? ================================ */
async function openCallTime(q) {
  const place = await resolvePlace(q);
  if (!place) return openPanel(hint('Place not found', 'Try another spelling.'));
  const lat = place.kind === 'city' ? place.r.latitude : center(place.feature).lat;
  const lng = place.kind === 'city' ? place.r.longitude : center(place.feature).lng;
  const wx = await terraFetch('openmeteo', { query: { latitude: lat, longitude: lng, current: 'temperature_2m,weather_code,is_day', timezone: 'auto' } });
  const tz = (wx && wx.timezone) || (place.r && place.r.timezone) || 'UTC';
  renderCallTime([{ name: place.name, tz }]);
}

function renderCallTime(places) {
  const rows = places.map(p => {
    const now = new Date();
    const hhmm = new Intl.DateTimeFormat('en', { timeZone: p.tz, hour: '2-digit', minute: '2-digit', hour12: false }).format(now);
    const [h, m] = hhmm.split(':').map(Number);
    const [color, label] = trafficLight(h, m);
    const day = new Intl.DateTimeFormat('en', { timeZone: p.tz, weekday: 'long' }).format(now);
    return { ...p, hhmm, color, label, day };
  });
  let h = `<div class="hero" style="background:linear-gradient(135deg,#173049,#0d3a52)"><button id="x">✕</button><div class="in"><div><h2>🕐 Good time to call?</h2><p>Local times right now</p></div></div></div>`;
  h += card('Their day', rows.map(r => `<div class="row">
    <span class="nm" style="width:auto;flex:1;color:var(--txt);font-size:14px">${esc(r.name)} · ${esc(r.day)}</span>
    <span style="width:64px;text-align:right;font:600 15px Inter">${esc(r.hhmm)}</span>
    <span style="width:14px;height:14px;border-radius:50%;background:${r.color};margin-left:10px" title="${esc(r.label)}"></span></div>`).join('') +
    rows.map(r => `<div class="ex" style="font-size:11.5px"><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${r.color}"></span> ${esc(r.name)}: ${esc(r.label)}</div>`).join(''));
  h += card('Add more places (meeting finder)', `<div style="display:flex;gap:8px">
    <input id="callAdd" placeholder="add a city" style="flex:1;background:rgba(255,255,255,.05);border:1px solid var(--line);border-radius:8px;color:var(--txt);padding:10px;font:500 12px Inter">
    <button class="btn" id="callGo" style="width:auto;padding:10px 14px">Add</button></div>
    <div class="ex" id="meetOut" style="margin-top:10px"></div>`);
  h += `<div class="sec"><button class="btn" id="homeBtn">⌂ Home</button></div>`;
  openPanel(h);
  $('#homeBtn').onclick = showHome;
  const add = async () => {
    const v = $('#callAdd').value.trim(); if (!v) return;
    const p = await resolvePlace(v);
    if (!p) { $('#meetOut').textContent = 'Place not found.'; return; }
    let tz = p.kind === 'city' ? p.r.timezone : null;
    if (!tz) {
      const c = p.kind === 'country' ? center(p.feature) : null;
      const wx2 = c ? await terraFetch('openmeteo', { query: { latitude: c.lat, longitude: c.lng, current: 'temperature_2m', timezone: 'auto' } }) : null;
      tz = (wx2 && wx2.timezone) || 'UTC';
    }
    renderCallTime([...places, { name: p.name, tz }]);
  };
  $('#callGo').onclick = add;
  $('#callAdd').addEventListener('keydown', e => { if (e.key === 'Enter') add(); });
}

/* ================================ 💱 MONEY ================================ */
function openMoney(amount, from, to) {
  const codes = Object.keys((D.fx && D.fx.rates) || {}).sort();
  const sel = (id, chosen) => `<select id="${id}" style="background:rgba(255,255,255,.05);border:1px solid var(--line);border-radius:8px;color:var(--txt);padding:10px;font:500 13px Inter">
    ${codes.map(c => `<option ${c === chosen ? 'selected' : ''}>${c}</option>`).join('')}</select>`;
  let h = `<div class="hero" style="background:linear-gradient(135deg,#173049,#0d3a52)"><button id="x">✕</button><div class="in"><div><h2>💱 Money</h2><p>Daily rates snapshot · ${esc(String((D.fx && D.fx.date) || ''))}</p></div></div></div>`;
  h += card('Convert', `<div style="display:flex;gap:8px;align-items:center">
    <input id="mAmt" value="${esc(String(amount || 100))}" style="width:100px;background:rgba(255,255,255,.05);border:1px solid var(--line);border-radius:8px;color:var(--txt);padding:10px;font:600 15px Inter">
    ${sel('mFrom', from)} <span style="color:var(--dim)">→</span> ${sel('mTo', to)}</div>
    <div class="ex" id="mOut" style="margin-top:12px;font-size:16px"></div>`);
  h += card('What it feels like', `<div class="ex" id="mBig"></div>`);
  h += `<div class="sec"><div class="ex" style="font-size:11px">Rates are a daily snapshot and can differ from your bank’s. ${esc(disclaimer.advice)}</div></div>`;
  h += `<div class="sec"><button class="btn" id="homeBtn">⌂ Home</button></div>`;
  openPanel(h);
  const calc = () => {
    const amt = parseFloat($('#mAmt').value) || 0, f = $('#mFrom').value, t = $('#mTo').value;
    const out = fx(amt, f, t);
    $('#mOut').innerHTML = out != null
      ? `<b>${esc(String(amt))} ${esc(f)}</b> = <b style="color:#9fd8c0">${out.toFixed(out < 10 ? 3 : 2)} ${esc(t)}</b>`
      : 'Rates unavailable right now.';
    const bmT = D.bigmac && D.bigmac.rows && D.bigmac.rows[t], bmF = D.bigmac && D.bigmac.rows && D.bigmac.rows[f];
    $('#mBig').innerHTML = (bmT && bmF && out) ? `Roughly <b>${(out / bmT.local).toFixed(1)} Big Macs</b> in ${esc(t)} vs <b>${(amt / bmF.local).toFixed(1)}</b> in ${esc(f)} — as of ${esc(String(D.bigmac.as_of || ''))}.` : '';
  };
  ['mAmt', 'mFrom', 'mTo'].forEach(id => $('#' + id).addEventListener('input', calc));
  calc();
  $('#homeBtn').onclick = showHome;
}

/* ================================ 📰 WHAT’S HAPPENING ================================ */
async function openHeadlines(place) {
  const world = (D.news && D.news.items) || [];
  const pubs = [...new Set(world.map(i => i.pub))];
  let h = `<div class="hero" style="background:linear-gradient(135deg,#152238,#0c2c40)"><button id="x">✕</button><div class="in"><div><h2>📰 What’s happening</h2><p>Headlines from publishers</p></div></div></div>`;
  h += card('TERRA shows what outlets report; it does not verify it. Compare sources.',
    `<div class="seg" id="pubFilter"><button class="on" data-p="">All</button>${pubs.map(p => `<button data-p="${esc(p)}">${esc(p)}</button>`).join('')}</div>
     <div id="newsList">${newsListHTML(world)}</div>
     <div class="ex" style="margin-top:8px;font-size:11px">Only headlines — title, publisher, time and a link to the original. Nothing is copied or summarised.</div>`);

  const quakes = (D.quakes || []).slice().sort((a, b) => b.mag - a.mag).slice(0, 1);
  const haz = (D.hazards || []).length;
  h += card('Also worth knowing', `
    ${quakes.map(q2 => `<div class="ex" style="margin:6px 0">🌍 Largest earthquake this week: <b>M ${q2.mag.toFixed(1)}</b> — ${esc(q2.place || '')}</div>`).join('')}
    <div class="ex" style="margin:6px 0">🌪️ ${haz} active natural ${haz === 1 ? 'event' : 'events'} tracked right now.</div>
    <div class="ex" style="margin:6px 0">🛰️ The ISS passes overhead constantly — see the white dot on the globe.</div>`);

  h += card('What happened today in history', `<div class="ex" id="otd">Loading…</div>`);
  h += card('News about one place', `<div style="display:flex;gap:8px">
    <input id="gdIn" placeholder="country, city or topic" style="flex:1;background:rgba(255,255,255,.05);border:1px solid var(--line);border-radius:8px;color:var(--txt);padding:10px;font:500 12px Inter">
    <button class="btn" id="gdGo" style="width:auto;padding:10px 14px">Search</button></div><div id="gdOut" style="margin-top:10px"></div>`);
  h += `<div class="sec"><button class="btn" id="homeBtn">⌂ Home</button></div>`;
  openPanel(h);
  $('#homeBtn').onclick = showHome;

  $$('#pubFilter button').forEach(b => b.onclick = () => {
    $$('#pubFilter button').forEach(x => x.classList.toggle('on', x === b));
    $('#newsList').innerHTML = newsListHTML(b.dataset.p ? world.filter(i => i.pub === b.dataset.p) : world);
  });

  /* On this day (Wikimedia feed) */
  const now = new Date();
  const otd = await terraFetch('onthisday', { path: { mm: String(now.getMonth() + 1).padStart(2, '0'), dd: String(now.getDate()).padStart(2, '0') } });
  const events = (otd && (otd.selected || otd.all) || []).slice(0, 3);
  $('#otd').innerHTML = events.length
    ? events.map(e => `<div style="margin:6px 0"><b>${esc(String(e.year))}</b> — ${esc((e.text || '').slice(0, 160))} ${chip('Wikipedia', 'CC BY-SA')}</div>`).join('')
    : 'Unavailable right now.';

  /* GDELT "this place" — on demand only (§4.7) */
  $('#gdGo').onclick = async () => {
    const v = $('#gdIn').value.trim(); if (!v) return;
    $('#gdOut').innerHTML = '<div class="ex">Searching headlines…</div>';
    const g = await terraFetch('gdelt', {
      query: { query: v, mode: 'artlist', maxrecords: 8, format: 'json', sort: 'datedesc', timespan: '24h' }
    });
    const arts = (g && g.articles) || [];
    $('#gdOut').innerHTML = arts.length
      ? newsListHTML(arts.map(a => ({ t: a.title, url: a.url, pub: a.domain || 'publisher', ts: 0 })).slice(0, 8)) +
      `<div class="ex" style="font-size:11px;margin-top:6px">Source: GDELT Project. ${esc(disclaimer.data)}</div>`
      : '<div class="ex">Headlines are unavailable right now.</div>';
  };
}

function newsListHTML(items) {
  if (!items.length) return '<div class="ex">Headlines are unavailable right now.</div>';
  return items.map(i => `<div class="row" style="align-items:flex-start">
    <span style="flex:1"><a href="${esc(i.url)}" target="_blank" rel="noopener" style="color:var(--txt);text-decoration:none;font-size:12.5px">${esc(i.t)}</a>
      <small style="display:block;color:var(--dim);margin-top:2px">${esc(i.pub)}${i.ts ? ' · ' + ago(i.ts * 1000) : ''}</small></span></div>`).join('');
}

/* ================================ 🛰️ TODAY (§6.8) ================================ */
async function openToday() {
  let h = `<div class="hero" style="background:linear-gradient(135deg,#0d2038,#132c4a)"><button id="x">✕</button><div class="in"><div><h2>🛰️ Today</h2><p>${esc(new Date().toDateString())}</p></div></div></div>`;

  /* next launch + space weather */
  const l = (D.launches || [])[0];
  const kp = D.space && D.space.kp;
  h += card('Space', `<div class="grid">
    ${l ? `<div class="k"><small>Next launch</small><b style="font-size:12px">${esc(l.name || '')}</b><small style="display:block;color:var(--dim)">${esc(String(l.net || ''))} · ${esc(l.status || '')}</small></div>` : '<div class="k"><small>Next launch</small><b>—</b></div>'}
    ${kp ? `<div class="k"><small>Geomagnetic activity ${chip('NOAA SWPC', 'US Government public domain')}</small><b>Kp ${kp.kp.toFixed(1)}</b><small style="display:block;color:var(--dim)">${kp.kp >= 5 ? 'Storm level — aurora possible at lower latitudes' : kp.kp >= 3 ? 'Active — aurora likely at high latitudes' : 'Quiet — aurora only near the poles'}</small></div>` : ''}
    ${(D.launches || []).slice(1, 3).map(x => `<div class="k"><small>Also coming up</small><b style="font-size:12px">${esc((x.name || '').slice(0, 40))}</b><small style="display:block;color:var(--dim)">${esc(String(x.net || ''))}</small></div>`).join('')}
  </div>
  ${l ? `<div class="ex" style="margin-top:8px;font-size:11px">${chip('Launch Library 2', 'The Space Devs · free tier')} Launch times are UTC.</div>` : ''}`);

  /* featured article + picture of the day */
  const now = new Date();
  const fdate = new Date(now.getTime() - 86400000);
  const feat = await terraFetch('wiki_featured', {
    path: { yyyy: String(fdate.getUTCFullYear()), mm: String(fdate.getUTCMonth() + 1).padStart(2, '0'), dd: String(fdate.getUTCDate()).padStart(2, '0') }
  });
  const fa = feat && feat.tfa, potd = feat && feat.image;
  h += card('Featured article & picture of the day', `${
    fa ? `<div class="ex"><b>${esc(fa.title || '')}</b> — ${esc((fa.extract || '').slice(0, 200))}…
      ${fa.content_urls ? `<a href="${esc(fa.content_urls.desktop.page)}" target="_blank" rel="noopener" style="color:var(--acc)">Read on Wikipedia ↗</a>` : ''} ${chip('Wikipedia', 'CC BY-SA')}</div>` : '<div class="ex">Unavailable right now.</div>'}
    ${potd && potd.thumbnail ? `<img src="${esc(potd.thumbnail.source)}" alt="Picture of the day" style="width:100%;border-radius:10px;margin-top:10px"><div class="ex" style="font-size:10.5px;margin-top:4px">${esc(potd.title || '')} · image licence varies — see Wikimedia</div>` : ''}`);

  /* largest quake + aurora chance */
  const q = (D.quakes || []).slice().sort((a, b) => b.mag - a.mag)[0];
  h += card('Earth & sky', `
    ${q ? `<div class="ex" style="margin:6px 0">🌍 Largest quake this week: <b>M ${q.mag.toFixed(1)}</b> — ${esc(q.place || '')}</div>` : ''}
    ${kp ? `<div class="ex" style="margin:6px 0">🌌 Aurora chance today: <b>${kp.kp >= 5 ? 'high at mid-latitudes' : kp.kp >= 3 ? 'good at high latitudes' : 'poles only'}</b> (Kp ${kp.kp.toFixed(1)}). Toggle the Aurora layer on the globe!</div>` : ''}
    <div class="ex" style="margin:6px 0">🌙 Moon tonight: <b>${moonPhase(new Date())}</b> (calculated locally)</div>`);
  h += `<div class="sec"><button class="btn" id="homeBtn">⌂ Home</button></div>`;
  openPanel(h);
  $('#homeBtn').onclick = showHome;
}

/* ================================ 🎓 LEARN & PLAY ================================ */
function openLearn() {
  const cs = (D.countries || []).filter(c => c.cca2 && c.capital);
  const seed = Math.floor(Date.now() / 86400000);
  const pick = i => cs[(seed * 31 + i * 977) % cs.length];
  const totalPop = Object.values(D.values.pop || {}).reduce((s, a) => s + (a[0] || 0), 0);
  const top = Object.entries(D.values.pop || {}).sort((a, b) => b[1][0] - a[1][0]).slice(0, 3)
    .map(([iso, v]) => ({ name: (D.countries.find(c => c.cca3 === iso) || {}).name || iso, pct: v[0] / totalPop * 100 }));

  let h = `<div class="hero" style="background:linear-gradient(135deg,#173049,#0d3a52)"><button id="x">✕</button><div class="in"><div><h2>🎓 Learn & play</h2><p>Daily challenge + world facts</p></div></div></div>`;

  h += card('Daily flag challenge', quizHTML('flag', pick(0), pick(1), pick(2), pick(3)));
  h += card('Daily capital challenge', quizHTML('capital', pick(4), pick(5), pick(6), pick(7)));
  if (top.length) h += card('If the world were 100 people', top.map(t =>
    `<div class="ex" style="margin:6px 0">• <b>${esc(t.name)}</b> would be about <b>${Math.round(t.pct)} of them</b>.</div>`).join('') +
    `<div class="ex" style="font-size:11px">${chip('World Bank', 'Population · CC BY 4.0 · lags 1–2 years')}</div>`);
  h += `<div class="sec" style="display:flex;gap:8px"><button class="btn" id="printFacts">Print school factsheet</button><button class="btn" id="homeBtn">⌂ Home</button></div>`;
  openPanel(h);
  $('#homeBtn').onclick = showHome;
  $('#printFacts').onclick = () => window.print();
  bindQuiz();
}

function quizHTML(kind, right, ...wrong) {
  const opts = [right, ...wrong].sort((a, b) => (a.name > b.name ? 1 : -1));
  const ask = kind === 'flag'
    ? `<img src="${esc(flagUrl(right.cca2))}" style="width:110px;border-radius:8px" alt="flag of the mystery country">`
    : `<div style="font:600 16px Inter">What is the capital of ${esc(right.name)}?</div>`;
  return `<div class="quizBox">${ask}<div style="display:flex;flex-direction:column;gap:6px;margin-top:10px">
    ${opts.map(o => `<button class="btn quiz" data-ok="${o.name === right.name}" data-right="${esc(right.name)}"
      data-cap="${esc(right.capital)}">${esc(kind === 'flag' ? o.name : o.capital)}</button>`).join('')}
    </div><div class="ex quizOut" style="margin-top:8px"></div>
    <div class="ex" style="font-size:11px;margin-top:6px">Find it on the globe: search <b>${esc(right.name)}</b> and fly there! ${chip('REST Countries', 'public API')}</div></div>`;
}
function bindQuiz() {
  $$('.quizBox').forEach(box => box.querySelectorAll('.quiz').forEach(b => b.onclick = () => {
    const out = box.querySelector('.quizOut');
    if (!out) return;
    out.innerHTML = b.dataset.ok === 'true'
      ? '✅ Correct!'
      : `❌ Not quite — it’s <b>${esc(b.dataset.cap)}</b> (${esc(b.dataset.right)}).`;
  }));
}

/* ================================ 📍 AROUND ME ================================ */
function openAroundMe() {
  openPanel(`<div class="sec" style="border:0;padding:24px"><button id="x">✕</button>
    <div style="font:700 19px Inter">📍 Around me</div>
    <p class="ex">We ask your device for your location <b>only when you tap the button</b>. It is used for the weather and place lookups, never stored.</p>
    <button class="btn" id="geoBtn" style="margin-top:12px">Use my location</button>
    <div class="ex" id="geoOut" style="margin-top:10px"></div></div>`);
  $('#geoBtn').onclick = () => {
    if (!navigator.geolocation) { $('#geoOut').textContent = 'Location is not available in this browser — type a city instead.'; return; }
    $('#geoOut').textContent = 'Asking your device…';
    navigator.geolocation.getCurrentPosition(
      pos => { openPointCard(pos.coords.latitude, pos.coords.longitude); },
      () => { $('#geoOut').textContent = 'We could not get your location. Type a city instead.'; },
      { timeout: 10000, maximumAge: 300000 });
  };
}
