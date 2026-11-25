"""Live layers (cached, parallel): quakes, merged hazards, capital weather, city AQ, trending, FX.

TERRA_MASTER_SPEC.md §4.2/§4.3/§4.5. M1 trims applied here:
- EONET + GDACS merge into ONE "Hazards" layer, de-duplicated (type + 100 km + 48 h),
  each event keeps a source badge.
- One active flight source: OpenSky (TTL ≥ 10 min per §4.2) with adsb.lol fallback.
- Frankfurter dropped → one cached daily ExchangeRate-API snapshot (er_api).
"""
from __future__ import annotations

import datetime as dt
import math
from concurrent.futures import ThreadPoolExecutor

import streamlit as st

from . import net

CITIES = [("Delhi", 28.61, 77.21), ("Lahore", 31.55, 74.34), ("Dhaka", 23.81, 90.41), ("Beijing", 39.90, 116.40),
          ("Shanghai", 31.23, 121.47), ("Jakarta", -6.20, 106.85), ("Bangkok", 13.76, 100.50), ("Mumbai", 19.08, 72.88),
          ("Karachi", 24.86, 67.01), ("Cairo", 30.04, 31.24), ("Lagos", 6.52, 3.38), ("Nairobi", -1.29, 36.82),
          ("Johannesburg", -26.20, 28.05), ("Kinshasa", -4.44, 15.27), ("Addis Ababa", 9.03, 38.75),
          ("Istanbul", 41.01, 28.98), ("Moscow", 55.76, 37.62), ("London", 51.51, -0.13), ("Paris", 48.86, 2.35),
          ("Berlin", 52.52, 13.40), ("Madrid", 40.42, -3.70), ("Rome", 41.90, 12.50), ("New York", 40.71, -74.01),
          ("Los Angeles", 34.05, -118.24), ("Chicago", 41.88, -87.63), ("Toronto", 43.65, -79.38),
          ("Mexico City", 19.43, -99.13), ("Bogotá", 4.71, -74.07), ("Lima", -12.05, -77.04),
          ("São Paulo", -23.55, -46.63), ("Buenos Aires", -34.60, -58.38), ("Santiago", -33.45, -70.67),
          ("Tokyo", 35.68, 139.69), ("Seoul", 37.57, 126.98), ("Manila", 14.60, 120.98),
          ("Ho Chi Minh City", 10.82, 106.63), ("Singapore", 1.35, 103.82), ("Sydney", -33.87, 151.21),
          ("Dubai", 25.20, 55.27), ("Riyadh", 24.71, 46.68), ("Tehran", 35.69, 51.39), ("Accra", 5.60, -0.19),
          ("Kampala", 0.35, 32.58), ("Dar es Salaam", -6.79, 39.21)]

utcnow = lambda: dt.datetime.now(dt.timezone.utc)  # noqa: E731


# --------------------------------------------------------------- earthquakes
def fetch_quakes() -> list[dict]:
    data = net.get_json("usgs", path={"feed": "2.5_week"})
    try:
        return [dict(lat=q["geometry"]["coordinates"][1], lng=q["geometry"]["coordinates"][0],
                     mag=q["properties"]["mag"], place=q["properties"]["place"], t=q["properties"]["time"])
                for q in data["features"] if q["properties"]["mag"] is not None]
    except Exception:  # noqa: BLE001
        return []


# --------------------------------------------------------------- hazards (EONET + GDACS, merged)
def _haversine(a: tuple, b: tuple) -> float:
    la1, lo1, la2, lo2 = map(math.radians, (*a, *b))
    h = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    return 2 * 6371 * math.asin(math.sqrt(h))


def _fetch_eonet() -> list[dict]:
    data = net.get_json("eonet", query=dict(status="open", limit=150))
    out = []
    try:
        for e in data["events"]:
            g = e["geometry"][-1]
            if g["type"] == "Point":
                out.append(dict(lat=g["coordinates"][1], lng=g["coordinates"][0],
                                cat=e["categories"][0]["title"], title=e["title"],
                                src="EONET", t=e.get("geometry", [{}])[-1].get("date", "")))
    except Exception:  # noqa: BLE001
        pass
    return out


