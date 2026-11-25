# 🌍 TERRA PRIME: Master Build Brief

> **Audience:** AI coding agents / AI website builders.
> **Goal:** Evolve the existing TERRA (Streamlit + globe.gl) into a single, beautiful "one world source of information" app: countries, cities, live hazards, space, network/DNS/WHOIS/IP intelligence, facts and everyday utilities. It must run on Streamlit Community Cloud or any host that points at the GitHub repo.
> **Absolute rules:** no API keys, no accounts, no paid services, open public endpoints only, strict rate-limit discipline.

Read this file fully before writing code. Where this brief says **MUST**, it is an acceptance criterion (see §14).

---

## 0. How to use this brief

1. Treat the uploaded `app.py`, `requirements.txt`, `README.md` and `LICENSE` as the baseline. Keep what works (parallel cached fetching, one-HTML-page globe, no reruns on interaction). Refactor into the layout in §3.
2. Build in the milestone order in §13. Do not start visual polish (M5) before data and rate limiting (M1–M2) are solid.
3. **Verify every endpoint before relying on it** (`scripts/check_apis.py`, §11). Free APIs change terms, CORS policy and quotas. Limits quoted here are conservative planning budgets, not guarantees. If an endpoint fails verification, use its listed fallback or drop the feature quietly.
4. Update `README.md` at the end so it matches what was actually built.

---

## 1. Product vision

**"Open the app, point at anywhere on Earth, and know it."**

- A cinematic 3D Earth is the home screen. Everything else (country, city, domain, IP, hazard) opens as a dossier from the globe or from one universal search box.
- **One search box understands anything:** country, city, domain (`example.com`), IPv4/IPv6, ASN (`AS13335`), or a lat,lng pair. It detects the type and routes to the right dossier.
- Every number on screen shows **where it came from and how fresh it is**. This is the "source of truth" promise (§6.9).
- It must feel like a premium documentary: National Geographic editorial calm + a modern game-engine render quality, and never like a dashboard of widgets.
- **Built for everyone, not just techies.** Two modes share one globe: **Simple mode (the default)** speaks plain language, answers real-life questions ("Do I need an umbrella?", "Is this website safe?", "What plug do I need in Japan?") and hides jargon. **Pro mode** (one tap, "Advanced tools") unlocks the DNS / RDAP / IP / TLS desk and the developer utilities. A grandparent, a student, a traveller and a sysadmin should each find their answer in under 10 seconds. See §6.10 and §6.11.

---

## 2. Hard constraints

| # | Constraint |
|---|---|
| C1 | **No API keys, accounts, tokens, or sign-ups.** Not even "demo keys" (so no NASA `DEMO_KEY`, no ReliefWeb appname, no Mapbox, no Google, no ipinfo token). |
| C2 | **Free and public only.** Open-data or open-source community services. No scraping of sites that forbid it. |
| C3 | **Respect rate limits and terms.** Use the shared rate-limit engine (§5) for *every* outbound call, browser or server. |
| C4 | **Zero secrets in the repo.** Deployable by pointing Streamlit Community Cloud (or Docker/any host) at the repo. `streamlit run app.py` must work on a clean machine after `pip install -r requirements.txt`. |
| C5 | **Stack:** Python + Streamlit for hosting/caching/server-side tools; HTML5, CSS3 and vanilla ES2022 JavaScript for the UI; globe.gl + three.js loaded from a pinned CDN version. No build step (no npm, no bundler). |
| C6 | **Graceful degradation.** Every layer, tool and panel fails independently and quietly (small "offline" chip, never a crash or blank screen). |
| C7 | **Privacy first.** No analytics, cookies or tracking. The visitor's own IP is looked up only after they click "My connection". Never log queries server-side (§10). |
| C8 | **Attribution.** Show a Sources & Licences panel and a footer credit for each active provider (§6.9, §12). |

---

## 3. Architecture & repository layout

Streamlit's `components.v1.html` / `st.iframe` renders **one self-contained HTML document** in a sandboxed iframe. All interaction inside it happens in the browser with no Streamlit reruns. Keep that. Some tools (TLS certificate, HTTP headers, reverse DNS) cannot run from a browser, so they run in Python as native Streamlit widgets.

```
terra/
├─ app.py                  # Streamlit entrypoint: layout, tabs/pages, injects web/ assets
├─ requirements.txt        # streamlit>=1.35, requests  (add only if truly needed)
├─ README.md  LICENSE
├─ sources.yaml            # single manifest of every API (see §4.1); app + health check read it
├─ data/                   # small curated static datasets (see §4.8): emergency numbers, plugs, glossary, phrasebook, brands
├─ .streamlit/config.toml  # dark theme, hide toolbar clutter, set fonts
├─ terra/                  # Python package
│  ├─ net.py               # rate-limited, cached, retrying HTTP client (§5.2)
│  ├─ data_worldbank.py    # lens data (cached 24h)
│  ├─ data_live.py         # quakes, hazards, flights, air quality, space weather (cached)
│  ├─ tools_server.py      # rDNS, TLS cert, HTTP header probe, crt.sh (SSRF-guarded, §10)
│  └─ bundle.py            # assembles JSON payload + inlines web assets into one HTML string
├─ web/                    # inlined into the iframe at runtime by bundle.py
│  ├─ template.html        # shell + placeholders  {{CSS}} {{JS}} {{DATA}}
│  ├─ styles.css           # design tokens + components
│  └─ js/
│     ├─ net.js            # client rate-limit engine (§5.1)
│     ├─ globe.js          # scene, shaders, layers, camera
│     ├─ search.js         # universal omnibox + router
│     ├─ dossier.js        # country / city / domain / IP panels
│     ├─ tools.js          # DNS, RDAP, IP, converters (CORS-capable tools)
│     ├─ today.js          # facts, on-this-day, ticker
│     ├─ everyday.js       # Simple-mode hubs: Trip, Today, Safety, Website Check, Money, Learn (§6.10)
│     ├─ intent.js         # rule-based "Ask" bar parser (no AI, no API)
│     ├─ i18n.js           # UI strings, RTL support, metric/imperial, 12/24 h
│     └─ ui.js             # panels, keyboard, a11y, toasts
├─ scripts/check_apis.py   # endpoint health + CORS check (§11)
├─ scripts/validate_data.py # schema + source/as_of check for everything in data/ (§4.8)
└─ .github/workflows/api-health.yml   # optional scheduled health check
```

**Native Streamlit tabs** around the globe:

1. **🌐 Globe** (the iframe: primary experience)
2. **🛰️ Network Lab** (server-side tools in `st.form` inside `@st.fragment`, so submitting a form never reloads the globe)
3. **🧰 Toolbox** (optional, client-side utilities; may live inside the globe as a drawer instead)

Fallback for older Streamlit: if `st.fragment` or `st.iframe` is missing, fall back to `components.html` and plain forms (README already notes this).

**Cross-origin reality check:** the iframe has an opaque/`srcdoc` origin, so browser `fetch` only works against endpoints that send `Access-Control-Allow-Origin: *`. Every API in §4 is tagged **B** (browser, CORS verified) or **S** (server only). Anything not CORS-enabled is fetched by Python and embedded or proxied via the tab forms. Never assume CORS: verify (§11).

---

## 4. API registry (free, keyless)

Legend: **B** = browser (CORS), **S** = Python server, **Fallback** = used if primary fails. "Budget" = the app's self-imposed ceiling (stay well below published limits).

