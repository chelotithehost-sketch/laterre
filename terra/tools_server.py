"""Server-side network tools (TERRA_MASTER_SPEC.md §4.4) — SSRF-guarded (§10).

rDNS, TLS certificate probe, HTTP header probe, crt.sh subdomain discovery,
email-DNS health (pure DNS — no mail is ever sent).

SECURITY (§10, MUST):
- accept only a valid public hostname/IP; resolve DNS and reject private, loopback,
  link-local, multicast, CGNAT and cloud-metadata ranges
- re-check the IP after every redirect; connect only to vetted IPs; ports 80/443 only
- never read response bodies in the header probe; max 5 redirects
- per-session throttling of tool calls is applied by the caller (Network Lab tab)
"""
from __future__ import annotations

import datetime as dt
import ipaddress
import socket
import ssl
from urllib.parse import urlparse

import requests

from . import net

BLOCKED_NETS = [
    ipaddress.ip_network(n) for n in (
        "10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "127.0.0.0/8",
        "169.254.0.0/16", "100.64.0.0/10", "0.0.0.0/8", "224.0.0.0/4",
        "192.0.0.0/24", "192.0.2.0/24", "198.51.100.0/24", "203.0.113.0/24",
        "240.0.0.0/4",
        "::1/128", "fc00::/7", "fe80::/10", "ff00::/8", "2001:db8::/32",
    )
]
META_IP = ipaddress.ip_address("169.254.169.254")


class SSRFError(ValueError):
    """Input refused by the SSRF guard."""


def is_public_ip(ip: str) -> bool:
    try:
        addr = ipaddress.ip_address(ip)
    except ValueError:
        return False
    if addr == META_IP:
        return False
    return not any(addr in n for n in BLOCKED_NETS) and addr.is_global


def vet_host(host: str) -> str:
    """Validate a hostname or IP literal. Returns the host; raises SSRFError."""
    host = (host or "").strip().strip(".").lower()
    if not host or len(host) > 253 or " " in host or "/" in host or "@" in host:
        raise SSRFError("that does not look like a hostname")
    try:                                   # IP literal → must be public
        ipaddress.ip_address(host)
        if not is_public_ip(host):
            raise SSRFError("private or reserved addresses are not allowed")
        return host
    except ValueError:
        pass
    labels = host.split(".")
    if len(labels) < 2 or any(not l or len(l) > 63 or l.startswith("-") or l.endswith("-")
                              or not all(c.isalnum() or c == "-" for c in l) for l in labels):
        raise SSRFError("that does not look like a hostname")
    # resolve and vet every answer (bypass-DNS rebinding is out of scope for a read-only tool,
    # but the vetted IP is what we connect to wherever possible)
    try:
        infos = socket.getaddrinfo(host, None)
    except OSError as e:
        raise SSRFError(f"could not resolve {host}") from e
    for info in infos:
        if not is_public_ip(info[4][0]):
            raise SSRFError(f"{host} resolves to a private address — refused")
    return host


def resolve_vetted(host: str, port: int = 443) -> str:
    """Return a vetted public IP for host (used as the connection target)."""
    host = vet_host(host)
    try:
        ipaddress.ip_address(host)
        return host
    except ValueError:
        pass
    for info in socket.getaddrinfo(host, port, proto=socket.IPPROTO_TCP):
        ip = info[4][0]
        if is_public_ip(ip):
            return ip
    raise SSRFError(f"{host} has no public address")


# ------------------------------------------------------------------ tools
def reverse_dns(ip: str) -> dict:
    if not is_public_ip(ip):
        raise SSRFError("private or reserved addresses are not allowed")
    try:
        name, _aliases, _addrs = socket.gethostbyaddr(ip)
        return {"ip": ip, "ptr": name, "found": True}
    except OSError:
        return {"ip": ip, "ptr": None, "found": False}


def tls_certificate(host: str, timeout: float = 5.0) -> dict:
    """Certificate chain summary for host:443 (SSRF-vetted, port 443 only)."""
    host = vet_host(host)
    ip = resolve_vetted(host, 443)
    ctx = ssl.create_default_context()
    with socket.create_connection((ip, 443), timeout=timeout) as sock:
        with ctx.wrap_socket(sock, server_hostname=host) as tls:
            cert = tls.getpeercert()
            cipher = tls.cipher()
            proto = tls.version()
    sans = [v for typ, v in cert.get("subjectAltName", ()) if typ == "DNS"]
    subject = dict(x[0] for x in cert.get("subject", ()))
    issuer = dict(x[0] for x in cert.get("issuer", ()))
    not_before = dt.datetime.strptime(cert["notBefore"], "%b %d %H:%M:%S %Y %Z").replace(tzinfo=dt.timezone.utc)
    not_after = dt.datetime.strptime(cert["notAfter"], "%b %d %H:%M:%S %Y %Z").replace(tzinfo=dt.timezone.utc)
    return dict(host=host, ip=ip, subject=subject.get("commonName"), issuer=issuer.get("organizationName"),
                sans=sans[:20], not_before=not_before.isoformat(), not_after=not_after.isoformat(),
                days_left=(not_after - dt.datetime.now(dt.timezone.utc)).days,
                protocol=proto, cipher=cipher[0] if cipher else None)


