/* layers.js — live point layers (WebGL only — no DOM markers, so panning stays smooth).
   Hazards is ONE merged layer (EONET + GDACS de-duplicated, §4.6) with a source badge. */
const MAGC = m => m >= 6 ? '#ff4d6d' : m >= 5 ? '#ff7a45' : m >= 4 ? '#ffb347' : '#ffe08a';
const EVC = {
  'Wildfires': '#ff6b3d', 'Severe Storms': '#7cc4ff', 'Volcanoes': '#ff3d6b', 'Floods': '#4aa3ff',
  'Sea and Lake Ice': '#bfe9ff', 'Drought': '#d9a45b', 'Dust and Haze': '#c9b28a', 'Landslides': '#a58a6b',
  'Snow': '#e6f2ff', 'Temperature Extremes': '#ff9a3c', 'Earthquakes': '#ff7a45', 'Hazards': '#f2c55c'
};

const P_Q = D.quakes.filter(q => q.mag >= 3).sort((a, b) => b.mag - a.mag).slice(0, 280).map(q => ({
  lat: q.lat, lng: q.lng, alt: .004 + q.mag * .0032, r: .09 + q.mag * .04, col: MAGC(q.mag),
  tip: `<b>M ${q.mag.toFixed(1)} earthquake</b><div class="s">${esc(q.place || '')}</div><div class="s">${ago(q.t)}</div>`
}));
const P_E = (D.hazards || []).map(e => ({
  lat: e.lat, lng: e.lng, alt: .006, r: .26, col: EVC[e.cat] || '#f2c55c',
  tip: `<b>${esc(e.title)}</b><div class="s">${esc(e.cat)}</div><div class="s">${esc(e.src || '')}</div>`
}));
const P_A = D.aqi.map(c => ({
  lat: c.lat, lng: c.lng, alt: .004, r: .4, col: aqc(c.aqi),
  tip: `<b>${esc(c.name)}</b><div class="v" style="color:${aqc(c.aqi)}">AQI ${Math.round(c.aqi)} · ${AQ(c.aqi)}</div><div class="s">European index, now</div>`
}));
const iss = { lat: 0, lng: 0, alt: .07, r: .5, col: '#ffffff', on: false, tip: '<b>International Space Station</b>' };

/* aurora oval (NOAA SWPC ovation) — intensity-scaled green points */
const P_AR = ((D.space && D.space.aurora) || []).map(a => ({
  lat: a.lat, lng: a.lng, alt: .006, r: .18 + (a.v / 100) * .3,
  col: `rgba(90,${180 + Math.round(a.v)},140,.8)`,
  tip: `<b>Aurora forecast</b><div class="s">Aurora chance ${Math.round(a.v)}% · NOAA SWPC</div>`
}));

/* capitals: a small flag standing on each capital, with its weather beside it (free Open-Meteo data) */
const ptip = document.getElementById('ptip');
const HOT = {};     // ISO3 → { n, items } filled by news.js
const capMarkers = () => (D.countries || []).filter(c => c.capital && c.capLatlng && c.capLatlng.length === 2).map(c => ({
  lat: c.capLatlng[0], lng: c.capLatlng[1], iso: c.cca3, name: c.name, capital: c.capital, cca2: c.cca2,
  wx: (D.capwx || {})[c.cca3] || null, hot: HOT[c.cca3] || null
}));
function capEl(d) {
  const el = document.createElement('div'); el.className = 'cap';
  const w = S.wx && d.wx ? d.wx : null;
  el.innerHTML = '<i class="pole"></i>' + (d.cca2 ? `<img class="fl" alt="" src="${esc(flagUrl(d.cca2, 'w40'))}">` : '') +
    (w ? `<b class="wx">${wxEmoji(w[1], w[2])}<u>${w[0]}°</u></b>` : '');
  const hot = S.news && d.hot ? d.hot : null;
  if (hot) { el.classList.add('hot'); el.insertAdjacentHTML('beforeend', `<em class="bd">${hot.n}</em>`); }
  el.onmouseenter = () => {
    ptip.innerHTML = `<b>${esc(d.capital)}</b><div class="s">Capital of ${esc(d.name)}</div>` +
      (w ? `<div class="s">${wxEmoji(w[1], w[2])} ${WX(w[1])} · ${w[0]}°C</div>` : '') +
      (hot ? `<div class="s" style="margin-top:5px;max-width:240px;white-space:normal">📰 ${esc(hot.items[0].t.slice(0, 110))}</div>` : '');
    ptip.style.display = 'block';
  };
  el.onmousemove = e => { ptip.style.left = (e.clientX + 14) + 'px'; ptip.style.top = (e.clientY + 14) + 'px'; };
  el.onmouseleave = () => { ptip.style.display = 'none'; };
  el.onclick = () => {                                   // same as clicking the country
    ptip.style.display = 'none';
    const f = feats.find(x => x.properties.ADM0_A3 === d.iso); if (f) pick(f);
  };
  return el;
}
world.htmlLat('lat').htmlLng('lng').htmlAltitude(.004).htmlElement(capEl).htmlTransitionDuration(0);
if (world.htmlElementVisibilityModifier) world.htmlElementVisibilityModifier((el, vis) => {
  el.style.opacity = vis ? 1 : 0; el.style.pointerEvents = vis ? 'auto' : 'none';
});
/* temperatures appear once you zoom in; from far away it is just flag + weather icon */
let zoomRaf = 0;
world.controls().addEventListener('change', () => {
  if (zoomRaf) return;
  zoomRaf = requestAnimationFrame(() => { zoomRaf = 0; document.body.classList.toggle('zoomed', world.pointOfView().altitude < 1.5); });
});

const pointsList = () => {
  let p = [];
  if (S.quakes) p = p.concat(P_Q);
  if (S.hazards) p = p.concat(P_E);
  if (S.aqi) p = p.concat(P_A);
  if (S.iss && iss.on) p.push(iss);
  if (S.aurora) p = p.concat(P_AR);
  if (window.ipMarker) p.push(window.ipMarker);
  return p;
};

function layers() {
  world.pointsData(pointsList()).ringsData(S.quakes ? D.quakes.filter(q => q.mag >= 5) : []);
  world.htmlElementsData(S.flags ? capMarkers() : []);
  world.arcsData(cmpArc ? [cmpArc] : []);
}

/* per-layer counts + freshness chips (offline → small "offline" note, never a crash) */
function layerCounts() {
  $('#nq').textContent = P_Q.length;
  $('#nh').textContent = P_E.length;
  const nw = Object.keys(D.capwx || {}).length;
  $('#nw').textContent = nw || 'offline';
  if (!nw && S.wx) setToggle('wx', false);              // free weather API unavailable → flags only
  const nn = $('#nn'); if (nn) nn.textContent = Object.keys(HOT).length || '';
  const ncc = $('#nc'); if (ncc) ncc.textContent = capMarkers().length || '';
  $('#na').textContent = P_A.length || 'offline';
  const nar = $('#nar'); if (nar) nar.textContent = P_AR.length || 'quiet';
  const nsp = $('#spaceChip');
  if (nsp && D.space && D.space.kp) nsp.textContent = `Kp ${D.space.kp.kp.toFixed(1)}`;
}
layerCounts();