### 4.1 `sources.yaml` manifest (MUST)

Every API gets one entry: `id, name, url_template, where (B|S), cors_verified, ttl_seconds, rate (requests per window per host), attribution, licence, terms_url, fallback_id`. `net.js`, `net.py`, the Sources panel and `check_apis.py` all read from this one file (Python reads YAML; inject the parsed JSON into the page). **No endpoint URL may be hard-coded outside this manifest.**

### 4.2 Keep (existing)

| ID | Purpose | Endpoint (pattern) | Where | Cache / budget | Notes |
|---|---|---|---|---|---|
| `worldbank` | Country indicators | `https://api.worldbank.org/v2/country/all/indicator/{code}?format=json&per_page=20000&mrnev=1` | S | 24 h | Fetch indicators in parallel with a small thread pool (≤ 5 concurrent). |
| `usgs` | Earthquakes | `https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_week.geojson` | S | 5 min | Public domain. Also `all_hour` for a "live now" pulse. |
| `eonet` | Wildfires, volcanoes, storms, sea ice | `https://eonet.gsfc.nasa.gov/api/v3/events?status=open` | S | 10 min | Merge with GDACS (§4.3), de-duplicate by type + 100 km + 48 h. |
| `openmeteo` | Weather, forecast, air quality, sunrise/sunset | `https://api.open-meteo.com/v1/forecast`, `https://air-quality-api.open-meteo.com/v1/air-quality` | B (click), S (city AQ layer) | Click: 15 min per location. Layer: 30 min | **Free tier is for non-commercial use** and has daily call limits. Batch multiple coordinates per call. Keep attribution visible. |
| `restcountries` | Country facts | `https://restcountries.com/v3.1/alpha/{cca3}?fields=...` | B | 24 h (session) | `fields` is limited to ~10 per request; make two calls or fetch once at start-up for all countries and embed (preferred: one S call, cached 24 h). |
| `nager` | Public holidays | `https://date.nager.at/api/v3/NextPublicHolidays/{cca2}` | B | 24 h | Some countries return empty; hide the row. |
| `wikipedia` | Summaries, images | `https://en.wikipedia.org/api/rest_v1/page/summary/{title}` | B | 24 h | Send `Accept` only; the browser cannot set a custom User-Agent, use `Api-User-Agent` header if allowed. CC BY-SA, so link to the article. |
| `wiki_pageviews` | Trending | `https://wikimedia.org/api/rest_v1/metrics/pageviews/top/en.wikipedia/all-access/{YYYY}/{MM}/{DD}` | S | 1 h | Use yesterday's date (today is incomplete). Filter out `Main_Page`, `Special:*`, `Wikipedia:*`. |
| `iss` | ISS position | `https://api.wheretheiss.at/v1/satellites/25544` | B | poll ≥ 6 s, pause when tab hidden | Dead-reckon between polls so motion is smooth. |
| `opensky` | Flights (primary) | `https://opensky-network.org/api/states/all` | S | **≥ 10 min** | ⚠️ The README's 2-minute TTL probably exceeds OpenSky's anonymous daily credit quota. Verify the current quota and raise TTL, or use a bounding box. Fallback: `adsb` below. |

### 4.3 Add: geography, places, facts

| ID | Purpose | Endpoint | Where | Budget | Notes |
|---|---|---|---|---|---|
| `geocode` | City search + city metadata (population, admin area, elevation, **IANA timezone**, country) | `https://geocoding-api.open-meteo.com/v1/search?name={q}&count=8` | B | debounce 350 ms, ≤ 1 req/s | Primary city source, so no account like GeoNames needed. |
| `photon` | Fallback place search / reverse geocode (OpenStreetMap data) | `https://photon.komoot.io/api/?q={q}`, `/reverse?lat=&lon=` | B | ≤ 1 req/s, fair use | Attribute © OpenStreetMap contributors (ODbL). |
| `nominatim` | Reverse geocode on globe click, **only if** `photon` fails | `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=&lon=` | B | **hard 1 req/s, no autocomplete, no bulk** | Strict usage policy; identify the app with a Referer/UA where possible. |
| `elevation` | Elevation at a point | `https://api.open-meteo.com/v1/elevation?latitude=&longitude=` | B | on click | Show "X m above sea level" in the click card. |
| `wikidata` | Structured facts: head of state, founded, area, coordinates, official site, ISO codes | `https://www.wikidata.org/w/api.php?action=wbgetentities&ids={Q}&format=json&origin=*` and SPARQL `https://query.wikidata.org/sparql?format=json&query=…` (sparingly) | B | ≤ 1 req/s, SPARQL ≤ 5/min | Used to **enrich**, never to block rendering. |
| `wiki_geo` | "What's near this point" | `https://en.wikipedia.org/w/api.php?action=query&list=geosearch&gscoord={lat}|{lon}&gsradius=10000&gslimit=10&format=json&origin=*` | B | on click | Gives landmarks and local articles near any click. |
| `onthisday` | Today in history | `https://api.wikimedia.org/feed/v1/wikipedia/en/onthisday/all/{MM}/{DD}` | B | 24 h | Powers the "Today" card. |
| `wiki_featured` | Featured article / picture of the day | `https://api.wikimedia.org/feed/v1/wikipedia/en/featured/{YYYY}/{MM}/{DD}` | B | 24 h | Beautiful hero imagery with credit lines. |
| `flags` | Flag images | `https://flagcdn.com/w320/{cca2lower}.png` (srcset w160/w320/w640) | B | lazy-load | Fallback: `flags.png` field from REST Countries. |
| `facts` | Random "did you know" | `https://uselessfacts.jsph.pl/api/v2/facts/today?language=en` | B | 24 h | Optional garnish; hide if offline. Prefer Wikipedia-derived facts for credibility. |

### 4.4 Add: DNS, domains, IP & internet intelligence

| ID | Purpose | Endpoint | Where | Budget | Notes |
|---|---|---|---|---|---|
| `doh_google` | DNS-over-HTTPS (A, AAAA, MX, NS, TXT, CNAME, SOA, CAA, DS, DNSKEY, PTR) | `https://dns.google/resolve?name={n}&type={t}&do=1` | B | ≤ 10 req/min per session | Response includes the `AD` flag (DNSSEC validated). |
| `doh_cloudflare` | Second resolver (compare / propagation) | `https://cloudflare-dns.com/dns-query?name={n}&type={t}` with `Accept: application/dns-json` | B | ≤ 10 req/min | Show a "Resolvers agree / differ" badge. |
| `doh_quad9` | Optional third resolver | `https://dns.quad9.net:5053/dns-query?name={n}&type={t}` | verify B | ≤ 10 req/min | Include only if CORS verifies; otherwise skip. |
| `rdap_domain` | **WHOIS replacement** (registrar, created/expires/updated, status, nameservers, DNSSEC) | `https://rdap.org/domain/{domain}` (bootstrap redirect) | B, S fallback | ≤ 6 req/min, cache 6 h | Port-43 WHOIS is blocked on most free hosts and not CORS, so **RDAP is the WHOIS**. Fallback: the TLD registry's own RDAP (e.g. Verisign for `.com/.net`) discovered via `https://data.iana.org/rdap/dns.json` (cache 7 d). Redact personal data: show organisation/registrar only. |
| `rdap_ip` | IP/ASN registry record (network name, CIDR, country, abuse contact) | `https://rdap.org/ip/{ip}`, `https://rdap.org/autnum/{asn}` | B, S fallback | ≤ 6 req/min | Same bootstrap mechanism. |
| `ipwho` | IP geolocation + ASN + connection + timezone + currency | `https://ipwho.is/{ip}` | B | ≤ 1 req/s, cache 24 h per IP | Primary. |
| `geojs` | IP geolocation fallback | `https://get.geojs.io/v1/ip/geo/{ip}.json` | B | ≤ 1 req/s | Fallback for `ipwho`. |
| `ipify` | "My public IP" | `https://api.ipify.org?format=json` | B | **only on user click** | Fallback: `https://get.geojs.io/v1/ip.json`. Never call on page load (C7). |
| `ripestat` | ASN holder, announced prefixes, routing status, abuse contact, geolocation of prefix | `https://stat.ripe.net/data/prefix-overview/data.json?resource={ip}`, `…/as-overview/…?resource=AS{n}`, `…/announced-prefixes/…` | B | ≤ 1 req/s | Gives the "who runs this network" story. Pass `sourceapp=terra-open-atlas` as RIPE requests. |
| `ioda` | Internet outage signals by country/ASN (Georgia Tech IODA) | `https://api.ioda.inetintelligence.cc/v2/…` | verify B/S | 15 min | Powers an **Internet health** lens/layer. If unavailable at verification time, drop it (do not fake it). |
| `crtsh` | Certificate-transparency subdomains | `https://crt.sh/?q=%25.{domain}&output=json` | **S only** | ≤ 2 req/min, 10 s timeout | Slow and flaky; optional "Discover subdomains" button with a clear loading state. |

