#!/usr/bin/env python3
"""TERRA API health check (TERRA_MASTER_SPEC.md §11).

Reads sources.yaml, requests one sample URL per source (and per RSS feed, and
per CDN asset), and reports status, latency, parse-ability and — for browser
(`where: B`) sources — whether CORS actually allows the iframe origin.

Usage:
    python scripts/check_apis.py            # print table, exit 1 on required failures
    python scripts/check_apis.py --write    # also stamp cors_verified into sources.yaml
    python scripts/check_apis.py --only doh_google,ipwho

Spec rule: run this BEFORE relying on any endpoint. If a source fails here,
apply its listed fallback or drop the feature quietly and note it in README.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import re
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import requests
import yaml

ROOT = Path(__file__).resolve().parent.parent
MANIFEST = ROOT / "sources.yaml"
UA = {"User-Agent": "TERRA-OpenAtlas/1.0 (health-check; +https://github.com/terra-open-atlas/terra)"}
ORIGIN = {"Origin": "https://example.com"}
TOKEN = re.compile(r"\{\{(-?\d+):([^}]+)\}\}")   # {{-2:%Y}} → strftime of (now - 2 days) UTC


def fill_tokens(url: str) -> str:
    now = dt.datetime.now(dt.timezone.utc)

    def sub(m: re.Match) -> str:
        return (now + dt.timedelta(days=int(m.group(1)))).strftime(m.group(2))

    return TOKEN.sub(sub, url)


def check_one(kind: str, sid: str, url: str, where: str, headers: dict) -> dict:
    hdrs = dict(UA)
    hdrs.update(headers or {})
    if where == "B":
        hdrs.update(ORIGIN)
    t0 = time.monotonic()
    out = dict(kind=kind, id=sid, url=url, status=0, ms=0, json_ok=None, cors=False, error="")
    try:
        r = requests.get(url, headers=hdrs, timeout=(4, 12), stream=True, allow_redirects=True)
        out["status"] = r.status_code
        out["ms"] = int((time.monotonic() - t0) * 1000)
        acao = r.headers.get("access-control-allow-origin", "")
        out["cors"] = (where != "B") or acao == "*" or (acao == "https://example.com")
        ctype = r.headers.get("content-type", "")
        cap = 4_000_000
        body = r.raw.read(cap, decode_content=True)   # bounded read, never a full huge download
        trunc = len(body) >= cap
        if "json" in ctype or body[:1] in (b"{", b"["):
            try:
                json.loads(body)
                out["json_ok"] = True
            except Exception:
                out["json_ok"] = None if trunc else False   # truncated download ≠ bad endpoint
        elif "xml" in ctype or body[:5] in (b"<?xml", b"<rss ", b"<RDF "):
            out["json_ok"] = True if body.lstrip()[:5] in (b"<?xml", b"<rss ", b"<RDF ") else False
        elif body[:8].lower() == b"<!doctype" or body[:5].lower() == b"<html":
            out["json_ok"] = None   # HTML page (flag images etc.) — fine
        else:
            out["json_ok"] = None
    except Exception as e:  # noqa: BLE001 — health check reports, never crashes
        out["error"] = f"{type(e).__name__}: {e}"[:80]
        out["ms"] = int((time.monotonic() - t0) * 1000)
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--write", action="store_true", help="stamp cors_verified back into sources.yaml")
    ap.add_argument("--only", default="", help="comma-separated source ids to check")
    args = ap.parse_args()

    man = yaml.safe_load(MANIFEST.read_text(encoding="utf-8"))
    only = {s.strip() for s in args.only.split(",") if s.strip()}
    jobs = []   # (kind, id, url, where, headers, required)

    for sid, s in (man.get("sources") or {}).items():
        if only and sid not in only:
            continue
        if s.get("deprecated") and sid not in only:
            continue          # kept for the Sources panel only — not verified, not used
        jobs.append(("src", sid, fill_tokens(s["sample"]), s.get("where", "S"),
                     s.get("headers") or {}, bool(s.get("required"))))
        for fid, f in (s.get("feeds") or {}).items():
            if only and fid not in only:
                continue
            jobs.append(("feed", f"{sid}.{fid}", f["url"], "S", {}, bool(f.get("required", False))))

    for aid, a in (man.get("assets") or {}).items():
        if only and aid not in only:
            continue
        jobs.append(("asset", aid, a["url"], "S", {}, False))

    results = []
    with ThreadPoolExecutor(8) as ex:
        futs = [ex.submit(check_one, k, i, u, w, h) for (k, i, u, w, h, _r) in jobs]
        for job, fut in zip(jobs, futs):
            r = fut.result()
            r["required"] = job[5]
            results.append(r)

    name_of = {}
    for sid, s in (man.get("sources") or {}).items():
        name_of[sid] = s.get("name", sid)
        for fid, f in (s.get("feeds") or {}).items():
            name_of[f"{sid}.{fid}"] = f.get("name", fid)
    for aid, a in (man.get("assets") or {}).items():
        name_of[aid] = a.get("name", aid)

    w = max((len(r["id"]) for r in results), default=10)
    print(f"{'ID'.ljust(w)}  {'STATUS':>6}  {'ms':>5}  {'CORS':>4}  {'PARSE':>5}  RESULT")
    print("-" * (w + 40))
    bad_required = []
    for r in results:
        ok = r["status"] and r["status"] < 400 and not r["error"]
        if r["json_ok"] is False:
            ok = False
        if r["kind"] == "src" and r["required"] and not ok:
            bad_required.append(r["id"])
        mark = "OK " if ok else ("WARN" if not r["required"] else "FAIL")
        cors = "—" if r["kind"] != "src" else ("yes" if r["cors"] else "NO")
        parse = "—" if r["json_ok"] is None else ("yes" if r["json_ok"] else "NO")
        note = r["error"] or ("" if ok else f"http {r['status']}")
        print(f"{r['id'].ljust(w)}  {str(r['status'] or '—'):>6}  {r['ms']:>5}  {cors:>4}  {parse:>5}  {mark}  {note}")

    if args.write:
        for r in results:
            if r["kind"] != "src":
                continue
            entry = man["sources"][r["id"]]
            entry["cors_verified"] = bool(r["cors"]) if not r["error"] and r["status"] < 400 else False
        MANIFEST.write_text(yaml.safe_dump(man, sort_keys=False, allow_unicode=True), encoding="utf-8")
        print("\ncors_verified stamped into sources.yaml")

    print(f"\n{len(results)} checks · required failures: {bad_required or 'none'}")
    return 1 if bad_required else 0


if __name__ == "__main__":
    sys.exit(main())
