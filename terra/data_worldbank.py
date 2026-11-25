"""World Bank lens data (cached 24 h). TERRA_MASTER_SPEC.md §4.2, §4.6.

M1 trim (§4.6): the four electricity lenses merge into ONE "Electricity mix" lens
with a segmented control (Renewable · Fossil · Nuclear · Hydro) over the same
indicators. "Urban share %" keeps its own lens; absolute population stays.
"""
from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor

import streamlit as st

from . import net

# Refined sequential ramps (dark → light)
COOL = ["#0a1f3d", "#14477a", "#1f7fa8", "#4fc0c0", "#d9f3d0"]
FOREST = ["#0a2a2a", "#14604e", "#35a36a", "#a3d977", "#f4f2b0"]
PLUM = ["#241238", "#6b1f5c", "#c2415a", "#f08a4b", "#fbe3a0"]
AMBER = ["#1c1a2e", "#5a3a4a", "#b5533c", "#f0953a", "#ffe08a"]
MAGMA = ["#0d0b24", "#3b1a63", "#8b2a8a", "#e0485f", "#fbb36a"]

S_, E_, A_ = "Society & economy", "Energy & electricity", "Air & climate"

# id, World Bank code, label, format, log-scale, palette, group
# The four electricity rows share group "power" and are rendered as ONE lens
# with a segmented control (§4.6).
LENSES = [
    ("gdp", "NY.GDP.PCAP.CD", "GDP per person", "usd", True, COOL, S_),
    ("gdptotal", "NY.GDP.MKTP.CD", "GDP (total)", "usd", True, COOL, S_),
    ("net", "IT.NET.USER.ZS", "Internet users", "pct", False, COOL, S_),
    ("mobile", "IT.CEL.SETS.P2", "Mobile subs / 100", "num", False, COOL, S_),
    ("life", "SP.DYN.LE00.IN", "Life expectancy", "yrs", False, FOREST, S_),
    ("pop", "SP.POP.TOTL", "Population", "num", True, PLUM, S_),
    ("urban", "SP.URB.TOTL.IN.ZS", "Urban share", "pct", False, COOL, S_),
    ("unemp", "SL.UEM.TOTL.ZS", "Unemployment", "pct", False, AMBER, S_),
    ("renew", "EG.ELC.RNEW.ZS", "Renewable electricity", "pct", False, FOREST, "power"),
    ("fossil", "EG.ELC.FOSL.ZS", "Fossil electricity", "pct", False, AMBER, "power"),
    ("nuclear", "EG.ELC.NUCL.ZS", "Nuclear electricity", "pct", False, MAGMA, "power"),
    ("hydro", "EG.ELC.HYRO.ZS", "Hydro electricity", "pct", False, COOL, "power"),
    ("energy", "EG.USE.PCAP.KG.OE", "Energy use per person", "kgoe", True, AMBER, E_),
    ("pm25", "EN.ATM.PM25.MC.M3", "PM2.5 air pollution", "pm", False, MAGMA, A_),
    ("co2", "EN.ATM.CO2E.PC", "CO₂ per person", "co2", False, AMBER, A_),
]
POWER_SUBS = ["renew", "fossil", "nuclear", "hydro"]


def fetch_wb(code: str) -> dict:
    """World Bank indicator → {ISO3: [value, year]} (thread-safe, no st.* calls)."""
    data = net.get_json("worldbank", query=dict(format="json", mrnev=1, per_page=20000),
                        timeout=(3, 20), cache_key=code)
    try:
        return {x["countryiso3code"]: [x["value"], x["date"]]
                for x in data[1] if x.get("value") is not None and x.get("countryiso3code")}
    except Exception:  # noqa: BLE001
        return {}


@st.cache_data(ttl=86400, show_spinner=False)
def static_bundle() -> dict:
    """All lens indicators, fetched in parallel (≤ 5 concurrent per §4.2)."""
    with ThreadPoolExecutor(5) as ex:
        res = list(ex.map(fetch_wb, [l[1] for l in LENSES]))
    return {l[0]: v for l, v in zip(LENSES, res)}


def lens_payload() -> tuple[list[dict], dict]:
    """(lenses, values) for the browser payload, with the power lens merged."""
    lenses = [dict(id=l[0], label=l[2], fmt=l[3], log=l[4], pal=l[5], group=l[6])
              for l in LENSES if l[6] != "power"]
    power = dict(id="power", label="Electricity mix", fmt="pct", log=False,
                 pal=FOREST, group=E_,
                 subs=[dict(id=s, label=next(l[2] for l in LENSES if l[0] == s)) for s in POWER_SUBS])
    lenses.insert(next(i for i, l in enumerate(lenses) if l["id"] == "unemp") + 1, power)   # Society → Energy → Air
    values = static_bundle()
    return lenses, values
