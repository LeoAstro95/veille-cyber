#!/usr/bin/env python3
"""
Veille cyber quotidienne - collecte des vulnérabilités et des attaques.

Sources (gratuites, sans clé API) :
  - CERT-FR (ANSSI) : alertes, avis de sécurité, actualités (flux RSS)
  - CISA KEV : vulnérabilités activement exploitées (JSON)
  - NVD (NIST) : CVE critiques publiées récemment (API 2.0)
  - Presse spécialisée : flux RSS d'actualités cyber (attaques, fuites, ransomwares)

Le script n'utilise que la bibliothèque standard Python : aucune installation requise.
Résultat : docs/data/veille.json (+ une copie datée dans docs/data/archive/).
"""

import json
import re
import sys
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from html import unescape
from pathlib import Path

# --------------------------------------------------------------------------
# Configuration
# --------------------------------------------------------------------------

JOURS = 3            # fenêtre de collecte : les N derniers jours
MAX_PAR_SOURCE = 25  # nombre max d'éléments gardés par flux
TIMEOUT = 30         # secondes

RACINE = Path(__file__).resolve().parent.parent
SORTIE = RACINE / "docs" / "data" / "veille.json"
ARCHIVE = RACINE / "docs" / "data" / "archive"

USER_AGENT = "VeilleCyber-BTS-SIO/1.0 (+https://github.com/)"

FLUX_CERTFR = {
    "alerte": "https://www.cert.ssi.gouv.fr/alerte/feed/",
    "avis": "https://www.cert.ssi.gouv.fr/avis/feed/",
    "actualite": "https://www.cert.ssi.gouv.fr/actualite/feed/",
}

FLUX_PRESSE = {
    "The Hacker News": "https://feeds.feedburner.com/TheHackersNews",
    "BleepingComputer": "https://www.bleepingcomputer.com/feed/",
    "ZATAZ": "https://www.zataz.com/feed/",
    "SecurityWeek": "https://www.securityweek.com/feed/",
}

URL_KEV = "https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json"
URL_NVD = "https://services.nvd.nist.gov/rest/json/cves/2.0"

# Mots-clés qui signalent une attaque (pour classer les articles de presse)
MOTS_ATTAQUE = re.compile(
    r"\b(ransomware|rançongiciel|cyberattaque|cyber-attaque|attack\w*|breach\w*|fuite|leak\w*|"
    r"hack\w*|piratage|piraté\w*|compromis|compromise\w*|ddos|phishing|hameçonnage|malware|"
    r"botnet|apt\d*|espionnage|stolen|volé\w*|extorsion|wiper|backdoor)\b",
    re.IGNORECASE,
)
CVE_RE = re.compile(r"CVE-\d{4}-\d{4,7}", re.IGNORECASE)


# --------------------------------------------------------------------------
# Outils
# --------------------------------------------------------------------------

def telecharger(url: str) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=TIMEOUT) as rep:
        return rep.read()


def nettoyer(texte: str, longueur: int = 300) -> str:
    """Retire le HTML et raccourcit un texte."""
    if not texte:
        return ""
    texte = re.sub(r"<[^>]+>", " ", texte)
    texte = unescape(re.sub(r"\s+", " ", texte)).strip()
    return texte if len(texte) <= longueur else texte[: longueur - 1].rstrip() + "…"


def parse_date(valeur: str):
    """Convertit une date RSS/Atom/ISO en datetime UTC (ou None)."""
    if not valeur:
        return None
    valeur = valeur.strip()
    try:
        d = parsedate_to_datetime(valeur)
    except (TypeError, ValueError):
        try:
            d = datetime.fromisoformat(valeur.replace("Z", "+00:00"))
        except ValueError:
            return None
    if d.tzinfo is None:
        d = d.replace(tzinfo=timezone.utc)
    return d.astimezone(timezone.utc)


def lire_rss(contenu: bytes):
    """Lit un flux RSS 2.0 ou Atom et renvoie une liste de dicts."""
    racine = ET.fromstring(contenu)
    atom = "{http://www.w3.org/2005/Atom}"
    elements = []

    for item in racine.iter("item"):  # RSS 2.0
        elements.append({
            "titre": (item.findtext("title") or "").strip(),
            "lien": (item.findtext("link") or "").strip(),
            "date": parse_date(item.findtext("pubDate") or ""),
            "resume": item.findtext("description") or "",
        })

    for entry in racine.iter(atom + "entry"):  # Atom
        lien = entry.find(atom + "link")
        elements.append({
            "titre": (entry.findtext(atom + "title") or "").strip(),
            "lien": lien.get("href", "") if lien is not None else "",
            "date": parse_date(entry.findtext(atom + "updated")
                               or entry.findtext(atom + "published") or ""),
            "resume": entry.findtext(atom + "summary") or entry.findtext(atom + "content") or "",
        })
    return elements


def iso(d):
    return d.isoformat() if d else None


# --------------------------------------------------------------------------
# Collecteurs
# --------------------------------------------------------------------------

def collecter_certfr(depuis, erreurs):
    resultats = []
    for categorie, url in FLUX_CERTFR.items():
        try:
            for it in lire_rss(telecharger(url))[:MAX_PAR_SOURCE]:
                if it["date"] and it["date"] < depuis:
                    continue
                texte = it["titre"] + " " + it["resume"]
                resultats.append({
                    "source": "CERT-FR",
                    "categorie": categorie,
                    "titre": it["titre"],
                    "lien": it["lien"],
                    "date": iso(it["date"]),
                    "resume": nettoyer(it["resume"]),
                    "cves": sorted(set(c.upper() for c in CVE_RE.findall(texte))),
                })
        except Exception as e:  # une source en panne ne bloque pas les autres
            erreurs.append(f"CERT-FR {categorie} : {e}")
    return resultats


