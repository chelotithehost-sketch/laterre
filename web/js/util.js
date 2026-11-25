/* util.js — formatting, colour ramps, escaping. Every untrusted string goes
   through esc() before it touches innerHTML (TERRA_MASTER_SPEC.md §10). */
/* Pro-mode flag (Simple is the default — §6.11). Set by the mode switch in ui.js. */
window.PRO = window.PRO || false;

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];

/* XSS: remote strings (Wikipedia extracts, DNS TXT, RDAP remarks) are untrusted */
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const cmpf = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });

function fmt(v, t) {
  if (v == null) return '—';
  return t === 'usd' ? '$' + cmpf.format(v) : t === 'pct' ? v.toFixed(1) + '%'
    : t === 'yrs' ? v.toFixed(1) + ' yrs' : t === 'co2' ? v.toFixed(1) + ' t'
    : t === 'pm' ? v.toFixed(1) + ' µg/m³' : t === 'kgoe' ? cmpf.format(v) + ' kgoe'
    : cmpf.format(v);
}

const hex = h => [1, 3, 5].map(i => parseInt(h.substr(i, 2), 16));
function ramp(pal, x) {
  x = Math.max(0, Math.min(1, x));
  const p = x * (pal.length - 1), i = Math.min(pal.length - 2, Math.floor(p)), f = p - i,
    a = hex(pal[i]), b = hex(pal[i + 1]);
  return a.map((c, k) => Math.round(c + (b[k] - c) * f));
}

const AQ = v => v <= 20 ? 'Good' : v <= 40 ? 'Fair' : v <= 60 ? 'Moderate' : v <= 80 ? 'Poor' : v <= 100 ? 'Very poor' : 'Extreme';
const aqc = v => v <= 20 ? '#3ddc97' : v <= 40 ? '#9be15d' : v <= 60 ? '#f2e06a' : v <= 80 ? '#f5a742' : v <= 100 ? '#ef5b4c' : '#b01e5b';

const ago = t => {
  const m = Math.round((Date.now() - t) / 60000);
  return m < 60 ? m + ' min ago' : m < 1440 ? Math.round(m / 60) + ' h ago' : Math.round(m / 1440) + ' d ago';
};

const wxEmoji = (c, day) => c === 0 ? (day ? '☀️' : '🌙') : c <= 2 ? (day ? '⛅' : '☁️') : c === 3 ? '☁️' : c <= 48 ? '🌫️'
  : c <= 57 ? '🌦️' : c <= 67 ? '🌧️' : c <= 77 ? '🌨️' : c <= 82 ? '🌧️' : c <= 86 ? '🌨️' : '⛈️';
const WX = c => c === 0 ? 'Clear' : c <= 2 ? 'Partly cloudy' : c == 3 ? 'Overcast' : c <= 48 ? 'Fog'
  : c <= 57 ? 'Drizzle' : c <= 67 ? 'Rain' : c <= 77 ? 'Snow' : c <= 82 ? 'Showers' : 'Thunderstorm';
const WXS = c => c === 0 ? 'Clear' : c <= 2 ? 'P. cloudy' : c == 3 ? 'Cloudy' : c <= 48 ? 'Fog'
  : c <= 57 ? 'Drizzle' : c <= 67 ? 'Rain' : c <= 77 ? 'Snow' : c <= 82 ? 'Showers' : 'Storm';

/* M1 (§4.6): the four electricity rows live behind ONE "power" lens */
const POWER_SUBS = ['renew', 'fossil', 'nuclear', 'hydro'];

/* source chip (§6.9 provenance): every value can say where it came from */
function chip(text, title) {
  return `<span class="srcchip" title="${esc(title || '')}">${esc(text)}</span>`;
}

/* friendly toast (§8: errors are a chip + retry, never a blocking dialog) */
function toast(msg, ms) {
  let el = document.getElementById('toast');
  if (!el) {
    el = document.createElement('div'); el.id = 'toast';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('show'), ms || 3200);
}

/* flag image URL from the flagcdn source template ({cca2} lower-case) */
function flagUrl(cca2, size) {
  if (!cca2) return '';
  const tpl = (D.manifest.sources.flags || {}).url_template || '';
  return tpl ? tpl.replace('{cca2}', String(cca2).toLowerCase()).replace('/w320/', '/' + (size || 'w320') + '/') : '';
}

/* great-circle helpers (compare mode, point cards) */
function haversine(p, q) {
  const r = x => x * Math.PI / 180, R = 6371;
  const dLat = r(q.lat - p.lat), dLon = r(q.lng - p.lng);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(r(p.lat)) * Math.cos(r(q.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
function bearing(p, q) {
  const r = x => x * Math.PI / 180, d = x => x * 180 / Math.PI;
  const y = Math.sin(r(q.lng - p.lng)) * Math.cos(r(q.lat));
  const x = Math.cos(r(p.lat)) * Math.sin(r(q.lat)) - Math.sin(r(p.lat)) * Math.cos(r(q.lat)) * Math.cos(r(q.lng - p.lng));
  return (d(Math.atan2(y, x)) + 360) % 360;
}
