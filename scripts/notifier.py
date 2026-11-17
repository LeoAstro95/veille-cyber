#!/usr/bin/env python3
"""
Envoie le résumé de la veille du jour sur le téléphone.

Canaux disponibles (chacun s'active seulement si ses variables sont définies) :

  Telegram (recommandé)
    TELEGRAM_TOKEN   : jeton du bot donné par @BotFather          (secret GitHub)
    TELEGRAM_CHAT_ID : identifiant de ta conversation avec le bot (secret GitHub)

  ntfy (optionnel)
    NTFY_TOPIC  : nom du canal ntfy                               (secret GitHub)
    NTFY_SERVER : serveur ntfy (par défaut https://ntfy.sh)

  SITE_URL : adresse du site, ouverte depuis la notification      (variable GitHub)

Bibliothèque standard uniquement.
"""

import json
import os
import sys
import urllib.request
from html import escape
from pathlib import Path

DONNEES = Path(__file__).resolve().parent.parent / "docs" / "data" / "veille.json"


def post_json(url: str, corps: dict) -> int:
    req = urllib.request.Request(
        url,
        data=json.dumps(corps).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=20) as rep:
        return rep.status


def points_cles(d: dict, n: int = 3):
    """Les éléments les plus importants : alertes CERT-FR puis failles exploitées."""
    items = []
    for x in d.get("certfr", []):
        if x.get("categorie") == "alerte":
            items.append((x.get("titre", ""), x.get("lien", "")))
    for x in d.get("kev", []):
        texte = f"{x.get('cve', '')} – {x.get('editeur', '')} {x.get('produit', '')}".strip()
        items.append((texte, x.get("lien", "")))
    return items[:n]


def lignes_stats(s: dict):
    return [
        f"🚨 {s.get('alertes_certfr', 0)} alerte(s) CERT-FR · {s.get('avis_certfr', 0)} avis",
        f"💥 {s.get('kev', 0)} faille(s) activement exploitée(s)",
        f"🔴 {s.get('cve_critiques', 0)} CVE critique(s)",
        f"📰 {s.get('attaques', 0)} article(s) sur des attaques",
    ]


# --------------------------------------------------------------------------
# Telegram
# --------------------------------------------------------------------------

def envoyer_telegram(d: dict, site: str):
    token = os.environ.get("TELEGRAM_TOKEN", "").strip()
    chat_id = os.environ.get("TELEGRAM_CHAT_ID", "").strip()
    if not (token and chat_id):
        print("Telegram non configuré : ignoré.")
        return

    s = d.get("stats", {})
    texte = ["🛡️ <b>Veille cyber du jour</b>", ""] + [escape(l) for l in lignes_stats(s)]

    cles = points_cles(d)
    if cles:
        texte += ["", "<b>À retenir :</b>"]
        for titre, lien in cles:
            titre = escape(titre[:120])
            texte.append(f'• <a href="{escape(lien)}">{titre}</a>' if lien else f"• {titre}")

    corps = {
        "chat_id": chat_id,
        "text": "\n".join(texte),
        "parse_mode": "HTML",
        "disable_web_page_preview": True,
        # Notification silencieuse s'il n'y a ni alerte ni faille exploitée
        "disable_notification": not (s.get("alertes_certfr") or s.get("kev")),
    }
    if site:
        corps["reply_markup"] = {
            "inline_keyboard": [[{"text": "📊 Ouvrir la veille", "url": site}]]
        }

    try:
        statut = post_json(f"https://api.telegram.org/bot{token}/sendMessage", corps)
        print(f"Message Telegram envoyé (HTTP {statut}).")
    except Exception as e:
        # On n'affiche jamais le jeton dans les logs
        print(f"⚠ Échec Telegram : {str(e).replace(token, '***')}", file=sys.stderr)


# --------------------------------------------------------------------------
# ntfy (optionnel)
# --------------------------------------------------------------------------

def envoyer_ntfy(d: dict, site: str):
    topic = os.environ.get("NTFY_TOPIC", "").strip()
    if not topic:
        return

    s = d.get("stats", {})
    lignes = lignes_stats(s)
    cles = points_cles(d)
    if cles:
        lignes += ["", "À retenir :"] + [f"• {t[:110]}" for t, _ in cles]

        corps = {
        "topic": topic,
        "title": "Veille cyber du jour",
        "message": "\n".join(lignes),
        "priority": 4 if (s.get("alertes_certfr") or s.get("kev")) else 3,
        "tags": ["shield"],
    }