**Server-side (Python stdlib / `requests`, no third party):**

| Tool | How | Guardrails |
|---|---|---|
| Reverse DNS (PTR) | `socket.gethostbyaddr` or DoH PTR | Validate IP; block private/reserved ranges. |
| TLS certificate | `ssl.create_default_context()` + `socket.create_connection((host, 443), timeout=5)` → issuer, subject, SANs, notBefore/notAfter, days left, protocol/cipher | SSRF guard (§10); 443 only. |
| HTTP header probe | `requests.head/get(url, allow_redirects=True, timeout=6, stream=True)` → status chain, `server`, security headers (HSTS, CSP, X-Frame-Options, Referrer-Policy, Permissions-Policy), redirect chain, TTFB | SSRF guard; max 5 redirects; read **no body**; http/https only. |
| Email DNS health | From DoH results: MX, SPF (`v=spf1`), DMARC (`_dmarc.`), common DKIM selectors, MTA-STS | Pure DNS, no mail sent. |

### 4.5 Add: Earth, hazards, space

| ID | Purpose | Endpoint | Where | Budget |
|---|---|---|---|---|
| `gdacs` | Floods, cyclones, droughts, volcano alerts with Green/Orange/Red level | `https://www.gdacs.org/gdacsapi/api/events/geteventlist/SEARCH?alertlevel=Orange;Red&eventlist=EQ;TC;FL;VO;DR;WF` (verify params) | S | 15 min |
| `swpc` | Space weather: Kp index, solar wind, aurora oval | `https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json`, `https://services.swpc.noaa.gov/json/ovation_aurora_latest.json` | B/S | 10 min |
| `launches` | Next rocket launches worldwide | `https://ll.thespacedevs.com/2.2.0/launch/upcoming/?limit=5&mode=list` | S | **≥ 30 min** (free tier is roughly 15 req/h; verify) |
| `gibs` | NASA daily true-colour satellite imagery tiles (VIIRS / MODIS) as a "Today from orbit" texture/overlay | `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_SNPP_CorrectedReflectance_TrueColor/default/{YYYY-MM-DD}/GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpg` (verify layer + level) | B | tile-lazy; use yesterday's date |
| `rainviewer` | Global precipitation radar tiles | `https://api.rainviewer.com/public/weather-maps.json` (then tile host/path from response) | B | 10 min | Verify terms and max zoom; drop if restricted. |
| `adsb` | Flights (fallback to OpenSky) | `https://api.adsb.lol/v2/point/{lat}/{lon}/{radius_nm}` | verify B/S | ≥ 60 s | Community, open. Use viewport-centred queries, not the whole planet. |
| `who_gho` | Health indicators (life expectancy, immunisation, etc.) | `https://ghoapi.azureedge.net/api/{IndicatorCode}?$filter=SpatialDim eq '{ISO3}'` | B | 24 h | Add as an optional "Health" lens group if it verifies. |
| `er_api` | Exchange rates (160+ currencies) | `https://open.er-api.com/v6/latest/USD` | S (once/day) | 24 h | Attribution required by its terms. |

### 4.6 Drop or merge (redundancy removal)

| Removed / merged | Why | Replacement |
|---|---|---|
| **Frankfurter** (`frankfurter.app`) | ECB reference rates cover only ~30 currencies, so most countries would show no rate. | `er_api` (one cached daily call serves every country, plus the currency converter). |
| 4 separate electricity lenses (renewable / fossil / nuclear / hydro) | Four near-identical colour ramps clutter the lens picker. | One **"Electricity mix"** lens with a segmented control (Renewable · Fossil · Nuclear · Hydro) over the same indicators. |
| "Urban population" vs "Population" | Largely correlated, low unique value. | Keep **Urban share (%)** only; absolute population stays. |
| EONET + GDACS as two separate layers | Overlapping disaster feeds. | One **Hazards** layer, typed icons/colours, de-duplicated, with source badge per event. |
| Two flight sources rendered at once | Double drawing, double quota. | One active flight source (`opensky` → `adsb` fallback). |
| Wikipedia summary **and** Wikidata **and** REST Countries repeating the same facts | Conflicting duplicates. | Use the source-precedence table in §6.9. |
| Unreliable/HTTP-only APIs (e.g. `api.open-notify.org`, NumbersAPI) | Mixed-content blocks; flaky. | Not used. |

### 4.7 Add: everyday-life data (keyless)

