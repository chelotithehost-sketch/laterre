/* dossier.js — country dossier (§6.3), city dossier (§6.4), point card (§6.1).
   Remote strings are escaped with esc() before touching innerHTML (§10).
   FX comes from the one cached daily ExchangeRate-API snapshot (§4.6). */

function openPanel(html) {
  document.body.classList.add('open');
  $('#panel').innerHTML = html;
  xBtn(closeP);
}
const hint = (t, s) => `<div class="sec" style="border:0;padding:30px 24px"><button id="x">✕</button>
  <div style="font:700 19px Inter;letter-spacing:-.01em">${t}</div><p class="ex" style="margin-top:8px">${s}</p></div>`;

/* ---------------- country dossier ---------------- */
function mixHTML(iso) {
  const g = id => { const a = D.values[id][iso]; return a ? a[0] : null; };
  const f = g('fossil'), n = g('nuclear'), r = g('renew'), hy = g('hydro');
  if ([f, n, r].filter(v => v != null).length < 2) return '';
  const parts = [['Fossil', f, '#e8863a'], ['Nuclear', n, '#9a7be0'], ['Renewable', r, '#4fc58a']].map(p => [p[0], Math.max(0, p[1] || 0), p[2]]);
  const tot = parts.reduce((s, p) => s + p[1], 0) || 1;
  const yr = (D.values.fossil[iso] || D.values.renew[iso] || [0, ''])[1];
  return `<div class="sec"><h4>Electricity mix · ${esc(String(yr))} ${chip('World Bank', 'World Bank · CC BY 4.0')}</h4>
 <div class="mix">${parts.map(p => `<i style="width:${p[1] / tot * 100}%;background:${p[2]}"></i>`).join('')}</div>
 <div class="leg">${parts.map(p => `<span style="--c:${p[2]}"><b>${p[1].toFixed(0)}%</b> ${p[0]}</span>`).join('')}</div>
 ${hy != null ? `<div class="ex" style="margin-top:8px;font-size:11.5px">Of which hydro: ${hy.toFixed(0)}%</div>` : ''}</div>`;
}

const usdF = a => a && a[0] != null ? '$' + cmpf.format(a[0]) : '—';
const yrTag = a => a ? `<small style="color:var(--dim);display:block">${esc(String(a[1]))}</small>` : '';

