"""intoDNS / LeafDNS-style DNS report for the Network Lab.

Real DNS queries (UDP, TCP fallback) sent from the server with dnspython:
  1. walk the delegation from a root server down to the PARENT of the domain (NS + glue),
  2. ask every authoritative nameserver directly (NS, SOA, CNAME, TCP, recursion),
  3. MX / WWW lookups, and a "what do public resolvers see" cache view.
SSRF guard: only PUBLIC nameserver IPs are ever queried (tools_server.is_public_ip).
The low-level functions (walk_parent, probe, resolve, asn, ptr, resolver_serial) are the only
ones touching the network, so build_report() is testable with fakes.
"""
from __future__ import annotations

import html
import ipaddress
import re
import time
from concurrent.futures import ThreadPoolExecutor

from .tools_server import is_public_ip

ROOT = ("a.root-servers.net", "198.41.0.4")
RESOLVERS = [("Google", "8.8.8.8"), ("Cloudflare", "1.1.1.1"), ("OpenDNS", "208.67.222.222"), ("Quad9", "9.9.9.9")]
HOST_RE = re.compile(r"^(?=.{1,253}$)([a-z0-9_]([a-z0-9_-]{0,61}[a-z0-9_])?\.)+[a-z0-9-]{2,63}$")


class ReportError(ValueError):
    pass


def clean_domain(raw: str) -> str:
    d = re.sub(r"^[a-z]+://", "", (raw or "").strip().lower())
    d = d.split("/")[0].split("?")[0].split(":")[0].rstrip(".")
    try:
        d = d.encode("idna").decode("ascii")
    except UnicodeError:
        raise ReportError("That domain name has characters DNS cannot use.")
    try:
        ipaddress.ip_address(d)
        raise ReportError("Enter a domain name (like example.com), not an IP address.")
    except ValueError as e:
        if isinstance(e, ReportError):
            raise
    if not HOST_RE.match(d):
        raise ReportError("That does not look like a valid domain name.")
    return d


# ------------------------------------------------------------------ network layer
def _query(ip, name, rtype, rd=False, timeout=3.0, tcp=False):
    import dns.flags
    import dns.message
    import dns.query
    try:
        m = dns.message.make_query(name, rtype, use_edns=0, payload=1232, flags=dns.flags.RD if rd else 0)
        if tcp:
            return dns.query.tcp(m, ip, timeout=timeout)
        r = dns.query.udp(m, ip, timeout=timeout)
        return dns.query.tcp(m, ip, timeout=timeout) if r.flags & dns.flags.TC else r
    except Exception:  # noqa: BLE001 — a dead server is a result, not a crash
        return None


def resolve(name, rtype):
    """Recursive lookup through public resolvers → ([text values], ttl). ([], None) when absent."""
    import dns.resolver
    r = dns.resolver.Resolver(configure=False)
    r.nameservers = ["1.1.1.1", "8.8.8.8"]
    r.lifetime = 5
    try:
        ans = r.resolve(name, rtype)
        return [x.to_text() for x in ans], ans.rrset.ttl
    except Exception:  # noqa: BLE001
        return [], None


def walk_parent(domain):
    """Follow referrals from the root to the servers that hold the delegation for `domain`."""
    import dns.name
    import dns.rdatatype as rt
    target = dns.name.from_text(domain)
    sname, sip = ROOT
    for _ in range(8):
        r = _query(sip, domain, "NS")
        if r is None:
            return None
        sets = [x for x in r.answer if x.rdtype == rt.NS and x.name == target] or \
               [x for x in r.authority if x.rdtype == rt.NS]
        if not sets:
            return None
        rr = sets[0]
        names = sorted(str(x.target).rstrip(".").lower() for x in rr)
        glue: dict[str, list[str]] = {}
        for x in r.additional:
            if x.rdtype == rt.A:
                glue.setdefault(str(x.name).rstrip(".").lower(), []).extend(i.to_text() for i in x)
        if rr.name == target:
            return dict(server=sname, ns=names, glue=glue, ttl=rr.ttl)
        nxt = next((n for n in names if glue.get(n)), None)
        if nxt:
            sname, sip = nxt, glue[nxt][0]
            continue
        for n in names:
            ips, _t = resolve(n, "A")
            if ips:
                sname, sip = n, ips[0]
                break
        else:
            return None
    return None


