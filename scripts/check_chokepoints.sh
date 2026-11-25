#!/usr/bin/env bash
# Choke-point lint (TERRA_MASTER_SPEC.md §14):
#  - the only fetch() call in web/ must live in net.js
#  - the only requests.* calls in terra/ must live in net.py / tools_server.py
set -euo pipefail
cd "$(dirname "$0")/.."
fail=0

out=$(grep -Rn "fetch(" web/ --exclude-dir=__pycache__ | grep -v "js/net.js" || true)
if [ -n "$out" ]; then echo "FAIL: fetch() outside web/js/net.js:"; echo "$out"; fail=1; fi

out=$(grep -Rn "requests\." terra/ --exclude-dir=__pycache__ | grep -v "net.py" | grep -v "tools_server.py" || true)
if [ -n "$out" ]; then echo "FAIL: requests.* outside net.py/tools_server.py:"; echo "$out"; fail=1; fi

out=$(grep -RnE "https?://[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/" web/js/ terra/*.py app.py --exclude-dir=__pycache__ | grep -vE "net\.js|github\.com/terra-open-atlas|w3\.org|example\.com|schema|href=|purl\.org" || true)
if [ -n "$out" ]; then echo "WARN: endpoint-looking URLs outside sources.yaml (check these):"; echo "$out"; fi

[ $fail -eq 0 ] && echo "choke points OK"
exit $fail
