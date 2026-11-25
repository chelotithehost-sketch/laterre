# 🌍 TERRA — Live World Atlas (TERRA PRIME build)

An interactive 3D globe built with **Streamlit** and **globe.gl** (WebGL). Hover a country to
see a statistic, click it to open a live dashboard, compare two countries side by side, search
for any country / city / domain / IP / ASN from one box, and watch earthquakes, hazards, flights
and the ISS in real time.

**No API keys. No accounts. No paid services.** Built from `TERRA_MASTER_SPEC.md` (milestones
M0–M3 partially complete — see *Build status* below).

## Quick start

```bash
pip install -r requirements.txt
streamlit run app.py
```

Open the URL Streamlit prints (usually http://localhost:8501). First load takes a few seconds
while the World Bank data is fetched; it is then cached for 24 h. The **browser** needs internet
access (map shapes, textures, fonts and click-time APIs come from public CDNs/APIs).

## Build status (vs. TERRA_MASTER_SPEC.md milestones)

| # | Milestone | Status |
|---|---|---|
| M0 | §3 layout, `sources.yaml`, `net.py` + `net.js` choke points, `check_apis.py` | ✅ done |
| M1 | Lens/layer trims (§4.6): merged Electricity-mix lens, merged Hazards layer (EONET+GDACS de-dup), Frankfurter → ExchangeRate-API, OpenSky TTL 600 s + adsb.lol fallback | ✅ done |
| M2 | Universal omnibox + router (country, city, domain, IPv4/IPv6, ASN, lat,lng), country + city dossiers, point card (reverse geocode, elevation, nearby), `?q=` deep links | ✅ done |
| M2.5 | Everyday Mode (§6.10/§6.11): home cards, Trip Card, Weather plainly, Safety, Website Check, Is-it-down, Call-time, Money, What's happening (RSS headlines), Learn & play, Around me, "Ask" bar, glossary tooltips, Simple/Pro switch, i18n skeleton, print CSS | ✅ done |
| M3 | Domain / IP / ASN dossiers (DoH ×2, RDAP, ipwho/geojs, RIPEstat) + Network Lab tab (TLS, headers, rDNS, email DNS health, CT subdomains, SSRF-guarded) | ✅ done (UI polish pending) |
| M4 | Space & Earth layers: SWPC Kp/aurora layer, launches, merged Hazards, Today card + ticker | ✅ done (rain radar & GIBS tiles dropped — see limitations) |
| M5 | Visual pass: adaptive quality governor (Ultra/High/Balanced/Lite, auto-downgrade), intro title card, `prefers-reduced-motion`, mobile CSS | ✅ core done (terminator shader / clouds / bloom deferred) |
| M6 | Toolbox drawer (unit/CIDR/timestamp/coordinate/encode-decode), Sources & Licences modal, diagnostics drawer (`⚙︎` / `?debug`), text-size control A−/A+, provenance chips, glossary tooltips | ✅ done |
| M7 | Docs (this README + SECURITY.md), deployment steps, verification commands | ✅ done (screenshots pending a browser session) |

## Architecture (spec §3)

```
terra_master/
├─ app.py                  # Streamlit entrypoint: 🌐 Globe tab (iframe) + 🛰️ Network Lab tab
├─ requirements.txt        # streamlit, requests, pyyaml, defusedxml — nothing else
├─ sources.yaml            # THE single manifest: every endpoint URL lives here, nowhere else
├─ data/                   # curated static datasets (emergency numbers, plugs, glossary, …)
├─ .streamlit/config.toml  # dark theme
├─ terra/                  # Python package
│  ├─ net.py               # rate-limited, cached, retrying HTTP client (server choke point)
│  ├─ data_worldbank.py    # lens data (cached 24 h, parallel)
│  ├─ data_live.py         # quakes, hazards, flights, AQ, trending, FX snapshot
│  ├─ tools_server.py      # rDNS, TLS, header probe, crt.sh — all SSRF-guarded (§10)
│  └─ bundle.py            # JSON payload + web/ assets → one self-contained HTML page
├─ web/                    # inlined into the iframe at runtime
│  ├─ template.html  styles.css
│  └─ js/            # net.js (browser choke point), globe.js, layers.js, ui.js,
│                    # search.js (omnibox router), dossier.js, tools.js, compare.js, iss.js
└─ scripts/
   ├─ check_apis.py        # endpoint health + CORS verification (run before relying on APIs)
   ├─ validate_data.py     # fails if any data/ record lacks source_url/as_of/verified
   └─ check_chokepoints.sh # lint: fetch() only in net.js; requests.* only in net.py/tools_server.py
```

How it works: Python fetches the heavy data (cached, parallel) and embeds it as JSON into one
HTML page rendered in a sandboxed iframe. All interaction (rotate, hover, search, compare,
lens switching, dossiers) happens in the browser **without Streamlit reruns**. Click-time
details are fetched by the browser through `web/js/net.js` — a per-host token-bucket rate
limiter with cache, in-flight de-dupe, backoff, and a circuit breaker (3 failures → source
marked offline 5 min, fallback takes over).

## Verification (run these!)

```bash
python scripts/check_apis.py            # 68 checks — all REQUIRED sources pass
python scripts/validate_data.py         # data/ provenance gate — passes
bash scripts/check_chokepoints.sh       # choke-point lint — passes
```

### API verification results (2026-11-19)

- **Verified & used:** World Bank, USGS, EONET, GDACS, Open-Meteo (weather/AQ/elevation/archive),
  ~~REST Countries~~ (dropped — v5 needs a key, see deviation 7) → mledoze/countries + Wikidata SPARQL,
  Nager.Date, Wikipedia (summary + geo + pageviews + featured + on-this-day),
  ISS (wheretheiss.at), OpenSky, adsb.lol, ExchangeRate-API, Open-Meteo geocoding, Photon,
  Nominatim, Wikidata, flagcdn, Google DoH, Cloudflare DoH, RDAP (domain + autnum), ipwho.is,
  GeoJS, ipify, RIPEstat, NOAA SWPC (Kp), Launch Library 2, NASA GIBS, RainViewer, HN, MyMemory,
  Big Mac CSV, BBC/Al Jazeera/DW/France 24/NPR/CNA/Africanews/teleSUR feeds, all CDN assets.
- **Dropped after verification (spec §11 rule — never faked):**
  - `doh_quad9` — unreachable from the test host; only two resolvers are used.
  - `ioda` (internet outage signals) — API unreachable; **the Internet-outage layer is not shipped**.
  - `who_gho` — works but **no CORS**, so the optional Health lens is not shipped (browser can't fetch it).
  - Africanews RSS canonical URL 404s → switched to `/feed` (verified); teleSUR is flaky (413 at
    times) and degrades quietly.
- **Kept with graceful degradation:** crt.sh (502/flaky — button with loading state, server-side),
  GDELT (slow/timeouts — on-demand only), rdap_ip (ARIN redirects can time out — panel shows
  "unavailable right now"), OpenSky (anonymous quota — 10 min TTL, adsb.lol fallback).

### Deviations from the spec (conservative choices)

1. **OpenSky TTL = 600 s** (not 2 min as the old README implied) per §4.2 warning.
2. **Frankfurter removed** → one cached daily `er_api` snapshot embedded in the payload (§4.6).
3. **Four electricity lenses merged** into one "Electricity mix" lens with a segmented control (§4.6).
4. **EONET + GDACS merged** into one Hazards layer, de-duplicated by category + 100 km + 48 h (§4.6).
5. **Quad9 / IODA / WHO-Health** dropped as above; `sources.yaml` keeps the entries with
   `cors_verified: false` so the Sources panel can show what exists but is unused.
6. Country polygons load from a **pinned jsDelivr Natural Earth copy** with the globe.gl example
   file as fallback (§9), both verified 200.
7. ⚠️ **REST Countries dropped (2026-11-19 mid-build):** restcountries.com deprecated v3.1 and
   the replacement v5 **requires an API key** → violates constraint C1 → not used. Replaced by:
   **mledoze/countries** (MIT, the dataset REST Countries used to serve) embedded at start-up for
   facts, **flagcdn** for flags, one bulk **Wikidata SPARQL** for driving side (247/250 countries),
   **World Bank** for population (labelled with year), Open-Meteo geocoding for capital coordinates.
   The deprecated entries stay in `sources.yaml` (`deprecated: true`) for the Sources panel.
8. **Website Check HTTPS/certificate:** the sandboxed iframe cannot probe TLS (no CORS), so the
   card checks name age, lookalikes, punycode and hosting in-browser and points to the 🛰️
   Network Lab "TLS certificate" tool for the certificate check. "Is it down" uses a network-level
   no-cors probe (can't read status codes — honest one-sentence answers only).
9. **Headlines**: 8 publisher feeds registered (≥ 5 from ≥ 4 regions required); at build time
   BBC/Al Jazeera/France 24/NPR/Africanews served fine while DW/CNA/teleSUR were flaky — feeds
   that fail are hidden quietly and the balance rule holds.

## Features (as shipped)

| Feature | What it does |
|---|---|
| **Colour lenses** | 11 lenses incl. a segmented Electricity mix (renew/fossil/nuclear/hydro): GDP/person, internet users, mobile subs, life expectancy, population, urban share, unemployment, energy use, PM2.5, CO₂/person |
| **Hover cards** | Country name, value, data year and global rank |
| **Country dossier** | Flag, capital, population, area, languages, currency + daily USD rate, capital weather + 5-day forecast, live AQ, next public holiday, electricity-mix bar, World Bank snapshot, Wikipedia summary — every block with a **source chip** |
| **City dossier** | Local clock + UTC offset + DST note (browser `Intl`), weather + forecast, AQ, sunrise/sunset/day length, UV, elevation, Wikipedia + nearby landmarks, "distance to…" |
| **Point card** | Click anywhere (land or sea): reverse geocoded place (Photon → Nominatim), elevation, local time, weather, nearby Wikipedia |
| **Universal search** | `/` to focus — routes country names, cities, domains, IPv4/IPv6, ASNs and `lat,lng` (`?q=` deep links work) |
| **Domain dossier** | DNS from Google + Cloudflare DoH side by side (agree/differ badge, TTLs, DNSSEC), RDAP registration with expiry countdown + age warning, email health (SPF/DMARC/DKIM/MX), hosting location plotted on the globe |
| **IP / ASN dossier** | Geolocation (labelled approximate), ISP, ASN holder, network block, abuse contact (role only), globe marker. **My connection** only on explicit click |
| **Compare mode** | Arc between two countries, side-by-side bars per lens, local times, distance + flight estimate (labelled), swap |
| **Network Lab tab** | TLS certificate, HTTP headers/redirects, reverse DNS, email DNS health, CT subdomains — all SSRF-guarded, throttled 10/min per session, no logging |
| **Live layers** | Earthquakes (USGS), Hazards (EONET+GDACS merged), flights (OpenSky → adsb.lol), city air quality, ISS, Aurora forecast (NOAA SWPC ovation, intensity-scaled) |
| **Today card** | Next rocket launches (Launch Library 2), Kp index + aurora chance, featured article + picture of the day, largest quake, moon phase (local calc) |
| **Toolbox** | Unit converter, CIDR calculator, timestamp converter, coordinate DD↔DMS, Base64/URL/SHA-256/UUID/JWT (all local — nothing leaves the browser), distance & bearing |
| **Everyday Mode** | "What do you need today?" home cards: ✈️ Trip Card (best months, packing, money, plugs, driving side, emergency numbers, phrasebook with read-aloud, holidays, official travel-advice links, print/PDF), 🌦️ Weather plainly (umbrella/jacket/run/sunscreen with fixed thresholds), 🆘 Safety (quakes/hazards/AQ/emergency numbers), 🛡️ Website Check (age, lookalikes, punycode, hosting — never says "safe"), 📡 Is-it-down, 🕐 Call-time traffic light + meeting finder, 💱 Money converter + Big Mac note, 📰 Headlines (5+ publishers, 4+ regions, interleave + dedupe + filters), 🎓 Learn & play (daily quizzes, 100-people facts), 📍 Around me (explicit-tap geolocation) |
| **Ask bar** | Rule-based (no AI): "time in Tokyo", "weather in Lagos", "100 usd to eur", "is example.com down/safe", "plug in Japan", "emergency number France", "distance Paris to Rome", "best time to visit Peru", "what's my ip", "headlines", "news in Brazil" |
| **Simple / Pro** | Simple is the default; Pro reveals DNS/RDAP jargon (session-remembered). Glossary tooltips on technical terms |
| **Display** | Dark / Satellite / Night imagery, relief extrusion, auto-rotate, 1.5 s intro title card, adaptive quality governor (auto-downgrades under 40 fps), reduced-motion respected |
| **Footer** | Freshness bar + **Sources & Licences** modal (every provider + licence + terms link) + **Diagnostics** drawer (`?debug`: token buckets, cache hits, offline sources, quality tier) + text-size A−/A+ |
| **Ticker** | Most-read English Wikipedia articles of the day |
| **Tools lint** | `check_chokepoints.sh` enforces the single-choke-point rule; `validate_data.py` gates `data/` |

## Data sources & licences

Every provider, endpoint, cache TTL, rate budget, licence and terms URL is listed in
**`sources.yaml`** — the same file the app, the health check and the rate limiter read.
Highlights: Natural Earth (public domain) · World Bank (CC BY 4.0) · USGS/NOAA/NASA (US Gov) ·
Open-Meteo (CC BY 4.0, non-commercial) · OpenStreetMap via Photon/Nominatim (ODbL) ·
Wikipedia/Wikimedia (CC BY-SA — links provided) · mledoze/countries (MIT), Nager.Date, flagcdn, ipwho.is,
GeoJS, ipify, RIPEstat, RDAP, GDACS, Launch Library 2, OpenSky, adsb.lol, ExchangeRate-API,
publisher RSS feeds (title + link only), GDELT, MyMemory, Economist Big Mac data — see terms in
`sources.yaml`. globe.gl / three.js / Streamlit: MIT / Apache-2.0.

*TERRA is not affiliated with National Geographic, NVIDIA or any listed provider.*

## Known limitations

- World Bank indicators are annual and lag 1–2 years; compare bars show the larger value, not "better".
- Flight arcs are back-projected from heading/speed (~40 min trails) — not filed flight routes.
- **Rain radar & NASA GIBS tile overlays** are not rendered as globe tiles (globe.gl has no simple tile overlay without extra three.js plumbing); the endpoints are verified and listed in `sources.yaml` for a future pass.
- **Terminator shader, cloud layer, bloom post-processing** (M5 cinematic pass) not yet implemented — the quality governor and reduced-motion support are in place for them.
- Screenshots for the README need a browser session.
- Free public APIs can rate-limit or go down; each layer fails independently and quietly.

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| Blank globe / "COULD NOT LOAD MAP DATA" | Browser can't reach jsDelivr/unpkg/GitHub raw. Check connection or ad-blocker. |
| Flights show "offline" | OpenSky rate-limits anonymous use; adsb.lol fallback engages; retry later. |
| A country has no data | The World Bank doesn't report every indicator for every territory — it renders grey. |
| Stale numbers | World Bank values cache 24 h and lag 1–2 years. Clear cache from the Streamlit menu (`C`). |
| "Slow down a little" toast | Browser tool budget (DNS/RDAP/IP ≤ 10 lookups/min) — wait a minute. |

## Security & privacy

- Server-side tools are **read-only public-data lookups**, SSRF-guarded (private/loopback/
  metadata ranges refused, re-checked after every redirect, ports 80/443 only). See `SECURITY.md`.
- No analytics, no cookies, no tracking, no query logging. Your own IP is looked up only after
  you click **My connection**. RDAP personal contacts are redacted.
- All remote strings are HTML-escaped before rendering (`esc()`), XSS-tested against hostile
  DNS TXT records.

## Credits & licences

Built with [globe.gl](https://globe.gl/) (MIT), [three-globe](https://github.com/vasturiano/three-globe)
(MIT) and [Streamlit](https://streamlit.io/) (Apache-2.0). Map data from Natural Earth
(public domain). Please follow each data provider's attribution and fair-use terms (see
`sources.yaml`) if you publish the app publicly.

## UI v2 (calm by default)

- On first load you see only each capital's **flag on a small pole with its current weather** (free Open-Meteo data,
  refreshed hourly; temperatures appear when you zoom in; if the weather API is down you get flags only). Earthquakes, ISS,
  hazards, air quality, aurora and the colour lenses appear only after you switch them on (**Data** / **Layers** buttons, left).
- **Simple / Pro** now changes the whole app: Simple hides technical lenses, layers, tools and dossier rows; Pro reveals them.
- Country panel opens instantly with **Capital, GDP per person, GDP (total), Population, Area, Languages, Currency**; hover cards show capital + GDP too.
- Top bar is a single flex row (brand · search · mode), so nothing overlaps; the panel pushes it aside when open.

## DNS report (Network Lab)

First tool in the Network tab: an intoDNS/LeafDNS-style report (Parent, NS, SOA, MX, WWW) using real DNS queries
(`dnspython`, UDP with TCP fallback). It walks the delegation from a root server to the parent, queries every
public nameserver directly, shows what Google/Cloudflare/OpenDNS/Quad9 currently cache (SOA serial), and links to
the cache-flush pages (cachecheck.opendns.com, dns.google/cache, one.one.one.one/purge-cache/).
Needs outbound port 53 (UDP and TCP). Private nameserver IPs are never queried.

## News globe (UI v3)

The numeric data lenses (World Bank) were removed — they returned no data. TERRA is now a real-time news & trends globe:

- **News** panel (left dock): publisher headlines (BBC, Al Jazeera, DW, France 24, NPR, CNA, Africanews, teleSUR, Guardian,
  ABC AU, Euronews, The Hindu, SCMP), Wikipedia *In the news* and Wikipedia *most read*.
- Every item is tagged to a country (by name, capital or demonym). Capitals with news get a pulsing red badge with the
  headline count; clicking opens the country with an **In the news** card.
- Ticker at the bottom mixes headlines and Wikipedia trends. Wikipedia refreshes in the browser every 10 min; RSS feeds
  refresh server-side every 15 min (all fetched in parallel, failing feeds are hidden quietly).
- Default map: flags standing on capitals with weather; layers (quakes, ISS, hazards, air quality, aurora) are opt-in.
