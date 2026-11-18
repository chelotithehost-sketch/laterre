# 🌍 TERRA — Live World Atlas

An interactive 3D globe built with **Streamlit** and **globe.gl** (WebGL). Hover a country to see a statistic, click it to open a live country dashboard, compare two countries side by side, and watch earthquakes, natural events, flights and the ISS in real time.

**No API keys. No accounts. No paid services.**

## Features

| Feature | What it does |
|---|---|
| **Colour lenses** | Recolour (and extrude) the world by 14 World Bank indicators: GDP per person, internet users, mobile subscriptions, life expectancy, population, urban population, unemployment, renewable / fossil / nuclear / hydro electricity, energy use per person, PM2.5 pollution, CO₂ per person |
| **Hover cards** | Country name, value, data year and global rank |
| **Country dashboard** | Click a country: flag, capital, population, area, languages, currency, capital-city weather + 5-day forecast, live air quality, USD exchange rate, next public holiday, electricity-mix bar, World Bank snapshot, Wikipedia summary |
| **Search** | Autocomplete country search (press `/` to focus) |
| **Compare mode** | Pick two countries: arc between them, side-by-side bars for every lens, capital weather, swap button |
| **Live layers** | Earthquakes (USGS), natural events (NASA EONET), flight trails (OpenSky), city air quality (Open-Meteo), ISS position |
| **Display** | Dark / Satellite / Night imagery, optional relief extrusion, auto-rotate |
| **Ticker** | Most-read English Wikipedia articles of the day |

## Quick start

```bash
pip install -r requirements.txt
streamlit run app.py
```

Open the URL Streamlit prints (usually http://localhost:8501). The first load takes a few seconds while the World Bank data is fetched; it is then cached.

> The **browser** needs internet access: map shapes, globe textures, fonts and the click-time APIs are loaded directly from public CDNs and APIs.

## Deploy for free (Streamlit Community Cloud)

1. Push `app.py` and `requirements.txt` to a GitHub repo.
2. Go to https://share.streamlit.io, choose the repo and set `app.py` as the main file.
3. Deploy. No secrets are needed.

## Data sources

| Data | Source | Fetched | Cache |
|---|---|---|---|
| Country indicators | [World Bank API](https://datahelpdesk.worldbank.org/knowledgebase/articles/889392) | Server | 24 h |
| Earthquakes (M2.5+, 7 days) | [USGS](https://earthquake.usgs.gov/earthquakes/feed/) | Server | 5 min |
| Natural events | [NASA EONET](https://eonet.gsfc.nasa.gov/) | Server | 10 min |
| Flights | [OpenSky Network](https://opensky-network.org/) (anonymous) | Server | 2 min |
| City air quality | [Open-Meteo Air Quality](https://open-meteo.com/en/docs/air-quality-api) | Server | 30 min |
| Trending articles | [Wikimedia Pageviews](https://wikimedia.org/api/rest_v1/) | Server | 1 h |
| Country facts | [REST Countries](https://restcountries.com/) | Browser, on click | — |
| Weather + forecast | [Open-Meteo](https://open-meteo.com/) | Browser, on click | — |
| Exchange rates | [Frankfurter](https://frankfurter.app/) | Browser, on click | — |
| Public holidays | [Nager.Date](https://date.nager.at/) | Browser, on click | — |
| Country summaries | [Wikipedia REST](https://en.wikipedia.org/api/rest_v1/) | Browser, on click | — |
| ISS position | [wheretheiss.at](https://wheretheiss.at/) | Browser, every 6 s | — |
| Map shapes | [Natural Earth](https://www.naturalearthdata.com/) via globe.gl examples | Browser | — |
| Globe textures | NASA Blue Marble / night lights via [three-globe](https://github.com/vasturiano/three-globe) | Browser | — |

## How it works

`app.py` is a single file:

1. **Python** (cached with `st.cache_data`) downloads the heavy data and embeds it as JSON into one HTML page.
2. That page is rendered with `streamlit.components.v1.html`. It runs globe.gl, so all interaction (rotate, hover, search, compare, lens switching) happens in the browser **without Streamlit reruns**.
3. Click-time details (weather, facts, FX…) are fetched directly by the browser.

## Customising

- **Add a lens:** add a row to `LENSES` in `app.py` (`id`, World Bank indicator code, label, format, log-scale flag, 5-colour palette, group). Keep rows of the same group together. For a new `format`, extend `fmt()` in the JavaScript.
- **Add cities to the air-quality layer:** append `(name, lat, lng)` to `CITIES`.
- **Change refresh rates:** edit the `ttl=` values on the `@st.cache_data` functions.
- **Change flight density:** edit the `700` sample size in `flights()`; the `2400` is trail length in seconds (40 min).
- **Look and feel:** colours and spacing are CSS variables at the top of the `<style>` block.

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| Blank globe or "COULD NOT LOAD MAP DATA" | The browser can't reach `raw.githubusercontent.com` or `unpkg.com`. Check the connection or ad-blocker. |
| Flights show "offline" | OpenSky rate-limits anonymous use and sometimes blocks cloud-host IPs. Everything else still works; retry later. |
| A country has no data | The World Bank doesn't report every indicator for every territory. It renders grey. |
| Country panel is missing facts | Disputed or tiny territories aren't in REST Countries; the panel skips what it can't find. |
| Page shows old numbers | World Bank values are cached for 24 h and are themselves 1–3 years old. Clear the cache from the Streamlit menu (`C`). |
| Globe resets when a Streamlit widget changes | All controls live inside the globe, so none should rerun the app. A full browser refresh resets the view. |

## Performance notes

- All markers (quakes, events, city air quality, ISS) are WebGL points, not DOM elements, so panning stays smooth.
- Panels are solid (no backdrop blur) and the renderer is capped at 1.5x pixel ratio on HiDPI screens.
- Server data is fetched **in parallel** and cached; a cold start waits for the slowest source (max ~20 s, usually 3-5 s).
- Streamlit 1.56+ uses `st.iframe`; older versions fall back to `components.html` automatically.

## Known limitations

- World Bank indicators are annual and lag by one or more years, so they are not real-time.
- Flight arcs are back-projected from each plane's heading and speed (~40 min trail); they are not actual flight routes or filed flight plans.
- Compare mode highlights the larger value; a larger value is not always "better".
- Free public APIs can rate-limit or go down; each layer fails independently and quietly.

## Credits & licences

Built with [globe.gl](https://globe.gl/) (MIT), [three-globe](https://github.com/vasturiano/three-globe) (MIT) and [Streamlit](https://streamlit.io/) (Apache-2.0). Map data from Natural Earth (public domain). Please follow each data provider's attribution and fair-use terms listed above if you publish the app publicly.
