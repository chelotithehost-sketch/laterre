"""TERRA v2 — a live, keyless world atlas. Streamlit + globe.gl (WebGL).

Server side (cached): World Bank indicators, USGS quakes, NASA EONET, OpenSky flights,
Open-Meteo city air quality, Wikipedia trending.
Browser side (on click): REST Countries, Open-Meteo weather/AQI, Frankfurter FX,
Nager.Date holidays, Wikipedia summary, live ISS. No API keys anywhere.
"""
import datetime as dt
import json
import math
from concurrent.futures import ThreadPoolExecutor

import requests
import streamlit as st
import streamlit.components.v1 as components

st.set_page_config(page_title="TERRA · Live World Atlas", page_icon="🌍",
                   layout="wide", initial_sidebar_state="collapsed")
st.markdown("""<style>
header[data-testid="stHeader"], footer, #MainMenu {display:none !important;}
.block-container {padding:0 !important; max-width:100% !important;}
.stApp {background:#04070d;}
iframe {border:0; display:block;}
</style>""", unsafe_allow_html=True)

UA = {"User-Agent": "terra-atlas/2.0 (streamlit demo)"}

# id, World Bank code, label, format, log-scale, palette, group  (keep groups contiguous)
S_, E_, A_ = "Society & economy", "Energy mix", "Air & climate"
LENSES = [
    ("gdp", "NY.GDP.PCAP.CD", "GDP per person", "usd", True, ["#0b3a5b", "#1e90b8", "#6fe0b0", "#f4e27a", "#ff9a52"], S_),
    ("net", "IT.NET.USER.ZS", "Internet users", "pct", False, ["#2a1b5e", "#5b3fd1", "#2fa8ff", "#5af0d2", "#d6ff7a"], S_),
    ("mobile", "IT.CEL.SETS.P2", "Mobile subs / 100", "num", False, ["#2b1346", "#7a2fb8", "#d04fa0", "#ff9b6a", "#ffe58a"], S_),
    ("life", "SP.DYN.LE00.IN", "Life expectancy", "yrs", False, ["#4a0f2b", "#c2325f", "#ff8a5c", "#ffd36b", "#e8ffb0"], S_),
    ("pop", "SP.POP.TOTL", "Population", "num", True, ["#0d2a3a", "#1b6f8f", "#42c2b5", "#f2d86a", "#ff6b4a"], S_),
    ("urban", "SP.URB.TOTL.IN.ZS", "Urban population", "pct", False, ["#1a2a4a", "#3d6fd6", "#6fd3ff", "#b5f0c8", "#fff1a8"], S_),
    ("unemp", "SL.UEM.TOTL.ZS", "Unemployment", "pct", False, ["#12323f", "#2c8fa6", "#f0d36a", "#ff8a4a", "#d6285a"], S_),
    ("renew", "EG.ELC.RNEW.ZS", "Renewable electricity", "pct", False, ["#0e2a2b", "#1f7a5a", "#52c97a", "#c6ef6a", "#fff59a"], E_),
    ("fossil", "EG.ELC.FOSL.ZS", "Fossil electricity", "pct", False, ["#14282f", "#47616b", "#b08a4a", "#ee8a3a", "#e63b2e"], E_),
    ("nuclear", "EG.ELC.NUCL.ZS", "Nuclear electricity", "pct", False, ["#1b1740", "#4a3fb5", "#9a5be0", "#ff8de0", "#ffe6f7"], E_),
    ("hydro", "EG.ELC.HYRO.ZS", "Hydro electricity", "pct", False, ["#0b2a4a", "#1469b5", "#2fb4e6", "#8ee8f0", "#e6fff8"], E_),
    ("energy", "EG.USE.PCAP.KG.OE", "Energy use per person", "kgoe", True, ["#1d2540", "#3a5fb0", "#58c6c0", "#f2d86a", "#ff7e4a"], E_),
    ("pm25", "EN.ATM.PM25.MC.M3", "PM2.5 air pollution", "pm", False, ["#1c4a3a", "#7ec87a", "#f2e06a", "#f08a3a", "#b3203a"], A_),
    ("co2", "EN.ATM.CO2E.PC", "CO₂ per person", "co2", False, ["#10343a", "#2f8a6b", "#c8d14a", "#ff9a3c", "#e0245e"], A_),
]

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


@st.cache_data(ttl=86400, show_spinner=False)
def world_bank(code):
    try:
        r = requests.get(f"https://api.worldbank.org/v2/country/all/indicator/{code}",
                         params=dict(format="json", mrnev=1, per_page=400), timeout=25, headers=UA).json()
        return {x["countryiso3code"]: [x["value"], x["date"]]
                for x in r[1] if x.get("value") is not None and x.get("countryiso3code")}
    except Exception:
        return {}


@st.cache_data(ttl=300, show_spinner=False)
def quakes():
    try:
        f = requests.get("https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_week.geojson",
                         timeout=20, headers=UA).json()["features"]
        return [dict(lat=q["geometry"]["coordinates"][1], lng=q["geometry"]["coordinates"][0],
                     mag=q["properties"]["mag"], place=q["properties"]["place"], t=q["properties"]["time"])
                for q in f if q["properties"]["mag"] is not None]
    except Exception:
        return []


ICONS = {"Wildfires": "🔥", "Severe Storms": "🌀", "Volcanoes": "🌋", "Sea and Lake Ice": "🧊",
         "Floods": "🌊", "Drought": "🏜️", "Dust and Haze": "🌫️", "Landslides": "⛰️",
         "Snow": "❄️", "Temperature Extremes": "🌡️", "Manmade": "🏭", "Water Color": "💧"}


@st.cache_data(ttl=600, show_spinner=False)
def eonet():
    try:
        ev = requests.get("https://eonet.gsfc.nasa.gov/api/v3/events",
                          params=dict(status="open", limit=150), timeout=25, headers=UA).json()["events"]
        out = []
        for e in ev:
            g = e["geometry"][-1]
            if g["type"] == "Point":
                cat = e["categories"][0]["title"]
                out.append(dict(lat=g["coordinates"][1], lng=g["coordinates"][0],
                                icon=ICONS.get(cat, "📍"), title=f'{e["title"]} · {cat}'))
        return out
    except Exception:
        return []


