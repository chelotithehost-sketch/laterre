/* ui.js — lens rail (incl. the merged Electricity-mix segmented control), layer
   toggles, imagery selector, ticker, keyboard shortcuts. */
(function () {
  const lensList = $('#lensList');
  let group = '';
  D.lenses.forEach(l => {
    const po = l.group !== 'Society & economy' ? ' pro-only' : '';
    if (l.group !== group) {
      const h = document.createElement('div'); h.className = 'gh' + po; h.textContent = l.group;
      lensList.appendChild(h); group = l.group;
    }
    const b = document.createElement('button');
    b.className = 'chip' + po; b.dataset.id = l.id;
    b.style.setProperty('--sw', 'rgb(' + ramp(l.pal || ['#0a1f3d', '#d9f3d0'], .7) + ')');
    b.innerHTML = `<i class="dot"></i>${esc(l.label)}`;
    b.onclick = () => {
      if (S.lensOn && S.lens === l.id) S.lensOn = false; else { S.lens = l.id; S.lensOn = true; }
      legend(); redraw();
      if (sel && !S.cmp) openCountry(sel, true);
    };
    lensList.appendChild(b);
    if (l.subs) {                       // "Electricity mix" segmented control (§4.6)
      const seg = document.createElement('div');
      seg.className = 'seg' + po; seg.dataset.for = l.id;
      seg.style.display = 'none';
      l.subs.forEach(s => {
        const sb = document.createElement('button');
        sb.textContent = s.label.replace(' electricity', '');
        sb.dataset.id = s.id;
        if (s.id === S.powerSub) sb.classList.add('on');
        sb.onclick = () => {
          S.powerSub = s.id; S.lens = 'power'; S.lensOn = true;
          seg.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === sb));
          legend(); redraw();
          if (sel && !S.cmp) openCountry(sel, true);
        };
        seg.appendChild(sb);
      });
      lensList.appendChild(seg);
    }
  });

  function dock(k) {
    const c = 'dock-' + k, was = document.body.classList.contains(c);
    document.body.classList.remove('dock-news', 'dock-layers');
    if (!was) document.body.classList.add(c);
  }
  $('#dockNews').onclick = () => dock('news');
  $('#dockLayers').onclick = () => dock('layers');

  $$('.sw').forEach(el => el.onclick = () => {
    const k = el.dataset.k; setToggle(k, !S[k]);
    if (k === 'spin') ctl.autoRotate = S.spin;
    if (k === 'cmp') { S.cmp ? startCompare(null) : exitCompare(); return; }
    if (k === 'relief') { redraw(); if (S.relief && !S.lensOn) toast('Relief follows the data lens — pick one under Data'); }
    if (k === 'wx' && S.wx && !Object.keys(D.capwx || {}).length) { setToggle('wx', false); toast('Weather is unavailable right now'); }
    if (k === 'flags' && S.flags && !capMarkers().length) toast('Capital locations are still loading…');
    if (k === 'iss' && S.iss) { if (iss.on) fly({ lat: iss.lat, lng: iss.lng }, 2.2, 1200); else toast('Locating the ISS…'); }
    layers();
  });

  $$('#imgsel button').forEach(b => b.onclick = () => {
    S.img = b.dataset.m; world.globeImageUrl(IMG[S.img]);
    $$('#imgsel button').forEach(x => x.classList.toggle('on', x === b));
    redraw();
  });

  buildTicker();                                   // headlines + Wikipedia, see news.js

  /* Everyday home + Simple/Pro switch: Simple is calm and plain; Pro reveals technical lenses, layers and details */
  $('#homeIcon').onclick = showHome;
  function setMode(pro, announce) {
    window.PRO = pro;
    document.body.classList.toggle('pro', pro);
    $$('#modeSel button').forEach(x => x.classList.toggle('on', (x.dataset.mode === 'pro') === pro));
    try { sessionStorage.setItem('terraPro', pro ? '1' : '0'); } catch (e) { }
    if (!pro) {                                   // leaving Pro: drop technical layers / lenses from the map
      ['hazards', 'aqi', 'aurora', 'relief'].forEach(k => S[k] && setToggle(k, false));
      const l = D.lenses.find(x => x.id === S.lens);
      if (S.lensOn && l && l.group !== 'Society & economy') S.lensOn = false;
      legend(); redraw(); layers();
    }
    if (announce) toast(pro ? 'Pro mode: technical layers and details unlocked' : 'Simple mode: plain language, clean map');
  }
  $$('#modeSel button').forEach(b => b.onclick = () => setMode(b.dataset.mode === 'pro', true));
  try { if (sessionStorage.getItem('terraPro') === '1') setMode(true, false); } catch (e) { }

  /* "Ask" example chips (§6.10) */
  const chips = $('#askchips');
  $('#q').addEventListener('focus', () => chips.classList.add('show'));
  $('#q').addEventListener('blur', () => setTimeout(() => chips.classList.remove('show'), 250));
  $$('.askchip').forEach(c => c.onclick = () => { terraRoute(c.textContent); chips.classList.remove('show'); });

  /* footer bar: Sources, Toolbox, Diagnostics, text size (§6.8, §6.9, §6.11) */
  $('#srcBtn').onclick = openSources;
  $('#toolBtn').onclick = openToolbox;
  $('#diagBtn').onclick = openDiagnostics;
  $('#fontUp').onclick = () => textSize(0.1);
  $('#fontDown').onclick = () => textSize(-0.1);
  if (location.search.includes('debug')) setTimeout(openDiagnostics, 1500);

  /* keyboard: / search · Esc close · L lenses · Y layers · C compare · ? help */
  addEventListener('keydown', e => {
    if (e.key === 'Escape') { document.body.classList.remove('dock-news', 'dock-layers'); $('#q').value = ''; $('#q').blur(); if (document.body.classList.contains('open')) closeP(); return; }
    if (e.key === '/' && document.activeElement !== $('#q')) { e.preventDefault(); $('#q').focus(); return; }
    if (document.activeElement === $('#q')) return;
    if (e.key === 'l' || e.key === 'L') dock('news');
    if (e.key === 'c' || e.key === 'C') { setToggle('cmp', !S.cmp); S.cmp ? startCompare(null) : exitCompare(); }
    if (e.key === 'y' || e.key === 'Y') dock('layers');
  });
})();