def collecter_kev(depuis, erreurs):
    resultats = []
    try:
        data = json.loads(telecharger(URL_KEV))
        for v in data.get("vulnerabilities", []):
            ajout = parse_date(v.get("dateAdded", "") + "T00:00:00+00:00")
            if not ajout or ajout < depuis:
                continue
            resultats.append({
                "source": "CISA KEV",
                "cve": v.get("cveID"),
                "titre": v.get("vulnerabilityName"),
                "editeur": v.get("vendorProject"),
                "produit": v.get("product"),
                "resume": nettoyer(v.get("shortDescription", "")),
                "action": nettoyer(v.get("requiredAction", ""), 200),
                "date": iso(ajout),
                "ransomware": v.get("knownRansomwareCampaignUse") == "Known",
                "lien": f"https://nvd.nist.gov/vuln/detail/{v.get('cveID')}",
            })
    except Exception as e:
        erreurs.append(f"CISA KEV : {e}")
    return resultats


def collecter_nvd(depuis, maintenant, erreurs):
    resultats = []
    fmt = "%Y-%m-%dT%H:%M:%S.000"
    url = (f"{URL_NVD}?pubStartDate={depuis.strftime(fmt)}"
           f"&pubEndDate={maintenant.strftime(fmt)}"
           f"&cvssV3Severity=CRITICAL&resultsPerPage=100")
    try:
        data = json.loads(telecharger(url))
        for item in data.get("vulnerabilities", []):
            cve = item.get("cve", {})
            desc = next((d["value"] for d in cve.get("descriptions", [])
                         if d.get("lang") == "en"), "")
            score, severite = None, "CRITICAL"
            for cle in ("cvssMetricV31", "cvssMetricV30"):
                metriques = cve.get("metrics", {}).get(cle)
                if metriques:
                    cvss = metriques[0].get("cvssData", {})
                    score = cvss.get("baseScore")
                    severite = cvss.get("baseSeverity", severite)
                    break
            resultats.append({
                "source": "NVD",
                "cve": cve.get("id"),
                "resume": nettoyer(desc),
                "score": score,
                "severite": severite,
                "date": iso(parse_date(cve.get("published", ""))),
                "lien": f"https://nvd.nist.gov/vuln/detail/{cve.get('id')}",
            })
        resultats.sort(key=lambda x: (x["score"] or 0), reverse=True)
    except Exception as e:
        erreurs.append(f"NVD : {e}")
    return resultats


def collecter_presse(depuis, erreurs):
    resultats = []
    for nom, url in FLUX_PRESSE.items():
        try:
            for it in lire_rss(telecharger(url))[:MAX_PAR_SOURCE]:
                if it["date"] and it["date"] < depuis:
                    continue
                texte = it["titre"] + " " + it["resume"]
                resultats.append({
                    "source": nom,
                    "titre": it["titre"],
                    "lien": it["lien"],
                    "date": iso(it["date"]),
                    "resume": nettoyer(it["resume"]),
                    "attaque": bool(MOTS_ATTAQUE.search(texte)),
                    "cves": sorted(set(c.upper() for c in CVE_RE.findall(texte))),
                })
        except Exception as e:
            erreurs.append(f"{nom} : {e}")
    resultats.sort(key=lambda x: x["date"] or "", reverse=True)
    return resultats


# --------------------------------------------------------------------------
# Programme principal
# --------------------------------------------------------------------------

def main():
    maintenant = datetime.now(timezone.utc)
    depuis = maintenant - timedelta(days=JOURS)
    erreurs = []

    certfr = collecter_certfr(depuis, erreurs)
    kev = collecter_kev(depuis, erreurs)
    nvd = collecter_nvd(depuis, maintenant, erreurs)
    presse = collecter_presse(depuis, erreurs)

    certfr.sort(key=lambda x: x["date"] or "", reverse=True)
    kev.sort(key=lambda x: x["date"] or "", reverse=True)

    resultat = {
        "genere_le": iso(maintenant),
        "fenetre_jours": JOURS,
        "stats": {
            "alertes_certfr": sum(1 for x in certfr if x["categorie"] == "alerte"),
            "avis_certfr": sum(1 for x in certfr if x["categorie"] == "avis"),
            "kev": len(kev),
            "cve_critiques": len(nvd),
            "attaques": sum(1 for x in presse if x["attaque"]),
        },
        "certfr": certfr,
        "kev": kev,
        "nvd": nvd,
        "presse": presse,
        "erreurs": erreurs,
    }

    SORTIE.parent.mkdir(parents=True, exist_ok=True)
    ARCHIVE.mkdir(parents=True, exist_ok=True)
    texte = json.dumps(resultat, ensure_ascii=False, indent=2)
    SORTIE.write_text(texte, encoding="utf-8")
    (ARCHIVE / f"{maintenant:%Y-%m-%d}.json").write_text(texte, encoding="utf-8")

    # Index des archives pour pouvoir consulter les jours précédents
    jours = sorted((p.stem for p in ARCHIVE.glob("*.json") if p.stem != "index"), reverse=True)
    (ARCHIVE / "index.json").write_text(json.dumps(jours), encoding="utf-8")

    print(f"Veille générée : {resultat['stats']}")
    for e in erreurs:
        print(f"  ⚠ {e}", file=sys.stderr)

    # Échec seulement si TOUTES les sources sont tombées
    if not (certfr or kev or nvd or presse) and erreurs:
        sys.exit(1)


if __name__ == "__main__":
    main()
