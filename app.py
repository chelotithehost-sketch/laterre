"""TERRA — Live World Atlas. Streamlit entrypoint (TERRA_MASTER_SPEC.md §3).

Layout: 🌐 Globe (one self-contained HTML page in a sandboxed iframe — all
interaction happens in the browser with no Streamlit reruns) and 🛰️ Network Lab
(server-side tools that cannot run in a browser: TLS cert, HTTP headers, rDNS).

Every outbound request goes through terra/net.py; every browser request through
web/js/net.js. Endpoint URLs live only in sources.yaml. No keys, no accounts.
"""
import datetime as dt

import streamlit as st

from terra import bundle, data_live, data_news, data_worldbank, dns_report, net, tools_server

st.set_page_config(page_title="TERRA · Live World Atlas", page_icon="🌍",
                   layout="wide", initial_sidebar_state="collapsed")
st.markdown("""<style>
header[data-testid="stHeader"], footer, #MainMenu {display:none !important;}
.block-container {padding:0 !important; max-width:100% !important;}
.stApp {background:#05080f;}
iframe {border:0; display:block; width:100%; height:calc(100vh - 64px) !important; min-height:640px;}
</style>""", unsafe_allow_html=True)


# ------------------------------------------------------------------ payload
@st.cache_data(ttl=300, show_spinner=False)
def build_payload() -> dict:
    live = data_live.live_bundle()
    # data lenses (World Bank) were removed: nothing numeric to colour the globe with — it is a news globe now
    return dict(lenses=[], values={}, wikinews=data_news.fetch_wiki_news(), fx=data_live.fetch_fx(),
                countries=data_live.fetch_countries_all(), bigmac=data_live.fetch_bigmac(),
                news=data_news.fetch_headlines(), static=load_static_data(),
                updated=net.utcnow().strftime("%H:%M UTC"), **live)


def load_static_data() -> dict:
    """Curated data/ datasets, gated by scripts/validate_data.py (§4.8)."""
    import json
    from pathlib import Path
    out = {}
    for f in (Path(__file__).parent / "data").glob("*.json"):
        doc = json.loads(f.read_text(encoding="utf-8"))
        recs = [r for r in doc.get("records", [])
                if r.get("verified") is True and (r.get("source_url") or doc.get("source_url"))
                and (r.get("as_of") or doc.get("as_of"))]
        out[f.stem] = dict(records=recs, as_of=doc.get("as_of"), source_url=doc.get("source_url"))
    return out


# ------------------------------------------------------------------ layout
tab_globe, tab_lab = st.tabs(["🌐 Globe", "🛰️ Network Lab"])

with tab_globe:
    with st.spinner("Calibrating satellites…"):
        payload = build_payload()
    payload["initialRoute"] = st.query_params.get("q", "")
    html = bundle.assemble(payload)
    if hasattr(st, "iframe"):                    # Streamlit ≥ 1.56
        st.iframe(html, height=880)
    else:                                        # older Streamlit
        import streamlit.components.v1 as components
        components.html(html, height=880, scrolling=False)

with tab_lab:
    st.markdown("#### 🛰️ Network Lab — read-only lookups of public data")
    st.caption("Runs on the server (TLS / headers / reverse DNS need sockets). "
               "Private and reserved addresses are refused. No queries are logged.")

    # per-session throttle (§10): 10 lookups/min, 60/hour
    now = dt.datetime.now()
    if "tool_calls" not in st.session_state:
        st.session_state.tool_calls = []
    st.session_state.tool_calls = [t for t in st.session_state.tool_calls if (now - t).total_seconds() < 3600]

    def _throttled() -> bool:
        calls = st.session_state.tool_calls
        if len([t for t in calls if (now - t).total_seconds() < 60]) >= 10 or len(calls) >= 60:
            st.warning("Slow down a little — try again in a minute.")
            return False
        calls.append(now)
        return True

    with st.form("netlab"):
        target = st.text_input("Domain or IP", placeholder="example.com")
        tool = st.radio("Tool", ["DNS report (intoDNS-style)", "TLS certificate", "HTTP headers & redirects",
                                 "Reverse DNS (PTR)", "Email DNS health", "Subdomains (CT logs)"],
                        horizontal=True)
        submitted = st.form_submit_button("Look up")
    if submitted and target.strip():
        if _throttled():
            t = target.strip()
            try:
                with st.spinner("Looking up…"):
                    if tool.startswith("DNS report"):
                        rep = dns_report.build_report(t)
                        st.html(dns_report.render_html(rep))
                        st.markdown("##### Clear the cache on public resolvers")
                        st.caption("Changed your DNS? Ask these resolvers to forget the old answer, then run the report again. "
                                   "Enter the domain on each page.")
                        st.code(rep["domain"], language=None)
                        c1, c2, c3 = st.columns(3)
                        c1.link_button("OpenDNS cache check", "https://cachecheck.opendns.com/", use_container_width=True)
                        c2.link_button("Google Public DNS flush", "https://dns.google/cache", use_container_width=True)
                        c3.link_button("Cloudflare 1.1.1.1 purge", "https://one.one.one.one/purge-cache/", use_container_width=True)
                    elif tool == "TLS certificate":
                        st.json(tools_server.tls_certificate(t))
                    elif tool == "HTTP headers & redirects":
                        st.json(tools_server.headers_probe(t if "://" in t else "https://" + t))
                    elif tool == "Reverse DNS (PTR)":
                        st.json(tools_server.reverse_dns(t))
                    elif tool == "Email DNS health":
                        st.json(tools_server.email_dns_health(t))
                    else:
                        with st.spinner("CT logs can take up to 15 seconds…"):
                            st.json(tools_server.subdomains_crtsh(t))
            except dns_report.ReportError as e:
                st.error(str(e))
            except ModuleNotFoundError:
                st.error("The DNS report needs the dnspython package: add `dnspython` to requirements.txt and reinstall.")
            except tools_server.SSRFError as e:
                st.error(f"Not allowed: {e}")
            except Exception as e:  # noqa: BLE001 — friendly errors only (§6.11)
                st.warning("We could not complete that lookup. Try again in a minute.")
