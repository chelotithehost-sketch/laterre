/* tools.js — Domain / IP / ASN dossiers (TERRA_MASTER_SPEC.md §6.5, §6.6).
   All lookups go through terraFetch (rate-limited, circuit-broken). Pro-only
   raw fields (DNSSEC flags, RDAP status codes) are labelled as such (§6.11).
   Personal RDAP contact fields are redacted — registrar/org and abuse role only (§10). */

function showMarker(lat, lng, label) {
  window.ipMarker = { lat, lng, alt: .012, r: .55, col: '#4cc3ff', tip: `<b>${esc(label)}</b>` };
  layers();
  fly({ lat, lng }, 1.4, 1200);
}

const RRTYPE = { A: 1, AAAA: 28, CNAME: 5, MX: 15, NS: 2, TXT: 16, SOA: 6, CAA: 257 };

async function doh(resolver, name, type) {
  const query = { name, type };
  if (resolver === 'doh_cloudflare' || resolver === 'doh_quad9') Object.assign(query, {});
  const r = await terraFetch(resolver, { query });
  return r || {};
}
function rr(r) { return (r.Answer || []).map(a => ({ v: a.data, ttl: a.TTL, type: a.type })); }

/* ---------------- domain dossier (§6.5) ---------------- */
async function openDomainDossier(domain) {
  if (!TERRA_NET.toolAllowed()) { toast('Slow down a little — try again in a minute'); return; }
  openPanel(`<div class="hero" style="background:linear-gradient(135deg,#152238,#0c2c40)"><button id="x">✕</button>
    <div class="in"><div><h2>${esc(domain)}</h2><p>Looking up DNS, registration and hosting…</p></div></div></div>
    <div class="sk"></div><div class="sk" style="width:70%"></div>`);

  const types = ['A', 'AAAA', 'MX', 'NS', 'TXT'];
  const jobs = [];
  for (const res of ['doh_google', 'doh_cloudflare'])
    for (const t of types) jobs.push(doh(res, domain, t));
  const [gA, gAAAA, gMX, gNS, gTXT, cA, cAAAA, cMX, cNS, cTXT, rdap, spf, dmarc] = await Promise.all([
    ...jobs,
    terraFetch('rdap_domain', { path: { domain } }),
    terraFetch('doh_google', { query: { name: domain, type: 'TXT' } }),
    terraFetch('doh_google', { query: { name: `_dmarc.${domain}`, type: 'TXT' } })
  ]);
  const G = { A: gA, AAAA: gAAAA, MX: gMX, NS: gNS, TXT: gTXT };
  const C = { A: cA, AAAA: cAAAA, MX: cMX, NS: cNS, TXT: cTXT };

  const agree = types.every(t => {
    const a = rr(G[t]).map(x => x.v).sort().join('|'), b = rr(C[t]).map(x => x.v).sort().join('|');
    return a === b;
  });

  let h = `<div class="hero" style="background:linear-gradient(135deg,#152238,#0c2c40)"><button id="x">✕</button>
    <div class="in"><div><h2>${esc(domain)}</h2><p>Resolvers ${agree ? '<b style="color:#3ddc97">agree</b>' : '<b style="color:#ffb020">differ</b>'}${PRO ? ` · DNSSEC ${gA && gA.AD ? '<b style="color:#3ddc97">validated</b>' : 'not validated'}` : ''}</p></div></div></div>`;

  /* --- DNS records --- */
  h += `<div class="sec"><h4>DNS records ${chip('Google & Cloudflare DoH', 'DNS-over-HTTPS · public resolvers')}</h4>`;
  for (const t of types) {
    const ga = rr(G[t]), ca = rr(C[t]);
    if (!ga.length && !ca.length) continue;
    h += `<div class="row"><span class="nm">${t}</span><span style="flex:1">
      ${ga.map(x => `<div style="font:500 12px Inter;word-break:break-all">${esc(x.v)} <small style="color:var(--dim)">TTL ${x.ttl}</small></div>`).join('') || '<span style="color:var(--dim)">no answer</span>'}
      ${ca.map(x => esc(x.v)).join('|') !== ga.map(x => esc(x.v)).join('|') ? `<div style="color:var(--dim);font-size:11px">Cloudflare: ${ca.map(x => esc(x.v)).join(', ') || 'no answer'}</div>` : ''}
    </span></div>`;
  }
  h += `</div>`;

  /* --- Registration (RDAP) --- */
  h += `<div class="sec"><h4>Registration ${chip('RDAP', 'RDAP — the modern WHOIS. Personal data redacted.')}</h4>`;
  if (rdap) {
    const events = Object.fromEntries((rdap.events || []).map(e => [e.eventAction, e.eventDate]));
    const reg = (rdap.entities || []).find(e => (e.roles || []).includes('registrar'));
    const regName = reg && ((reg.vcardArray && reg.vcardArray[1] || []).find(v => v[0] === 'fn') || [])[3];
    const ns = (rdap.nameservers || []).map(n => n.ldhName).filter(Boolean);
    const created = events.registrar || events.registration, expires = events.expiration;
    const daysLeft = expires ? Math.round((new Date(expires) - Date.now()) / 86400000) : null;
    h += `<div class="grid">
      <div class="k"><small>Registrar</small><b style="font-size:13px">${regName ? esc(regName) : '—'}</b></div>
      <div class="k"><small>Registered</small><b style="font-size:13px">${created ? esc(created.slice(0, 10)) : '—'}</b></div>
      <div class="k"><small>Expires</small><b style="font-size:13px">${expires ? esc(expires.slice(0, 10)) : '—'}${daysLeft != null ? ` · ${daysLeft > 0 ? daysLeft + ' days' : 'expired'}` : ''}</b></div>
      <div class="k"><small>Nameservers</small><b style="font-size:11px;word-break:break-all">${ns.slice(0, 3).map(esc).join('<br>') || '—'}</b></div>
    </div>`;
    const ageDays = created ? Math.round((Date.now() - new Date(created)) / 86400000) : null;
    if (ageDays != null && ageDays < 30)
      h += `<div class="ex" style="margin-top:8px;color:#ffb020">In plain English: this name was registered only ${ageDays} days ago. Very new sites are more often used in scams — be careful.</div>`;
    if (PRO && rdap.status && rdap.status.length)
      h += `<div class="ex" style="margin-top:8px;font-size:11px">Status: ${rdap.status.map(esc).join(' · ')}</div>`;
  } else {
    h += `<div class="ex">Registration data is unavailable right now.</div>`;
  }
  h += `</div>`;

  /* --- Email health --- */
  const txts = (r) => rr(r).map(x => x.v);
  const spfRec = txts(spf).find(t => t.toLowerCase().startsWith('v=spf1'));
  const dmarcRec = txts(dmarc).find(t => t.toLowerCase().startsWith('v=dmarc1'));
  const mxRecs = rr(gMX).map(x => x.v);
  const dkim = await Promise.all(['default', 'google', 'selector1'].map(s =>
    terraFetch('doh_google', { query: { name: `${s}._domainkey.${domain}`, type: 'TXT' } })));
  const dkimFound = ['default', 'google', 'selector1'].filter((s, i) => rr(dkim[i]).length);
  const row = (ok, label, note) => `<div class="row"><span class="nm" style="color:${ok ? '#3ddc97' : '#ffb020'}">${ok ? '✓' : '○'} ${label}</span><span style="flex:1;color:var(--dim);font-size:11.5px">${note}</span></div>`;
  h += `<div class="sec"><h4>Email health ${chip('DoH lookups', 'Pure DNS — no email is ever sent')}</h4>
    ${row(!!spfRec, 'SPF', spfRec ? esc(spfRec.slice(0, 80)) : 'No SPF record found — mail may be forged')}
    ${row(!!dmarcRec, 'DMARC', dmarcRec ? esc(dmarcRec.slice(0, 80)) : 'No DMARC record found')}
    ${row(dkimFound.length > 0, 'DKIM', dkimFound.length ? 'Found for selectors: ' + dkimFound.map(esc).join(', ') : 'No DKIM key found for common selectors')}
    ${row(mxRecs.length > 0, 'MX', mxRecs.length ? mxRecs.slice(0, 3).map(esc).join(', ') : 'No mail servers published')}
    <div class="ex" style="margin-top:6px;font-size:11px">In plain English: these records stop others from sending email that looks like it's from this domain. Missing ones don't mean a site is bad — but they're easy to add.</div></div>`;

  /* --- Where it lives --- */
  const firstA = rr(gA)[0] && rr(gA)[0].v;
  if (firstA) {
    const ipinfo = await terraFetch('ipwho', { path: { ip: firstA } }) || await terraFetch('geojs', { path: { ip: firstA } });
    const lat = ipinfo && (ipinfo.latitude ?? ipinfo.latitude), lng = ipinfo && (ipinfo.longitude ?? ipinfo.longitude);
    h += `<div class="sec"><h4>Where it lives ${chip('ipwho.is', 'IP geolocation is approximate and database-derived')}</h4>
      <div class="grid">
        <div class="k"><small>Server IP</small><b style="font-size:13px">${esc(firstA)}</b></div>
        <div class="k"><small>Hosting area</small><b style="font-size:13px">${esc((ipinfo && (ipinfo.city || ipinfo.country)) || 'unknown')}</b></div>
        <div class="k"><small>Network</small><b style="font-size:13px">${esc((ipinfo && (ipinfo.connection && ipinfo.connection.isp || ipinfo.asn)) || '—')}</b></div>
        <div class="k"><small>Approx. location</small><b style="font-size:13px">${lat != null ? Number(lat).toFixed(1) + ', ' + Number(lng).toFixed(1) : '—'}</b></div>
      </div>
      <button class="btn" id="ipd" style="margin-top:10px">Open IP dossier for ${esc(firstA)}</button>
      ${lat != null ? `<div class="ex" style="margin-top:8px;font-size:11px">Plotted on the globe — the marker is approximate.</div>` : ''}
    </div>`;
    if (lat != null) setTimeout(() => showMarker(Number(lat), Number(lng), domain + ' · ' + firstA), 100);
    setTimeout(() => { const b = $('#ipd'); if (b) b.onclick = () => openIpDossier(firstA); }, 0);
  }

  $('#panel').innerHTML = h; xBtn(closeP);
  const ipb = $('#ipd'); if (ipb && firstA) ipb.onclick = () => openIpDossier(firstA);
}