async function openCountry(d, keepView) {
  sel = d;
  const p = d.properties, iso = p.ADM0_A3, c = center(d), cty = CTY[iso] || {};
  document.body.classList.add('open'); redraw(true);
  if (!keepView) fly(c, Math.max(.45, Math.min(2, c.span / 38)));

  const flag = flagUrl(cty.cca2), cc = cty.cur, a2 = cty.cca2;
  const gdpPc = (D.values.gdp || {})[iso], gdpT = (D.values.gdptotal || {})[iso], popWB = (D.values.pop || {})[iso];
  const WBc = chip('World Bank', 'World Bank · CC BY 4.0 · annual, lags 1–2 years');
  /* everything below is local data — it shows instantly, before any network call */
  const head = `<div class="hero" style="background-image:url(${esc(flag)})"><button id="x">✕</button><div class="in">${flag ? `<img src="${esc(flag)}" alt="flag">` : ''}<div><h2>${esc(p.NAME)}</h2><p>${esc(cty.subregion || p.CONTINENT || '')}</p></div></div></div>
  <div class="sec"><div class="grid">
    <div class="k wide"><small>Capital</small><b class="lg">${cty.capital ? esc(cty.capital) : '—'}</b></div>
    <div class="k"><small>Region</small><b style="font-size:13px">${esc(cty.region || '—')}</b></div>
    <div class="k"><small>Area ${chip('mledoze/countries', 'MIT dataset')}</small><b>${cty.area ? cmpf.format(cty.area) + ' km²' : '—'}</b></div>
    <div class="k"><small>Languages</small><b style="font-size:13px">${(cty.lang || []).map(esc).join(', ') || '—'}</b></div>
    <div class="k"><small>Currency</small><b style="font-size:13px">${cc ? esc(cty.curName || cc) + ' (' + esc(cc) + ')' : '—'}</b></div>
    <div class="k pro-only"><small>Codes</small><b style="font-size:13px">${esc(iso)}${a2 ? ' · ' + esc(a2) : ''}${cty.tld ? ' · ' + esc(cty.tld) : ''}</b></div>
    <div class="k pro-only"><small>Calling code · drives on</small><b style="font-size:13px">${esc(cty.idd || '—')}${cty.drive ? ' · ' + esc(cty.drive) : ''}</b></div>
  </div></div>` + countryNewsHTML(iso, cty.name || p.NAME);
  const bind = () => {
    xBtn(closeP);
    const mb = $('#moreNews'); if (mb) mb.onclick = () => openHeadlines(cty.name || p.NAME).then(() => { const i = $('#gdIn'); if (i) { i.value = cty.name || p.NAME; $('#gdGo').click(); } });
  };
  $('#panel').innerHTML = head + `<div class="sk"></div><div class="sk" style="width:70%"></div><div class="sk"></div>`;
  bind();

  let ll = cty.capLatlng && cty.capLatlng.length === 2 ? [cty.capLatlng[0], cty.capLatlng[1]] : null;
  if (!ll && cty.capital) {
    const g = await terraFetch('geocode', { query: { name: cty.capital, countryCode: cty.cca2, count: 1, language: 'en', format: 'json' } });
    const r = g && g.results && g.results[0]; if (r) ll = [r.latitude, r.longitude];
    if (sel !== d) return;
  }
  if (!ll) ll = cty.latlng && cty.latlng.length === 2 ? [cty.latlng[0], cty.latlng[1]] : [c.lat, c.lng];
  const [wx, aq, hol, wk] = await Promise.all([
    terraFetch('openmeteo', { query: { latitude: ll[0], longitude: ll[1], current: 'temperature_2m,wind_speed_10m,weather_code', daily: 'temperature_2m_max,temperature_2m_min,weather_code', timezone: 'auto', forecast_days: 5 } }),
    terraFetch('openmeteo_aq', { query: { latitude: ll[0], longitude: ll[1], current: 'european_aqi,pm2_5' } }),
    a2 ? terraFetch('nager', { path: { cca2: a2 } }) : null,
    terraFetch('wikipedia', { path: { title: encodeURIComponent(cty.name || p.NAME) } })
  ]);
  if (sel !== d) return;

  let h = head;
  if (wx && wx.current) {
    const t = new Date(Date.now() + wx.utc_offset_seconds * 1000).toISOString().substr(11, 5);
    h += `<div class="sec"><h4>${cty.capital ? esc(cty.capital) : 'Capital'} now · ${t} local ${chip('Open-Meteo', 'Open-Meteo · CC BY 4.0 · non-commercial')}</h4>
      <div class="wx"><div class="big">${Math.round(wx.current.temperature_2m)}°</div>
      <div class="c">${WX(wx.current.weather_code)} · wind ${Math.round(wx.current.wind_speed_10m)} km/h${aq && aq.current ? `<br>Air quality: <b style="color:var(--txt)">${AQ(aq.current.european_aqi)}</b> (AQI ${Math.round(aq.current.european_aqi)})` : ''}</div></div>
      <div class="fc">${wx.daily.time.map((x, i) => `<div>${new Date(x).toLocaleDateString('en', { weekday: 'short' })}<b>${Math.round(wx.daily.temperature_2m_max[i])}° / ${Math.round(wx.daily.temperature_2m_min[i])}°</b>${WXS(wx.daily.weather_code[i])}</div>`).join('')}</div></div>`;
  }
  const extra = [];
  const rate = cc && D.fx && D.fx.rates ? D.fx.rates[cc] : null;
  if (rate && cc !== 'USD') extra.push(`<div class="k"><small>1 USD = ${chip('ExchangeRate-API', 'ExchangeRate-API · daily snapshot')}</small><b>${rate.toFixed(rate < 10 ? 3 : 2)} ${esc(cc)}</b></div>`);
  if (hol && hol[0]) extra.push(`<div class="k"><small>Next public holiday · ${esc(hol[0].date)} ${chip('Nager.Date', 'Nager.Date · MIT')}</small><b style="font-size:13px">${esc(hol[0].name)}</b></div>`);
  if (extra.length) h += `<div class="sec"><div class="grid">${extra.join('')}</div></div>`;

  if (wk && wk.extract) {
    let t = wk.extract; if (t.length > 340) t = t.slice(0, 340).replace(/\s+\S*$/, '') + '…';
    h += `<div class="sec"><h4>About ${chip('Wikipedia', 'Wikipedia · CC BY-SA — follow the link to republish')}</h4><div class="ex">${esc(t)}</div></div>`;
  }
  $('#panel').innerHTML = h; bind();
}

