/* toolbox.js — M6: client-side utilities (§6.8), Sources & Licences modal (§6.9),
   diagnostics drawer (§5.1), text-size control (§6.11). Everything here is local:
   hash/base64/UUID tools run in the browser and say so — nothing leaves the page. */

/* ================================ TOOLBOX DRAWER ================================ */
function openToolbox() {
  let h = `<div class="hero" style="background:linear-gradient(135deg,#173049,#0d3a52)"><button id="x">✕</button>
    <div class="in"><div><h2>🧰 Toolbox</h2><p>Small utilities — all run in your browser</p></div></div></div>`;

  h += card('World clock & meeting planner', `<div class="ex">Use the 🕐 Good time to call? card — it takes several places and shows a traffic light for each.</div>`);
  h += card('Unit converter', `<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
    <input id="uVal" value="1" style="width:90px;background:rgba(255,255,255,.05);border:1px solid var(--line);border-radius:8px;color:var(--txt);padding:9px;font:600 14px Inter">
    <select id="uFrom" class="tbox-sel"></select> <span style="color:var(--dim)">→</span>
    <select id="uTo" class="tbox-sel"></select>
    <div class="ex" id="uOut" style="width:100%"></div></div>`);
  h += card('Distance & bearing', `<div class="ex">Type in the main search: <b>distance Paris to Rome</b> — or click two points via city dossiers.</div>`);
  h += card('Coordinate formats', `<div style="display:flex;gap:8px">
    <input id="cIn" placeholder="48.8584, 2.2945" style="flex:1;background:rgba(255,255,255,.05);border:1px solid var(--line);border-radius:8px;color:var(--txt);padding:10px;font:500 12px Inter">
    <button class="btn" id="cGo" style="width:auto;padding:10px 14px">Convert</button></div><div class="ex" id="cOut" style="margin-top:8px"></div>`);
  h += card('Subnet / CIDR calculator', `<div style="display:flex;gap:8px">
    <input id="cidrIn" placeholder="203.0.113.0/24" style="flex:1;background:rgba(255,255,255,.05);border:1px solid var(--line);border-radius:8px;color:var(--txt);padding:10px;font:500 12px Inter">
    <button class="btn" id="cidrGo" style="width:auto;padding:10px 14px">Calc</button></div><div class="ex" id="cidrOut" style="margin-top:8px"></div>`);
  h += card('Timestamp converter', `<div style="display:flex;gap:8px">
    <input id="tsIn" placeholder="1700000000 or 2026-11-19T12:00Z" style="flex:1;background:rgba(255,255,255,.05);border:1px solid var(--line);border-radius:8px;color:var(--txt);padding:10px;font:500 12px Inter">
    <button class="btn" id="tsGo" style="width:auto;padding:10px 14px">Convert</button></div><div class="ex" id="tsOut" style="margin-top:8px"></div>`);
  h += card('Encode / decode (local only)', `<div class="ex" style="font-size:11px">Runs in your browser with Web Crypto — <b>nothing leaves this page</b>.</div>
    <textarea id="encIn" rows="2" placeholder="text to encode" style="width:100%;background:rgba(255,255,255,.05);border:1px solid var(--line);border-radius:8px;color:var(--txt);padding:10px;font:500 12px Inter"></textarea>
    <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px">
      <button class="btn encBtn" data-k="b64" style="width:auto;padding:8px 12px">Base64</button>
      <button class="btn encBtn" data-k="url" style="width:auto;padding:8px 12px">URL-encode</button>
      <button class="btn encBtn" data-k="md5" style="width:auto;padding:8px 12px">SHA-256</button>
      <button class="btn encBtn" data-k="uuid" style="width:auto;padding:8px 12px">New UUID</button>
      <button class="btn encBtn" data-k="jwt" style="width:auto;padding:8px 12px">Decode JWT</button>
    </div><div class="ex" id="encOut" style="margin-top:8px;word-break:break-all"></div>`);
  h += `<div class="sec"><button class="btn" id="homeBtn">⌂ Home</button></div>`;
  openPanel(h);
  $('#homeBtn').onclick = showHome;

  /* unit converter */
  const UNITS = {
    Length: { m: 1, km: 1000, mi: 1609.344, ft: 0.3048, 'nmi': 1852 },
    Mass: { kg: 1, g: 0.001, lb: 0.45359237, oz: 0.028349523125 },
    Speed: { 'km/h': 1, mph: 1.609344, kn: 1.852, 'm/s': 3.6 },
    Data: { B: 1, KB: 1024, MB: 1048576, GB: 1073741824, TB: 1099511627776 }
  };
  const fill = (sel, keys) => sel.innerHTML = keys.map(k => `<option>${k}</option>`).join('');
  const all = Object.keys(UNITS).flatMap(g => Object.keys(UNITS[g]));
  fill($('#uFrom'), all); fill($('#uTo'), all); $('#uTo').selectedIndex = 1;
  const unitCalc = () => {
    const v = parseFloat($('#uVal').value) || 0, f = $('#uFrom').value, t = $('#uTo').value;
    const g = Object.values(UNITS).find(x => x[f] && x[t]);
    if (!g) { $('#uOut').textContent = 'Pick two units of the same kind.'; return; }
    $('#uOut').innerHTML = `<b>${v} ${f}</b> = <b style="color:#9fd8c0">${(v * g[f] / g[t]).toFixed(4)} ${t}</b>`;
  };
  ['#uVal', '#uFrom', '#uTo'].forEach(id => $(id).addEventListener('input', unitCalc));
  unitCalc();

  /* coordinates: DD → DMS */
  $('#cGo').onclick = () => {
    const m = $('#cIn').value.trim().match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/);
    if (!m) { $('#cOut').textContent = 'Type “lat, lng” like 48.8584, 2.2945.'; return; }
    const dms = (v, pos, neg) => {
      const d = Math.floor(Math.abs(v)), mi = Math.floor((Math.abs(v) - d) * 60), s = ((Math.abs(v) - d) * 60 - mi) * 60;
      return `${d}° ${mi}′ ${s.toFixed(1)}″ ${v >= 0 ? pos : neg}`;
    };
    $('#cOut').innerHTML = `<b>DD:</b> ${m[1]}, ${m[2]}<br><b>DMS:</b> ${dms(+m[1], 'N', 'S')} · ${dms(+m[2], 'E', 'W')}`;
  };

  /* CIDR */
  $('#cidrGo').onclick = () => {
    const m = $('#cidrIn').value.trim().match(/^(\d{1,3}(?:\.\d{1,3}){3})\/(\d|[12]\d|3[0-2])$/);
    if (!m) { $('#cidrOut').textContent = 'IPv4 CIDR only — e.g. 203.0.113.0/24'; return; }
    const ip = m[1].split('.').map(Number), p = +m[2];
    if (ip.some(o => o > 255)) { $('#cidrOut').textContent = 'Invalid octet.'; return; }
    const n = ((ip[0] << 24) >>> 0) + (ip[1] << 16) + (ip[2] << 8) + ip[3];
    const mask = p === 0 ? 0 : (0xFFFFFFFF << (32 - p)) >>> 0;
    const net = (n & mask) >>> 0, bcast = (net | (~mask >>> 0)) >>> 0;
    const toStr = x => [x >>> 24, (x >>> 16) & 255, (x >>> 8) & 255, x & 255].join('.');
    $('#cidrOut').innerHTML = `<b>Network:</b> ${toStr(net)}/${p} · <b>Mask:</b> ${toStr(mask)}<br>
      <b>Range:</b> ${toStr((net + 1) >>> 0)} – ${toStr((bcast - 1) >>> 0)} · <b>Broadcast:</b> ${toStr(bcast)}<br>
      <b>Hosts:</b> ${p >= 31 ? (p === 31 ? 2 : 1) : Math.pow(2, 32 - p) - 2}`;
  };

  /* timestamps */
  $('#tsGo').onclick = () => {
    const v = $('#tsIn').value.trim();
    let d = /^\d{10}$/.test(v) ? new Date(+v * 1000) : /^\d{13}$/.test(v) ? new Date(+v) : new Date(v);
    if (isNaN(d)) { $('#tsOut').textContent = 'Could not read that date.'; return; }
    $('#tsOut').innerHTML = `<b>Local:</b> ${esc(d.toLocaleString())}<br><b>ISO:</b> ${esc(d.toISOString())}<br><b>Unix:</b> ${Math.floor(d.getTime() / 1000)}`;
  };

  /* encode/decode */
  $$('.encBtn').forEach(b => b.onclick = async () => {
    const v = $('#encIn').value;
    try {
      if (b.dataset.k === 'b64') $('#encOut').textContent = v ? btoa(unescape(encodeURIComponent(v))) : '';
      if (b.dataset.k === 'url') $('#encOut').textContent = encodeURIComponent(v);
      if (b.dataset.k === 'md5') {
        const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(v));
        $('#encOut').textContent = [...new Uint8Array(h)].map(x => x.toString(16).padStart(2, '0')).join('');
      }
      if (b.dataset.k === 'uuid') $('#encOut').textContent = crypto.randomUUID ? crypto.randomUUID() : 'needs a modern browser';
      if (b.dataset.k === 'jwt') {
        const p = v.split('.')[1] || '';
        $('#encOut').textContent = JSON.stringify(JSON.parse(atob(p.replace(/-/g, '+').replace(/_/g, '/'))), null, 2);
      }
    } catch (e) { $('#encOut').textContent = 'Could not process that input.'; }
  });
}

