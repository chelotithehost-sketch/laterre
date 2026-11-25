# SECURITY.md

TERRA is a **read-only viewer of public data**. It sends no email, opens no ports, writes no
user data to disk, and has no accounts, cookies or analytics.

## What the network tools do

The 🛰️ Network Lab tools (TLS certificate, HTTP header probe, reverse DNS, email DNS health,
certificate-transparency subdomains) look up **public** information about a domain or IP that
you type in. They cannot scan ports, cannot reach internal networks, and cannot be pointed at
your infrastructure.

## SSRF protections (terra/tools_server.py)

Every server-side lookup passes through a guard that:

- accepts only a valid public hostname or IP literal;
- resolves DNS and **refuses** private, loopback, link-local, multicast, CGNAT, benchmarking,
  and cloud-metadata ranges (`10/8, 172.16/12, 192.168/16, 127/8, 169.254/16, 100.64/10`,
  `::1, fc00::/7, fe80::/10`, `169.254.169.254`, and more);
- re-checks the target **after every redirect** (max 5);
- connects only to ports **80/443** — never arbitrary ports;
- never reads response bodies in the header probe (HEAD only, streamed, bounded);
- limits TLS probes to 5 s and CT queries to 12 s.

## Rate limiting & abuse

- Server tools are throttled per session (10 lookups/min, 60/hour).
- All outbound requests (server and browser) pass through shared rate-limit choke points
  (`terra/net.py`, `web/js/net.js`) with per-host budgets from `sources.yaml`, backoff on
  429/503, and a circuit breaker that marks a failing provider offline instead of hammering it.

## Privacy

- **No query logging.** Searches and lookups are not persisted anywhere.
- The visitor's own IP is looked up only after an explicit click on **My connection**
  (constraint C7), and only via the same public APIs as any other IP lookup.
- Geolocation and voice input (where used) require an explicit tap and are never stored.
- RDAP personal contact fields are redacted by default (organisation/registrar and abuse role only).
- Cached data lives in browser `sessionStorage` (cleared when the tab closes) and server-side
  `st.cache_data` — no database exists.

## Reporting

If you find a way to make these tools reach something they shouldn't, please open an issue in
this repository. The tools are intentionally conservative: when in doubt they refuse.