def probe(ip, domain):
    """What one authoritative server says about the zone."""
    import dns.flags
    import dns.rdatatype as rt
    out = dict(ip=ip, ok=False, aa=False, ns=[], ns_ttl=None, glue_hosts=[], soa=None, ra=False, tcp=False, cname=False)
    r = _query(ip, domain, "NS")
    if r is None:
        return out
    out["ok"], out["aa"] = True, bool(r.flags & dns.flags.AA)
    for x in r.answer:
        if x.rdtype == rt.NS:
            out["ns"] = sorted(str(i.target).rstrip(".").lower() for i in x)
            out["ns_ttl"] = x.ttl
    out["glue_hosts"] = sorted({str(x.name).rstrip(".").lower() for x in r.additional if x.rdtype == rt.A})
    s = _query(ip, domain, "SOA")
    for x in (s.answer if s else []):
        if x.rdtype == rt.SOA:
            i = x[0]
            out["soa"] = dict(mname=str(i.mname).rstrip("."), rname=str(i.rname).rstrip("."), serial=i.serial,
                              refresh=i.refresh, retry=i.retry, expire=i.expire, minimum=i.minimum)
    out["tcp"] = _query(ip, domain, "SOA", tcp=True) is not None
    c = _query(ip, domain, "CNAME")
    out["cname"] = bool(c and any(x.rdtype == rt.CNAME for x in c.answer))
    q = _query(ip, "www.google.com", "A", rd=True)
    out["ra"] = bool(q and q.flags & dns.flags.RA and any(x.rdtype == rt.A for x in q.answer))
    return out


def asn(ip):
    """Origin AS number via Team Cymru's DNS service (None if unknown)."""
    vals, _t = resolve(".".join(reversed(ip.split("."))) + ".origin.asn.cymru.com", "TXT")
    return vals[0].strip('"').split("|")[0].strip() if vals else None


def ptr(ip):
    vals, _t = resolve(".".join(reversed(ip.split("."))) + ".in-addr.arpa", "PTR")
    return [v.rstrip(".") for v in vals]


def resolver_serial(rip, domain):
    import dns.rdatatype as rt
    r = _query(rip, domain, "SOA", rd=True)
    for x in (r.answer if r else []):
        if x.rdtype == rt.SOA:
            return x[0].serial
    return None


# ------------------------------------------------------------------ helpers
def human(s):
    if s and s % 604800 == 0:
        n = s // 604800
        return f"{n} week" + ("s" if n > 1 else "")
    if s and s % 86400 == 0:
        n = s // 86400
        return f"{n} day" + ("s" if n > 1 else "")
    if s and s % 3600 == 0:
        n = s // 3600
        return f"{n} hour" + ("s" if n > 1 else "")
    return ""


def _line(host, ips, ttl, tail=""):
    return f"{host}   {ips}{tail}   [TTL={ttl}]"