def _fetch_gdacs() -> list[dict]:
    data = net.get_json("gdacs", query=dict(eventlist="EQ,TC,FL,VO,DR,WF", alertlevels="Orange,Red"))
    out = []
    try:
        feats = data.get("features") or []
        for f in feats:
            p, g = f.get("properties", {}), f.get("geometry") or {}
            co = (g.get("coordinates") or [None, None])
            if co[0] is None:
                continue
            cat = {"EQ": "Earthquakes", "TC": "Severe Storms", "FL": "Floods",
                   "VO": "Volcanoes", "DR": "Drought", "WF": "Wildfires"}.get(p.get("eventtype"), "Hazards")
            out.append(dict(lat=float(co[1]), lng=float(co[0]), cat=cat,
                            title=p.get("name") or p.get("eventtype", "GDACS event"),
                            src=f"GDACS {p.get('alertlevel', '')}".strip(),
                            t=p.get("fromdate", "")))
    except Exception:  # noqa: BLE001
        pass
    return out


def _dedupe_hazards(events: list[dict]) -> list[dict]:
    """Merge overlapping disaster feeds: same category within 100 km and 48 h → keep one."""
    def ts(e: dict) -> float:
        try:
            return dt.datetime.fromisoformat(e["t"].replace("Z", "+00:00")).timestamp()
        except Exception:  # noqa: BLE001
            return 0.0

    kept: list[dict] = []
    for e in events:
        for k in kept:
            if k["cat"] == e["cat"] and abs(ts(k) - ts(e)) < 48 * 3600 and \
                    _haversine((k["lat"], k["lng"]), (e["lat"], e["lng"])) < 100:
                break
        else:
            kept.append(e)
    return kept


def fetch_hazards() -> list[dict]:
    with ThreadPoolExecutor(2) as ex:
        a, b = ex.submit(_fetch_eonet), ex.submit(_fetch_gdacs)
        return _dedupe_hazards(a.result() + b.result())


# --------------------------------------------------------------- flights (OpenSky → adsb fallback)
def _back(lat, lon, bearing, dist_m):
    d, th = dist_m / 6371000.0, math.radians(bearing)
    p1, l1 = math.radians(lat), math.radians(lon)
    p2 = math.asin(math.sin(p1) * math.cos(d) + math.cos(p1) * math.sin(d) * math.cos(th))
    l2 = l1 + math.atan2(math.sin(th) * math.sin(d) * math.cos(p1), math.cos(d) - math.sin(p1) * math.sin(p2))
    return math.degrees(p2), (math.degrees(l2) + 540) % 360 - 180


def _trails(rows: list[tuple]) -> list[dict]:
    """(lat, lon, vel, trk, callsign, icao, alt) rows → 40-minute trail arcs."""
    out = []
    for lat, lon, vel, trk, cs, icao, alt in rows:
        sl, sg = _back(lat, lon, (trk + 180) % 360, vel * 2400)
        out.append(dict(sLat=round(sl, 2), sLng=round(sg, 2), eLat=round(lat, 2), eLng=round(lon, 2),
                        cs=(cs or "").strip() or icao, c="", alt=alt, v=round(vel)))
    return out