| ID | Purpose | Endpoint | Where | Budget | Notes |
|---|---|---|---|---|---|
| `climate_normals` | "Best time to visit": monthly average temperature and rainfall for any place | `https://archive-api.open-meteo.com/v1/archive?latitude=&longitude=&start_date=2015-01-01&end_date=2024-12-31&daily=temperature_2m_mean,precipitation_sum&timezone=auto` | B | one call per place, **cache 30 days**, on demand only | Average the 10 years into 12 monthly values in JS. Verify the payload size is acceptable; otherwise request fewer years. Same non-commercial terms as Open-Meteo. |
| `forecast_plus` | Simple-mode weather answers | Same Open-Meteo forecast call with extra `daily` fields: `uv_index_max, precipitation_probability_max, apparent_temperature_max/min, wind_gusts_10m_max, sunrise, sunset` | B | shared 15-min cache | No extra endpoint; just richer fields. |
| `news_rss` | **World headlines** from several publishers | Publisher RSS/Atom feeds fetched by Python, e.g. BBC World `https://feeds.bbci.co.uk/news/world/rss.xml`, Al Jazeera `https://www.aljazeera.com/xml/rss/all.xml`, DW `https://rss.dw.com/rdf/rss-en-all`, France 24 `https://www.france24.com/en/rss`, NPR `https://feeds.npr.org/1004/rss.xml` (verify every URL; add more regions, e.g. an Asian, an African and a Latin American outlet, if their feeds verify) | S | cache **15 min per feed**, ≤ 1 request per feed per 15 min | Parse with `defusedxml` (not stdlib `xml`, which is unsafe on untrusted XML). Keep **≥ 5 publishers across ≥ 4 regions** so no single viewpoint dominates. Store only headline, link, publisher, published time; no article body or images unless the feed's terms allow. Many feeds are licensed for non-commercial use only: record the terms in `sources.yaml`. |
| `gdelt` | **Headlines about one country, city or topic** across thousands of outlets worldwide | `https://api.gdeltproject.org/api/v2/doc/doc?query={query}&mode=artlist&maxrecords=10&format=json&sort=datedesc&timespan=24h` | verify B, else S | ≤ 1 request per 5 s, cache 15 min per query, **on demand only** (when a country/city/topic is opened) | Keyless GDELT DOC 2.0 API. Verify CORS, query syntax (e.g. `sourcelang:english`, `sourcecountry:`) and current rate guidance. Returns title, URL, domain, language and time. Cap 2 headlines per domain, dedupe near-identical titles, and drop results whose domain is missing or malformed. |
| `hn` | *(Pro mode, optional)* Tech headlines | `https://hacker-news.firebaseio.com/v0/topstories.json` then `/item/{id}.json` | B | cache 10 min, fetch ≤ 10 items | Public Firebase endpoint. Show as a small "Tech" tile in Pro mode only. |
| `mymemory` | "Say it in their language" machine translation for the travel phrasebook | `https://api.mymemory.translated.net/get?q={text}&langpair=en|{lang}` | B | tiny anonymous daily quota: only translate the **fixed phrasebook**, cache each result for 30 days in `sessionStorage`, max 5 calls/min | Label results "machine translation". Free-text translation is **off by default** and, if offered, warns that the text is sent to a third party. If it fails or quota is hit, show the phrase in English plus a link to look it up elsewhere. |
| `bigmac` | "Does my money go further there?" purchasing-power comparison | `https://raw.githubusercontent.com/TheEconomist/big-mac-data/master/output-data/big-mac-full-index.csv` | S | fetch weekly | Show the data date next to the answer. If the file is old, say so. Verify its licence. |
| `wiki_news` | "In the news" headlines (neutral, Wikipedia-curated) | Already inside `wiki_featured` (`news` array) | B | 1 h | Do not editorialise; link to the Wikipedia article. |

**Browser-native features (zero API, free):** Geolocation (only on button click), `Intl` (time zones, currency/number/date formatting, language names), `speechSynthesis` (read-aloud), `SpeechRecognition` where supported (voice search), Web Share API, `window.print()` with print CSS, `navigator.connection.saveData`.

### 4.8 Curated static datasets (`data/`)

Some everyday facts have no reliable keyless API (emergency numbers, plug types, travel-advisory pages). Ship them as **small, hand-verified JSON files** instead of inventing or scraping:

| File | Content | Rules |
|---|---|---|
| `emergency_numbers.json` | Police / ambulance / fire / single-number per country | Each record: `{country, numbers, source_url, as_of, verified}`. Compile from an authoritative public source and cross-check a second. |
| `plugs_voltage.json` | Plug/socket types (A-N), voltage, frequency per country | Same record shape. Cite the public source used. |
| `advisory_links.json` | Link-outs to **official government** travel-advice pages (e.g. UK FCDO, US State Dept, Australia Smartraveller, Canada) by country | Links only; never summarise or score risk ourselves. Verify each URL pattern. |
| `phrasebook.json` | ~25 universal travel phrases in English (hello, thank you, help, where is the toilet, how much, I need a doctor...) | Translated on demand via `mymemory` and cached. |
| `glossary.json` | Plain-English definitions of every technical term used (DNS, IP address, ASN, DNSSEC, TTL, AQI, Kp, magnitude...) | Max 25 words each; shown as tooltips. |
| `brands.json` | ~150 widely impersonated brand/bank/shipping domains for the Website Check's lookalike warning | Small, public, hand-maintained. |

**Rules:** any record with `verified: false` or a missing `source_url` is **not shown**; the UI says "Check official sources" and links out. `scripts/validate_data.py` fails the build if a record has no source or as-of date. Show `as of {date}` beside every static fact, because these change (numbers, plugs, rules).

---

## 5. Rate-limit & caching engine (MUST: single choke point)

### 5.1 Browser: `web/js/net.js`

Export `terraFetch(sourceId, url, opts)`; **no other `fetch` call is allowed in the codebase** (add a lint-style grep test).

- **Per-host token bucket** configured from `sources.yaml` (e.g. `{capacity: 5, refillPerSec: 1}`); requests queue instead of failing.
- **Cache:** memory `Map` + `sessionStorage` (wrapped in try/catch, as the sandboxed iframe may block storage) with per-source TTL; serve stale-while-revalidate for non-critical data.
- **In-flight de-dupe:** identical concurrent requests share one promise.
- **Debounce & cancel:** omnibox 350 ms; use `AbortController` to cancel superseded requests.
- **Backoff:** on 429/503, honour `Retry-After`, otherwise exponential backoff with jitter (1 s → 2 s → 4 s, max 3 tries).
- **Circuit breaker:** 3 consecutive failures → source marked **offline** for 5 min (UI chip) and its fallback takes over.
- **Visibility-aware polling:** `document.hidden` pauses ISS, flights and any timer. Resume with one immediate refresh.
- **Session budgets** for user-triggered tools: DNS/RDAP/IP ≤ 10 lookups/min, with a friendly "slow down" toast, not an error.
- Expose `window.TERRA_NET.stats()` (hits, misses, queued, offline sources) and show it in a hidden "Diagnostics" drawer (`?debug`).

### 5.2 Server: `terra/net.py`

- One `requests.Session` with a descriptive `User-Agent: TERRA-OpenAtlas/1.x (+https://github.com/<owner>/<repo>)`. Wikimedia, Nominatim and others require an identifying UA.
- `@st.cache_data(ttl=..., show_spinner=False)` on every fetcher, TTLs from `sources.yaml`.
- Per-host `threading.Semaphore` / min-interval throttle; parallel across hosts, serial within a host if it is sensitive.
- Timeouts (connect 3 s, read 8 s), **never** an unbounded request. Cold start must render within ~20 s worst case, with data layers filling in progressively.
- On failure return the last good cached value flagged `stale: true` rather than empty.

---

## 6. Features

### 6.1 The Globe (home)

- Colour **lenses** (§4.6 trimmed list) with smooth colour tweening between lenses and optional extrusion.
- Hover card: name, flag, value, year, global rank, percentile bar.
- Click anywhere (land or sea): **Point card**: reverse-geocoded place (Photon → Nominatim fallback), elevation, local time, weather, nearby Wikipedia landmarks, and a button *"Open dossier"*.
- Layers (toggle chips, each shows count + "updated 3 min ago"): Earthquakes · Hazards · Flights · ISS · City air quality · Aurora/Space weather · Rain radar · Internet outages (if verified) · Day/Night terminator · City lights.
- Display modes: **Cinematic** (default) · Satellite · Night · Political · Clean-minimal.
- **Tour mode:** a gentle auto-rotate with occasional "fly-to" of an interesting live event (largest quake, strongest storm, next launch site) with a one-line caption. Stops on any user input.

### 6.2 Universal omnibox (`/` to focus, `Esc` to clear)

Detect input type with regexes (IPv4/IPv6, `AS\d+`, domain with a public suffix heuristic, `lat,lng`, otherwise name search):