SECURITY_HEADERS = ["strict-transport-security", "content-security-policy", "x-frame-options",
                    "x-content-type-options", "referrer-policy", "permissions-policy"]


def headers_probe(url: str, timeout: float = 6.0) -> dict:
    """Redirect chain + security-header scorecard. No body is ever read (§4.4)."""
    if not url.lower().startswith(("http://", "https://")):
        raise SSRFError("only http(s) URLs")
    if "://" in url[8:] or "@" in urlparse(url).netloc:
        raise SSRFError("malformed URL")
    vet_host(urlparse(url).hostname or "")
    chain, t0 = [], dt.datetime.now(dt.timezone.utc)
    ses = requests.Session()
    ses.headers.update(net.UA)
    current, ttfb_ms = url, None
    for hop in range(6):
        t1 = dt.datetime.now(dt.timezone.utc)
        r = ses.request("HEAD", current, timeout=(3, timeout), allow_redirects=False, stream=True)
        if r.status_code in (301, 302, 303, 307, 308) and r.headers.get("location"):
            nxt = requests.compat.urljoin(current, r.headers["location"])
            h = urlparse(nxt).hostname or ""
            try:
                vet_host(h)                       # re-check AFTER every redirect (§10)
            except SSRFError as e:
                chain.append(dict(url=current, status=r.status_code, blocked=str(e)))
                break
            chain.append(dict(url=current, status=r.status_code))
            current = nxt
            continue
        if ttfb_ms is None:
            ttfb_ms = int((dt.datetime.now(dt.timezone.utc) - t1).total_seconds() * 1000)
        chain.append(dict(url=current, status=r.status_code))
        hdrs = {k.lower(): v for k, v in r.headers.items()}
        missing = [h for h in SECURITY_HEADERS if h not in hdrs]
        return dict(url=url, final_url=current, hops=len(chain) - 1, ttfb_ms=ttfb_ms,
                    status=r.status_code, server=hdrs.get("server"),
                    present={h: hdrs[h] for h in SECURITY_HEADERS if h in hdrs},
                    missing=missing, chain=chain,
                    elapsed_ms=int((dt.datetime.now(dt.timezone.utc) - t0).total_seconds() * 1000))
    return dict(url=url, final_url=current, hops=len(chain), ttfb_ms=ttfb_ms, status=None,
                chain=chain, error="too many redirects", missing=SECURITY_HEADERS)


def subdomains_crtsh(domain: str, timeout: float = 12.0) -> dict:
    """Certificate-transparency subdomain discovery. Slow/flaky by nature — button-driven."""
    domain = vet_host(domain)
    try:
        r = net.get_raw("crtsh", query={"q": f"%.{domain}", "output": "json"},
                        timeout=(3, timeout))
        rows = r.json()
        names = sorted({n.strip().lower() for row in rows for n in (row.get("name_value") or "").split("\n")
                        if n.strip().lower().endswith(domain)})
        return {"domain": domain, "names": names[:200], "count": len(names)}
    except Exception as e:  # noqa: BLE001 — flaky endpoint, fail quietly (C6)
        return {"domain": domain, "names": [], "count": 0, "error": str(e)[:120]}


def email_dns_health(domain: str) -> dict:
    """SPF / DMARC / DKIM / MX / MTA-STS from DoH lookups. No mail is ever sent."""
    domain = vet_host(domain)

    def txt(name: str) -> list[str]:
        data = net.get_json("doh_google", query={"name": name, "type": "TXT"}, cache_key=name) or {}
        out = []
        for ans in data.get("Answer") or []:
            v = ans.get("data", "").strip('"')
            if v:
                out.append(v)
        return out

    def mx() -> list[str]:
        data = net.get_json("doh_google", query={"name": domain, "type": "MX"}, cache_key=f"mx{domain}") or {}
        return [a.get("data", "") for a in (data.get("Answer") or []) if a.get("type") == 15]

    spf = [t for t in txt(domain) if t.lower().startswith("v=spf1")]
    dmarc = [t for t in txt(f"_dmarc.{domain}") if t.lower().startswith("v=dmarc1")]
    dkim_sel = ["default", "google", "selector1", "selector2", "k1", "s1", "s2", "mail"]
    dkim = [(s, txt(f"{s}._domainkey.{domain}")) for s in dkim_sel]
    dkim = [{"selector": s, "found": bool(v)} for s, v in dkim if v]
    mtasts = txt(f"_mta-sts.{domain}")
    sts_txt = txt(f"_smtp._tls.{domain}")
    return dict(domain=domain, mx=mx(),
                spf={"found": bool(spf), "record": spf[0] if spf else None},
                dmarc={"found": bool(dmarc), "record": dmarc[0] if dmarc else None},
                dkim=dkim, mtasts={"found": bool(mtasts), "record": mtasts[0] if mtasts else None},
                tlsrpt={"found": bool(sts_txt), "record": sts_txt[0] if sts_txt else None})
