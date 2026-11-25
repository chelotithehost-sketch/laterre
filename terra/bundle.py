"""bundle.assemble — one self-contained HTML document for the iframe (§3).

Python fetches the heavy data (cached) and embeds it as JSON; web/ assets are
inlined at runtime. All interaction happens in the browser with no Streamlit reruns.
"""
from __future__ import annotations

import json
from pathlib import Path

import yaml

from . import net

ROOT = Path(__file__).resolve().parent.parent
WEB = ROOT / "web"

# concatenated in this order into {{JS}} (no build step, plain ES2022)
JS_FILES = ["js/net.js", "js/i18n.js", "js/util.js", "js/globe.js", "js/layers.js", "js/news.js", "js/ui.js",
            "js/search.js", "js/dossier.js", "js/tools.js", "js/everyday.js", "js/intent.js",
            "js/toolbox.js", "js/compare.js", "js/iss.js"]


def manifest_for_browser() -> dict:
    """sources.yaml → JSON-safe dict (URL templates + budgets + attribution only)."""
    m = net.manifest()
    src = {}
    for sid, s in m.get("sources", {}).items():
        src[sid] = {k: s.get(k) for k in ("name", "url_template", "where", "ttl_seconds",
                                          "budget", "attribution", "licence", "terms_url",
                                          "fallback", "cors_verified", "headers", "feeds")}
    assets = {aid: a.get("url") for aid, a in m.get("assets", {}).items()}
    asset_meta = {aid: {k: a.get(k) for k in ("name", "licence", "terms_url")}
                  for aid, a in m.get("assets", {}).items()}
    return dict(sources=src, assets=assets, assetMeta=asset_meta)


def assemble(payload: dict) -> str:
    template = (WEB / "template.html").read_text(encoding="utf-8")
    css = (WEB / "styles.css").read_text(encoding="utf-8")
    js = "\n".join((WEB / f).read_text(encoding="utf-8") for f in JS_FILES)

    payload = dict(payload)
    payload["manifest"] = manifest_for_browser()
    payload.setdefault("updated", net.utcnow().strftime("%H:%M UTC"))

    data = json.dumps(payload, ensure_ascii=False).replace("</", "<\\/")
    return (template
            .replace("{{CSS}}", css)
            .replace("{{JS}}", js)
            .replace("{{DATA}}", data)
            .replace("{{UPD}}", payload["updated"]))