# ------------------------------------------------------------------ the report
def build_report(raw_domain: str) -> dict:
    t0 = time.time()
    domain = clean_domain(raw_domain)
    rows: list[tuple] = []

    def add(cat, status, name, info):
        rows.append((cat, status, name, info))

    par = walk_parent(domain)
    if not par:
        add("Parent", "Error", "Domain NS records",
            "I could not get the nameserver records from the parent servers. The domain may not be registered, "
            "or its delegation is broken. Check that the nameservers are set at your registrar.")
        return dict(domain=domain, rows=rows, resolvers=[], seconds=round(time.time() - t0, 3))

    pns, glue, srv = par["ns"], par["glue"], par["server"]
    with ThreadPoolExecutor(6) as ex:
        resolved = dict(zip(pns, ex.map(lambda h: resolve(h, "A")[0], pns)))
    ips_of = {h: (glue.get(h) or resolved.get(h) or []) for h in pns}

    # ---- PARENT
    lines = [_line(h + ".", ips_of[h], par["ttl"], "" if glue.get(h) else " (NO GLUE)") for h in pns]
    add("Parent", "Info", "Domain NS records",
        "Nameserver records returned by the parent servers are:\n\n" + "\n".join(lines) +
        f"\n\n{srv} was kind enough to give us that information.")
    tld = domain.rsplit(".", 1)[-1]
    add("Parent", "Pass", "TLD Parent Check",
        f"Good. {srv}, the parent server I interrogated, has information for your TLD (.{tld}).")
    add("Parent", "Pass" if pns else "Error", "Your nameservers are listed",
        f"Good. The parent server {srv} has your nameservers listed. This is a must if you want to be found, as "
        "anyone who does not know your DNS servers will first ask the parent nameservers." if pns else
        "ERROR: the parent server does not list any nameservers for your domain.")
    noglue = [h for h in pns if not glue.get(h)]
    add("Parent", "Pass" if not noglue else "Info", "DNS Parent sent Glue",
        f"Good. The parent server {srv} sent GLUE (the A records) for every nameserver." if not noglue else
        f"The parent nameserver {srv} is not sending GLUE for every nameserver listed, meaning it hands out your "
        "nameserver host names without their A records. It is OK, but it needs an extra A lookup that can delay "
        "connections a little. This happens a lot when nameservers are on a different TLD than the domain.")
    missing_a = [h for h in pns if not ips_of[h]]
    add("Parent", "Pass" if not missing_a else "Error", "Nameservers A records",
        "Good. Every nameserver listed has A records. This is a must if you want to be found." if not missing_a else
        "ERROR: these nameservers have no A record, so nobody can reach them: " + ", ".join(missing_a))

    # ---- probe every public nameserver IP
    targets = [(h, ip) for h in pns for ip in ips_of[h] if is_public_ip(ip)][:16]
    private = [(h, ip) for h in pns for ip in ips_of[h] if not is_public_ip(ip)]
    with ThreadPoolExecutor(8) as ex:
        probes = list(ex.map(lambda t: probe(t[1], domain), targets))
        asns = list(ex.map(lambda t: asn(t[1]), targets))
    good = [p for p in probes if p["ok"]]
    by_host: dict[str, list] = {}
    for (h, _ip), p in zip(targets, probes):
        by_host.setdefault(h, []).append(p)

    # ---- NS
    if good:
        nsl = []
        for h in pns:
            hp = next((p for p in by_host.get(h, []) if p["ok"] and p["ns"]), None)
            nsl.append(_line(h, ips_of[h], (hp or good[0])["ns_ttl"] or "?"))
        add("NS", "Info", "NS records from your nameservers",
            "NS records got from your nameservers listed at the parent NS are:\n\n" + "\n".join(nsl))
    else:
        add("NS", "Error", "NS records from your nameservers", "ERROR: none of your nameservers answered my queries.")
    open_rec = [p["ip"] for p in good if p["ra"]]
    add("NS", "Pass" if not open_rec else "Warn", "Recursive Queries",
        "Good. Your nameservers (the ones reported by the parent server) do not report that they allow recursive "
        "queries for anyone." if not open_rec else
        "WARNING: these nameservers answer recursive queries for anyone: " + ", ".join(open_rec) +
        ". This is a security risk (cache poisoning and DDoS amplification). Disable recursion for outside clients.")
    ns_sets = {tuple(p["ns"]) for p in good if p["ns"]}
    reported = sorted(set().union(*[set(s) for s in ns_sets])) if ns_sets else []
    mismatch_glue = [h for h in pns if glue.get(h) and resolved.get(h) and set(glue[h]) != set(resolved[h])]
    add("NS", "Pass" if not mismatch_glue else "Warn", "Same Glue",
        "The A records (the GLUE) got from the parent zone check are the same as the ones got from your nameservers. "
        "Make sure your parent has the same NS records as you do." if not mismatch_glue else
        "WARNING: the GLUE at the parent differs from the A records of: " + ", ".join(mismatch_glue))
    ns_noglue = sorted({h for p in good for h in pns if h not in p["glue_hosts"]}) if good else []
    if ns_noglue and good:
        ips = [ip for h in ns_noglue for ip in ips_of[h]]
        add("NS", "Info", "Glue for NS records",
            "INFO: GLUE was not sent when I asked your nameservers for your NS records. This is OK, but an extra A "
            "lookup is needed to get the IPs of your NS records. The nameservers without glue are:\n" + "\n".join(ips))
    add("NS", "Pass" if len(ns_sets) <= 1 else "Error", "Mismatched NS records",
        "OK. The NS records at all your nameservers are identical." if len(ns_sets) <= 1 else
        "ERROR: your nameservers return different NS records. Make them identical.")
    silent = [f"{h} ({ip})" for (h, ip), p in zip(targets, probes) if not p["ok"]]
    add("NS", "Pass" if not silent and targets else "Error", "DNS servers responded",
        "Good. All nameservers listed at the parent server responded." if not silent and targets else
        "ERROR: these nameservers did not respond: " + ", ".join(silent or pns))
    badnames = [h for h in pns if not HOST_RE.match(h)]
    add("NS", "Pass" if not badnames else "Error", "Name of nameservers are valid",
        "OK. All of the NS records that your nameservers report seem valid." if not badnames else
        "ERROR: invalid nameserver names: " + ", ".join(badnames))
    n = len(pns)
    add("NS", "Pass" if n >= 2 else "Error", "Multiple Nameservers",
        "Good. You have multiple nameservers. According to RFC2182 section 5 you must have at least 3 nameservers, "
        "and no more than 7. Having 2 nameservers is also OK by me." if n >= 2 else
        "ERROR: you have only one nameserver. RFC2182 asks for at least 2 (ideally 3).")
    lame = [p["ip"] for p in good if not p["aa"]]
    add("NS", "Pass" if not lame else "Error", "Nameservers are lame",
        "OK. All the nameservers listed at the parent servers answer authoritatively for your domain." if not lame else
        "ERROR: these nameservers do not answer authoritatively (lame): " + ", ".join(lame))
    extra = sorted(set(reported) - set(pns))
    absent = sorted(set(pns) - set(reported)) if reported else []
    add("NS", "Pass" if not extra else "Warn", "Missing nameservers reported by parent",
        "OK. All NS records are the same at the parent and at your nameservers." if not extra else
        "WARNING: your nameservers list these but the parent does not: " + ", ".join(extra))
    add("NS", "Pass" if not absent else "Warn", "Missing nameservers reported by your nameservers",
        f"OK. All nameservers returned by the parent server {srv} are the same as the ones reported by your "
        "nameservers." if not absent else "WARNING: the parent lists these but your nameservers do not: " + ", ".join(absent))
    apex_cname = [p["ip"] for p in good if p["cname"]]
    add("NS", "Pass" if not apex_cname else "Error", "Domain CNAMEs",
        "OK. RFC1912 2.4 and RFC2181 10.3 state that there should be no CNAMEs if an NS (or any other) record is "
        "present." if not apex_cname else "ERROR: your domain apex is a CNAME, which cannot coexist with NS/SOA records.")
    with ThreadPoolExecutor(6) as ex:
        ns_cn = [h for h, v in zip(pns, ex.map(lambda h: resolve(h, "CNAME")[0], pns)) if v]
    add("NS", "Pass" if not ns_cn else "Error", "NSs CNAME check",
        "OK. RFC1912 2.4 and RFC2181 10.3 state that there should be no CNAMEs if an NS (or any other) record is "
        "present." if not ns_cn else "ERROR: these nameserver names are CNAMEs (not allowed): " + ", ".join(ns_cn))
    all_ips = [ip for _h, ip in targets]
    nets = {ip.rsplit(".", 1)[0] for ip in all_ips}
    add("NS", "Pass" if len(nets) >= 2 else "Warn", "Different subnets",
        "OK. Looks like you have nameservers on different subnets!" if len(nets) >= 2 else
        "WARNING: all your nameservers are in the same /24 subnet. One network outage would take them all down.")
    add("NS", "Pass" if not private else "Warn", "IPs of nameservers are public",
        "OK. Looks like the IP addresses of your nameservers are public. This is a good thing because it will "
        "prevent DNS delays and other problems." if not private else
        "WARNING: these nameserver IPs are private/reserved and were NOT queried: " +
        ", ".join(f"{h} ({ip})" for h, ip in private))
    notcp = [p["ip"] for p in good if not p["tcp"]]
    add("NS", "Pass" if not notcp else "Warn", "DNS servers allow TCP connection",
        "OK. Seems all your DNS servers allow TCP connections. This is a good thing and useful even if UDP "
        "connections are used by default." if not notcp else
        "WARNING: these servers refused TCP on port 53: " + ", ".join(notcp))
    known = {a for a in asns if a}
    add("NS", "Pass" if len(known) >= 2 else ("Warn" if known else "Info"), "Different autonomous systems",
        "OK. It seems you are safe from a single point of failure. Try to have nameservers in different locations "
        "so one outage cannot take them all down." if len(known) >= 2 else
        ("WARNING: all nameservers are in the same autonomous system (AS" + next(iter(known)) + ")." if known else
         "INFO: I could not determine the autonomous systems."))
    add("NS", "Pass" if len(ns_sets) <= 1 and not extra else "Warn", "Stealth NS records sent",
        "Ok. No stealth ns records are sent" if len(ns_sets) <= 1 and not extra else
        "WARNING: your nameservers send NS records that the parent does not list (stealth NS).")

    # ---- SOA
    soas = [p["soa"] for p in good if p["soa"]]
    auth_serial = None
    if soas:
        s = soas[0]
        auth_serial = s["serial"]
        add("SOA", "Info", "SOA record",
            f"The SOA record is:\nPrimary nameserver: {s['mname']}\nHostmaster E-mail address: {s['rname']}\n"
            f"Serial #: {s['serial']}\nRefresh: {s['refresh']}\nRetry: {s['retry']}\n"
            f"Expire: {s['expire']}   {human(s['expire'])}\nDefault TTL: {s['minimum']}")
        serials = {x["serial"] for x in soas}
        add("SOA", "Pass" if len(serials) == 1 else "Error", "NSs have same SOA serial",
            f"OK. All your nameservers agree that your SOA serial number is {s['serial']}." if len(serials) == 1 else
            "ERROR: your nameservers disagree on the SOA serial (" + ", ".join(map(str, sorted(serials))) +
            "). Zone transfers or syncing are failing.")
        add("SOA", "Pass" if s["mname"].lower() in pns else "Warn", "SOA MNAME entry",
            f"OK. {s['mname']} That server is listed at the parent servers." if s["mname"].lower() in pns else
            f"WARNING: the primary nameserver in your SOA ({s['mname']}) is not listed at the parent.")
        ser = str(s["serial"])
        add("SOA", "Pass" if re.match(r"^(19|20)\d{6}\d{2}$", ser) else "Warn", "SOA Serial",
            f"Your SOA serial number is: {ser}. " + ("It follows the recommended YYYYMMDDnn format."
                                                    if re.match(r"^(19|20)\d{6}\d{2}$", ser) else
                                                    "This can be OK if you know what you are doing."))
        add("SOA", "Pass" if 1200 <= s["refresh"] <= 43200 else "Warn", "SOA REFRESH",
            f"{'OK. ' if 1200 <= s['refresh'] <= 43200 else 'WARNING: '}Your SOA REFRESH interval is: {s['refresh']}. "
            + ("That is OK" if 1200 <= s["refresh"] <= 43200 else "RIPE recommends 1200 to 43200."))
        add("SOA", "Pass" if 120 <= s["retry"] <= 7200 else "Warn", "SOA RETRY",
            f"Your SOA RETRY value is: {s['retry']}. " + ("Looks ok" if 120 <= s["retry"] <= 7200 else "RIPE recommends 120 to 7200."))
        add("SOA", "Pass" if 1209600 <= s["expire"] <= 3628800 else "Warn", "SOA EXPIRE",
            f"Your SOA EXPIRE number is: {s['expire']}. " +
            ("Looks ok" if 1209600 <= s["expire"] <= 3628800 else "RIPE recommends 1209600 to 3628800."))
        m = s["minimum"]
        add("SOA", "Pass" if 300 <= m <= 86400 else "Warn", "SOA MINIMUM TTL",
            f"Your SOA MINIMUM TTL is: {m}. This value is the default TTL for records without one and is used for "
            "negative caching (how long a resolver may cache a 'does not exist' answer). RFC2308 recommends 1-3 hours. " +
            ("Your value is OK." if 300 <= m <= 86400 else "Your value is outside the usual range."))
    else:
        add("SOA", "Error", "SOA record", "ERROR: I could not get the SOA record from any of your nameservers.")

    # ---- MX
    mx_raw, mx_ttl = resolve(domain, "MX")
    mxs = sorted(((int(a), b.rstrip(".").lower()) for a, b in (x.split(None, 1) for x in mx_raw)))
    if not mxs:
        add("MX", "Error", "MX Records",
            "Oh well, I did not detect any MX records so you probably don't have any and if you know you should "
            "have then they may be missing at your nameservers!")
    else:
        with ThreadPoolExecutor(6) as ex:
            mxips = dict(zip([h for _p, h in mxs], ex.map(lambda h: resolve(h[1], "A")[0], mxs)))
            mxcn = dict(zip([h for _p, h in mxs], ex.map(lambda h: bool(resolve(h[1], "CNAME")[0]), mxs)))
        add("MX", "Info", "MX Records", "Your MX records that were reported by your nameservers are:\n\n" +
            "\n".join(f"{p}   {h}.   {mxips[h]}   [TTL={mx_ttl}]" for p, h in mxs))
        add("MX", "Pass" if len(mxs) >= 2 else "Warn", "Different MX records",
            "Good. You have multiple MX records." if len(mxs) >= 2 else
            "WARNING: you have only one MX record. A second one gives you a fallback if it is down.")
        bad = [h for _p, h in mxs if not HOST_RE.match(h)]
        add("MX", "Pass" if not bad else "Error", "MX name validity",
            "OK. I did not detect any invalid hostnames for your MX records." if not bad else "ERROR: invalid MX names: " + ", ".join(bad))
        priv = [ip for _p, h in mxs for ip in mxips[h] if not is_public_ip(ip)]
        add("MX", "Pass" if not priv else "Warn", "MX IPs are public",
            "OK. All of your MX records appear to use public IPs." if not priv else "WARNING: private MX IPs: " + ", ".join(priv))
        cn = [h for _p, h in mxs if mxcn[h]]
        add("MX", "Pass" if not cn else "Error", "MX CNAME Check",
            "OK. No problems here: none of your MX records point to a CNAME (RFC2181 10.3)." if not cn else
            "ERROR: these MX hosts are CNAMEs (not allowed): " + ", ".join(cn))
        noa = [h for _p, h in mxs if not mxips[h]]
        add("MX", "Pass" if not noa else "Error", "MX A request",
            "OK. Every MX record returns an A record." if not noa else "ERROR: no A record for MX: " + ", ".join(noa))
        with ThreadPoolExecutor(6) as ex:
            flat = [(h, ip) for _p, h in mxs for ip in mxips[h]]
            ptrs = list(ex.map(lambda t: ptr(t[1]), flat))
        nop = [f"{ip} ({h})" for (h, ip), v in zip(flat, ptrs) if not v]
        add("MX", "Pass" if not nop else "Warn", "Reverse MX A records (PTR)",
            "OK. All your mail server IPs have reverse DNS (PTR) entries." if not nop else
            "WARNING: no reverse DNS (PTR) for: " + ", ".join(nop) + ". Many mail servers reject mail without it.")

    # ---- WWW
    www, www_ttl = resolve("www." + domain, "A")
    wcn, _t = resolve("www." + domain, "CNAME")
    if www:
        add("WWW", "Pass", "WWW A Record", f"Your www.{domain} A records are:\n\n" + f"www.{domain}.   {www}   [TTL={www_ttl}]" +
            (f"\n(www is a CNAME to {wcn[0]})" if wcn else ""))
        wp = [ip for ip in www if not is_public_ip(ip)]
        add("WWW", "Pass" if not wp else "Warn", "IPs are public",
            "OK. All of your WWW IPs appear to be public IPs." if not wp else "WARNING: private WWW IPs: " + ", ".join(wp))
    else:
        add("WWW", "Error", "WWW A Record",
            f"ERROR: I could not get any A records for www.{domain}!\n\n(I only do a cache request, if you recently "
            "added a WWW A record, it might not show up here.)")

    # ---- public resolver cache view
    resolvers = []
    with ThreadPoolExecutor(4) as ex:
        sers = list(ex.map(lambda r: resolver_serial(r[1], domain), RESOLVERS))
    for (nm, ip), sv in zip(RESOLVERS, sers):
        st = "No answer" if sv is None else ("In sync" if auth_serial in (None, sv) else "Older copy cached")
        resolvers.append(dict(name=nm, ip=ip, serial=sv, status=st))
    return dict(domain=domain, rows=rows, resolvers=resolvers, auth_serial=auth_serial,
                seconds=round(time.time() - t0, 3))