| Input | Route |
|---|---|
| `Japan`, `ja` | Country dossier |
| `Lahore` | City dossier (geocode, pick from list) |
| `example.com` | Domain dossier |
| `1.1.1.1` / `2606:4700::1111` | IP dossier (+ marker on globe at its geolocation) |
| `AS13335` | ASN dossier |
| `31.55, 74.34` | Point card |

Show a ranked suggestion list with icons per type. Keyboard navigable (↑ ↓ Enter), screen-reader friendly (`role="combobox"`).

### 6.3 Country dossier

Header: flag, name, official name, region, capital, ISO codes. Sections (collapsible, skeleton-loaded, each with source chip):
1. **Snapshot:** population, area, density, languages, currency + live rate vs USD, calling code, driving side, TLD, timezones.
2. **Live now:** capital local time, weather + 5-day forecast, air quality, sunrise/sunset, next public holiday, recent quakes/hazards within the country.
3. **By the numbers:** every lens with value, year, rank, sparkline if multi-year data is cheap to fetch.
4. **Electricity mix:** stacked bar.
5. **Internet:** TLD, internet users %, outage signal (if `ioda` verified), top ASNs/prefix count (RIPEstat country resource if verified).
6. **Story:** Wikipedia summary + hero image + "Today in history" for that country where available (filter `onthisday` by keyword), plus **Latest headlines** about that country (`gdelt`, loaded only when the section is opened).
7. **Compare:** one-click add to Compare.

### 6.4 City dossier

From `geocode` result: name, admin area, country, population, elevation, timezone, **live local clock + UTC offset + DST note** (computed with `Intl.DateTimeFormat`, no API), weather + forecast, air quality, sunrise/sunset/day length, Wikipedia summary, nearby landmarks (`wiki_geo`), "distance to…" (great-circle calc vs. another place the user picks).

### 6.5 Domain dossier (the "DNS / WHOIS" desk)

Single input → tabs:
- **DNS records:** A, AAAA, CNAME, MX, NS, TXT, SOA, CAA, DNSKEY/DS. Two resolvers side-by-side with an **agree/differ** badge and TTLs. Copy buttons. DNSSEC "validated" badge from the `AD` flag.
- **Registration (RDAP):** registrar, registry, created / updated / **expires (with countdown)**, status codes (explained in plain English), nameservers, DNSSEC. Personal data redacted.
- **Where it lives:** A/AAAA → IP dossier → ASN/network owner → geolocation plotted **on the globe** (fly-to marker).
- **Email health:** SPF · DMARC · DKIM (common selectors) · MX · MTA-STS, each pass/warn/fail with a one-line fix hint.
- **TLS & HTTP (server tab):** certificate chain summary, days to expiry, protocol; redirect chain and security-header scorecard.
- **Subdomains (optional, server):** via CT logs (`crtsh`), rate-limited, with a clear "this can take a while" state.
- **Shareable link:** `#domain=example.com` hash route (only a plain `#name` form passes between the iframe and the parent if hosted as an artifact; in Streamlit use `st.query_params` for deep links and keep the iframe state in memory).

### 6.6 IP & ASN dossier

Geolocation (country/region/city, approximate, labelled as such), ISP/org, ASN + holder, announced prefix/CIDR, RDAP network record + abuse contact (role address only), reverse DNS, timezone, currency, and map marker. Include a clear note: *"IP geolocation is approximate and database-derived."*
**My connection** button (explicit click): shows the visitor's IP, location estimate, ASN/ISP, and whether IPv6 is available.

### 6.7 Compare mode

Two countries (or two cities): arc on globe, side-by-side bars for every lens, live local time difference, weather, distance, flight-time estimate at 850 km/h (clearly labelled estimate), swap button. Highlight larger value without implying "better" (as in README).

### 6.8 Today & Utilities

- **Today:** On this day (3 curated events), featured article, picture of the day, trending articles ticker, a verified fact, next rocket launch, Kp/aurora chance.
- **Toolbox drawer (client-side, zero API unless noted):**
  - **World clock & meeting planner:** pick up to 5 places; shared slider shows overlapping working hours (`Intl` + IANA tz from geocode).
  - **Currency converter** (daily `er_api` snapshot).
  - **Unit converter** (length, mass, temperature, speed, area, volume, energy, data).
  - **Distance & bearing** between two points, **coordinate formats** (DD / DMS / UTM / Plus Code-style optional).
  - **Subnet / CIDR calculator** (IPv4 and IPv6) and **IP range → CIDR**.
  - **Hash / Base64 / URL-encode / UUID / JWT decoder** via Web Crypto + built-ins (local only; nothing leaves the browser, and say so in the UI).
  - **Timestamp converter** (Unix ↔ ISO ↔ local) and **Date maths**.
  - **ISO/E.164 helper:** calling codes, country codes, plug/voltage not available keylessly, so omit rather than invent.
  Keep each tool small, keyboard-first, copy-to-clipboard everywhere.

### 6.9 Truth & provenance layer ("one source of truth")

- Every datum carries `{value, unit, source_id, as_of, fetched_at, stale?}`.
- UI: a small **source chip** (e.g. `World Bank · 2022`) on each value; hover/tap reveals provider, licence and link. A **Freshness** bar in the footer summarises live layers ("Quakes 2 min · Flights 11 min · Weather 8 min").
- **Source-precedence rules** (to avoid conflicts):
  - Population/area/capital/currency/languages → REST Countries; cross-check World Bank population: if they differ > 10 %, show both with years.
  - Leaders, founding dates, official sites → Wikidata.
  - Narrative text → Wikipedia only (never merged with other prose).
  - Weather/air quality → Open-Meteo only.
  - Hazards → USGS for earthquakes (authoritative), GDACS/EONET for everything else.
- Disagreement or missing data is **shown honestly** ("Not reported by World Bank for this territory") and never fabricated or silently filled.
- **Sources & Licences** modal listing every active source from `sources.yaml` with licence + attribution text (§12).

### 6.10 Everyday Mode (Simple mode): the heart for non-technical users

**Home overlay (shown over the globe, dismissible, remembered per session):** "What do you need today?" with big, friendly cards. Each card opens a guided page on the right sheet (bottom sheet on mobile). Every answer is a short sentence first, details second.

