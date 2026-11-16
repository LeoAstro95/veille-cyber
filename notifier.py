#!/usr/bin/env python3
"""
Envoie le résumé de la veille du jour sur le téléphone via ntfy (https://ntfy.sh).

Variables d'environnement (à définir dans les secrets GitHub) :
  NTFY_TOPIC  : nom du "canal" ntfy auquel ton téléphone est abonné (obligatoire)
  SITE_URL    : adresse du site, ouverte quand on touche la notification
  NTFY_SERVER : serveur ntfy (par défaut https://ntfy.sh)

Bibliothèque standard uniquement.
"""

import json
import os
import sys
import urllib.request
from pathlib import Path

DONNEES = Path(__file__).resolve().parent.parent / "docs" / "data" / "veille.json"


def construire_message(d: dict) -> dict:
    s = d.get("stats", {})
    alertes = s.get("alertes_certfr", 0)
    kev = s.get("kev", 0)

    lignes = [
        f"🚨 {alertes} alerte(s) CERT-FR · {s.get('avis_certfr', 0)} avis",
        f"💥 {kev} faille(s) activement exploitée(s)",
        f"🔴 {s.get('cve_critiques', 0)} CVE critique(s)",
        f"📰 {s.get('attaques', 0)} article(s) sur des attaques",
    ]

    # Les 3 points les plus importants du jour
    a_retenir = []
    for x in d.get("certfr", []):
        if x.get("categorie") == "alerte":
            a_retenir.append("• " + x["titre"])
    for x in d.get("kev", []):
        a_retenir.append(f"• {x['cve']} – {x.get('editeur', '')} {x.get('produit', '')}".strip())
    if a_retenir:
        lignes.append("")
        lignes.append("À retenir :")
        lignes.extend(t[:110] for t in a_retenir[:3])

    # Priorité plus haute (son + vibration marqués) s'il y a une alerte ou une faille exploitée
    priorite = 4 if (alertes or kev) else 3

    return {
        "title": "Veille cyber du jour",
        "message": "\n".join(lignes),
        "priority": priorite,
        "tags": ["shield"],
    }


def main():
    topic = os.environ.get("NTFY_TOPIC", "").strip()
    if not topic:
        print("NTFY_TOPIC non défini : notification ignorée.")
        return

    serveur = os.environ.get("NTFY_SERVER", "https://ntfy.sh").rstrip("/")
    site = os.environ.get("SITE_URL", "").strip()

    d = json.loads(DONNEES.read_text(encoding="utf-8"))
    corps = construire_message(d)
    corps["topic"] = topic
    if site:
        corps["click"] = site  # ouvre le site quand on touche la notification
        corps["actions"] = [{"action": "view", "label": "Ouvrir la veille", "url": site}]

    req = urllib.request.Request(
        serveur,
        data=json.dumps(corps).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=20) as rep:
            print(f"Notification envoyée (HTTP {rep.status}).")
    except Exception as e:
        # La veille est déjà publiée : un échec de notification ne doit pas faire échouer le workflow
        print(f"⚠ Échec de l'envoi de la notification : {e}", file=sys.stderr)


if __name__ == "__main__":
    main()
