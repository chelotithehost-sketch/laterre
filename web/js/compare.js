/* compare.js — two countries side by side (§6.7). Arc on globe, per-lens bars,
   local-time difference, great-circle distance, swap button.
   Larger value is highlighted — higher is NOT always better. */
let cmp = { a: null, b: null }, cmpArc = null, cmpN = 0;

function startCompare(first) {
  sel = null; cmp = { a: first, b: null }; cmpArc = null;
  layers(); redraw(true);
  if (first) fly(center(first), 1.6, 1000);
  renderCompare();
}
function exitCompare() {
  setToggle('cmp', false); cmp = { a: null, b: null }; cmpArc = null; cmpN++;
  layers(); closeP();
}
function compareAdd(d) {
  if (!cmp.a || (cmp.a && cmp.b)) { cmp = { a: d, b: null }; cmpArc = null; fly(center(d), 1.6, 1000); }
  else if (d !== cmp.a) { cmp.b = d; } else return;
  layers(); redraw(true); renderCompare();
}
function mid(p, q) {
  const r = x => x * Math.PI / 180, v = (la, lo) => [Math.cos(r(la)) * Math.cos(r(lo)), Math.cos(r(la)) * Math.sin(r(lo)), Math.sin(r(la))];
  const A = v(p.lat, p.lng), B = v(q.lat, q.lng), M = A.map((x, i) => x + B[i]), n = Math.hypot(...M) || 1;
  const ang = Math.acos(Math.max(-1, Math.min(1, A[0] * B[0] + A[1] * B[1] + A[2] * B[2])));
  return { lat: Math.asin(M[2] / n) * 180 / Math.PI, lng: Math.atan2(M[1], M[0]) * 180 / Math.PI, ang };
}

async function cdata(d) {
  const c = center(d);
  const cty = (D.countries || []).find(x => x.cca3 === d.properties.ADM0_A3) || {};
  const llr0 = (cty.capital && !cty.capLatlng) ? await terraFetch('geocode', { query: { name: cty.capital, countryCode: cty.cca2, count: 1, language: 'en', format: 'json' } }) : null;
  const r0 = llr0 && llr0.results && llr0.results[0];
  const ll = cty.capLatlng ? [cty.capLatlng[0], cty.capLatlng[1]] : r0 ? [r0.latitude, r0.longitude] : (cty.latlng && cty.latlng.length === 2 ? [cty.latlng[0], cty.latlng[1]] : [c.lat, c.lng]);
  const wx = await terraFetch('openmeteo', { query: { latitude: ll[0], longitude: ll[1], current: 'temperature_2m,weather_code', timezone: 'auto' } });
  return { rc: cty, wx, c, ll };
}

async function renderCompare() {
  const n = ++cmpN, { a, b } = cmp;
  document.body.classList.add('open'); ctl.autoRotate = false;
  if (!a) { openPanel(hint('Compare mode', 'Click any country on the globe, or search for one, to start.')); return; }
  if (!b) { openPanel(hint(esc(a.properties.NAME) + ' selected', 'Now pick a second country to compare side by side.')); return; }
  openPanel(`<div class="sec" style="border:0"><button id="x">✕</button></div><div class="sk"></div><div class="sk" style="width:70%"></div><div class="sk"></div>`);
  const [A, B] = await Promise.all([cdata(a), cdata(b)]);
  if (n !== cmpN) return;
  cmpArc = { cmp: true, sLat: A.c.lat, sLng: A.c.lng, eLat: B.c.lat, eLng: B.c.lng };
  layers();
  const m = mid(A.c, B.c); fly(m, Math.min(3.2, .9 + m.ang * 1.2), 1400);
  const ia = a.properties.ADM0_A3, ib = b.properties.ADM0_A3;

  const side = (o, d, c) => `<div class="sd" style="--c:${c}">${o.rc && o.rc.cca2 ? `<img src="${esc(flagUrl(o.rc.cca2))}" alt="flag">` : ''}<b>${esc(d.properties.NAME)}</b><small>${o.wx && o.wx.current ? WX(o.wx.current.weather_code) + ' · ' + Math.round(o.wx.current.temperature_2m) + '° now' : (o.rc && o.rc.capital ? esc(o.rc.capital) : '')}</small></div>`;
  let h = `<div class="cmph"><button id="x">✕</button>${side(A, a, '#f2c55c')}<div class="vs">VS</div>${side(B, b, '#ee7b8f')}</div>
 <div class="sec" style="padding:10px 20px"><button class="btn" id="swap">Swap countries</button></div>`;

  /* distance · time difference · flight estimate (clearly labelled estimate) */
  const km = haversine(A.ll, B.ll);
  const tA = new Date().toLocaleTimeString('en', { timeZone: (A.wx && A.wx.timezone) || 'UTC', hour: '2-digit', minute: '2-digit' });
  const tB = new Date().toLocaleTimeString('en', { timeZone: (B.wx && B.wx.timezone) || 'UTC', hour: '2-digit', minute: '2-digit' });
  h += `<div class="sec"><h4>Between them</h4><div class="grid">
    <div class="k"><small>Distance (great circle)</small><b>${Math.round(km).toLocaleString()} km</b></div>
    <div class="k"><small>Flight time (est. 850 km/h)</small><b>${(km / 850).toFixed(1)} h</b></div>
    <div class="k"><small>Local time · ${esc(a.properties.NAME)}</small><b>${esc(tA)}</b></div>
    <div class="k"><small>Local time · ${esc(b.properties.NAME)}</small><b>${esc(tB)}</b></div>
  </div></div>`;

  const groups = [...new Set(D.lenses.map(l => l.group))];
  groups.forEach(g => {
    h += `<div class="sec"><h4>${esc(g)}</h4>` + D.lenses.filter(l => l.group === g).flatMap(l =>
      (l.subs ? l.subs.map(s => ({ id: s.id, label: s.label, fmt: l.fmt })) : [l])).map(l => {
        const va = D.values[l.id][ia], vb = D.values[l.id][ib], w = va && vb ? (va[0] > vb[0] ? 'a' : va[0] < vb[0] ? 'b' : '') : '';
        return `<div class="cr"><div class="cv ${w === 'a' ? 'w' : ''}" style="--c:#f2c55c">${va ? fmt(va[0], l.fmt) : '—'}</div><div class="cl">${esc(l.label)}</div><div class="cv r ${w === 'b' ? 'w' : ''}" style="--c:#ee7b8f">${vb ? fmt(vb[0], l.fmt) : '—'}</div></div>
  <div class="duel"><div class="du"><i style="width:${va ? norm0(l.id, ia) * 100 : 0}%;background:#f2c55c"></i></div><div class="du r"><i style="width:${vb ? norm0(l.id, ib) * 100 : 0}%;background:#ee7b8f"></i></div></div>`;
      }).join('') + `</div>`;
  });
  h += `<div class="sec"><div class="ex" style="font-size:11px">Bars are scaled across all countries (5th–95th percentile). The highlighted value is the larger one — higher is not always better.</div></div>`;
  $('#panel').innerHTML = h; xBtn(exitCompare);
  $('#swap').onclick = () => { cmp = { a: b, b: a }; cmpArc = null; layers(); redraw(true); renderCompare(); };
}