/* ================================ SOURCES & LICENCES MODAL (§6.9, §12) ================================ */
function openSources() {
  const m = D.manifest || {};
  const rows = Object.entries(m.sources || {}).filter(([, s]) => !s.deprecated).map(([id, s]) =>
    `<div class="row" style="align-items:flex-start"><span style="flex:1">
      <b>${esc(s.name || id)}</b> <small class="srcchip">${esc(s.where === 'B' ? 'browser' : 'server')}</small><br>
      <small style="color:var(--dim)">${esc(s.attribution || '')} · ${esc(s.licence || '')}
      ${s.terms_url ? `· <a href="${esc(s.terms_url)}" target="_blank" rel="noopener" style="color:var(--acc)">terms</a>` : ''}</small></span></div>`).join('');
  const assets = Object.entries(m.assetMeta || {}).map(([id, a]) =>
    `<div class="row"><span style="flex:1"><b>${esc(a.name || id)}</b> <small style="color:var(--dim)">${esc(a.licence || '')}</small></span></div>`).join('');
  let h = `<div class="hero" style="background:linear-gradient(135deg,#152238,#0c2c40)"><button id="x">✕</button>
    <div class="in"><div><h2>Sources &amp; licences</h2><p>Every provider TERRA talks to</p></div></div></div>`;
  h += card('Data & tools', rows);
  h += card('Assets (CDN)', assets);
  h += card('Static datasets', Object.entries(STATIC).map(([k, v]) =>
    `<div class="row"><span style="flex:1"><b>${esc(k)}</b> <small style="color:var(--dim)">as of ${esc(String(v.as_of || ''))} · <a href="${esc(v.source_url || '#')}" target="_blank" rel="noopener" style="color:var(--acc)">source</a></small></span></div>`).join(''));
  h += `<div class="sec"><div class="ex" style="font-size:11px">TERRA is not affiliated with National Geographic, NVIDIA or any listed provider. World Bank data is CC BY 4.0. Wikipedia text is CC BY-SA — links to articles are provided. Open-Meteo's free API is for non-commercial use.</div></div>`;
  openPanel(h);
}

