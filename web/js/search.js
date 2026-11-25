/* search.js — universal omnibox + router (TERRA_MASTER_SPEC.md §6.2).
   Input types: country · city · domain · IPv4/IPv6 · ASN · "lat,lng".
   `/` focuses, Esc clears. Suggestions use the country datalist + a ranked
   suggestion list with type icons. */
(function () {
  const q = $('#q');

  function classify(v) {
    v = v.trim();
    if (/^-?\d{1,3}(\.\d+)?\s*,\s*-?\d{1,3}(\.\d+)?$/.test(v)) return 'point';
    if (/^(\d{1,3}\.){3}\d{1,3}$/.test(v)) return 'ipv4';
    if (/^[0-9a-fA-F:]+$/.test(v) && v.includes(':')) return 'ipv6';
    if (/^AS\d{1,10}$/i.test(v)) return 'asn';
    if (/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i.test(v)) return 'domain';
    return 'name';
  }

  function route(v) {
    v = (v || '').trim();
    if (!v) return;
    const kind = classify(v);
    if (kind === 'point') {
      const [lat, lng] = v.split(',').map(Number);
      openPointCard(lat, lng);
      return;
    }
    if (kind === 'ipv4' || kind === 'ipv6') { openIpDossier(v); return; }
    if (kind === 'asn') { openAsnDossier(v.toUpperCase()); return; }
    if (kind === 'domain') { openDomainDossier(v.toLowerCase()); return; }
    /* name: Ask-bar intent first (rule-based, §6.10), then country, then city */
    const intentFn = (typeof terraIntent === 'function') ? terraIntent(v) : null;
    if (intentFn) { intentFn(); return; }
    const f = findC(v);
    if (f) { pick(f); return; }
    searchCity(v);
  }

  /* country lookup against the loaded Natural Earth features */
  function findC(v) {
    v = v.trim().toLowerCase(); if (!v) return null;
    const n = f => f.properties.NAME.toLowerCase();
    return feats.find(f => n(f) === v) || feats.find(f => n(f).startsWith(v)) ||
      feats.find(f => (f.properties.NAME_LONG || '').toLowerCase().includes(v));
  }

  /* city search via the geocode source (debounced 350 ms, ≤ 1 req/s — §4.3) */
  const citySearch = TERRA_NET.debounce(async (text) => {
    if (!TERRA_NET.toolAllowed()) return;
    const data = await terraFetch('geocode', { query: { name: text, count: 8, language: 'en', format: 'json' } });
    const results = (data && data.results) || [];
    if (!results.length) { toast('No place found — try another spelling'); return; }
    if (results.length === 1) return openCityDossier(results[0]);
    showCityPicker(text, results);
  }, 350);

  function searchCity(text) { citySearch(text); }

  function showCityPicker(text, results) {
    openPanel(hint('Places matching “' + esc(text) + '”', 'Pick the place you mean.'));
    $('#panel').insertAdjacentHTML('beforeend',
      results.map((r, i) => `<div class="sec" style="border:0;padding:8px 24px">
        <button class="btn" data-i="${i}">${esc(r.name)}${r.admin1 ? ' · ' + esc(r.admin1) : ''}${r.country ? ' · ' + esc(r.country) : ''}</button></div>`).join(''));
    $$('#panel .btn[data-i]').forEach(b => b.onclick = () => openCityDossier(results[+b.dataset.i]));
  }

  /* omnibox: Enter routes; input prefills the country datalist (baseline behaviour) */
  q.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); route(q.value); q.value = ''; q.blur(); }
    e.stopPropagation();
  });
  q.addEventListener('change', () => {           // datalist pick
    const f = findC(q.value);
    if (f && f.properties.NAME.toLowerCase() === q.value.trim().toLowerCase()) { q.value = ''; q.blur(); pick(f); }
  });
  addEventListener('keydown', e => {
    if (e.key === '/' && document.activeElement !== q) { e.preventDefault(); q.focus(); }
  });

  window.terraRoute = route;
  window.terraClassify = classify;
  window.findC = findC;
  window.searchCity = searchCity;
})();