/* ---------------- city dossier (§6.4) ---------------- */
function tzClock(tz) {
  const now = new Date();
  const time = new Intl.DateTimeFormat('en', { timeZone: tz, hour: '2-digit', minute: '2-digit', weekday: 'short' }).format(now);
  let offset = '';
  try { offset = new Intl.DateTimeFormat('en', { timeZone: tz, timeZoneName: 'longOffset' }).formatToParts(now).find(p => p.type === 'timeZoneName').value; } catch (e) { }
  /* DST note: compare the current offset with the January and July offsets */
  const off = d => { try { return new Intl.DateTimeFormat('en', { timeZone: tz, timeZoneName: 'longOffset' }).formatToParts(d).find(p => p.type === 'timeZoneName').value; } catch (e) { return ''; } };
  const jan = off(new Date(Date.UTC(now.getUTCFullYear(), 0, 15))), jul = off(new Date(Date.UTC(now.getUTCFullYear(), 6, 15)));
  const dst = (jan && jul && jan !== jul) ? 'Daylight saving applies part of the year here' : 'No daylight saving';
  return { time, offset, dst };
}

async function openCityDossier(r) {
  const tz = r.timezone || 'UTC';
  openPanel(`<div class="hero"><button id="x">✕</button><div class="in"><div><h2>${esc(r.name)}</h2><p>Gathering live data…</p></div></div></div><div class="sk"></div><div class="sk" style="width:70%"></div>`);
  const [wx, aq, elev, wk, near] = await Promise.all([
    terraFetch('openmeteo', { query: { latitude: r.latitude, longitude: r.longitude, current: 'temperature_2m,wind_speed_10m,weather_code,apparent_temperature', daily: 'temperature_2m_max,temperature_2m_min,weather_code,precipitation_probability_max,uv_index_max,sunrise,sunset', timezone: 'auto', forecast_days: 5 } }),
    terraFetch('openmeteo_aq', { query: { latitude: r.latitude, longitude: r.longitude, current: 'european_aqi,pm2_5' } }),
    terraFetch('openmeteo_elevation', { query: { latitude: r.latitude, longitude: r.longitude } }),
    terraFetch('wikipedia', { path: { title: encodeURIComponent(r.name) } }),
    terraFetch('wiki_geo', { query: { action: 'query', list: 'geosearch', gscoord: `${r.latitude}|${r.longitude}`, gsradius: 10000, gslimit: 6, format: 'json', origin: '*' } })
  ]);
  const clk = tzClock(tz);
  let h = `<div class="hero" style="background:linear-gradient(135deg,#12263f,#0a3a4a)"><button id="x">✕</button><div class="in"><div>
    <h2>${esc(r.name)}</h2><p>${esc(r.admin1 ? r.admin1 + ' · ' : '')}${esc(r.country || '')} · ${esc(clk.time)} (${esc(clk.offset)}) · ${esc(clk.dst)}</p></div></div></div>`;

  h += `<div class="sec"><div class="grid">
    <div class="k"><small>Population ${chip('Open-Meteo geocoding', 'Geocoding via Open-Meteo')}</small><b>${r.population ? cmpf.format(r.population) : '—'}</b></div>
    <div class="k"><small>Elevation ${chip('Copernicus DEM', 'Open-Meteo elevation · Copernicus DEM')}</small><b>${elev && elev.elevation ? Math.round(elev.elevation[0]) + ' m' : '—'}</b></div>
    <div class="k"><small>Time zone</small><b style="font-size:13px">${esc(tz)}</b></div>
    <div class="k"><small>Coordinates</small><b style="font-size:13px">${r.latitude.toFixed(2)}, ${r.longitude.toFixed(2)}</b></div>
  </div></div>`;

  if (wx && wx.current) {
    h += `<div class="sec"><h4>Weather now ${chip('Open-Meteo', 'Open-Meteo · CC BY 4.0 · non-commercial')}</h4>
      <div class="wx"><div class="big">${Math.round(wx.current.temperature_2m)}°</div>
      <div class="c">${WX(wx.current.weather_code)} · feels ${Math.round(wx.current.apparent_temperature)}° · wind ${Math.round(wx.current.wind_speed_10m)} km/h${aq && aq.current ? `<br>Air quality: <b style="color:var(--txt)">${AQ(aq.current.european_aqi)}</b> (AQI ${Math.round(aq.current.european_aqi)})` : ''}</div></div>
      <div class="fc">${wx.daily.time.map((x, i) => `<div>${new Date(x).toLocaleDateString('en', { weekday: 'short' })}<b>${Math.round(wx.daily.temperature_2m_max[i])}° / ${Math.round(wx.daily.temperature_2m_min[i])}°</b>${WXS(wx.daily.weather_code[i])}${wx.daily.precipitation_probability_max ? ' · ' + (wx.daily.precipitation_probability_max[i] ?? 0) + '%' : ''}</div>`).join('')}</div></div>`;
    const sr = wx.daily.sunrise && wx.daily.sunrise[0], ss = wx.daily.sunset && wx.daily.sunset[0];
    if (sr && ss) {
      const mins = Math.round((new Date(ss) - new Date(sr)) / 60000);
      h += `<div class="sec"><div class="grid">
        <div class="k"><small>Sunrise</small><b>${esc(String(sr).slice(11, 16))}</b></div>
        <div class="k"><small>Sunset</small><b>${esc(String(ss).slice(11, 16))}</b></div>
        <div class="k"><small>Day length</small><b>${Math.floor(mins / 60)} h ${mins % 60} min</b></div>
        <div class="k"><small>UV max</small><b>${wx.daily.uv_index_max ? wx.daily.uv_index_max[0].toFixed(1) : '—'}</b></div>
      </div></div>`;
    }
  }

  if (near && near.query && near.query.geosearch && near.query.geosearch.length) {
    h += `<div class="sec"><h4>Nearby landmarks ${chip('Wikipedia', 'Wikipedia · CC BY-SA')}</h4>` +
      near.query.geosearch.map(g => `<div class="row"><span class="nm" style="width:auto;flex:1;color:var(--txt)">${esc(g.title)}</span><span class="vl">${(g.dist / 1000).toFixed(1)} km</span></div>`).join('') + '</div>';
  }

  if (wk && wk.extract) {
    let t = wk.extract; if (t.length > 340) t = t.slice(0, 340).replace(/\s+\S*$/, '') + '…';
    h += `<div class="sec"><h4>About ${chip('Wikipedia', 'Wikipedia · CC BY-SA')}</h4><div class="ex">${esc(t)}</div></div>`;
  }

  h += `<div class="sec"><h4>Distance to…</h4><div style="display:flex;gap:8px">
    <input id="distTo" placeholder="another place" style="flex:1;background:rgba(255,255,255,.05);border:1px solid var(--line);border-radius:8px;color:var(--txt);padding:9px;font:500 12px Inter">
    <button class="btn" id="distGo" style="width:auto;padding:9px 14px">Go</button></div><div class="ex" id="distOut" style="margin-top:8px"></div></div>`;

  $('#panel').innerHTML = h; xBtn(closeP);
  $('#distGo').onclick = async () => {
    const v = $('#distTo').value.trim(); if (!v) return;
    const g = await terraFetch('geocode', { query: { name: v, count: 1, language: 'en', format: 'json' } });
    const o = g && g.results && g.results[0];
    if (!o) { $('#distOut').textContent = 'Could not find that place.'; return; }
    const km = haversine({ lat: r.latitude, lng: r.longitude }, { lat: o.latitude, lng: o.longitude });
    const brg = bearing({ lat: r.latitude, lng: r.longitude }, { lat: o.latitude, lng: o.longitude });
    $('#distOut').innerHTML = `<b>${Math.round(km).toLocaleString()} km</b> to ${esc(o.name)} · bearing ${Math.round(brg)}° · about ${(km / 850).toFixed(1)} h at cruising speed (estimate)`;
  };
}