/* ---------------- IP dossier (§6.6) ---------------- */
async function openIpDossier(ip) {
  if (!TERRA_NET.toolAllowed()) { toast('Slow down a little — try again in a minute'); return; }
  openPanel(`<div class="hero" style="background:linear-gradient(135deg,#152238,#0c2c40)"><button id="x">✕</button>
    <div class="in"><div><h2>${esc(ip)}</h2><p>Looking up network and location…</p></div></div></div><div class="sk"></div><div class="sk" style="width:70%"></div>`);
  const [info, geo, rdap, ripe] = await Promise.all([
    terraFetch('ipwho', { path: { ip } }),
    terraFetch('geojs', { path: { ip } }),
    terraFetch('rdap_ip', { path: { ip } }),
    terraFetch('ripestat', { query: { resource: ip, sourceapp: 'terra-open-atlas' } })
  ]);
  const g = info || {};
  const lat = g.latitude ?? (geo && Number(geo.latitude)), lng = g.longitude ?? (geo && Number(geo.longitude));
  const country = g.country || (geo && geo.country) || '—';
  const city = g.city || (geo && geo.city) || '';
  const asn = (g.connection && g.connection.asn) || (geo && geo.asn) || (ripe && ripe.data && ripe.data.asns && ripe.data.asns[0]);
  const isp = (g.connection && g.connection.isp) || (geo && geo.org) || '—';
  const netRec = rdap && (rdap.name || (rdap.cidr0_cidrs || [])[0] && (rdap.cidr0_cidrs || [])[0].v4prefix);
  const abuse = rdap && (rdap.entities || []).find(e => (e.roles || []).includes('abuse'));
  const abuseMail = abuse && ((abuse.vcardArray && abuse.vcardArray[1] || []).find(v => v[0] === 'email') || [])[3];

  let h = `<div class="hero" style="background:linear-gradient(135deg,#152238,#0c2c40)"><button id="x">✕</button>
    <div class="in"><div><h2>${esc(ip)}</h2><p>${esc([city, country].filter(Boolean).join(', '))} · ${esc(isp)}</p></div></div></div>`;
  h += `<div class="sec"><div class="grid">
    <div class="k"><small>Country ${chip('ipwho.is', 'IP geolocation is approximate and database-derived')}</small><b style="font-size:13px">${esc(country)}</b></div>
    <div class="k"><small>City (approx.)</small><b style="font-size:13px">${esc(city) || '—'}</b></div>
    <div class="k"><small>ASN</small><b style="font-size:13px">${asn ? esc(String(asn).startsWith('AS') ? asn : 'AS' + asn) : '—'}</b></div>
    <div class="k"><small>Network operator</small><b style="font-size:12px">${esc(isp)}</b></div>
    ${netRec ? `<div class="k"><small>Network block ${chip('RDAP', 'Registry record; contact data redacted')}</small><b style="font-size:12px;word-break:break-all">${esc(String(netRec))}</b></div>` : ''}
    ${abuseMail ? `<div class="k"><small>Abuse contact</small><b style="font-size:12px">${esc(abuseMail)}</b></div>` : ''}
  </div>
  <div class="ex" style="margin-top:8px;font-size:11px">IP geolocation is approximate and database-derived — never exact. Personal contact details in registry records are hidden.</div>
  ${asn ? `<button class="btn" id="asnd" style="margin-top:10px">Open ASN dossier for AS${esc(String(asn).replace(/^AS/i, ''))}</button>` : ''}
  </div>`;
  if (lat != null) {
    h += `<div class="sec"><h4>On the map</h4><div class="ex">Approximate location plotted on the globe.</div></div>`;
    setTimeout(() => showMarker(Number(lat), Number(lng), ip), 100);
  }
  $('#panel').innerHTML = h; xBtn(closeP);
  const ab = $('#asnd'); if (ab) ab.onclick = () => openAsnDossier('AS' + String(asn).replace(/^AS/i, ''));
}

