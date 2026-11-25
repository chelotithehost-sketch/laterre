/* intent.js — the rule-based "Ask" parser (TERRA_MASTER_SPEC.md §6.10).
   No AI, no API: deterministic patterns route plain requests to the Everyday cards.
   Unknown text falls back to normal country/city search. */
(function () {
  const RULES = [
    [/^(?:what(?:'s| is)?\s+(?:the\s+)?)?time\s+(?:in|at|for)\s+(.+)$/i, m => () => openCallTime(m[1])],
    [/^weather\s+(?:in|for|at)\s+(.+)$/i, m => () => openWeatherPlainly(m[1])],
    [/^best\s+time\s+to\s+visit\s+(.+)$/i, m => () => openTripCard(m[1])],
    [/^(?:plan\s+a\s+)?trip\s+(?:to\s+)?(.+)$/i, m => () => openTripCard(m[1])],
    [/^(\d+(?:\.\d+)?)\s*([a-z]{3})\s+(?:to|in|into)\s+([a-z]{3})$/i,
    m => () => openMoney(parseFloat(m[1]), m[2].toUpperCase(), m[3].toUpperCase())],
    [/^convert\s+(\d+(?:\.\d+)?)\s*([a-z]{3})\s+(?:to|into)\s+([a-z]{3})$/i,
    m => () => openMoney(parseFloat(m[1]), m[2].toUpperCase(), m[3].toUpperCase())],
    [/^is\s+(\S+)\s+(?:down|up|working)$/i, m => () => openIsDown(m[1])],
    [/^is\s+(?:this\s+)?(?:website|site|link|url)\s+(\S+)\s+safe$/i, m => () => openWebsiteCheck(m[1])],
    [/^is\s+(\S+)\s+safe$/i, m => () => openWebsiteCheck(m[1])],
    [/^(?:website|site)\s+check\s+(\S+)$/i, m => () => openWebsiteCheck(m[1])],
    [/^plug(?:s| type)?\s+(?:in|for)\s+(.+)$/i, m => () => openTripCard(m[1])],
    [/^(?:emergency\s+(?:number|numbers)|police\s+number)\s+(?:in|for)?\s*(.+)$/i, m => () => openSafety(m[1])],
    [/^(?:is\s+it\s+)?safe\s+(?:in|to\s+visit)\s+(.+)$/i, m => () => openSafety(m[1])],
    [/^distance\s+(?:from\s+)?(.+?)\s+to\s+(.+)$/i, m => () => distanceCard(m[1], m[2])],
    [/^what(?:'s| is)?\s+my\s+(?:ip|ip\s+address|connection)$/i, () => () => myConnection()],
    [/^(?:show\s+)?headlines?$/i, () => () => openHeadlines(null)],
    [/^(?:what(?:'s| is)?\s+happening|news)$/i, () => () => openHeadlines(null)],
    [/^news\s+(?:in|about|from)\s+(.+)$/i, m => () => openHeadlines(m[1])],
    [/^(?:convert|exchange)\s+(\d+(?:\.\d+)?)\s*([a-z]{3})\s+(?:to|into)\s+([a-z]{3})$/i,
    m => () => openMoney(parseFloat(m[1]), m[2].toUpperCase(), m[3].toUpperCase())],
    [/^(?:money|currency)\s+converter$/i, () => () => openMoney('', myCurrency(), 'USD')],
    [/^(?:umbrella|jacket|sunscreen)\s+(?:in|for|today|tomorrow)?\s*(.*)$/i, m => () => openWeatherPlainly(m[1] || 'here')],
  ];

  function distanceCard(a, b) {
    openPanel(hint('Distance from ' + esc(a) + ' to ' + esc(b), 'Working it out…'));
    Promise.all([resolvePlace(a), resolvePlace(b)]).then(([pa, pb]) => {
      if (!pa || !pb) return openPanel(hint('Place not found', 'Check the spellings and try again.'));
      const c1 = pa.kind === 'city' ? { lat: pa.r.latitude, lng: pa.r.longitude } : center(pa.feature);
      const c2 = pb.kind === 'city' ? { lat: pb.r.latitude, lng: pb.r.longitude } : center(pb.feature);
      const km = haversine(c1, c2), brg = bearing(c1, c2);
      openPanel(`<div class="sec" style="border:0;padding:24px"><button id="x">✕</button>
        <div style="font:700 17px Inter">${esc(pa.name)} → ${esc(pb.name)}</div>
        <div class="grid" style="margin-top:12px">
          <div class="k"><small>Distance (great circle)</small><b>${Math.round(km).toLocaleString()} km</b></div>
          <div class="k"><small>Bearing</small><b>${Math.round(brg)}°</b></div>
          <div class="k"><small>Flight time (est. 850 km/h)</small><b>${(km / 850).toFixed(1)} h</b></div>
          <div class="k"><small>Driving distance</small><b>longer!</b></div></div>
        <div class="ex" style="margin-top:10px;font-size:11px">Great-circle distance is the straight line over the curve of the Earth. Flight time is a labelled estimate.</div></div>`);
    });
  }

  /* returns a function to run, or null when the text is not a known request */
  function intent(text) {
    const t = (text || '').trim();
    if (!t) return null;
    if (/^(?:here|my location)$/i.test(t)) return () => openAroundMe();
    for (const [re, build] of RULES) {
      const m = t.match(re);
      if (m) return build(m);
    }
    return null;
  }

  window.terraIntent = intent;
  window.distanceCard = distanceCard;
})();