/* ---------------- point card (§6.1: click anywhere, land or sea) ---------------- */
let lastPolyPick = 0;
async function openPointCard(lat, lng) {
  if (Date.now() - lastPolyPick < 350) return;      // polygon click wins
  openPanel(`<div class="sec" style="border:0;padding:26px 24px"><button id="x">✕</button>
    <div style="font:700 17px Inter">${lat.toFixed(3)}, ${lng.toFixed(3)}</div>
    <p class="ex">Looking up this point…</p></div><div class="sk"></div><div class="sk" style="width:70%"></div>`);

  let place = await terraFetch('photon_reverse', { query: { lat, lon: lng } });
  let pa = place && place.features && place.features[0] && place.features[0].properties;
  if (!pa) {
    const nom = await terraFetch('nominatim', { query: { format: 'jsonv2', lat, lon: lng } });
    if (nom && nom.address) pa = { name: nom.name || nom.display_name, city: nom.address.city || nom.address.town || nom.address.village, country: nom.address.country, countrycode: nom.address.country_code };
  }
  const [wx, elev, near] = await Promise.all([
    terraFetch('openmeteo', { query: { latitude: lat, longitude: lng, current: 'temperature_2m,weather_code,wind_speed_10m', timezone: 'auto' } }),
    terraFetch('openmeteo_elevation', { query: { latitude: lat, longitude: lng } }),
    terraFetch('wiki_geo', { query: { action: 'query', list: 'geosearch', gscoord: `${lat}|${lng}`, gsradius: 10000, gslimit: 5, format: 'json', origin: '*' } })
  ]);
  const tz = (wx && wx.timezone) || 'UTC';
  const clk = tzClock(tz);
  const title = [pa && pa.name, pa && pa.city, pa && pa.country].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join(' · ') || 'A point on Earth';

  let h = `<div class="hero" style="background:linear-gradient(135deg,#16283f,#0d2b3d)"><button id="x">✕</button><div class="in"><div>
    <h2>${esc(title)}</h2><p>${lat.toFixed(3)}, ${lng.toFixed(3)} · ${elev && elev.elevation ? Math.round(elev.elevation[0]) + ' m above sea level' : ''}</p></div></div></div>`;

  h += `<div class="sec"><div class="grid">
    <div class="k"><small>Local time ${chip('Intl', 'Computed in your browser — no API')}</small><b>${esc(clk.time)}</b></div>
    <div class="k"><small>Time zone</small><b style="font-size:13px">${esc(tz)}</b></div>
  </div></div>`;

  if (wx && wx.current) {
    h += `<div class="sec"><h4>Weather now ${chip('Open-Meteo', 'Open-Meteo · CC BY 4.0 · non-commercial')}</h4>
      <div class="wx"><div class="big">${Math.round(wx.current.temperature_2m)}°</div>
      <div class="c">${WX(wx.current.weather_code)} · wind ${Math.round(wx.current.wind_speed_10m)} km/h</div></div></div>`;
  }

  if (near && near.query && near.query.geosearch && near.query.geosearch.length) {
    h += `<div class="sec"><h4>Nearby on Wikipedia</h4>` +
      near.query.geosearch.map(g => `<div class="row"><span class="nm" style="width:auto;flex:1;color:var(--txt)">${esc(g.title)}</span><span class="vl">${(g.dist / 1000).toFixed(1)} km</span></div>`).join('') + '</div>';
  }

  const cname = pa && (pa.country || pa.countrycode);
  const f = cname ? (findC(cname) || feats.find(x => (x.properties.ISO_A2_EH || '') === String(pa.countrycode || '').toUpperCase())) : null;
  if (f) h += `<div class="sec"><button class="btn" id="openC">Open ${esc(f.properties.NAME)} dossier</button></div>`;
  else h += `<div class="sec"><div class="ex">Open water or unrecognised territory — no country dossier here.</div></div>`;

  $('#panel').innerHTML = h; xBtn(closeP);
  const b = $('#openC');
  if (b && f) b.onclick = () => openCountry(f);
}

/* intercept polygon picks so the point card doesn't double-open */
const _pick = pick;
pick = function (d) { lastPolyPick = Date.now(); _pick(d); };