def _back(lat, lon, bearing, dist_m):
    """Point `dist_m` metres from (lat, lon) along `bearing` degrees (great circle)."""
    R, d, th = 6371000.0, dist_m / 6371000.0, math.radians(bearing)
    p1, l1 = math.radians(lat), math.radians(lon)
    p2 = math.asin(math.sin(p1) * math.cos(d) + math.cos(p1) * math.sin(d) * math.cos(th))
    l2 = l1 + math.atan2(math.sin(th) * math.sin(d) * math.cos(p1), math.cos(d) - math.sin(p1) * math.sin(p2))
    return math.degrees(p2), (math.degrees(l2) + 540) % 360 - 180


@st.cache_data(ttl=120, show_spinner=False)
def flights():
    """OpenSky anonymous /states/all → ~700 cruising aircraft as ~40-minute trail arcs."""
    try:
        r = requests.get("https://opensky-network.org/api/states/all", timeout=25, headers=UA)
        if r.status_code != 200:
            return []
        states = r.json().get("states") or []
    except Exception:
        return []
    cand = [s for s in states if not s[8] and s[5] is not None and s[6] is not None
            and s[9] and s[9] > 120 and s[10] is not None]
    step = max(1, len(cand) // 700)
    out = []
    for s in cand[::step][:700]:
        lat, lon, vel, trk = s[6], s[5], s[9], s[10]
        sl, sg = _back(lat, lon, (trk + 180) % 360, vel * 2400)
        out.append(dict(sLat=round(sl, 3), sLng=round(sg, 3), eLat=round(lat, 3), eLng=round(lon, 3),
                        cs=(s[1] or "").strip() or s[0], c=s[2], alt=s[13] or s[7], v=round(vel)))
    return out


@st.cache_data(ttl=1800, show_spinner=False)
def city_air():
    try:
        r = requests.get("https://air-quality-api.open-meteo.com/v1/air-quality", timeout=25, headers=UA,
                         params=dict(latitude=",".join(str(c[1]) for c in CITIES),
                                     longitude=",".join(str(c[2]) for c in CITIES),
                                     current="european_aqi")).json()
        return [dict(name=c[0], lat=c[1], lng=c[2], aqi=x["current"]["european_aqi"])
                for c, x in zip(CITIES, r) if x.get("current", {}).get("european_aqi") is not None]
    except Exception:
        return []


@st.cache_data(ttl=3600, show_spinner=False)
def wiki_trending():
    skip = ("Special:", "Wikipedia:", "Portal:", "Help:", "File:", "Category:", "Talk:")
    for back in (1, 2, 3):
        d = dt.datetime.utcnow() - dt.timedelta(days=back)
        try:
            r = requests.get("https://wikimedia.org/api/rest_v1/metrics/pageviews/top/en.wikipedia/"
                             f"all-access/{d:%Y/%m/%d}", timeout=20, headers=UA).json()
            arts = [a for a in r["items"][0]["articles"]
                    if a["article"] != "Main_Page" and not a["article"].startswith(skip)]
            return [dict(t=a["article"].replace("_", " "), v=a["views"]) for a in arts[:12]]
        except Exception:
            continue
    return []


with st.spinner("Calibrating satellites…"):
    with ThreadPoolExecutor(8) as ex:
        wb = list(ex.map(world_bank, [l[1] for l in LENSES]))
    payload = dict(
        lenses=[dict(id=l[0], label=l[2], fmt=l[3], log=l[4], pal=l[5], group=l[6]) for l in LENSES],
        values={l[0]: v for l, v in zip(LENSES, wb)},
        quakes=quakes(), events=eonet(), flights=flights(), aqi=city_air(), trending=wiki_trending(),
        updated=dt.datetime.utcnow().strftime("%H:%M UTC"),
    )

HTML = r"""
<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=Space+Grotesk:wght@500;600;700&display=swap" rel="stylesheet">
<style>
:root{--glass:rgba(10,16,28,.55);--line:rgba(255,255,255,.10);--txt:#eaf2ff;--dim:#8fa3c0;--acc:#5ad1ff;--acc2:#7cf7c4;--A:#ffd36b;--B:#ff7a8a}
*{box-sizing:border-box}html,body{margin:0;height:100%;background:#03060c;overflow:hidden;color:var(--txt);font-family:Inter,system-ui,sans-serif}
#globe{position:absolute;inset:0}
.glass{background:var(--glass);backdrop-filter:blur(18px) saturate(150%);-webkit-backdrop-filter:blur(18px) saturate(150%);
 border:1px solid var(--line);border-radius:18px;box-shadow:0 20px 60px rgba(0,0,0,.45),inset 0 1px 0 rgba(255,255,255,.08)}
.h{font-family:'Space Grotesk',sans-serif}
#brand{position:absolute;left:22px;top:20px;padding:14px 18px}
#brand b{font-size:22px;letter-spacing:.32em;background:linear-gradient(90deg,#fff,#7cf7c4);-webkit-background-clip:text;color:transparent}
#brand small{display:block;color:var(--dim);font-size:11px;margin-top:3px;letter-spacing:.04em}
#search{position:absolute;left:50%;top:22px;transform:translateX(-50%);width:min(340px,34vw);padding:4px 14px;display:flex;align-items:center;gap:8px;border-radius:30px}
#search input{flex:1;background:transparent;border:0;outline:0;color:var(--txt);font:500 14px Inter;padding:11px 0}
#search input::placeholder{color:var(--dim)}#search kbd{font:500 11px Inter;color:var(--dim);border:1px solid var(--line);border-radius:6px;padding:1px 6px}
#lens{position:absolute;left:22px;top:92px;padding:10px;width:230px;max-height:calc(100% - 290px);overflow-y:auto}
#lens::-webkit-scrollbar{width:5px}#lens::-webkit-scrollbar-thumb{background:rgba(255,255,255,.15);border-radius:5px}
.t{font-size:10px;letter-spacing:.18em;color:var(--dim);margin:2px 8px 8px;text-transform:uppercase}
.gh{font:600 10px Inter;letter-spacing:.14em;color:var(--acc);text-transform:uppercase;margin:12px 10px 4px;opacity:.85}
.chip{width:100%;text-align:left;border:0;background:transparent;color:var(--txt);padding:7px 10px;border-radius:10px;
 font:500 13px Inter;cursor:pointer;transition:.18s;display:flex;align-items:center;gap:9px}
.chip:hover{background:rgba(255,255,255,.07)}.chip.on{background:linear-gradient(90deg,rgba(90,209,255,.22),rgba(124,247,196,.12));box-shadow:inset 0 0 0 1px rgba(90,209,255,.4)}
.dot{width:9px;height:9px;border-radius:50%;background:var(--sw);box-shadow:0 0 10px var(--sw);flex:none}
#layers{position:absolute;right:22px;top:20px;padding:10px;width:240px;transition:right .35s}
body.open #layers{right:418px}
.sw{display:flex;align-items:center;justify-content:space-between;padding:7px 10px;font-size:13px;cursor:pointer;border-radius:10px;gap:8px}
.sw:hover{background:rgba(255,255,255,.06)}.sw em{font-style:normal;color:var(--dim);font-size:11px}
.tg{width:32px;height:18px;border-radius:12px;background:rgba(255,255,255,.14);position:relative;transition:.2s;flex:none}
.tg:after{content:"";position:absolute;top:2px;left:2px;width:14px;height:14px;border-radius:50%;background:#fff;transition:.2s}
.sw.on .tg{background:linear-gradient(90deg,#2fa8ff,#5af0d2)}.sw.on .tg:after{left:16px}
#legend{position:absolute;left:22px;bottom:56px;padding:12px 16px;width:300px}
#legend .n{font:600 14px 'Space Grotesk'}#legend .bar{height:8px;border-radius:6px;margin:10px 0 6px}
#legend .r{display:flex;justify-content:space-between;color:var(--dim);font-size:11px}
#ticker{position:absolute;left:0;right:0;bottom:0;height:40px;overflow:hidden;border-top:1px solid var(--line);
 background:linear-gradient(0deg,rgba(3,6,12,.92),rgba(3,6,12,.55));display:flex;align-items:center}
#ticker .lbl{flex:none;padding:0 16px;font:600 11px 'Space Grotesk';letter-spacing:.16em;color:var(--acc2)}
#ticker .mv{white-space:nowrap;animation:mv 80s linear infinite;color:var(--dim);font-size:12.5px}
#ticker .mv b{color:var(--txt);font-weight:500}#ticker .mv span{margin:0 26px}
@keyframes mv{from{transform:translateX(0)}to{transform:translateX(-50%)}}
#panel{position:absolute;right:-420px;top:16px;bottom:56px;width:396px;overflow-y:auto;transition:right .4s cubic-bezier(.2,.8,.2,1);padding:0}
body.open #panel{right:16px}#panel::-webkit-scrollbar{width:6px}#panel::-webkit-scrollbar-thumb{background:rgba(255,255,255,.15);border-radius:6px}
.hero{height:150px;border-radius:18px 18px 0 0;position:relative;background-size:cover;background-position:center;overflow:hidden}
.hero:before{content:"";position:absolute;inset:0;background:inherit;filter:blur(18px) saturate(1.4);transform:scale(1.3)}
.hero:after{content:"";position:absolute;inset:0;background:linear-gradient(180deg,rgba(8,14,26,.1),rgba(8,14,26,.92))}
.hero .in{position:absolute;left:20px;right:20px;bottom:14px;z-index:2;display:flex;align-items:flex-end;gap:14px}
.hero img{width:64px;border-radius:8px;box-shadow:0 6px 24px rgba(0,0,0,.6)}
.hero h2{margin:0;font:700 26px 'Space Grotesk'}.hero p{margin:2px 0 0;color:var(--dim);font-size:12.5px}
#x{position:absolute;right:12px;top:10px;z-index:3;border:0;background:rgba(255,255,255,.12);color:#fff;width:28px;height:28px;border-radius:50%;cursor:pointer}
.sec{padding:14px 20px;border-top:1px solid var(--line);position:relative}.sec h4{margin:0 0 10px;font:600 10px Inter;letter-spacing:.18em;color:var(--dim);text-transform:uppercase}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.k{background:rgba(255,255,255,.045);border:1px solid var(--line);border-radius:12px;padding:10px 12px}
.k small{display:block;color:var(--dim);font-size:10.5px}.k b{font:600 15px 'Space Grotesk'}
.wx{display:flex;align-items:center;gap:14px}.wx .big{font:700 44px 'Space Grotesk';line-height:1}.wx .e{font-size:40px}
.fc{display:flex;gap:6px;margin-top:12px}.fc div{flex:1;text-align:center;background:rgba(255,255,255,.045);border-radius:10px;padding:7px 2px;font-size:11px;color:var(--dim)}
.fc b{display:block;color:var(--txt);font-size:12px;margin:2px 0}
.row{display:flex;align-items:center;gap:10px;margin:9px 0;font-size:12.5px}.row .nm{width:128px;color:var(--dim)}
.row .bx{flex:1;height:5px;border-radius:5px;background:rgba(255,255,255,.08);overflow:hidden}.row .bx i{display:block;height:100%;border-radius:5px;background:linear-gradient(90deg,#2fa8ff,#7cf7c4)}
.row .vl{width:92px;text-align:right}.row .vl small{display:block;color:var(--dim);font-size:10px}
.mix{display:flex;height:12px;border-radius:8px;overflow:hidden;gap:2px}.mix i{display:block}
.leg{display:flex;gap:14px;margin-top:9px;font-size:11.5px;color:var(--dim);flex-wrap:wrap}.leg b{color:var(--txt);font-weight:600}
.leg span:before{content:"";display:inline-block;width:8px;height:8px;border-radius:2px;background:var(--c);margin-right:5px}
.ex{color:#c4d2e8;font-size:12.5px;line-height:1.55}
.btn{width:100%;border:1px solid var(--line);background:rgba(255,255,255,.06);color:var(--txt);padding:10px;border-radius:12px;font:500 13px Inter;cursor:pointer;transition:.18s}
.btn:hover{background:rgba(90,209,255,.18);border-color:rgba(90,209,255,.5)}
.sk{height:14px;border-radius:7px;margin:10px 20px;background:linear-gradient(90deg,rgba(255,255,255,.05),rgba(255,255,255,.13),rgba(255,255,255,.05));background-size:200% 100%;animation:sh 1.2s infinite}
@keyframes sh{to{background-position:-200% 0}}
.cmph{display:grid;grid-template-columns:1fr auto 1fr;align-items:center;gap:8px;padding:22px 16px 16px;text-align:center}
.cmph .sd img{width:54px;border-radius:7px;box-shadow:0 6px 20px rgba(0,0,0,.5)}.cmph .sd b{display:block;font:700 17px 'Space Grotesk';margin-top:8px;color:var(--c)}
.cmph .sd small{color:var(--dim);font-size:11px}.cmph .vs{font:700 12px 'Space Grotesk';color:var(--dim);letter-spacing:.2em}
.cr{display:grid;grid-template-columns:1fr auto 1fr;align-items:baseline;margin-top:11px}
.cv{font:600 14px 'Space Grotesk';color:var(--dim)}.cv.w{color:var(--c)}.cv.r{text-align:right}.cl{color:var(--dim);font-size:11px;padding:0 8px;text-align:center}
.duel{display:grid;grid-template-columns:1fr 1fr;gap:3px;margin-top:5px}
.du{height:6px;background:rgba(255,255,255,.08);border-radius:6px;overflow:hidden;display:flex;justify-content:flex-end}.du.r{justify-content:flex-start}.du i{display:block;height:100%;border-radius:6px}
.pin{font-size:20px;filter:drop-shadow(0 0 6px rgba(255,160,60,.9));cursor:help;transform:translate(-50%,-50%)}
.pin.iss{font-size:26px;filter:drop-shadow(0 0 10px rgba(120,220,255,.95))}
.aq{transform:translate(-50%,-50%);min-width:26px;height:26px;padding:0 4px;border-radius:13px;display:grid;place-items:center;font:700 11px Inter;color:#0a1020;background:var(--c);box-shadow:0 0 14px var(--c);cursor:help}
.tip{padding:10px 12px;background:rgba(8,14,26,.88);border:1px solid var(--line);border-radius:12px;font:12px Inter;color:#eaf2ff;backdrop-filter:blur(10px);min-width:170px}
.tip b{font:600 14px 'Space Grotesk'}.tip .v{margin-top:4px;color:#7cf7c4;font-weight:600}.tip .s{color:#8fa3c0;font-size:11px}
#boot{position:absolute;inset:0;display:grid;place-items:center;background:#03060c;transition:opacity .8s;z-index:9;font:600 13px 'Space Grotesk';letter-spacing:.3em;color:var(--dim)}
@media(max-width:900px){#layers,#legend{display:none}#panel{width:calc(100% - 24px)}#search{width:56vw;left:auto;right:16px;transform:none}}
</style></head><body>
<div id="boot">LOADING ATLAS…</div><div id="globe"></div>
<div id="brand" class="glass"><b class="h">TERRA</b><small>Live world atlas · updated __UPD__</small></div>
<div id="search" class="glass"><span>🔍</span><input id="q" list="cl" placeholder="Search a country…" autocomplete="off"><kbd>/</kbd><datalist id="cl"></datalist></div>
<div id="lens" class="glass"><div class="t">Colour the world by</div><div id="lensList"></div></div>
<div id="layers" class="glass"><div class="t">Live layers</div>
 <div class="sw on" data-k="quakes"><span>🫨 Earthquakes <em id="nq"></em></span><i class="tg"></i></div>
 <div class="sw on" data-k="events"><span>🔥 Natural events <em id="ne"></em></span><i class="tg"></i></div>
 <div class="sw on" data-k="flights"><span>✈️ Flights <em id="nf"></em></span><i class="tg"></i></div>
 <div class="sw on" data-k="aqi"><span>🌫️ City air quality <em id="na"></em></span><i class="tg"></i></div>
 <div class="sw on" data-k="iss"><span>🛰️ ISS live</span><i class="tg"></i></div>
 <div class="t" style="margin-top:10px">Display & tools</div>
 <div class="sw" data-k="cmp"><span>⚖️ Compare countries</span><i class="tg"></i></div>
 <div class="sw on" data-k="relief"><span>Relief extrusion</span><i class="tg"></i></div>
 <div class="sw on" data-k="spin"><span>Auto-rotate</span><i class="tg"></i></div>
 <div class="sw" data-k="night"><span>Night imagery</span><i class="tg"></i></div></div>
<div id="legend" class="glass"><div class="n" id="lgN"></div><div class="bar" id="lgB"></div><div class="r"><span id="lgL"></span><span id="lgH"></span></div></div>
<div id="panel" class="glass"></div>
<div id="ticker"><div class="lbl">● TRENDING ON WIKIPEDIA</div><div class="mv" id="mv"></div></div>

<script src="https://cdn.jsdelivr.net/npm/globe.gl@2.33.1/dist/globe.gl.min.js"></script>
<script>
const D = __DATA__;
const IMG = {day:'https://unpkg.com/three-globe@2.31.0/example/img/earth-blue-marble.jpg',
 night:'https://unpkg.com/three-globe@2.31.0/example/img/earth-night.jpg',
 bump:'https://unpkg.com/three-globe@2.31.0/example/img/earth-topology.png',
 sky:'https://unpkg.com/three-globe@2.31.0/example/img/night-sky.png'};
const GEO='https://raw.githubusercontent.com/vasturiano/globe.gl/master/example/datasets/ne_110m_admin_0_countries.geojson';
const $=s=>document.querySelector(s), j=u=>fetch(u,{signal:AbortSignal.timeout(9000)}).then(r=>r.ok?r.json():null).catch(()=>null);
const S={lens:D.lenses[0].id,quakes:true,events:true,flights:true,aqi:true,iss:true,relief:true,spin:true,night:false,cmp:false};
let hovered=null, iss=null, sel=null, cmp={a:null,b:null}, cmpArc=null, cmpN=0, feats=[];
const MIXSKIP=['fossil','nuclear','hydro','renew'];

// ---------- helpers
const cmpf=new Intl.NumberFormat('en',{notation:'compact',maximumFractionDigits:1});
function fmt(v,t){ if(v==null) return '—';
 return t==='usd'?'$'+cmpf.format(v):t==='pct'?v.toFixed(1)+'%':t==='yrs'?v.toFixed(1)+' yrs':t==='co2'?v.toFixed(1)+' t':t==='pm'?v.toFixed(1)+' µg/m³':t==='kgoe'?cmpf.format(v)+' kgoe':cmpf.format(v);}
const hex=h=>[1,3,5].map(i=>parseInt(h.substr(i,2),16));
function ramp(pal,x){x=Math.max(0,Math.min(1,x));const p=x*(pal.length-1),i=Math.min(pal.length-2,Math.floor(p)),f=p-i,a=hex(pal[i]),b=hex(pal[i+1]);
 return a.map((c,k)=>Math.round(c+(b[k]-c)*f));}
const AQ=v=>v<=20?'Good':v<=40?'Fair':v<=60?'Moderate':v<=80?'Poor':v<=100?'Very poor':'Extreme';
const aqc=v=>v<=20?'#3ddc97':v<=40?'#9be15d':v<=60?'#f2e06a':v<=80?'#f5a742':v<=100?'#ef5b4c':'#b01e5b';
const ago=t=>{const m=Math.round((Date.now()-t)/60000);return m<60?m+' min ago':m<1440?Math.round(m/60)+' h ago':Math.round(m/1440)+' d ago';};
const L={}; D.lenses.forEach(l=>{ const v=D.values[l.id], tr=x=>l.log?Math.log10(Math.max(x,1)):x;
 const e=Object.entries(v).map(([k,a])=>[k,a[0]]), s=e.map(a=>tr(a[1])).sort((a,b)=>a-b);
 const lo=s[Math.floor(s.length*.05)]??0, hi=s[Math.floor(s.length*.95)]??1;
 const rk={}; e.sort((a,b)=>b[1]-a[1]).forEach((a,i)=>rk[a[0]]=i+1);
 L[l.id]={l,tr,lo,hi,rk,n:e.length}; });
const cur=()=>L[S.lens];
function norm(iso){const c=cur(),a=D.values[S.lens][iso]; if(!a) return null; return (c.tr(a[0])-c.lo)/((c.hi-c.lo)||1);}
function norm0(id,iso){const c=L[id],a=D.values[id][iso];return a?Math.max(.03,Math.min(1,(c.tr(a[0])-c.lo)/((c.hi-c.lo)||1))):0;}
const isHi=d=>d===hovered||d===sel||d===cmp.a||d===cmp.b;
const AQI_PINS=D.aqi.map(c=>({lat:c.lat,lng:c.lng,aq:c.aqi,title:`${c.name} · European AQI ${Math.round(c.aqi)} — ${AQ(c.aqi)}`}));

// ---------- globe
const world=Globe()($('#globe'))
 .globeImageUrl(IMG.day).bumpImageUrl(IMG.bump).backgroundImageUrl(IMG.sky)
 .atmosphereColor('#6db7ff').atmosphereAltitude(0.22)
 .polygonCapColor(d=>{const n=norm(d.properties.ADM0_A3); if(n==null) return isHi(d)?'rgba(200,215,240,.4)':'rgba(130,145,170,.16)';
   const c=ramp(cur().l.pal,n); return `rgba(${c},${isHi(d)?.97:.78})`;})
 .polygonSideColor(()=>'rgba(255,255,255,.07)')
 .polygonStrokeColor(d=>d===cmp.a?'#ffd36b':d===cmp.b?'#ff7a8a':'rgba(255,255,255,.22)')
 .polygonAltitude(d=>{const n=norm(d.properties.ADM0_A3); const b=S.relief&&n!=null?.004+Math.max(0,Math.min(1,n))*.05:.003; return b+(isHi(d)?.018:0);})
 .polygonsTransitionDuration(350)
 .polygonLabel(d=>{const p=d.properties,a=D.values[S.lens][p.ADM0_A3],c=cur();
   return `<div class="tip"><b>${p.NAME}</b><div class="v">${a?fmt(a[0],c.l.fmt):'No data'}</div>
   <div class="s">${c.l.label}${a?` · ${a[1]} · #${c.rk[p.ADM0_A3]} of ${c.n}`:''}</div><div class="s" style="margin-top:6px">${S.cmp?'Click to compare':'Click to explore'}</div></div>`;})
 .onPolygonHover(d=>{hovered=d; redraw();})
 .onPolygonClick(d=>pick(d))
 .pointLat('lat').pointLng('lng').pointAltitude(d=>.004+d.mag*.004).pointRadius(d=>.12+d.mag*.05)
 .pointColor(d=>d.mag>=6?'#ff3b5c':d.mag>=5?'#ff7a45':d.mag>=4?'#ffc247':'#ffe9a0')
 .pointLabel(d=>`<div class="tip"><b>M ${d.mag.toFixed(1)}</b><div class="s">${d.place||''}</div><div class="s">${ago(d.t)}</div></div>`)
 .ringLat('lat').ringLng('lng').ringMaxRadius(d=>d.mag*1.1).ringPropagationSpeed(1.6).ringRepeatPeriod(1500)
 .ringColor(()=>t=>`rgba(255,110,70,${1-t})`)
 .arcStartLat('sLat').arcStartLng('sLng').arcEndLat('eLat').arcEndLng('eLng')
 .arcColor(d=>d.cmp?['#ffd36b','#ff7a8a']:['rgba(90,209,255,0)','rgba(160,255,225,.95)'])
 .arcStroke(d=>d.cmp?.7:.28).arcAltitudeAutoScale(d=>d.cmp?.45:.12)
 .arcDashLength(d=>d.cmp?.35:1).arcDashGap(d=>d.cmp?.15:0).arcDashAnimateTime(d=>d.cmp?2600:0).arcsTransitionDuration(0)
 .arcLabel(d=>d.cmp?'':`<div class="tip"><b>${d.cs}</b><div class="s">${d.c}${d.alt?' · '+(Math.round(d.alt*3.281/100)*100).toLocaleString()+' ft':''} · ${Math.round(d.v*3.6)} km/h</div></div>`)
 .htmlLat('lat').htmlLng('lng').htmlAltitude(.02)
 .htmlElement(d=>{const e=document.createElement('div');
   if(d.aq!=null){e.className='aq';e.style.setProperty('--c',aqc(d.aq));e.textContent=Math.round(d.aq);}
   else{e.className='pin'+(d.iss?' iss':'');e.innerHTML=d.icon;}
   e.title=d.title;return e;});
const ctl=world.controls(); ctl.autoRotate=true; ctl.autoRotateSpeed=.35; ctl.enableDamping=true; ctl.minDistance=140; ctl.maxDistance=520;
world.pointOfView({lat:15,lng:20,altitude:2.4});
function redraw(){world.polygonCapColor(world.polygonCapColor()).polygonAltitude(world.polygonAltitude()).polygonStrokeColor(world.polygonStrokeColor());}
function layers(){
 world.pointsData(S.quakes?D.quakes:[]).ringsData(S.quakes?D.quakes.filter(q=>q.mag>=5):[]);
 let h=[]; if(S.events)h=h.concat(D.events); if(S.aqi)h=h.concat(AQI_PINS); if(S.iss&&iss)h.push(iss);
 world.htmlElementsData(h);
 let a=S.flights?D.flights:[]; if(cmpArc)a=a.concat([cmpArc]); world.arcsData(a);}
function legend(){const c=cur(),p=c.l.pal;$('#lgN').textContent=c.l.label;
 $('#lgB').style.background=`linear-gradient(90deg,${p.join(',')})`;
 const inv=x=>c.l.log?Math.pow(10,x):x; $('#lgL').textContent=fmt(inv(c.lo),c.l.fmt); $('#lgH').textContent=fmt(inv(c.hi),c.l.fmt);
 document.querySelectorAll('#lensList .chip').forEach(b=>b.classList.toggle('on',b.dataset.id===S.lens));}
function setToggle(k,v){S[k]=v;const el=document.querySelector(`.sw[data-k="${k}"]`);if(el)el.classList.toggle('on',v);}

// ---------- UI wiring
let lg='';D.lenses.forEach(l=>{ if(l.group!==lg){const h=document.createElement('div');h.className='gh';h.textContent=l.group;$('#lensList').appendChild(h);lg=l.group;}
 const b=document.createElement('button');b.className='chip';b.dataset.id=l.id;
 b.style.setProperty('--sw','rgb('+ramp(l.pal,.7)+')');b.innerHTML=`<i class="dot"></i>${l.label}`;
 b.onclick=()=>{S.lens=l.id;legend();redraw();if(sel&&!S.cmp)openCountry(sel,true);};$('#lensList').appendChild(b);});
document.querySelectorAll('.sw').forEach(el=>el.onclick=()=>{const k=el.dataset.k;setToggle(k,!S[k]);
 if(k==='spin')ctl.autoRotate=S.spin; if(k==='night')world.globeImageUrl(S.night?IMG.night:IMG.day);
 if(k==='cmp'){S.cmp?startCompare(null):exitCompare();return;} if(k==='relief')redraw(); layers();});
$('#nq').textContent=D.quakes.length+' · M2.5+ 7d'; $('#ne').textContent=D.events.length;
$('#nf').textContent=D.flights.length?D.flights.length+' · OpenSky':'offline'; $('#na').textContent=D.aqi.length||'offline';
const tk=D.trending.map(t=>`<span><b>${t.t}</b> ${cmpf.format(t.v)} views</span>`).join('');
$('#mv').innerHTML=tk+tk;

// ---------- search
function findC(v){v=v.trim().toLowerCase();if(!v)return null;const n=f=>f.properties.NAME.toLowerCase();
 return feats.find(f=>n(f)===v)||feats.find(f=>n(f).startsWith(v))||feats.find(f=>(f.properties.NAME_LONG||'').toLowerCase().includes(v));}
function doSearch(exact){const e=$('#q'),f=findC(e.value);if(f&&(!exact||f.properties.NAME.toLowerCase()===e.value.trim().toLowerCase())){e.value='';e.blur();pick(f);}}
$('#q').addEventListener('input',()=>doSearch(true));$('#q').addEventListener('change',()=>doSearch(false));
addEventListener('keydown',e=>{if(e.key==='/'&&document.activeElement!==$('#q')){e.preventDefault();$('#q').focus();}});

// ---------- country geometry + routing
function center(d){const g=d.geometry,polys=g.type==='Polygon'?[g.coordinates]:g.coordinates;
 let best=polys[0];polys.forEach(p=>{if(p[0].length>best[0].length)best=p;});
 const xs=best[0].map(a=>a[0]),ys=best[0].map(a=>a[1]);return {lng:(Math.min(...xs)+Math.max(...xs))/2,lat:(Math.min(...ys)+Math.max(...ys))/2,
 span:Math.max(Math.max(...xs)-Math.min(...xs),Math.max(...ys)-Math.min(...ys))};}
const fly=(c,alt,ms)=>{ctl.autoRotate=false;world.pointOfView({lat:c.lat,lng:c.lng,altitude:alt},ms||1400);};
const xBtn=f=>{const x=$('#x');if(x)x.onclick=f;};
function pick(d){S.cmp?compareAdd(d):openCountry(d);}
function closeP(){sel=null;document.body.classList.remove('open');ctl.autoRotate=S.spin;world.pointOfView({altitude:2.2},1200);redraw();}

// ---------- single country panel
const WX=c=>c===0?'☀️':c<=2?'🌤️':c==3?'☁️':c<=48?'🌫️':c<=57?'🌦️':c<=67?'🌧️':c<=77?'🌨️':c<=82?'🌧️':'⛈️';
function mixHTML(iso){const g=id=>{const a=D.values[id][iso];return a?a[0]:null;};
 const f=g('fossil'),n=g('nuclear'),r=g('renew'),hy=g('hydro');
 if([f,n,r].filter(v=>v!=null).length<2) return '';
 const parts=[['Fossil',f,'#ee8a3a'],['Nuclear',n,'#9a5be0'],['Renewable',r,'#52c97a']].map(p=>[p[0],Math.max(0,p[1]||0),p[2]]);
 const tot=parts.reduce((s,p)=>s+p[1],0)||1,yr=(D.values.fossil[iso]||D.values.renew[iso]||[0,''])[1];
 return `<div class="sec"><h4>Electricity mix · ${yr}</h4><div class="mix">${parts.map(p=>`<i style="width:${p[1]/tot*100}%;background:${p[2]}"></i>`).join('')}</div>
 <div class="leg">${parts.map(p=>`<span style="--c:${p[2]}"><b>${p[1].toFixed(0)}%</b> ${p[0]}</span>`).join('')}</div>${hy!=null?`<div class="ex" style="margin-top:8px;font-size:11.5px">Of which hydro: ${hy.toFixed(0)}%</div>`:''}</div>`;}
async function openCountry(d,keepView){
 sel=d;const p=d.properties,iso=p.ADM0_A3,c=center(d);document.body.classList.add('open');redraw();
 if(!keepView)fly(c,Math.max(.45,Math.min(2,c.span/38)));
 $('#panel').innerHTML=`<div class="hero"><button id="x">✕</button><div class="in"><div><h2>${p.NAME}</h2><p>Gathering live data…</p></div></div></div><div class="sk"></div><div class="sk" style="width:70%"></div><div class="sk"></div>`;
 xBtn(closeP);
 let rc=await j(`https://restcountries.com/v3.1/alpha/${iso}?fields=name,flags,capital,capitalInfo,population,area,languages,currencies,region,subregion,cca2`);
 if(Array.isArray(rc)) rc=rc[0];
 const ll=rc&&rc.capitalInfo&&rc.capitalInfo.latlng?rc.capitalInfo.latlng:[c.lat,c.lng], cc=rc&&Object.keys(rc.currencies||{})[0], a2=rc&&rc.cca2;
 const [wx,aq,fx,hol,wk]=await Promise.all([
  j(`https://api.open-meteo.com/v1/forecast?latitude=${ll[0]}&longitude=${ll[1]}&current=temperature_2m,wind_speed_10m,weather_code&daily=temperature_2m_max,temperature_2m_min,weather_code&timezone=auto&forecast_days=5`),
  j(`https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${ll[0]}&longitude=${ll[1]}&current=european_aqi,pm2_5`),
  cc&&cc!=='USD'?j(`https://api.frankfurter.app/latest?from=USD&to=${cc}`):null,
  a2?j(`https://date.nager.at/api/v3/NextPublicHolidays/${a2}`):null,
  j(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(rc?rc.name.common:p.NAME)}`)]);
 if(sel!==d) return;
 const flag=rc?rc.flags.png:'';let h=`<div class="hero" style="background-image:url(${flag})"><button id="x">✕</button><div class="in">${flag?`<img src="${flag}">`:''}<div><h2>${p.NAME}</h2><p>${rc?(rc.capital||[])[0]+' · '+rc.subregion:p.CONTINENT}</p></div></div></div>`;
 h+=`<div class="sec" style="padding-bottom:4px"><button class="btn" id="cmpbtn">⚖️ Compare with another country</button></div>`;
 if(rc){const lang=Object.values(rc.languages||{}).slice(0,3).join(', ')||'—',cur0=cc?rc.currencies[cc]:null;
  h+=`<div class="sec"><div class="grid"><div class="k"><small>Population</small><b>${cmpf.format(rc.population)}</b></div><div class="k"><small>Area</small><b>${cmpf.format(rc.area)} km²</b></div>
  <div class="k"><small>Languages</small><b style="font-size:13px">${lang}</b></div><div class="k"><small>Currency</small><b style="font-size:13px">${cur0?cur0.name+' ('+cc+')':'—'}</b></div></div></div>`;}
 if(wx&&wx.current){const t=new Date(Date.now()+wx.utc_offset_seconds*1000).toISOString().substr(11,5);
  h+=`<div class="sec"><h4>Right now in the capital · ${t} local</h4><div class="wx"><div class="e">${WX(wx.current.weather_code)}</div><div class="big">${Math.round(wx.current.temperature_2m)}°</div>
  <div style="color:var(--dim);font-size:12px">Wind ${Math.round(wx.current.wind_speed_10m)} km/h${aq&&aq.current?`<br>Air quality: <b style="color:var(--txt)">${AQ(aq.current.european_aqi)}</b> (AQI ${Math.round(aq.current.european_aqi)})`:''}</div></div>
  <div class="fc">${wx.daily.time.map((x,i)=>`<div>${new Date(x).toLocaleDateString('en',{weekday:'short'})}<b>${WX(wx.daily.weather_code[i])}</b>${Math.round(wx.daily.temperature_2m_max[i])}° / ${Math.round(wx.daily.temperature_2m_min[i])}°</div>`).join('')}</div></div>`;}
 const extra=[];if(fx&&fx.rates&&cc)extra.push(`<div class="k"><small>1 USD =</small><b>${fx.rates[cc]} ${cc}</b></div>`);
 if(hol&&hol[0])extra.push(`<div class="k"><small>Next public holiday · ${hol[0].date}</small><b style="font-size:13px">${hol[0].name}</b></div>`);
 if(extra.length)h+=`<div class="sec"><div class="grid">${extra.join('')}</div></div>`;
 h+=mixHTML(iso);
 h+=`<div class="sec"><h4>World Bank snapshot</h4>`+D.lenses.filter(l=>!MIXSKIP.includes(l.id)).map(l=>{const a=D.values[l.id][iso],n=norm0(l.id,iso);
  return `<div class="row"><span class="nm">${l.label}</span><span class="bx"><i style="width:${a?Math.round(n*100):0}%"></i></span><span class="vl">${a?fmt(a[0],l.fmt):'—'}<small>${a?a[1]+' · #'+L[l.id].rk[iso]:''}</small></span></div>`;}).join('')+`</div>`;
 if(wk&&wk.extract){let t=wk.extract;if(t.length>340)t=t.slice(0,340).replace(/\s+\S*$/,'')+'…';h+=`<div class="sec"><h4>About</h4><div class="ex">${t}</div></div>`;}
 $('#panel').innerHTML=h;xBtn(closeP);
 $('#cmpbtn').onclick=()=>{setToggle('cmp',true);startCompare(d);};}

// ---------- compare mode
function startCompare(first){sel=null;cmp={a:first,b:null};cmpArc=null;layers();redraw();
 if(first)fly(center(first),1.6,1000);renderCompare();}
function exitCompare(){setToggle('cmp',false);cmp={a:null,b:null};cmpArc=null;cmpN++;layers();closeP();}
function compareAdd(d){ if(!cmp.a||(cmp.a&&cmp.b)){cmp={a:d,b:null};cmpArc=null;fly(center(d),1.6,1000);}
 else if(d!==cmp.a){cmp.b=d;} else return; layers();redraw();renderCompare();}
function mid(p,q){const r=x=>x*Math.PI/180,v=(la,lo)=>[Math.cos(r(la))*Math.cos(r(lo)),Math.cos(r(la))*Math.sin(r(lo)),Math.sin(r(la))];
 const A=v(p.lat,p.lng),B=v(q.lat,q.lng),M=A.map((x,i)=>x+B[i]),n=Math.hypot(...M)||1;
 const ang=Math.acos(Math.max(-1,Math.min(1,A[0]*B[0]+A[1]*B[1]+A[2]*B[2])));
 return {lat:Math.asin(M[2]/n)*180/Math.PI,lng:Math.atan2(M[1],M[0])*180/Math.PI,ang};}
const hint=(t,s)=>`<div class="sec" style="border:0;padding:30px 24px"><button id="x">✕</button><div class="h" style="font:700 20px 'Space Grotesk'">${t}</div><p class="ex" style="margin-top:8px">${s}</p></div>`;
async function cdata(d){const c=center(d);let rc=await j(`https://restcountries.com/v3.1/alpha/${d.properties.ADM0_A3}?fields=name,flags,capital,capitalInfo`);if(Array.isArray(rc))rc=rc[0];
 const ll=rc&&rc.capitalInfo&&rc.capitalInfo.latlng?rc.capitalInfo.latlng:[c.lat,c.lng];
 const wx=await j(`https://api.open-meteo.com/v1/forecast?latitude=${ll[0]}&longitude=${ll[1]}&current=temperature_2m,weather_code&timezone=auto`);return {rc,wx,c};}
async function renderCompare(){
 const n=++cmpN,{a,b}=cmp;document.body.classList.add('open');ctl.autoRotate=false;
 if(!a){$('#panel').innerHTML=hint('Compare mode','Click any country on the globe, or search for one, to start.');xBtn(exitCompare);return;}
 if(!b){$('#panel').innerHTML=hint(a.properties.NAME+' selected','Now pick a second country to compare side by side.');xBtn(exitCompare);return;}
 $('#panel').innerHTML=`<div class="sec" style="border:0"><button id="x">✕</button></div><div class="sk"></div><div class="sk" style="width:70%"></div><div class="sk"></div>`;xBtn(exitCompare);
 const [A,B]=await Promise.all([cdata(a),cdata(b)]);if(n!==cmpN)return;
 cmpArc={cmp:true,sLat:A.c.lat,sLng:A.c.lng,eLat:B.c.lat,eLng:B.c.lng};layers();
 const m=mid(A.c,B.c);fly(m,Math.min(3.2,.9+m.ang*1.2),1400);
 const ia=a.properties.ADM0_A3,ib=b.properties.ADM0_A3;
 const side=(o,d,c)=>`<div class="sd" style="--c:${c}">${o.rc?`<img src="${o.rc.flags.png}">`:''}<b>${d.properties.NAME}</b><small>${o.wx&&o.wx.current?WX(o.wx.current.weather_code)+' '+Math.round(o.wx.current.temperature_2m)+'° now':(o.rc&&o.rc.capital?o.rc.capital[0]:'')}</small></div>`;
 let h=`<div class="cmph"><button id="x">✕</button>${side(A,a,'#ffd36b')}<div class="vs">VS</div>${side(B,b,'#ff7a8a')}</div>
 <div class="sec" style="padding:10px 20px"><button class="btn" id="swap">⇄ Swap countries</button></div>`;
 [...new Set(D.lenses.map(l=>l.group))].forEach(g=>{h+=`<div class="sec"><h4>${g}</h4>`+D.lenses.filter(l=>l.group===g).map(l=>{
  const va=D.values[l.id][ia],vb=D.values[l.id][ib],w=va&&vb?(va[0]>vb[0]?'a':va[0]<vb[0]?'b':''):'';
  return `<div class="cr"><div class="cv ${w==='a'?'w':''}" style="--c:#ffd36b">${va?fmt(va[0],l.fmt):'—'}</div><div class="cl">${l.label}</div><div class="cv r ${w==='b'?'w':''}" style="--c:#ff7a8a">${vb?fmt(vb[0],l.fmt):'—'}</div></div>
  <div class="duel"><div class="du"><i style="width:${va?norm0(l.id,ia)*100:0}%;background:#ffd36b"></i></div><div class="du r"><i style="width:${vb?norm0(l.id,ib)*100:0}%;background:#ff7a8a"></i></div></div>`;}).join('')+`</div>`;});
 h+=`<div class="sec"><div class="ex" style="font-size:11px">Bars are scaled across all countries (5th–95th percentile). The highlighted value is the larger one — higher is not always better.</div></div>`;
 $('#panel').innerHTML=h;xBtn(exitCompare);$('#swap').onclick=()=>{cmp={a:b,b:a};cmpArc=null;layers();redraw();renderCompare();};}

// ---------- ISS (live, keyless)
async function pollISS(){const r=await j('https://api.wheretheiss.at/v1/satellites/25544');
 if(r){iss={lat:r.latitude,lng:r.longitude,icon:'🛰️',iss:true,title:`ISS · ${Math.round(r.altitude)} km · ${Math.round(r.velocity)} km/h`};if(S.iss)layers();}}

fetch(GEO).then(r=>r.json()).then(g=>{feats=g.features.filter(f=>f.properties.ADM0_A3!=='ATA');world.polygonsData(feats);
 $('#cl').innerHTML=feats.map(f=>f.properties.NAME).sort().map(n=>`<option value="${n.replace(/"/g,'&quot;')}">`).join('');
 legend();layers();pollISS();setInterval(pollISS,6000);setTimeout(()=>{$('#boot').style.opacity=0;setTimeout(()=>$('#boot').remove(),900)},500);})
 .catch(()=>{$('#boot').textContent='COULD NOT LOAD MAP DATA — CHECK YOUR CONNECTION';});
addEventListener('resize',()=>world.width(innerWidth).height(innerHeight));
</script></body></html>
"""

html = HTML.replace("__UPD__", payload["updated"]).replace(
    "__DATA__", json.dumps(payload, ensure_ascii=False).replace("</", "<\\/"))
components.html(html, height=880, scrolling=False)