def fetch_flights() -> list[dict]:
    data = net.get_json("opensky", query=dict(lamin=-60, lamax=70, lomin=-170, lomax=180),
                        timeout=(3, 12), cache_key="states")
    rows = []
    try:
        cand = [s for s in (data.get("states") or []) if not s[8] and s[5] is not None and s[6] is not None
                and s[9] and s[9] > 120 and s[10] is not None]
        step = max(1, len(cand) // 350)
        rows = [(s[6], s[5], s[9], s[10], s[1], s[0], s[13] or s[7]) for s in cand[::step][:350]]
    except Exception:  # noqa: BLE001
        rows = []
    if rows:
        return _trails(rows)
    return _flights_adsb()      # fallback (§4.2): viewport-ish regions, not the whole planet


def _flights_adsb() -> list[dict]:
    rows = []
    for lat, lon in [(51.5, -0.1), (40.7, -74.0), (34.0, -118.2), (25.2, 55.3),
                     (1.35, 103.8), (35.7, 139.7), (-23.5, -46.6), (28.6, 77.2)]:
        data = net.get_json("adsb", path={"lat": lat, "lon": lon, "radius_nm": 250},
                            timeout=(3, 12), cache_key=f"{lat},{lon}")
        try:
            for ac in (data.get("ac") or [])[:60]:
                if ac.get("lat") is None or ac.get("lon") is None or not ac.get("gs"):
                    continue
                rows.append((ac["lat"], ac["lon"], float(ac["gs"]) / 3.6, float(ac.get("track") or 0),
                             ac.get("flight"), ac.get("hex"), ac.get("alt_baro")))
        except Exception:  # noqa: BLE001
            continue
        if len(rows) >= 350:
            break
    return _trails(rows[:350])


# --------------------------------------------------------------- city air quality
def fetch_air() -> list[dict]:
    data = net.get_json("openmeteo_aq",
                        query=dict(latitude=",".join(str(c[1]) for c in CITIES),
                                   longitude=",".join(str(c[2]) for c in CITIES),
                                   current="european_aqi"),
                        timeout=(3, 12), cache_key="layer")
    out = []
    try:
        for c, x in zip(CITIES, data):
            aqi = x.get("current", {}).get("european_aqi")
            if aqi is not None:
                out.append(dict(name=c[0], lat=c[1], lng=c[2], aqi=aqi))
    except Exception:  # noqa: BLE001
        pass
    return out


# --------------------------------------------------------------- trending (Wikimedia pageviews)
def fetch_trending() -> list[dict]:
    skip = ("Special:", "Wikipedia:", "Portal:", "Help:", "File:", "Category:", "Talk:")
    for back in (1, 2, 3):
        d = utcnow() - dt.timedelta(days=back)
        data = net.get_json("wiki_pageviews", path={"yyyy": f"{d:%Y}", "mm": f"{d:%m}", "dd": f"{d:%d}"},
                            cache_key=str(back))
        try:
            arts = [a for a in data["items"][0]["articles"]
                    if a["article"] != "Main_Page" and not a["article"].startswith(skip)]
            return [dict(t=a["article"].replace("_", " "), v=a["views"]) for a in arts[:12]]
        except Exception:  # noqa: BLE001
            continue
    return []


# --------------------------------------------------------------- FX snapshot (er_api, daily)
@st.cache_data(ttl=86400, show_spinner=False)
def fetch_fx() -> dict:
    """One cached daily rates snapshot serves every country + the converter (§4.6)."""
    data = net.get_json("er_api", path={"base": "USD"})
    try:
        return dict(base="USD", rates=data.get("rates", {}),
                    date=data.get("time_last_update_utc") or data.get("time_last_update_unix"))
    except Exception:  # noqa: BLE001
        return dict(base="USD", rates={}, date=None)


# --------------------------------------------------------------- countries (embedded subset)
# NOTE (2026-11-19): restcountries.com v3.1 now redirects to a v5 that requires an API key
# (constraint C1 → not usable). Keyless replacement: mledoze/countries (MIT) for facts,
# flagcdn for flag images, this bulk Wikidata SPARQL for driving side, World Bank for population.
@st.cache_data(ttl=604800, show_spinner=False)
def _countries_all() -> list[dict]:
    import json as _json
    try:
        raw = net.get_bytes(net.source("countries_data")["url_template"], timeout=(3, 25))
        data = _json.loads(raw)
    except Exception:  # noqa: BLE001
        raise RuntimeError("countries dataset unavailable")

    sides = {}
    try:
        q = ("SELECT ?iso ?sideLabel WHERE { ?c wdt:P297 ?iso; wdt:P1622 ?side. "
             "SERVICE wikibase:label { bd:serviceParam wikibase:language \"en\". } }")
        sp = net.get_json("wikidata_sparql", query=dict(format="json", query=q), timeout=(3, 25),
                          cache_key="drive")
        for b in (sp.get("results", {}).get("bindings", [])):
            iso = b.get("iso", {}).get("value", "")
            side = b.get("sideLabel", {}).get("value", "").lower()
            if iso and side in ("left", "right"):
                sides[iso.upper()] = side
    except Exception:  # noqa: BLE001 — enrich only, never block (§4.3)
        pass

    out = []
    try:
        for c in data:
            cur = list((c.get("currencies") or {}).items())[:1]
            langs = list((c.get("languages") or {}).values())[:3]
            cap = (c.get("capital") or [None])[0]
            tr = c.get("translations") or {}
            out.append(dict(
                name=(c.get("name") or {}).get("common", ""),
                official=(c.get("name") or {}).get("official", ""),
                cca2=c.get("cca2"), cca3=c.get("cca3"), capital=cap,
                capLatlng=(c.get("capitalInfo") or {}).get("latlng"),
                area=c.get("area"), region=c.get("region"), subregion=c.get("subregion"),
                cur=cur[0][0] if cur else None,
                curName=cur[0][1].get("name") if cur else None,
                lang=langs, flagEmoji=c.get("flag"),
                latlng=c.get("latlng"), tld=(c.get("tld") or [None])[0],
                idd=(c.get("idd") or {}).get("root", "") +
                    (((c.get("idd") or {}).get("suffixes") or [""])[0] or ""),
                drive=sides.get(c.get("cca3")) or sides.get(c.get("cca2")),
                trNames={x: (tr.get(x) or {}).get("common") for x in
                         ("fra", "deu", "spa", "ara", "zho", "por", "hin", "ind") if tr.get(x)}))
    except Exception:  # noqa: BLE001
        raise RuntimeError("countries dataset unreadable")
    if not out:
        raise RuntimeError("countries dataset empty")
    return out


def fetch_countries_all() -> list[dict]:
    """A failed fetch is never cached (it used to hide every capital for a week)."""
    try:
        return _countries_all()
    except Exception:  # noqa: BLE001
        return []


# --------------------------------------------------------------- Big Mac index (weekly)
@st.cache_data(ttl=604800, show_spinner=False)
def fetch_bigmac() -> dict:
    """Purchasing-power snapshot: latest Big Mac price per currency (§4.7)."""
    import csv
    import io
    try:
        raw = net.get_bytes(net.source("bigmac")["url_template"], timeout=(3, 15))
        rows = list(csv.DictReader(io.StringIO(raw.decode("utf-8", "replace"))))
        latest = {}
        for r in rows:                      # file is chronological; later rows win
            if r.get("date") and r.get("local_price") and r.get("currency_code"):
                latest[r["currency_code"]] = dict(
                    date=r["date"], local=float(r["local_price"]),
                    usd=r.get("dollar_ex"), name=r.get("name", r["currency_code"]))
        return dict(rows=latest, as_of=max((v["date"] for v in latest.values()), default=None))
    except Exception:  # noqa: BLE001
        return dict(rows={}, as_of=None)


# --------------------------------------------------------------- space weather + launches
@st.cache_data(ttl=600, show_spinner=False)
def fetch_space() -> dict:
    """NOAA SWPC: Kp index + aurora oval samples (§4.5). Fails quietly."""
    kp, aurora = None, None
    try:
        rows = net.get_json("swpc_kp", cache_key="kp")
        for row in (rows or [])[::-1]:            # list of {time_tag, Kp, a_running, station_count}
            if isinstance(row, dict) and row.get("Kp") is not None:
                kp = {"time": row.get("time_tag"), "kp": float(row["Kp"])}
                break
    except Exception:  # noqa: BLE001
        pass
    aurora_pts = []
    try:
        ov = net.get_json("swpc_aurora", cache_key="oval")
        co = ov.get("coordinates", [])          # [[lon, lat, intensity %], …] ~65k rows
        strong = sorted((c for c in co if len(c) >= 3 and c[2] > 5), key=lambda c: -c[2])
        step = max(1, len(strong) // 400)
        aurora_pts = [dict(lat=c[1], lng=c[0], v=c[2]) for c in strong[::step]][:400]
        aurora = {"obs": ov.get("Observation Time"), "forecast": ov.get("Forecast Time"),
                  "count": len(aurora_pts)}
    except Exception:  # noqa: BLE001
        pass
    return dict(kp=kp, aurora=aurora_pts, aurora_meta=aurora)


@st.cache_data(ttl=1800, show_spinner=False)
def fetch_launches() -> list[dict]:
    """Next rocket launches (Launch Library 2 free tier: ≥ 30 min TTL, §4.5)."""
    data = net.get_json("launches", query=dict(limit=3, mode="list"), timeout=(3, 12), cache_key="up")
    out = []
    try:
        for r in (data.get("results") or []):
            out.append(dict(name=r.get("name"), net=r.get("net"), status=(r.get("status") or {}).get("name"),
                            location=r.get("location"), pad=r.get("pad")))
    except Exception:  # noqa: BLE001
        pass
    return out


# --------------------------------------------------------------- weather at capital cities (Open-Meteo, free, no key)
@st.cache_data(ttl=3600, show_spinner=False)
def _capital_weather() -> dict:
    caps = [(c["cca3"], c["capLatlng"][0], c["capLatlng"][1]) for c in fetch_countries_all()
            if c.get("capLatlng") and len(c["capLatlng"]) == 2 and c.get("cca3")]
    if not caps:
        raise RuntimeError("no capital coordinates")
    chunks = [caps[i:i + 100] for i in range(0, len(caps), 100)]

    def one(ch):
        data = net.get_json("openmeteo", query=dict(
            latitude=",".join(f"{lat:.2f}" for _i, lat, _g in ch), longitude=",".join(f"{lng:.2f}" for _i, _a, lng in ch),
            current="temperature_2m,weather_code,is_day"), timeout=(3, 15), cache_key="capwx" + ch[0][0])
        data = data if isinstance(data, list) else ([data] if isinstance(data, dict) else [])
        out = {}
        for (iso, _a, _g), d in zip(ch, data):
            cur = (d or {}).get("current") or {}
            if cur.get("temperature_2m") is not None:
                out[iso] = [round(cur["temperature_2m"]), cur.get("weather_code", 0), cur.get("is_day", 1)]
        return out

    res: dict = {}
    with ThreadPoolExecutor(len(chunks)) as ex:
        for part in ex.map(one, chunks):
            res.update(part)
    if not res:
        raise RuntimeError("weather unavailable")
    return res


def capital_weather() -> dict:
    """{ISO3: [temp °C, WMO code, is_day]} — {} when the free API is down (failures are never cached)."""
    try:
        return _capital_weather()
    except Exception:  # noqa: BLE001
        return {}


# --------------------------------------------------------------- bundles (all in parallel)
@st.cache_data(ttl=300, show_spinner=False)
def live_bundle() -> dict:
    jobs = dict(quakes=fetch_quakes, hazards=fetch_hazards, capwx=capital_weather,
                aqi=fetch_air, trending=fetch_trending, space=fetch_space, launches=fetch_launches)
    with ThreadPoolExecutor(len(jobs)) as ex:
        futs = {k: ex.submit(f) for k, f in jobs.items()}
        return {k: f.result() for k, f in futs.items()}
