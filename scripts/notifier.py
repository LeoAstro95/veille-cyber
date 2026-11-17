#!/usr/bin/env python3
"""
Envoie le résumé de la veille sur le téléphone (3 fois par jour : 7h, 12h, 18h).

Chaque message met en avant les NOUVEAUTÉS depuis la veille précédente,
pour ne pas recevoir trois fois les mêmes informations.

Variables d'environnement :
  TELEGRAM_TOKEN   : jeton du bot donné par @BotFather          (secret GitHub)
  TELEGRAM_CHAT_ID : identifiant de ta conversation avec le bot (secret GitHub)
  NTFY_TOPIC       : canal ntfy, optionnel                      (secret GitHub)
  NTFY_SERVER      : serveur ntfy (par défaut https://ntfy.sh)
  SITE_URL         : adresse du site                            (variable GitHub)
  CRENEAU          : matin / midi / soir / manuel               (fourni par le workflow)
  PRECEDENT        : chemin de la veille précédente             (fourni par le workflow)

Bibliothèque standard uniquement.
"""

import json
import os
import sys
import urllib.request
from html import escape
from pathlib import Path

DONNEES = Path(__file__).resolve().parent.parent / "docs" / "data" / "veille.json"

TITRES = {
    "matin": "☀️ Veille cyber du matin",
    "midi": "🕛 Veille cyber — point de midi",
    "soir": "🌙 Veille cyber — point du soir",
}
DEPUIS = {
    "matin": "depuis hier soir",
    "midi": "depuis ce matin",
    "soir": "depuis midi",
}


# --------------------------------------------------------------------------
# Outils
# --------------------------------------------------------------------------

def post_json(url: str, corps: dict) -> int:
    req = urllib.request.Request(
        url,
        data=json.dumps(corps).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=20) as rep:
        return rep.status


def lire_json(chemin):
    try:
        d = json.loads(Path(chemin).read_text(encoding="utf-8"))
        return d if d.get("genere_le") else None
    except Exception:
        return None


def cle(section: str, x: dict) -> str:
    """Identifiant unique d'un élément, pour comparer deux veilles."""
    if section in ("kev", "nvd"):
        return f"{section}:{x.get('cve')}"
    return f"{section}:{x.get('lien', '')}|{x.get('titre', '')}"


def nouveautes(d: dict, avant: dict) -> dict:
    """Éléments présents dans d mais absents de la veille précédente."""
    res = {}
    for section in ("certfr", "kev", "nvd", "presse"):
        connus = {cle(section, x) for x in avant.get(section, [])}
        res[section] = [x for x in d.get(section, []) if cle(section, x) not in connus]
    return res


def compter(n: dict) -> dict:
    return {
        "alertes": sum(1 for x in n["certfr"] if x.get("categorie") == "alerte"),
        "avis": sum(1 for x in n["certfr"] if x.get("categorie") == "avis"),
        "kev": len(n["kev"]),
        "cve": len(n["nvd"]),
        "attaques": sum(1 for x in n["presse"] if x.get("attaque")),
    }


def points_cles(n: dict, maxi: int = 5):
    """Les éléments les plus importants, dans l'ordre de priorité."""
    items = []
    for x in n["certfr"]:
        if x.get("categorie") == "alerte":
            items.append(("🚨", x.get("titre", ""), x.get("lien", "")))
    for x in n["kev"]:
        items.append(("💥", f"{x.get('cve', '')} – {x.get('editeur', '')} {x.get('produit', '')}".strip(), x.get("lien", "")))
    for x in n["certfr"]:
        if x.get("categorie") == "avis":
            items.append(("⚠️", x.get("titre", ""), x.get("lien", "")))
    for x in sorted(n["nvd"], key=lambda v: v.get("score") or 0, reverse=True):
        items.append(("🔴", f"{x.get('cve', '')} (CVSS {x.get('score', '?')})", x.get("lien", "")))
    for x in n["presse"]:
        if x.get("attaque"):
            items.append(("📰", x.get("titre", ""), x.get("lien", "")))
    return items[:maxi]


def lignes_compteurs(c: dict):
    lignes = []
    if c["alertes"] or c["avis"]:
        lignes.append(f"🚨 {c['alertes']} alerte(s) CERT-FR · {c['avis']} avis")
    if c["kev"]:
        lignes.append(f"💥 {c['kev']} faille(s) activement exploitée(s)")
    if c["cve"]:
        lignes.append(f"🔴 {c['cve']} CVE critique(s)")
    if c["attaques"]:
        lignes.append(f"📰 {c['attaques']} article(s) sur des attaques")
    return lignes


# --------------------------------------------------------------------------
# Construction du message (commun à Telegram et ntfy)
# --------------------------------------------------------------------------