| Card | What the person gets |
|---|---|
| **✈️ Plan a trip** | Pick a country or city. **Trip Card**: best months (12 bars from `climate_normals`, with "great / okay / avoid" ratings explained), what to pack (from the forecast), time difference from *you* (browser time zone), currency + "100 of yours ≈ X" with `er_api`, "money goes further" note (`bigmac`), plug type and voltage, driving side, emergency numbers, main languages + the **phrasebook with read-aloud**, public holidays to plan around (`nager`), links to **official** travel-advice pages, and the Wikipedia summary. **Print / Save as PDF / Share** as a one-page card (print CSS). |
| **🌦️ Weather, plainly** | "Should I...?" answers for any place: take an umbrella? wear a jacket? go for a run (air quality + heat + UV)? need sunscreen (UV index)? Sunrise/sunset and day length. Moon phase (computed locally, no API). Pollen only where the data exists; say "not available here" otherwise. Rules are fixed, visible thresholds (e.g. UV ≥ 6 → "Use sunscreen"), never a black box. |
| **🆘 Safety & alerts** | For a place: earthquakes in the last 7 days within 300 km, active hazards within 500 km (fires, storms, floods, volcanoes), air-quality advice in plain words, and the local **emergency number** big at the top. Always show: *"Follow your local authorities for official warnings."* No fear-mongering colours; use calm, consistent severity labels. |
| **🛡️ Is this website safe?** | Paste a link or name. Result is a **traffic light + plain sentences**, from only free checks: uses HTTPS and has a valid certificate (server probe), **how old the domain is** (RDAP; under 30 days → "very new sites are more often used in scams"), country where it is hosted, redirect hops, punycode/lookalike warning against `brands.json` (e.g. `paypa1.com`), and security headers as a footnote. Always end with: *"We can't prove a site is safe. If it asks for passwords, card numbers or urgent payment, stop and go to the company's official site yourself."* plus "Report a scam" link-outs. Never claim "safe", only "no warning signs found". |
| **📡 Is it down, or just me?** | Enter a site: server-side `HEAD` check (SSRF-guarded) + country-level outage signal if `ioda` verified. Answer in one sentence ("It's up for us, so the problem is probably on your side: try restarting your router."). Includes **My connection** in plain words: "You appear to be in {city}, using {ISP}." |
| **🕐 Good time to call?** | Choose a place. See their local time and a traffic light (09:00-20:00 green, 07:00-09:00 and 20:00-22:00 amber, otherwise red), with the day/night icon. Add up to 4 places for a quick meeting-time finder. |
| **💱 Money** | Converter with big keypad, recent-currencies memory (session), "what's this worth in {my currency}", purchasing-power note, and bank/public holidays that could delay things. |
| **📰 What's happening** | **Headlines** (see rules below): a "World" tab (mixed publishers via `news_rss`) and a "This place" tab for the opened country or city (via `gdelt`). Plus neutral tiles: Wikipedia "In the news", the largest quake today, active storms, next rocket launch, aurora chance, "On this day in history". Every item shows its publisher and age ("BBC · 2 h ago") and opens the original article in a new tab. |
| **🎓 Learn & play** | Flag / capital / "find it on the globe" quizzes (3 levels, from REST Countries + the globe), a **daily challenge** seeded by the date, "If the world were 100 people" (from World Bank figures), kid-friendly country comparisons, and a **printable school factsheet** with proper CC BY-SA credit. Fully client-side. |
| **📍 Around me** | One click on "Use my location" (browser Geolocation, never stored or sent anywhere except to the weather/geocode calls needed). Shows local time, weather, air, nearby landmarks, nearest quakes and the nearest holiday. Fallback: type a city. |

**Headline rules (MUST):**
- **Headlines only:** title, publisher, time, link. No scraped article text, no copied images, no summaries written by us. Always open the original in a new tab.
- **Balance:** the World tab mixes publishers from different regions and ownership types (public broadcasters, wire-style, regional). Order by **recency within each publisher, then interleave**, never by "engagement" or sensationalism. Show a visible publisher filter.
- **Neutral framing:** label the section "Headlines from publishers", not "the truth". Add a one-line note: *"TERRA shows what outlets report; it does not verify it. Compare sources."* This fits the source-chip provenance system in §6.9.
- **Dedupe & cap:** collapse near-identical titles (normalised lowercase, similarity check) and cap 2 per publisher in any view of ten.
- **Quiet failure:** if a feed or GDELT fails, hide that source; if all fail, show "Headlines are unavailable right now" with the Wikipedia "In the news" tile still working.
- **Safety of text:** escape every title (headlines are untrusted strings); decode HTML entities safely; strip any markup.
- **Respect limits:** feeds are fetched server-side on the 15-minute cache, so any number of visitors cause at most one request per feed per 15 minutes. GDELT is called only on demand and through the shared throttle.

**"Ask" bar (rule-based, no AI, no API):** the omnibox also understands plain requests via `intent.js` and routes them to the cards above. Minimum set: `time in Tokyo`, `weather in Lagos`, `100 usd to eur`, `is example.com down`, `is example.com safe`, `plug in Japan`, `emergency number France`, `distance Paris to Rome`, `best time to visit Peru`, `what's my ip`, `headlines`, `news in Brazil`. Unknown text falls back to the normal search. Show 3 tappable example chips under the box.

**Disclaimers that must appear (short, humble, never scary):** weather/air/quake data come from public feeds and can lag; health, safety, visa and legal rules change, so verify with official sources; this app doesn't give medical, legal or financial advice.

### 6.11 Plain-language & inclusion rules (MUST)

- **Simple / Pro switch** in the top bar. Simple is the default; Pro remembers its state for the session. Pro-only items: DNS records, RDAP raw fields, TLS details, subdomain discovery, Toolbox developer utilities, Diagnostics.
- **Reading level ≈ grade 6-8.** Short sentences, active voice, no unexplained acronym. The first time a technical term appears, it gets a dotted underline with a tooltip from `glossary.json`.
- **"In plain English" line** on every technical result, generated by deterministic templates in JS (no LLM, no API). Example: `Registered 12 days ago by NameCheap · expires in 11 months` → *"This website's name is very new. New sites aren't automatically bad, but be careful."*
- **Friendly errors:** "We couldn't reach the weather service. Try again in a minute." Never show status codes or stack traces outside Diagnostics.
- **Units & formats from the person's locale** (`navigator.language`, `Intl`): °C/°F, km/miles, 12/24 h, date order, with a visible switch.
- **Languages:** `i18n.js` holds UI strings as plain JSON. Ship English plus a starter set (e.g. Spanish, French, Portuguese, Hindi, Arabic with full **RTL** layout, Simplified Chinese, Indonesian); default to the browser language; mark machine-drafted strings `needs_review` so the community can correct them via pull requests. Country names use REST Countries translations.
- **Accessibility for everyone:** text-size control (A- / A+), high-contrast theme, **read-aloud** on every card, voice search where supported (note: some browsers send audio to their vendor), 44 px minimum targets, no hover-only features, no jargon-only icons (icon + label).
- **Low-bandwidth / older phones:** if `saveData` is on, the device is weak, or WebGL is missing, default to **Lite**: a flat 2D country list/map with the same cards. Everyday cards work without the 3D globe at all.
- **No dead ends:** every card links back to the globe ("Show on map") and to Sources.
- **Tone:** warm, calm and neutral. No scare words, no ads, no upsells, no dark patterns, no nagging prompts.

---

## 7. Visual direction: "National Geographic editorial × AAA game render"

Be honest about the tech: browsers cannot run NVIDIA DLSS. We **achieve that look** with a high-quality WebGL pipeline and an adaptive quality governor.

### 7.1 Globe render quality

- **Textures:** NASA Blue Marble (day), night lights, topology/bump, water mask (specular ocean) from the three-globe example assets, **pinned to jsDelivr/unpkg versions**. Use `anisotropy = renderer.capabilities.getMaxAnisotropy()` and mipmaps.
- **Day/night terminator:** custom `ShaderMaterial` blending day and night textures by the live **sub-solar point** (computed in JS from UTC), with soft twilight band and city lights visible only on the night side.
- **Atmosphere:** Fresnel rim glow (blue → warm at the terminator), plus a thin outer scattering shell. Tune subtly; no cartoon halo.
- **Clouds:** slowly drifting semi-transparent cloud layer (texture from three.js examples on jsDelivr; verify URL) with a faint shadow offset.
- **Ocean specular:** sun-direction specular glint using the water mask.
- **Post-processing:** `UnrealBloomPass` (very low strength, only for lights/lasers), `ACESFilmicToneMapping`, sRGB output, FXAA/SMAA, light film grain and vignette. Disable on low-end devices.
- **Stars & depth:** layered star sphere with parallax, subtle Milky Way texture, faint lens dust.
- **Motion:** eased camera (`easeInOutCubic`), fly-to with altitude arc, inertial rotate, subtle idle breathing. Respect `prefers-reduced-motion` (turn off auto-rotate, shorten tweens).
- **Borders & labels:** hairline borders that thicken on hover; country/city labels fade by altitude (LOD); markers are GPU points/sprites, never DOM nodes.
- **Today from orbit (optional hero):** blend latest NASA GIBS true-colour tiles near the camera when zoomed in close, labelled "Satellite image: yesterday".