/* ================================ DIAGNOSTICS (§5.1) ================================ */
function openDiagnostics() {
  const st = TERRA_NET.stats();
  let h = `<div class="hero" style="background:linear-gradient(135deg,#152238,#0c2c40)"><button id="x">✕</button>
    <div class="in"><div><h2>⚙︎ Diagnostics</h2><p>Rate limiter &amp; cache statistics</p></div></div></div>`;
  h += card('TERRA_NET', `<div class="ex" style="font-family:monospace;font-size:11px">
    hits: ${st.hits} · misses: ${st.misses} · queued: ${st.queued}<br>
    failures: ${st.failures} · served stale: ${st.served_stale}<br>
    offline sources: ${st.offline.length ? esc(st.offline.join(', ')) : 'none'}</div>`);
  h += card('Token buckets (host → tokens left)', `<div class="ex" style="font-family:monospace;font-size:11px">
    ${(st.buckets || []).map(([host, t]) => `${esc(host)}: ${t}`).join('<br>') || 'no requests yet'}</div>`);
  h += card('Payload', `<div class="ex" style="font-family:monospace;font-size:11px">
    updated: ${esc(D.updated || '')} · lenses: ${(D.lenses || []).length} · countries: ${(D.countries || []).length}<br>
    quakes: ${(D.quakes || []).length} · hazards: ${(D.hazards || []).length} · headlines: ${((D.news || {}).items || []).length}<br>
    quality tier: ${governor.tier} · reduced motion: ${reducedMotion}</div>`);
  h += card('Provider freshness', `<div class="ex" style="font-size:11px">
    World Bank: 24 h · quakes: 5 min · hazards: 10–15 min · capital weather: 1 h · weather: 15 min · FX: 24 h · headlines: 15 min</div>`);
  openPanel(h);
}

/* ================================ TEXT SIZE (§6.11) ================================ */
(function () {
  let scale = 1;
  try { scale = parseFloat(sessionStorage.getItem('terraText') || '1'); } catch (e) { }
  const apply = () => {
    document.body.style.zoom = scale;
    try { sessionStorage.setItem('terraText', String(scale)); } catch (e) { }
  };
  apply();
  window.textSize = (d) => { scale = Math.min(2, Math.max(0.75, scale + d)); apply(); };
})();
