"""World headlines from publisher RSS feeds (TERRA_MASTER_SPEC.md §4.7 + headline rules §6.10).

- feeds are fetched server-side through net.get_bytes with a 15-minute cache → any number
  of visitors cause at most one request per feed per 15 minutes
- headlines ONLY: title, link, publisher, published time. No article text, no images.
- parsed with defusedxml (never stdlib xml on untrusted input)
- titles escaped at render time in the browser (esc()); markup is stripped here too
- balanced interleave: recency within each publisher, then round-robin across
  publishers; near-duplicate titles collapsed; ≤ 2 per publisher per 10-item window
"""
from __future__ import annotations

import datetime as dt
import html
import re
from email.utils import parsedate_to_datetime

import streamlit as st
from defusedxml import ElementTree as Det

from concurrent.futures import ThreadPoolExecutor

from . import net

ATOM = "{http://purl.org/atom/1.0}"
DC = "{http://purl.org/dc/elements/1.1/}"


def _text(el) -> str:
    """Element text with any embedded markup stripped (titles are untrusted)."""
    raw = "".join(el.itertext()) if el is not None else ""
    return re.sub(r"<[^>]+>", "", html.unescape(raw)).strip()[:300]


def _when(item) -> float:
    for tag in ("pubDate", DC + "date", ATOM + "updated", ATOM + "published", "updated", "published"):
        el = item.find(tag)
        if el is not None and el.text:
            t = el.text.strip()
            try:
                d = parsedate_to_datetime(t)
                return d.timestamp() if d.tzinfo else d.replace(tzinfo=dt.timezone.utc).timestamp()
            except Exception:  # noqa: BLE001
                try:
                    return dt.datetime.fromisoformat(t.replace("Z", "+00:00")).timestamp()
                except Exception:  # noqa: BLE001
                    return 0.0
    return 0.0


def _parse_feed(xml_bytes: bytes, publisher: str) -> list[dict]:
    root = Det.fromstring(xml_bytes)
    out = []
    for item in root.iter("item"):                      # RSS 2.0
        title, link = _text(item.find("title")), _text(item.find("link"))
        if title and link.startswith("http"):
            out.append(dict(t=title, url=link, pub=publisher, ts=_when(item)))
    for item in root.iter(ATOM + "entry"):              # Atom fallback
        link_el = item.find(ATOM + "link")
        link = link_el.get("href", "") if link_el is not None else ""
        title = _text(item.find(ATOM + "title"))
        if title and link.startswith("http"):
            out.append(dict(t=title, url=link, pub=publisher, ts=_when(item)))
    return out


def _norm_title(t: str) -> str:
    return re.sub(r"[^a-z0-9 ]", "", t.lower()).strip()[:60]


def _window_ok(view: list[dict], pub: str) -> bool:
    """≤ 2 per publisher in any consecutive window of 10 (headline rules §6.10)."""
    window = view[-9:] + [{"pub": pub}]
    return len([x for x in window if x["pub"] == pub]) <= 2


@st.cache_data(ttl=900, show_spinner=False)
def fetch_headlines() -> dict:
    """One cached fetch per feed (≥ 5 publishers across ≥ 4 regions — balance rule)."""
    feeds = net.source("news_rss").get("feeds", {})
    items, ok, failed = [], [], []

    def one(fid, f):
        try:
            return fid, _parse_feed(net.get_bytes(f["url"], timeout=(3, 10)), f["name"])
        except Exception:  # noqa: BLE001 — hide the source quietly (headline rules)
            return fid, []

    with ThreadPoolExecutor(8) as ex:                       # all feeds at once, not one after another
        for fid, rows in ex.map(lambda kv: one(*kv), feeds.items()):
            if rows:
                ok.append(fid)
                items.extend(rows[:8])
            else:
                failed.append(fid)

    # collapse near-identical titles
    kept, keys = [], set()
    for it in sorted(items, key=lambda x: -x["ts"]):
        k = _norm_title(it["t"])
        if k not in keys:
            keys.add(k)
            kept.append(it)

    # recency within each publisher, then round-robin interleave (never by "engagement")
    by_pub: dict[str, list[dict]] = {}
    for it in kept:
        by_pub.setdefault(it["pub"], []).append(it)
    rows, inter = list(by_pub.values()), []
    i = 0
    while any(rows) and len(inter) < 48:
        row = rows[i % len(rows)]
        if row:
            inter.append(row.pop(0))
        i += 1

    view = []
    for it in inter:
        if _window_ok(view, it["pub"]):
            view.append(it)
        if len(view) >= 36:
            break

    return dict(items=view, publishers=ok, failed=failed)


@st.cache_data(ttl=600, show_spinner=False)
def _wiki_news() -> list[dict]:
    """Wikipedia 'In the news' stories (CC BY-SA): plain text + link to the first article."""
    import datetime as _dt
    for back in (0, 1):
        d = net.utcnow() - _dt.timedelta(days=back)
        data = net.get_json("wiki_featured", path={"yyyy": f"{d:%Y}", "mm": f"{d:%m}", "dd": f"{d:%d}"},
                            cache_key=f"wn{back}")
        out = []
        for s in ((data or {}).get("news") or [])[:10]:
            text = re.sub(r"<[^>]+>", "", html.unescape(s.get("story") or "")).strip()
            link = next((((x.get("content_urls") or {}).get("desktop") or {}).get("page")
                         for x in (s.get("links") or [])), None)
            if text and link:
                out.append(dict(t=text[:260], url=link, ts=0))
        if out:
            return out
    raise RuntimeError("no wikipedia news")


def fetch_wiki_news() -> list[dict]:
    try:
        return _wiki_news()
    except Exception:  # noqa: BLE001 — never cache a failure
        return []