def construire(d: dict, avant, creneau: str) -> dict:
    s = d.get("stats", {})
    total = {
        "alertes": s.get("alertes_certfr", 0), "avis": s.get("avis_certfr", 0),
        "kev": s.get("kev", 0), "cve": s.get("cve_critiques", 0), "attaques": s.get("attaques", 0),
    }

    if avant:  # on compare avec la veille précédente
        n = nouveautes(d, avant)
        c = compter(n)
        nb = sum(len(v) for v in n.values())
        depuis = DEPUIS.get(creneau, "depuis la dernière veille")
        if nb:
            entete = f"🆕 {nb} nouveauté(s) {depuis}"
            lignes = lignes_compteurs(c)
        else:
            entete = f"✅ Rien de nouveau {depuis}."
            lignes = []
        cles = points_cles(n)
        urgent = bool(c["alertes"] or c["kev"])
    else:      # première veille : pas de comparaison possible
        n = {k: d.get(k, []) for k in ("certfr", "kev", "nvd", "presse")}
        entete = f"Sur les {d.get('fenetre_jours', 3)} derniers jours :"
        lignes = lignes_compteurs(total) or ["Aucun élément."]
        cles = points_cles(n, 3)
        urgent = bool(total["alertes"] or total["kev"])

    resume_total = (f"Sur {d.get('fenetre_jours', 3)} jours : {total['alertes']} alerte(s) · "
                    f"{total['kev']} KEV · {total['cve']} CVE critique(s)")

    return {
        "titre": TITRES.get(creneau, "🛡️ Veille cyber"),
        "entete": entete,
        "lignes": lignes,
        "cles": cles,
        "resume_total": resume_total if avant else "",
        "urgent": urgent,
    }


# --------------------------------------------------------------------------
# Telegram
# --------------------------------------------------------------------------

def envoyer_telegram(m: dict, site: str):
    token = os.environ.get("TELEGRAM_TOKEN", "").strip()
    chat_id = os.environ.get("TELEGRAM_CHAT_ID", "").strip()
    if not (token and chat_id):
        print("Telegram non configuré : ignoré.")
        return

    texte = [f"<b>{escape(m['titre'])}</b>", "", f"<b>{escape(m['entete'])}</b>"]
    texte += [escape(l) for l in m["lignes"]]
    if m["cles"]:
        texte += ["", "<b>À retenir :</b>"]
        for icone, titre, lien in m["cles"]:
            t = escape(titre[:110])
            texte.append(f'{icone} <a href="{escape(lien)}">{t}</a>' if lien else f"{icone} {t}")
    if m["resume_total"]:
        texte += ["", f"<i>{escape(m['resume_total'])}</i>"]

    corps = {
        "chat_id": chat_id,
        "text": "\n".join(texte),
        "parse_mode": "HTML",
        "disable_web_page_preview": True,
        # Son et vibration uniquement s'il y a une nouvelle alerte ou faille exploitée
        "disable_notification": not m["urgent"],
    }
    if site:
        corps["reply_markup"] = {"inline_keyboard": [[{"text": "📊 Ouvrir la veille", "url": site}]]}

    try:
        statut = post_json(f"https://api.telegram.org/bot{token}/sendMessage", corps)
        print(f"Message Telegram envoyé (HTTP {statut}).")
    except Exception as e:
        # On n'affiche jamais le jeton dans les logs
        print(f"⚠ Échec Telegram : {str(e).replace(token, '***')}", file=sys.stderr)


# --------------------------------------------------------------------------
# ntfy (optionnel)
# --------------------------------------------------------------------------

def envoyer_ntfy(m: dict, site: str):
    topic = os.environ.get("NTFY_TOPIC", "").strip()
    if not topic:
        return
    lignes = [m["entete"], *m["lignes"]]
    if m["cles"]:
        lignes += ["", "À retenir :"] + [f"{i} {t[:100]}" for i, t, _ in m["cles"]]
    corps = {
        "topic": topic,
        "title": m["titre"],
        "message": "\n".join(lignes),
        "priority": 4 if m["urgent"] else 2,
        "tags": ["shield"],
    }
    if site:
        corps["click"] = site
        corps["actions"] = [{"action": "view", "label": "Ouvrir la veille", "url": site}]
    serveur = os.environ.get("NTFY_SERVER", "https://ntfy.sh").rstrip("/")
    try:
        print(f"Notification ntfy envoyée (HTTP {post_json(serveur, corps)}).")
    except Exception as e:
        print(f"⚠ Échec ntfy : {e}", file=sys.stderr)


def main():
    d = json.loads(DONNEES.read_text(encoding="utf-8"))
    avant = lire_json(os.environ.get("PRECEDENT", "")) if os.environ.get("PRECEDENT") else None
    creneau = os.environ.get("CRENEAU", "manuel").strip() or "manuel"
    site = os.environ.get("SITE_URL", "").strip()

    m = construire(d, avant, creneau)
    envoyer_telegram(m, site)
    envoyer_ntfy(m, site)
    # Un échec de notification ne fait jamais échouer le workflow : la veille est déjà publiée.


if __name__ == "__main__":
    main()