### 7.2 Adaptive quality governor (MUST)

Measure frame time for 2 s after load and then continuously. Target ≥ 50 fps.
- Tier **Ultra** → bloom + clouds + 2× DPR cap 1.75, Tier **High** → clouds, DPR 1.5, Tier **Balanced** → no bloom, DPR 1.25, Tier **Lite** → static texture, no post-processing, DPR 1.
- Auto-step down on sustained < 40 fps, never auto-step up more than once per minute. Manual override in a ⚙︎ menu. Persist in `sessionStorage` (try/catch).
- Mobile defaults to **Balanced**.

### 7.3 UI design language

- **Mood:** dark, cinematic, calm; documentary credits meet instrument panel.
- **Colour tokens** (CSS variables; the lens palettes stay data-driven):
  - `--bg: #05070b`, `--surface: #0c1118`, `--surface-2: #121a24`, `--line: rgba(255,255,255,.08)`
  - `--ink: #e9eef5`, `--ink-dim: #93a1b3`
  - `--accent: #f2b705` (warm editorial amber; an *inspired* nod to documentary yellow, **not** a trademarked logo/frame), `--accent-cool: #4cc3ff`
  - Status: `--ok #3ddc97`, `--warn #ffb020`, `--bad #ff5a5f`
- **Typography (Google Fonts, free; with system fallbacks):** display/headlines in a high-contrast serif (**Fraunces** or **Playfair Display**), UI in **Inter**, numbers/code in **JetBrains Mono** with `font-variant-numeric: tabular-nums`. Big, quiet type for country names; tiny uppercase tracking for labels.
- **Layout:** full-bleed globe; left = lens & layers rail; right = dossier sheet (slides in, 420 px desktop; bottom sheet on mobile with drag handle); top = omnibox centred; bottom = freshness bar + attribution. Everything else is hidden until needed.
- **Panels:** solid surfaces with 1 px hairline borders, subtle inner gradient, 16 px radius, soft shadow; **no `backdrop-filter` on large areas** (perf, as in the current README).
- **Data viz:** thin lines, generous spacing, direct labels over legends, one accent per chart, sparklines for time series, animated number count-ups (respect reduced motion).
- **Skeleton shimmer** for every async block; icons are inline SVG (Lucide-style, no icon font).
- **Intro:** 1.5 s letterbox fade-in with title card "TERRA" and "the world, live", skippable, shown once per session.
- **Micro-interactions:** hover card follows pointer with 8 px lag; lens change tweens polygon colours over 600 ms; arc animations stagger; haptic-feeling 120 ms press states.

---

## 8. UX rules

- Zero-config first view: globe, 3 default layers on (quakes, hazards, ISS), one default lens. No modal on load. The "What do you need today?" cards (§6.10) appear as a dismissible overlay, not a blocking dialog; Simple mode is the default.
- Progressive disclosure: advanced tools live in the Toolbox/Network Lab, not the main HUD.
- Every error is a *chip + retry*, never a blocking dialog. Offline sources are listed in Diagnostics.
- Deep links: `?q=example.com` or `?country=JPN` handled by Python via `st.query_params` and passed to the iframe as the initial route.
- Keyboard: `/` search · `Esc` close · `L` lenses · `Y` layers · `C` compare · `T` tour · `?` shortcuts help.
- Languages: English UI; country names from the dataset. (Optional later: i18n dictionary in `web/js/i18n.js`.)

---

## 9. Performance & accessibility budgets

- First meaningful render (globe with country polygons) **< 4 s** on broadband; data layers stream in after.
- JS payload (own code) **< 250 KB** unminified; no framework. Third-party: pinned globe.gl + three only.
- Idle CPU low: pause render loop when tab hidden or globe is not moving *and* no animated layers active (`renderer.setAnimationLoop(null)` pattern, wake on input).
- Geometry: use 110m Natural Earth polygons by default and swap to 50m **only when zoomed in** (lazy-load once). Prefer a pinned jsDelivr copy of Natural Earth GeoJSON as primary, with the globe.gl example file as fallback, so a single CDN failure does not blank the app.
- WCAG 2.2 AA: contrast ≥ 4.5:1, focus rings, ARIA roles for panels/combobox/tabs, text alternatives for colour-only encodings (value labels + patterns), `prefers-reduced-motion`, `prefers-color-scheme` (offer a light "Atlas paper" theme as a stretch goal).
- Touch targets ≥ 44 px; pinch/rotate gestures; mobile bottom-sheet dossier.
- Add `<noscript>` and a WebGL-unsupported fallback (static map image + the same dossier as a list).

---

## 10. Security & abuse prevention

- **SSRF guard for all server-side network tools (MUST):** parse input, accept only a valid public hostname/IP; resolve DNS and **reject** private, loopback, link-local, multicast, CGNAT and metadata ranges (`10/8, 172.16/12, 192.168/16, 127/8, 169.254/16, 100.64/10, ::1, fc00::/7, fe80::/10`, cloud metadata `169.254.169.254`). Re-check the IP **after** each redirect and connect to the vetted IP. Only ports 80/443. No arbitrary port probing, ever.
- **Throttle tools** per Streamlit session (`st.session_state`): e.g. 10 server lookups/min, 60/hour; exponential cooldown on repeats.
- **Input validation & output escaping:** treat all API responses as untrusted. Build DOM with `textContent` or a tiny `esc()` helper; never `innerHTML` with remote strings (Wikipedia extracts, DNS TXT records and RDAP remarks can contain markup).
- **No secrets, no logging of queries**, no analytics. Don't persist searches; clear on tab close (`sessionStorage` only).
- **Personal-signal rules:** Geolocation and voice input only after an explicit tap, never stored or logged. Translation of custom text is off by default and discloses the third-party transfer. The Website Check never stores the URLs people enter.
- **PII:** RDAP personal contact fields are redacted by default; show registrar/org and abuse role only.
- **Dependencies:** `requirements.txt` stays minimal (`streamlit`, `requests`, plus `pyyaml` for the manifest and `defusedxml` for safely parsing news feeds). Pin CDN scripts with exact versions and SRI hashes where the host supports it.
- Include a short `SECURITY.md` explaining the tools are read-only public-data lookups.

---

## 11. Verification & health (MUST: do this first)

Create `scripts/check_apis.py`:
1. Read `sources.yaml`.
2. For each source, request one sample URL, record status, latency, whether JSON parses, and (for `where: B`) whether the response includes `access-control-allow-origin` (`*` or echoing). Use an `Origin: https://example.com` header to emulate a browser.
3. Print a table and exit non-zero on any **required** source failing; mark optional ones as warnings.
4. Optionally run weekly in `.github/workflows/api-health.yml` and publish results as a workflow summary (no secrets needed).

