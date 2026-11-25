/* globe.js — scene, lens statistics, polygon rendering (baseline behaviour,
   refactored to read asset URLs from sources.yaml and the merged power lens). */
const IMG = {
  dark: D.manifest.assets.earth_dark,
  sat: D.manifest.assets.earth_sat,
  night: D.manifest.assets.earth_night,
  bump: D.manifest.assets.earth_bump,
  sky: D.manifest.assets.night_sky
};
const ALPHA = { dark: .86, sat: .62, night: .72 };
const GEO = D.manifest.assets.countries_geojson;      // pinned Natural Earth 110m copy
const GEO_ALT = D.manifest.assets.countries_geojson_alt;

const S = {
  lens: (D.lenses[0] || {}).id, powerSub: 'renew',
  quakes: false, hazards: false, wx: true, flags: true, news: true, aqi: false, iss: false, aurora: false,
  lensOn: false, relief: false, spin: true, cmp: false, img: 'dark'
};
let hovered = null, sel = null, feats = [];

/* per-lens distribution stats (5th–95th percentile + ranks) over every values key.
   The power-lens subs inherit fmt/log/pal from their parent lens. */
const L = {};
Object.keys(D.values).forEach(id => {
  const parent = D.lenses.find(l => l.id === id || (l.subs || []).some(s => s.id === id));
  const sub = parent && (parent.subs || []).find(s => s.id === id);
  const lensDef = Object.assign({ fmt: 'num', log: false, pal: ['#0a1f3d', '#d9f3d0'] }, parent, sub);
  const v = D.values[id] || {}, tr = x => lensDef.log ? Math.log10(Math.max(x, 1)) : x;
  const e = Object.entries(v).map(([k, a]) => [k, a[0]]), s = e.map(a => tr(a[1])).sort((a, b) => a - b);
  const lo = s[Math.floor(s.length * .05)] ?? 0, hi = s[Math.floor(s.length * .95)] ?? 1;
  const rk = {}; e.sort((a, b) => b[1] - a[1]).forEach((a, i) => rk[a[0]] = i + 1);
  L[id] = { lensDef, tr, lo, hi, rk, n: e.length };
});

/* the active values key: the power lens is a segmented control over 4 indicators (§4.6) */
const lensKeyId = () => S.lens === 'power' ? S.powerSub : S.lens;
const lensDef = () => {
  const l = D.lenses.find(x => x.id === S.lens);
  return S.lens === 'power'
    ? Object.assign({}, l, { label: (l.subs.find(s => s.id === S.powerSub) || {}).label || l.label })
    : l;
};
const cur = () => L[lensKeyId()];
function norm(iso) { const c = cur(), a = D.values[lensKeyId()][iso]; if (!a) return null; return (c.tr(a[0]) - c.lo) / ((c.hi - c.lo) || 1); }
function norm0(id, iso) { const c = L[id], a = (D.values[id] || {})[iso]; return a ? Math.max(.03, Math.min(1, (c.tr(a[0]) - c.lo) / ((c.hi - c.lo) || 1))) : 0; }
const isHi = d => d === hovered || d === sel || d === cmp.a || d === cmp.b;

/* country facts by ISO3 (server payload; browser fetches the dataset itself if the server's fetch failed) */
const CTY = {};
const indexCountries = () => (D.countries || []).forEach(c => { CTY[c.cca3] = c; });
indexCountries();
if (!(D.countries || []).length) {
  terraFetchURL(D.manifest.sources.countries_data.url_template, 604800).then(raw => {
    if (!Array.isArray(raw)) return;
    D.countries = raw.map(c => {
      const cu = Object.entries(c.currencies || {})[0], idd = c.idd || {};
      return {
        name: (c.name || {}).common || '', official: (c.name || {}).official || '', cca2: c.cca2, cca3: c.cca3,
        capital: (c.capital || [])[0] || null, capLatlng: (c.capitalInfo || {}).latlng || null, area: c.area,
        region: c.region, subregion: c.subregion, cur: cu ? cu[0] : null, curName: cu ? cu[1].name : null,
        lang: Object.values(c.languages || {}).slice(0, 3), latlng: c.latlng, tld: (c.tld || [])[0] || null,
        idd: (idd.root || '') + ((idd.suffixes || [''])[0] || '')
      };
    });
    indexCountries();
    if (typeof onCountries === 'function') onCountries();
    if (typeof layerCounts === 'function') layerCounts();
    layers();
    if (sel && !S.cmp) openCountry(sel, true);
  }).catch(() => { });
}

