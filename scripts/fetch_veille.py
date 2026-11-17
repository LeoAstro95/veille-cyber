#!/usr/bin/env python3
"""
Veille cyber quotidienne - collecte des vulnérabilités et des attaques.

Sources (gratuites, sans clé API) :
  - CERT-FR (ANSSI) : alertes, avis de sécurité, actualités (flux RSS)
  - CISA KEV : vulnérabilités activement exploitées (JSON)
  - NVD (NIST) : CVE critiques publiées récemment (API 2.0)
  - FIRST EPSS : probabilité qu'une CVE soit exploitée dans les 30 jours (API)
  - Presse spécialisée française et internationale (flux RSS)

Le script calcule aussi une liste de failles PRIORITAIRES : chaque CVE reçoit
un score de 0 à 100 selon son exploitation, sa gravité, sa diffusion
et le nombre de sources qui en parlent.

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

# nom : (adresse du flux, origine)  —  origine : "fr" = France, "int" = international
FLUX_PRESSE = {
    "IT-Connect": ("https://www.it-connect.fr/actualites/actu-securite/feed/", "fr"),
    "Le Monde Informatique": ("https://www.lemondeinformatique.fr/flux-rss/thematique/securite/rss.xml", "fr"),
    "ZATAZ": ("https://www.zataz.com/feed/", "fr"),
    "The Hacker News": ("https://feeds.feedburner.com/TheHackersNews", "int"),
    "BleepingComputer": ("https://www.bleepingcomputer.com/feed/", "int"),
    "SecurityWeek": ("https://www.securityweek.com/feed/", "int"),
    "Krebs on Security": ("https://krebsonsecurity.com/feed/", "int"),
}

URL_KEV = "https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json"
URL_NVD = "https://services.nvd.nist.gov/rest/json/cves/2.0"
URL_EPSS = "https://api.first.org/data/v1/epss"

MAX_PRIORITAIRES = 30  # nombre de failles gardées dans la vue « Prioritaires »

# Produits présents sur un très grand nombre de machines dans le monde :
# une faille qui les touche concerne potentiellement des millions d'utilisateurs.
TRES_REPANDUS = re.compile(
    r"\b(microsoft|windows|exchange|sharepoint|active directory|office|outlook|azure|"
    r"apple|ios|macos|iphone|safari|google|chrome|android|chromium|mozilla|firefox|"
    r"linux|kernel|openssl|openssh|apache|nginx|cisco|fortinet|fortios|fortigate|"
    r"palo alto|pan-os|ivanti|citrix|netscaler|vmware|esxi|oracle|java|"
    r"juniper|sonicwall|f5|big-ip|qualcomm|samsung|intel|amd)\b",
    re.IGNORECASE,
)

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
                    "origine": "fr",
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


def collecter_kev(depuis, erreurs, catalogue=None):
    """Renvoie les failles ajoutées récemment au KEV.
    Si `catalogue` (dict) est fourni, il est rempli avec TOUT le catalogue
    {CVE: utilisée par des ransomwares ?} pour repérer les failles exploitées plus anciennes."""
    resultats = []
    try:
        data = json.loads(telecharger(URL_KEV))
        for v in data.get("vulnerabilities", []):
            if catalogue is not None and v.get("cveID"):
                catalogue[v["cveID"].upper()] = v.get("knownRansomwareCampaignUse") == "Known"
            ajout = parse_date(v.get("dateAdded", "") + "T00:00:00+00:00")
            if not ajout or ajout < depuis:
                continue
            resultats.append({
                "source": "CISA KEV",
                "origine": "int",
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
                "origine": "int",
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
    for nom, (url, origine) in FLUX_PRESSE.items():
        try:
            for it in lire_rss(telecharger(url))[:MAX_PAR_SOURCE]:
                if it["date"] and it["date"] < depuis:
                    continue
                texte = it["titre"] + " " + it["resume"]
                resultats.append({
                    "source": nom,
                    "origine": origine,
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
# Failles prioritaires
# --------------------------------------------------------------------------

LIEN_KEV = "https://www.cisa.gov/known-exploited-vulnerabilities-catalog"


def recuperer_epss(cves, erreurs):
    """Score EPSS (probabilité d'exploitation sous 30 jours) pour une liste de CVE."""
    scores = {}
    cves = [c for c in cves if CVE_RE.fullmatch(c)]
    for i in range(0, len(cves), 100):  # l'API accepte 100 CVE par requête
        lot = ",".join(cves[i:i + 100])
        try:
            data = json.loads(telecharger(f"{URL_EPSS}?cve={lot}"))
            for d in data.get("data", []):
                scores[d["cve"].upper()] = (float(d.get("epss", 0)), float(d.get("percentile", 0)))
        except Exception as e:
            erreurs.append(f"EPSS : {e}")
            break
    return scores


def calculer_priorites(certfr, kev, nvd, presse, catalogue_kev, erreurs):
    """Regroupe les informations par CVE et calcule un score de priorité (0-100)."""
    groupes = {}

    def entree(cle):
        return groupes.setdefault(cle, {
            "cle": cle, "cve": cle if cle.startswith("CVE-") else None, "cves": [],
            "titres": [], "resume": "", "editeur": None, "produit": None,
            "sources": {}, "origines": set(), "dates": [],
            "certfr": None, "kev": False, "ransomware": False, "cvss": None, "medias": set(),
        })

    def ajouter(e, x, nom, lien):
        e["sources"].setdefault(nom, lien)
        e["origines"].add(x.get("origine", "int"))
        if x.get("date"):
            e["dates"].append(x["date"])

    # 1. Failles exploitées ajoutées récemment au catalogue KEV
    for x in kev:
        e = entree(x["cve"].upper())
        e["kev"] = True
        e["ransomware"] = e["ransomware"] or x.get("ransomware", False)
        e["titres"].insert(0, x.get("titre") or "")
        e["resume"] = e["resume"] or x.get("resume", "")
        e["editeur"], e["produit"] = x.get("editeur"), x.get("produit")
        ajouter(e, x, "CISA KEV", LIEN_KEV)

    # 2. CVE critiques de la NVD
    for x in nvd:
        e = entree(x["cve"].upper())
        e["cvss"] = x.get("score")
        e["resume"] = e["resume"] or x.get("resume", "")
        ajouter(e, x, "NVD", x.get("lien"))

    # 3. Bulletins CERT-FR (alertes et avis)
    for x in certfr:
        if x.get("categorie") not in ("alerte", "avis"):
            continue
        cves = x.get("cves", [])
        if x["categorie"] == "alerte" and (not cves or len(cves) > 5):
            cibles = [entree(f"CERTFR:{x['lien']}")]          # une seule entrée pour le bulletin
            cibles[0]["cves"] = cves[:10]
        elif len(cves) <= 5:
            cibles = [entree(c) for c in cves]
        else:                                                   # gros avis : on enrichit seulement
            cibles = [groupes[c] for c in cves if c in groupes]
        for e in cibles:
            if e["certfr"] != "alerte":
                e["certfr"] = x["categorie"]
            e["titres"].insert(0, x.get("titre", ""))   # titre français en priorité
            e["resume"] = x.get("resume") or e["resume"]   # résumé français en priorité
            ajouter(e, x, "CERT-FR", x.get("lien"))

    # 4. Articles de presse qui citent une CVE
    for x in presse:
        cves = x.get("cves", [])
        cibles = [entree(c) for c in cves] if len(cves) <= 3 else [groupes[c] for c in cves if c in groupes]
        for e in cibles:
            e["medias"].add(x["source"])
            e["titres"].append(x.get("titre", ""))
            ajouter(e, x, x["source"], x.get("lien"))

    # Failles déjà connues comme exploitées (catalogue KEV complet)
    for cle, e in groupes.items():
        for c in [cle, *e["cves"]]:
            if c in catalogue_kev:
                e["kev"] = True
                e["ransomware"] = e["ransomware"] or catalogue_kev[c]

    # Score EPSS
    cves = [c for c in groupes if c.startswith("CVE-")]
    epss = recuperer_epss(cves[:300], erreurs)

    resultats = []
    for cle, e in groupes.items():
        score, raisons = 0, []
        if e["kev"]:
            score += 35
            raisons.append({"code": "kev", "label": "Exploitée activement"})
        if e["ransomware"]:
            score += 10
            raisons.append({"code": "ransomware", "label": "Utilisée par des ransomwares"})
        if e["certfr"] == "alerte":
            score += 25
            raisons.append({"code": "alerte", "label": "Alerte CERT-FR"})
        elif e["certfr"] == "avis":
            score += 8
            raisons.append({"code": "avis", "label": "Avis CERT-FR"})
        if e["cvss"] is not None:
            score += 20 if e["cvss"] >= 9 else 12 if e["cvss"] >= 7 else 5
            raisons.append({"code": "cvss", "label": f"CVSS {e['cvss']}"})
        p_epss, pct = epss.get(cle, (None, None))
        if p_epss is not None:
            score += round(25 * p_epss)
            if p_epss >= 0.05:
                raisons.append({"code": "epss", "label": f"EPSS {round(p_epss * 100)} %"})
        texte = " ".join([*e["titres"], e["resume"], e["editeur"] or "", e["produit"] or ""])
        if TRES_REPANDUS.search(texte):
            score += 10
            raisons.append({"code": "repandu", "label": "Produit très répandu"})
        if e["medias"]:
            score += min(15, 5 * len(e["medias"]))
            n = len(e["medias"])
            raisons.append({"code": "medias", "label": f"Citée par {n} média{'s' if n > 1 else ''}"})

        titre = next((t for t in e["titres"] if t), None) or (e["cve"] or "Faille")
        lien = (e["sources"].get("CERT-FR") or e["sources"].get("NVD")
                or (f"https://nvd.nist.gov/vuln/detail/{e['cve']}" if e["cve"] else None)
                or next(iter(e["sources"].values()), ""))

        resultats.append({
            "cle": cle,
            "cve": e["cve"],
            "cves": e["cves"],
            "titre": titre,
            "resume": nettoyer(e["resume"]),
            "editeur": e["editeur"],
            "produit": e["produit"],
            "score": min(100, score),
            "raisons": raisons,
            "cvss": e["cvss"],
            "epss": round(p_epss, 4) if p_epss is not None else None,
            "epss_percentile": round(pct, 4) if pct is not None else None,
            "sources": [{"nom": n, "lien": l} for n, l in e["sources"].items()],
            "lien": lien,
            "date": max(e["dates"]) if e["dates"] else None,
            "origines": sorted(e["origines"]),
        })

    resultats.sort(key=lambda x: (x["score"], x["date"] or ""), reverse=True)
    return resultats[:MAX_PRIORITAIRES]


# --------------------------------------------------------------------------
# Programme principal
# --------------------------------------------------------------------------

def main():
    maintenant = datetime.now(timezone.utc)
    depuis = maintenant - timedelta(days=JOURS)
    erreurs = []

    certfr = collecter_certfr(depuis, erreurs)
    catalogue_kev = {}
    kev = collecter_kev(depuis, erreurs, catalogue_kev)
    nvd = collecter_nvd(depuis, maintenant, erreurs)
    presse = collecter_presse(depuis, erreurs)

    certfr.sort(key=lambda x: x["date"] or "", reverse=True)
    kev.sort(key=lambda x: x["date"] or "", reverse=True)

    priorites = calculer_priorites(certfr, kev, nvd, presse, catalogue_kev, erreurs)

    resultat = {
        "genere_le": iso(maintenant),
        "fenetre_jours": JOURS,
        "stats": {
            "urgentes": sum(1 for x in priorites if x["score"] >= 70),
            "alertes_certfr": sum(1 for x in certfr if x["categorie"] == "alerte"),
            "avis_certfr": sum(1 for x in certfr if x["categorie"] == "avis"),
            "kev": len(kev),
            "cve_critiques": len(nvd),
            "attaques": sum(1 for x in presse if x["attaque"]),
        },
        "priorites": priorites,
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