/* ---------------- ASN dossier ---------------- */
async function openAsnDossier(asn) {
  if (!TERRA_NET.toolAllowed()) { toast('Slow down a little — try again in a minute'); return; }
  const num = asn.replace(/^AS/i, '');
  openPanel(`<div class="hero" style="background:linear-gradient(135deg,#152238,#0c2c40)"><button id="x">✕</button>
    <div class="in"><div><h2>${esc(asn)}</h2><p>Looking up the network operator…</p></div></div></div><div class="sk"></div><div class="sk" style="width:70%"></div>`);
  const [rdap, overview, prefixes] = await Promise.all([
    terraFetch('rdap_autnum', { path: { asn: num } }),
    terraFetch('ripestat', { query: { resource: asn, sourceapp: 'terra-open-atlas' }, path: {} }),
    terraFetch('ripestat', { query: { resource: asn, sourceapp: 'terra-open-atlas' } })
  ]);
  const holder = (rdap && rdap.name) || (overview && overview.data && overview.data.holder) || '—';
  let h = `<div class="hero" style="background:linear-gradient(135deg,#152238,#0c2c40)"><button id="x">✕</button>
    <div class="in"><div><h2>${esc(asn)}</h2><p>${esc(holder)}</p></div></div></div>`;
  h += `<div class="sec"><div class="grid">
    <div class="k"><small>Holder ${chip('RDAP', 'Registry record; contact data redacted')}</small><b style="font-size:13px">${esc(holder)}</b></div>
    <div class="k"><small>Range</small><b style="font-size:13px">${rdap && rdap.startAutnum != null ? esc(String(rdap.startAutnum)) + '–' + esc(String(rdap.endAutnum)) : '—'}</b></div>
  </div>
  <div class="ex" style="margin-top:8px;font-size:11px">An ASN (Autonomous System Number) identifies one organisation that routes internet traffic — an internet provider, a company, or a hosting provider.</div></div>`;
  $('#panel').innerHTML = h; xBtn(closeP);
}

/* ---------------- My connection (explicit click only — C7) ---------------- */
async function myConnection() {
  const r = await terraFetch('ipify') || await terraFetch('geojs_ip');
  const ip = r && (r.ip || (typeof r === 'object' && r.ip));
  if (!ip) { toast('Could not determine your connection right now'); return; }
  openIpDossier(ip);
}