/* ---------- globe ---------- */
const world = Globe()($('#globe'))
  .globeImageUrl(IMG.dark).bumpImageUrl(IMG.bump).backgroundImageUrl(IMG.sky).showGraticules(true)
  .atmosphereColor('#7fa6ff').atmosphereAltitude(0.14)
  .polygonCapColor(d => {
    const n = S.lensOn ? norm(d.properties.ADM0_A3) : null; if (n == null) { const hn = typeof HOT !== 'undefined' && S.news && HOT[d.properties.ADM0_A3]; return isHi(d) ? 'rgba(200,215,240,.30)' : hn ? `rgba(255,120,80,${Math.min(.34, .09 + hn.n * .045)})` : 'rgba(255,255,255,.05)'; }
    const c = ramp(lensDef().pal, n); return `rgba(${c},${isHi(d) ? .98 : ALPHA[S.img]})`;
  })
  .polygonSideColor(() => 'rgba(255,255,255,.05)')
  .polygonStrokeColor(d => d === cmp.a ? '#f2c55c' : d === cmp.b ? '#ee7b8f' : 'rgba(255,255,255,.14)')
  .polygonAltitude(d => {
    const n = S.lensOn ? norm(d.properties.ADM0_A3) : null; const b = S.relief && n != null ? .003 + Math.max(0, Math.min(1, n)) * .04 : .002;
    return b + (isHi(d) ? .012 : 0);
  })
  .polygonsTransitionDuration(250)
  .polygonLabel(d => {
    const p = d.properties, iso = p.ADM0_A3, cty = CTY[iso] || {}, hot = typeof HOT !== 'undefined' && HOT[iso];
    return `<div class="tip"><b>${esc(p.NAME)}</b>${cty.capital ? `<div class="s">Capital · ${esc(cty.capital)}</div>` : ''}${hot ? `<div class="s">📰 ${hot.n} headline${hot.n > 1 ? 's' : ''} right now</div>` : ''}<div class="s" style="margin-top:6px">Click for news &amp; facts</div></div>`;
  })
  .onPolygonHover(d => { hovered = d; redraw(); })
  .onPolygonClick(d => pick(d))
  .pointLat('lat').pointLng('lng').pointAltitude('alt').pointRadius('r').pointColor('col').pointResolution(8)
  .pointsTransitionDuration(250).pointLabel(d => `<div class="tip">${d.tip}</div>`)
  .ringLat('lat').ringLng('lng').ringMaxRadius(d => d.mag * 1.0).ringPropagationSpeed(1.4).ringRepeatPeriod(1800)
  .ringColor(() => t => `rgba(255,122,69,${.8 * (1 - t)})`)
  .arcStartLat('sLat').arcStartLng('sLng').arcEndLat('eLat').arcEndLng('eLng')
  .arcColor(d => d.cmp ? ['#f2c55c', '#ee7b8f'] : ['rgba(124,247,196,0)', 'rgba(190,255,235,.9)'])
  .arcStroke(d => d.cmp ? .6 : .22).arcAltitudeAutoScale(d => d.cmp ? .45 : .1).arcCurveResolution(24).arcCircularResolution(4)
  .arcDashLength(d => d.cmp ? .35 : 1).arcDashGap(d => d.cmp ? .15 : 0).arcDashAnimateTime(d => d.cmp ? 2600 : 0).arcsTransitionDuration(0)
  .arcLabel(d => d.cmp ? '' : `<div class="tip"><b>${esc(d.cs)}</b><div class="s">${esc(d.c)}${d.alt ? ' · ' + (Math.round(d.alt * 3.281 / 100) * 100).toLocaleString() + ' ft' : ''} · ${Math.round(d.v * 3.6)} km/h</div></div>`);
world.renderer().setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));