# ------------------------------------------------------------------ HTML (inline styles only: safe in st.html)
_C = {"Pass": ("#3ddc97", "rgba(61,220,151,.12)"), "Warn": ("#f2c55c", "rgba(242,197,92,.13)"),
      "Error": ("#ef5b4c", "rgba(239,91,76,.14)"), "Info": ("#6aa9ff", "rgba(106,169,255,.12)"),
      "In sync": ("#3ddc97", "rgba(61,220,151,.12)"), "Older copy cached": ("#f2c55c", "rgba(242,197,92,.13)"),
      "No answer": ("#8794ab", "rgba(135,148,171,.12)")}
_TD = "padding:10px 12px;border-top:1px solid rgba(255,255,255,.08);vertical-align:top;"


def _badge(label):
    fg, bg = _C.get(label, _C["Info"])
    return (f'<span style="display:inline-block;min-width:56px;text-align:center;padding:2px 9px;border-radius:5px;'
            f'font:600 12px sans-serif;color:{fg};background:{bg};border:1px solid {fg}55">{html.escape(label)}</span>')


def _text(s):
    return html.escape(str(s)).replace("\n", "<br>")


def render_html(rep: dict) -> str:
    rows = rep["rows"]
    cnt = {k: sum(1 for r in rows if r[1] == k) for k in ("Pass", "Warn", "Error", "Info")}
    out = ['<div style="font:13.5px/1.55 sans-serif;color:#e9eef5">',
           f'<div style="margin:4px 0 14px;font:700 20px sans-serif">DNS report for {html.escape(rep["domain"])}</div>',
           '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px">' +
           "".join(f'{_badge(k)} <span style="margin-right:12px;color:#8794ab">{v}</span>' for k, v in cnt.items()) + "</div>",
           '<table style="width:100%;border-collapse:collapse;background:rgba(255,255,255,.03);border:1px solid '
           'rgba(255,255,255,.08);border-radius:10px"><thead><tr style="text-align:left;color:#8794ab;font-size:12px">'
           '<th style="padding:9px 12px;width:84px">Category</th><th style="padding:9px 12px;width:84px">Status</th>'
           '<th style="padding:9px 12px;width:210px">Test name</th><th style="padding:9px 12px">Information</th></tr></thead><tbody>']
    i = 0
    while i < len(rows):
        j = i
        while j < len(rows) and rows[j][0] == rows[i][0]:
            j += 1
        for k in range(i, j):
            cat, st, name, info = rows[k]
            cell = (f'<td rowspan="{j - i}" style="{_TD}font-weight:700;color:#8ab4ff;background:rgba(138,180,255,.06)">'
                    f'{html.escape(cat)}</td>') if k == i else ""
            out.append(f'<tr>{cell}<td style="{_TD}">{_badge(st)}</td><td style="{_TD}font-weight:600">{html.escape(name)}</td>'
                       f'<td style="{_TD}color:#c9d4e8;font-family:ui-monospace,Menlo,monospace;font-size:12.5px;'
                       f'word-break:break-word">{_text(info)}</td></tr>')
        i = j
    out.append("</tbody></table>")
    if rep.get("resolvers"):
        out.append('<div style="margin:22px 0 8px;font:700 15px sans-serif">What public resolvers see right now</div>'
                   '<table style="width:100%;border-collapse:collapse;background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.08)">')
        for r in rep["resolvers"]:
            out.append(f'<tr><td style="{_TD}font-weight:600">{html.escape(r["name"])}</td>'
                       f'<td style="{_TD}color:#8794ab">{html.escape(r["ip"])}</td>'
                       f'<td style="{_TD}">SOA serial {html.escape(str(r["serial"] if r["serial"] is not None else "—"))}</td>'
                       f'<td style="{_TD}">{_badge(r["status"])}</td></tr>')
        out.append("</table>")
    out.append(f'<div style="margin-top:12px;color:#8794ab;font-size:12px">Processed in {rep["seconds"]} seconds.</div></div>')
    return "".join(out)
