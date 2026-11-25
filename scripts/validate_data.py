#!/usr/bin/env python3
"""Validate every record in data/ (TERRA_MASTER_SPEC.md §4.8).

Fails the build if any record lacks source_url + as_of, or has verified != true.
The UI must never display records that fail here.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

DATA = Path(__file__).resolve().parent.parent / "data"
REQUIRED = ("source_url", "as_of")


def main() -> int:
    bad = 0
    for f in sorted(DATA.glob("*.json")):
        doc = json.loads(f.read_text(encoding="utf-8"))
        records = doc.get("records", [])
        defaults = {"source_url": doc.get("source_url"), "as_of": doc.get("as_of"),
                    "verified": doc.get("verified")}
        if not records:
            print(f"WARN {f.name}: no records")
        for i, r in enumerate(records):
            r = {**defaults, **r}      # doc-level provenance is a valid default
            for k in REQUIRED:
                if not r.get(k):
                    print(f"FAIL {f.name}[{i}]: missing {k}")
                    bad += 1
            if r.get("verified") is not True:
                print(f"FAIL {f.name}[{i}]: verified != true (must not be displayed)")
                bad += 1
        print(f"OK   {f.name}: {len(records)} records")
    print(f"\n{'PASS' if not bad else 'FAIL'}: {bad} problems")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
