"""terra.net — the single server-side HTTP choke point (TERRA_MASTER_SPEC.md §5.2).

EVERY outbound Python request goes through `get_json` / `get_raw`. Rule checked by
scripts/check_chokepoints.sh: `grep -R "requests." terra/` may only hit net.py
and tools_server.py (which needs raw sockets/TLS for probes).

- one requests.Session with an identifying User-Agent (Wikimedia/Nominatim require it)
- per-host semaphore + min-interval throttle (parallel across hosts, serial within)
- timeouts (connect 3 s, read 8 s unless the source needs more), retries with backoff
- TTLs read from sources.yaml
- on failure: return the last good value (flagged stale) rather than nothing
"""
from __future__ import annotations

import datetime as dt
import threading
import time
from pathlib import Path
from typing import Any
from urllib.parse import quote

import requests
import yaml

ROOT = Path(__file__).resolve().parent.parent
MANIFEST = yaml.safe_load((ROOT / "sources.yaml").read_text(encoding="utf-8"))

UA = {"User-Agent": MANIFEST.get("user_agent", "TERRA-OpenAtlas/1.0")}
DEFAULT_TIMEOUT = (3, 8)

_session = requests.Session()
_session.headers.update(UA)

_lock = threading.Lock()
_host_state: dict[str, dict] = {}          # host → {sem, last, min_interval}
_last_good: dict[str, Any] = {}            # cache key → last successful payload
_stale: set[str] = set()                   # source ids currently served stale


class NetError(RuntimeError):
    pass


def manifest() -> dict:
    return MANIFEST


def source(sid: str) -> dict:
    try:
        return MANIFEST["sources"][sid]
    except KeyError as e:  # pragma: no cover — programmer error
        raise NetError(f"unknown source id: {sid}") from e


def asset_url(aid: str) -> str:
    return MANIFEST["assets"][aid]["url"]


def ttl(sid: str, default: int = 3600) -> int:
    return int(MANIFEST["sources"].get(sid, {}).get("ttl_seconds", default))


def url(sid: str, path: dict | None = None, query: dict | None = None) -> str:
    """Build a request URL from the manifest template. No URL exists outside sources.yaml."""
    u = source(sid)["url_template"]
    for k, v in (path or {}).items():
        u = u.replace("{" + k + "}", quote(str(v), safe=""))
    if query:
        q = "&".join(f"{k}={quote(str(v), safe='')}" for k, v in query.items() if v is not None)
        if q:
            u += ("&" if "?" in u else "?") + q
    return u


def _throttle(host: str) -> None:
    with _lock:
        st = _host_state.setdefault(host, {"sem": threading.Semaphore(2), "last": 0.0,
                                           "min_interval": 0.25})
        sem, last, gap = st["sem"], st["last"], st["min_interval"]
    with sem:
        wait = last + gap - time.monotonic()
        if wait > 0:
            time.sleep(wait)
        with _lock:
            st["last"] = time.monotonic()


def get_raw(sid: str, path: dict | None = None, query: dict | None = None,
            timeout: tuple = DEFAULT_TIMEOUT, headers: dict | None = None) -> requests.Response:
    """One throttled GET. Raises NetError on failure (callers use get_json for stale fallback)."""
    u = url(sid, path, query)
    from urllib.parse import urlparse
    _throttle(urlparse(u).netloc)
    last_exc: Exception | None = None
    for attempt in range(3):
        try:
            r = _session.get(u, timeout=timeout, headers=headers or {})
            if r.status_code == 429 or r.status_code >= 500:
                raise NetError(f"http {r.status_code}")
            r.raise_for_status()
            return r
        except Exception as e:  # noqa: BLE001
            last_exc = e
            time.sleep(0.8 * (2 ** attempt))
    raise NetError(f"{sid}: {last_exc}")


def get_bytes(url: str, timeout: tuple = DEFAULT_TIMEOUT) -> bytes:
    """Throttled GET for non-JSON payloads (RSS feeds). Same single choke point."""
    from urllib.parse import urlparse
    _throttle(urlparse(url).netloc)
    last_exc: Exception | None = None
    for attempt in range(3):
        try:
            r = _session.get(url, timeout=timeout)
            if r.status_code == 429 or r.status_code >= 500:
                raise NetError(f"http {r.status_code}")
            r.raise_for_status()
            return r.content
        except Exception as e:  # noqa: BLE001
            last_exc = e
            time.sleep(0.8 * (2 ** attempt))
    raise NetError(f"get_bytes: {last_exc}")


def get_json(sid: str, path: dict | None = None, query: dict | None = None,
             timeout: tuple = DEFAULT_TIMEOUT, cache_key: str = "") -> Any:
    """Cached-value-aware JSON GET: returns live data, else the last good value (stale).

    `cache_key` distinguishes calls to the same source with different params.
    """
    key = f"{sid}|{cache_key or (path and str(path)) or (query and str(query)) or 'default'}"
    try:
        data = get_raw(sid, path, query, timeout).json()
        with _lock:
            _last_good[key] = data
            _stale.discard(sid)
        return data
    except Exception:  # noqa: BLE001 — every layer fails quietly (constraint C6)
        with _lock:
            good = _last_good.get(key)
            if good is not None:
                _stale.add(sid)
            return good


def is_stale(sid: str) -> bool:
    with _lock:
        return sid in _stale


def stale_sources() -> list[str]:
    with _lock:
        return sorted(_stale)


def utcnow() -> dt.datetime:
    return dt.datetime.now(dt.timezone.utc)