**Agents:** run it before building each feature. Wherever a "(verify)" tag appears in §4, resolve it, then update `sources.yaml` with the real endpoint, CORS result and limits. If something does not verify, apply its fallback or remove the feature, and note it in `README.md` → *Known limitations*.

---

## 12. Attribution & licences (show in-app and in README)

| Provider | Licence / note |
|---|---|
| Natural Earth | Public domain |
| World Bank | CC BY 4.0, so cite the indicator and year |
| USGS, NOAA SWPC, NASA (EONET, GIBS) | US Government works / open data |
| Open-Meteo | CC BY 4.0; **free API is for non-commercial use** |
| OpenStreetMap (Photon / Nominatim) | ODbL: "© OpenStreetMap contributors" |
| Wikipedia / Wikidata / Wikimedia | Wikidata CC0; Wikipedia text CC BY-SA, so link to source article and note licence; images carry individual licences, so show the credit line |
| REST Countries, Nager.Date, flagcdn, ipwho.is, GeoJS, ipify, RIPEstat, RDAP, IODA, GDACS, Launch Library 2, OpenSky, adsb.lol, WHO GHO, ExchangeRate-API (open endpoint) | Follow each provider's published terms and attribution; list them in the Sources modal with links |
| Publisher RSS feeds (BBC, Al Jazeera, DW, France 24, NPR, etc.), GDELT, Hacker News, MyMemory, Economist Big Mac data | Headlines are the publishers' content: show **title + link + publisher name only**, always link to the original, and follow each feed's terms (many are non-commercial only; record them in `sources.yaml`). GDELT: cite "GDELT Project". Verify the Big Mac data licence. MyMemory sends text to a third party, so disclose it in the UI |
| Curated `data/` files | Cite the original public source and date in each record; link it from the Sources modal |
| globe.gl, three.js, three-globe | MIT |
| Streamlit | Apache-2.0 |

Add a line: *"TERRA is not affiliated with National Geographic, NVIDIA or any listed provider."*

---

## 13. Build order (milestones)

| # | Milestone | Done when |
|---|---|---|
| **M0** | Refactor baseline into §3 layout. Add `sources.yaml`, `net.js`, `net.py`, `check_apis.py`. | App behaves exactly like today; every request goes through the choke points; health script runs. |
| **M1** | Trim lenses/layers per §4.6; swap Frankfurter → `er_api`; merge hazards; flight fallback; OpenSky TTL fixed. | No redundant sources; hazards de-duplicated. |
| **M2** | Omnibox + router; country + city dossiers; point card (reverse geocode, elevation, nearby). | Typing any of the §6.2 inputs routes correctly. |
| **M2.5** | **Everyday Mode (§6.10, §6.11):** home cards, Trip Card, Weather plainly, Safety, Website Check, Is-it-down, Call-time, Money, Learn & play, Around me, "Ask" bar, glossary + plain-English templates, `data/` files + `validate_data.py`, Simple/Pro switch, i18n skeleton. | A first-time, non-technical tester completes five tasks (trip card, umbrella?, site safe?, convert money, call time) unaided in under 10 seconds each. |
| **M3** | Domain / IP / ASN dossiers (DoH ×2, RDAP, ipwho/geojs, RIPEstat), globe markers for IPs; Network Lab tab (TLS, headers, rDNS, CT). | All §6.5/§6.6 tabs work, SSRF tests pass. |
| **M4** | Space & Earth layers: SWPC aurora/Kp, launches, GDACS, rain radar, GIBS (each only if verified). Today card + ticker. | Layers toggle, show freshness, fail independently. |
| **M5** | Visual pass: terminator shader, atmosphere, clouds, bloom, tone-mapping, governor, intro, typography, mobile sheet. | Meets §7, §9 budgets; Lite tier works. |
| **M6** | Toolbox utilities; provenance chips; Sources modal; diagnostics; a11y audit. | §6.8, §6.9, §9 acceptance met. |
| **M7** | Docs: README rewrite, SECURITY.md, screenshots, deployment steps. | Fresh clone → running in 3 commands. |

---

## 14. Acceptance checklist

- [ ] `pip install -r requirements.txt && streamlit run app.py` works on a clean machine; no env vars, secrets or sign-ups.
- [ ] `grep -R "fetch(" web/` finds calls **only** inside `net.js`; `grep -R "requests\." terra/` only inside `net.py` / `tools_server.py`.
- [ ] No endpoint URL exists outside `sources.yaml`.
- [ ] `check_apis.py` passes for all required sources; optional failures degrade silently in-app.
- [ ] Killing the network for any one provider (devtools "block request URL") does not break the page; an "offline" chip appears and a fallback engages where defined.
- [ ] Rapid-fire searching/clicking cannot exceed any host budget (verify with `TERRA_NET.stats()`).
- [ ] Omnibox correctly routes country, city, domain, IPv4, IPv6, ASN and lat,lng.
- [ ] Domain dossier shows DNS (2 resolvers), RDAP registration with expiry countdown, email health, and plots hosting location on the globe.
- [ ] Server tools refuse `localhost`, `127.0.0.1`, `10.x`, `169.254.169.254`, and redirects into private ranges.
- [ ] Every displayed statistic has a source chip and as-of date; stale data is flagged.
- [ ] Sustained ≥ 50 fps on a mid-range laptop at default tier; auto-downgrades gracefully; mobile is usable.
- [ ] Keyboard-only and screen-reader walkthrough of search → dossier → close succeeds; reduced-motion respected.
- [ ] No `innerHTML` with remote strings; XSS test with a TXT record containing `<img onerror=…>` renders as text.
- [ ] README, Sources & Licences modal, and `SECURITY.md` are accurate to what shipped.
- [ ] Simple mode is the default; no DNS/IP/TLS jargon is visible until Pro is switched on; every technical term has a tooltip.
- [ ] The Ask bar correctly routes the example phrases in §6.10.
- [ ] Trip Card renders for 10 varied countries (including a small island and a disputed territory) without errors; missing facts are hidden or marked "Check official sources", never invented.
- [ ] Every record in `data/` has `source_url` and `as_of`; `validate_data.py` passes; unverified records are not displayed.
- [ ] Website Check never says "safe": only "no warning signs found" with the mandatory disclaimer; `paypa1.com`, a punycode domain and a brand-new domain each trigger a warning.
- [ ] Geolocation and voice features run only after an explicit tap and store nothing.
- [ ] Headlines: World and "This place" tabs show ≥ 5 publishers from ≥ 4 regions, only title/publisher/time/link, escaped, deduped, and degrade quietly when any feed or GDELT fails; no more than one request per feed per 15 min.
- [ ] Layout works in RTL (Arabic) and with text size at 200 %; read-aloud works on at least one card.
- [ ] With WebGL disabled or `saveData` on, the Lite 2D mode serves every Everyday card.
- [ ] Usability test: 3 non-technical testers (ages 15, 40, 70) finish the five tasks above without help; fix anything that stalls them.

---

## 15. Seed prompt for the AI builder

> You are building **TERRA PRIME** from `TERRA_MASTER_SPEC.md` in this repo. Start with M0: refactor the existing `app.py` into the layout in §3 without changing behaviour, then create `sources.yaml`, the shared rate-limit engines, and `scripts/check_apis.py`. Run the health check and report which APIs verified, which need fallbacks, and any deviations from the spec **before** starting M1. Never add an API that needs a key or account. Ask me only if a requirement is genuinely ambiguous; otherwise make the conservative choice and note it in the README.