/* ---------- adaptive quality governor (§7.2): measure fps, auto-step down ---------- */
const QUALITY = {
  Ultra: { dpr: 1.75 }, High: { dpr: 1.5 }, Balanced: { dpr: 1.25 }, Lite: { dpr: 1 }
};
const governor = {
  tier: 'High', frames: 0, t0: performance.now(), lastUp: 0,
  apply() {
    world.renderer().setPixelRatio(Math.min(window.devicePixelRatio || 1, QUALITY[this.tier].dpr));
    try { sessionStorage.setItem('terraQuality', this.tier); } catch (e) { }
  },
  sample() {
    this.frames++;
    const now = performance.now(), dt = now - this.t0;
    if (dt >= 2000) {
      const fps = this.frames / (dt / 1000);
      this.frames = 0; this.t0 = now;
      const order = ['Lite', 'Balanced', 'High', 'Ultra'], i = order.indexOf(this.tier);
      if (fps < 40 && i > 0) { this.tier = order[i - 1]; this.apply(); }
      else if (fps > 55 && i < 3 && now - this.lastUp > 60000) {   // never up more than once/min
        this.tier = order[i + 1]; this.lastUp = now; this.apply();
      }
    }
    requestAnimationFrame(() => this.sample());
  }
};
try {
  const saved = sessionStorage.getItem('terraQuality');
  if (saved && QUALITY[saved]) governor.tier = saved;
  else if (innerWidth < 900) governor.tier = 'Balanced';
} catch (e) { }
governor.apply();
requestAnimationFrame(() => governor.sample());

/* respect prefers-reduced-motion (§7.1) */
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const ctl = world.controls(); ctl.autoRotate = !reducedMotion; ctl.autoRotateSpeed = .3; ctl.enableDamping = true; ctl.minDistance = 140; ctl.maxDistance = 520;
world.pointOfView({ lat: 15, lng: 20, altitude: 2.4 });
document.addEventListener('visibilitychange', () => document.hidden ? world.pauseAnimation() : world.resumeAnimation());

function redraw(full) {
  world.polygonCapColor(world.polygonCapColor()).polygonAltitude(world.polygonAltitude());
  if (full) world.polygonStrokeColor(world.polygonStrokeColor());
}

function legend() { document.body.classList.remove('lens-on'); }   // data lenses removed

function setToggle(k, v) {
  S[k] = v;
  const el = document.querySelector(`.sw[data-k="${k}"]`);
  if (el) el.classList.toggle('on', v);
}

function center(d) {
  const g = d.geometry, polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
  let best = polys[0]; polys.forEach(p => { if (p[0].length > best[0].length) best = p; });
  const xs = best[0].map(a => a[0]), ys = best[0].map(a => a[1]);
  return {
    lng: (Math.min(...xs) + Math.max(...xs)) / 2, lat: (Math.min(...ys) + Math.max(...ys)) / 2,
    span: Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys))
  };
}
const fly = (c, alt, ms) => { ctl.autoRotate = false; world.pointOfView({ lat: c.lat, lng: c.lng, altitude: alt }, ms || 1400); };
const xBtn = f => { const x = $('#x'); if (x) x.onclick = f; };
function pick(d) { S.cmp ? compareAdd(d) : openCountry(d); }
function closeP() {
  sel = null; document.body.classList.remove('open'); ctl.autoRotate = S.spin;
  world.pointOfView({ altitude: 2.2 }, 1200); redraw(true);
}

/* ---------- boot: country shapes (pinned copy, fallback copy, then error card) ---------- */
function bootGeo(g) {
  feats = (g.features || []).filter(f => f.properties.ADM0_A3 !== 'ATA');
  world.polygonsData(feats);
  $('#cl').innerHTML = feats.map(f => f.properties.NAME).sort().map(n => `<option value="${esc(n)}">`).join('');
  legend(); layers(); pollISS();
  if (D.initialRoute) setTimeout(() => { try { terraRoute(D.initialRoute); } catch (e) { } }, 800);

  /* intro title card (§7.3): 1.5 s letterbox fade, skippable, once per session */
  try {
    if (!sessionStorage.getItem('terraIntro')) {
      const intro = document.getElementById('intro');
      if (intro) {
        intro.style.display = 'grid';
        const kill = () => { intro.style.opacity = 0; setTimeout(() => intro.remove(), 700); sessionStorage.setItem('terraIntro', '1'); };
        intro.onclick = kill;
        setTimeout(kill, 1500);
      }
    } else { const intro = document.getElementById('intro'); if (intro) intro.remove(); }
  } catch (e) { }
  setTimeout(() => { $('#boot').style.opacity = 0; setTimeout(() => $('#boot').remove(), 800); }, 400);
}
terraFetchURL(GEO, 86400).then(g => {
  if (g && g.features) bootGeo(g);
  else return terraFetchURL(GEO_ALT, 86400).then(g2 => {
    if (g2 && g2.features) bootGeo(g2);
    else $('#boot').textContent = 'COULD NOT LOAD MAP DATA — CHECK YOUR CONNECTION';
  });
});
addEventListener('resize', () => world.width(innerWidth).height(innerHeight));
