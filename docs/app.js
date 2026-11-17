// Veille Cyber — affichage des données générées par scripts/fetch_veille.py

const etat = { data: null, onglet: "certfr", sousFiltre: "tout", filtre: "" };

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

function echapper(t) {
  return String(t ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

function dateFr(iso, avecHeure = false) {
  if (!iso) return "date inconnue";
  const opts = { day: "2-digit", month: "short", year: "numeric" };
  if (avecHeure) Object.assign(opts, { hour: "2-digit", minute: "2-digit" });
  return new Date(iso).toLocaleString("fr-FR", { ...opts, timeZone: "Europe/Paris" });
}

// --------------------------------------------------------------------------
// Étiquette produit / éditeur
// --------------------------------------------------------------------------

// Produits et éditeurs reconnus dans les titres (presse, NVD…).
// L'ordre compte : les noms précis passent avant les noms génériques.
const PRODUITS = [
  ["Active Directory", /active directory/i], ["Exchange", /\bexchange server\b|\bexchange\b/i],
  ["SharePoint", /sharepoint/i], ["Windows", /\bwindows\b/i], ["Kerberos", /kerberos/i],
  ["Microsoft", /microsoft|\bazure\b|\boffice 365\b|\boutlook\b/i],
  ["Chrome", /\bchrome\b/i], ["Android", /\bandroid\b/i], ["Google", /\bgoogle\b/i],
  ["iOS / macOS", /\bios\b|\bmacos\b|\biphone\b/i], ["Apple", /\bapple\b/i],
  ["FortiOS", /fortios|fortigate/i], ["Fortinet", /fortinet|forti\w+/i],
  ["Cisco", /\bcisco\b/i], ["Palo Alto", /palo alto|pan-os/i], ["Ivanti", /ivanti/i],
  ["Citrix", /citrix|netscaler/i], ["VMware", /vmware|esxi|vcenter/i], ["Veeam", /veeam/i],
  ["Juniper", /juniper|junos/i], ["SonicWall", /sonicwall/i], ["Zyxel", /zyxel/i],
  ["Check Point", /check point/i], ["F5", /\bf5\b|big-ip/i],
  ["Noyau Linux", /noyau linux|linux kernel/i], ["Linux", /\blinux\b|ubuntu|debian|red hat|redhat|suse/i],
  ["OpenSSH", /openssh/i], ["OpenSSL", /openssl/i], ["Apache", /\bapache\b|tomcat/i], ["Nginx", /nginx/i],
  ["Oracle", /\boracle\b|\bjava\b/i], ["SAP", /\bsap\b/i], ["Adobe", /adobe|acrobat/i],
  ["WordPress", /wordpress/i], ["Atlassian", /atlassian|confluence|jira/i],
  ["GitLab", /gitlab/i], ["GitHub", /github/i], ["Jenkins", /jenkins/i],
  ["Docker", /docker/i], ["Kubernetes", /kubernetes/i], ["Mozilla", /mozilla|firefox|thunderbird/i],
  ["Synology", /synology/i], ["QNAP", /qnap/i], ["Samsung", /samsung/i], ["Qualcomm", /qualcomm/i],
  ["Intel", /\bintel\b/i], ["AMD", /\bamd\b/i], ["NVIDIA", /nvidia/i],
  ["Dell", /\bdell\b/i], ["HPE", /\bhpe\b|hewlett/i], ["Lenovo", /lenovo/i],
  ["Siemens", /siemens/i], ["Schneider Electric", /schneider/i], ["IBM", /\bibm\b/i],
  ["SolarWinds", /solarwinds/i], ["Zimbra", /zimbra/i], ["Roundcube", /roundcube/i],
  ["MOVEit", /moveit/i], ["Progress", /progress software/i], ["PHP", /\bphp\b/i],
  ["Python", /\bpython\b/i], ["Node.js", /node\.js|\bnpm\b/i], ["Elastic", /elastic/i],
];

function produitConnu(texte) {
  for (const [nom, re] of PRODUITS) if (re.test(texte)) return nom;
  return null;
}

// Titres CERT-FR : « Multiples vulnérabilités dans les produits Microsoft (12 novembre 2026) »
function produitCertfr(titre) {
  const m = titre.match(/\bdans\s+(.+)$/i);
  if (!m) return produitConnu(titre);
  let p = m[1]
    .replace(/\s*\([^)]*\)\s*$/, "")                       // date entre parenthèses
    .replace(/^(les?|la|l['’]|des)\s+/i, "")
    .replace(/^(produits?|solutions?|logiciels?|équipements?)\s+/i, "")
    .trim();
  if (!p) return produitConnu(titre);
  p = p.charAt(0).toUpperCase() + p.slice(1);
  return p.length > 32 ? (produitConnu(p) || p.slice(0, 30) + "…") : p;
}

function produit(x, onglet) {
  if (onglet === "kev") return x.editeur && x.editeur !== "Unknown" ? x.editeur : null;
  if (onglet === "certfr") return produitCertfr(x.titre || "");
  return produitConnu(`${x.titre || ""} ${x.resume || ""}`);
}

const etiquette = (p) => (p ? `<span class="produit" title="${echapper(p)}">${echapper(p)}</span>` : "");

// --------------------------------------------------------------------------
// Chargement
// --------------------------------------------------------------------------

async function charger(jour) {
  const url = jour ? `data/archive/${jour}.json` : "data/veille.json";
  try {
    const rep = await fetch(`${url}?t=${Date.now()}`);
    if (!rep.ok) throw new Error(rep.status);
    etat.data = await rep.json();
  } catch (e) {
    etat.data = null;
  }
  afficher();
}

async function chargerArchives() {
  try {
    const rep = await fetch(`data/archive/index.json?t=${Date.now()}`);
    if (!rep.ok) return;
    const jours = await rep.json();
    const select = $("#jour");
    jours.slice(0, 60).forEach((j) => {
      const o = document.createElement("option");
      o.value = j;
      o.textContent = new Date(j + "T12:00:00").toLocaleDateString("fr-FR", {
        weekday: "short", day: "2-digit", month: "short",
      });
      select.appendChild(o);
    });
  } catch (_) { /* pas encore d'archives */ }
}

// --------------------------------------------------------------------------
// Statistiques cliquables
// --------------------------------------------------------------------------

const TUILES = [
  { cle: "alertes_certfr", lib: "Alertes CERT-FR", cls: "rouge", onglet: "certfr", sous: "alerte" },
  { cle: "avis_certfr", lib: "Avis CERT-FR", cls: "", onglet: "certfr", sous: "avis" },
  { cle: "kev", lib: "Failles exploitées (KEV)", cls: "rouge", onglet: "kev", sous: "tout" },
  { cle: "cve_critiques", lib: "CVE critiques (NVD)", cls: "orange", onglet: "nvd", sous: "tout" },
  { cle: "attaques", lib: "Articles sur des attaques", cls: "orange", onglet: "presse", sous: "attaques" },
];

function afficherStats(s) {
  $("#stats").innerHTML = TUILES.map((t, i) => {
    const actif = etat.onglet === t.onglet && etat.sousFiltre === t.sous;
    return `<button class="stat ${t.cls}${actif ? " actif" : ""}" data-i="${i}"
        title="Afficher : ${echapper(t.lib)}">
      <span class="nombre">${s?.[t.cle] ?? 0}</span>
      <span class="libelle">${t.lib}</span>
    </button>`;
  }).join("");
}

$("#stats").addEventListener("click", (e) => {
  const b = e.target.closest(".stat");
  if (!b) return;
  const t = TUILES[+b.dataset.i];
  changerOnglet(t.onglet, t.sous);
  $("#barre").scrollIntoView({ behavior: "smooth", block: "start" });
});

// --------------------------------------------------------------------------
// Sous-filtres
// --------------------------------------------------------------------------

const SOUS_FILTRES = {
  certfr: [
    ["tout", "Tout", () => true],
    ["alerte", "Alertes", (x) => x.categorie === "alerte"],
    ["avis", "Avis", (x) => x.categorie === "avis"],
    ["actualite", "Actualités", (x) => x.categorie === "actualite"],
  ],
  presse: [
    ["tout", "Tout", () => true],
    ["attaques", "Attaques uniquement", (x) => x.attaque],
  ],
  kev: [
    ["tout", "Tout", () => true],
    ["ransomware", "Utilisées par des ransomwares", (x) => x.ransomware],
  ],
};

function afficherSousFiltres(elements) {
  const defs = SOUS_FILTRES[etat.onglet];
  if (!defs) { $("#sous-filtres").innerHTML = ""; return; }
  $("#sous-filtres").innerHTML = defs.map(([id, lib, f]) => `
    <button class="puce${etat.sousFiltre === id ? " actif" : ""}" data-sous="${id}">
      ${lib}<span class="compte">${elements.filter(f).length}</span>
    </button>`).join("");
}

$("#sous-filtres").addEventListener("click", (e) => {
  const b = e.target.closest(".puce");
  if (!b) return;
  etat.sousFiltre = b.dataset.sous;
  afficher();
});

// --------------------------------------------------------------------------
// Rendu des cartes
// --------------------------------------------------------------------------

function badgesCve(cves = []) {
  return cves.slice(0, 6).map((c) => `<span class="badge">${echapper(c)}</span>`).join("");
}

const lien = (url, texte) => `<a href="${echapper(url)}" target="_blank" rel="noopener">${texte}</a>`;
const date = (iso) => `<time class="date" datetime="${echapper(iso || "")}">${dateFr(iso)}</time>`;

const rendus = {
  certfr: (x) => {
    const cls = x.categorie === "alerte" ? "critique" : x.categorie === "avis" ? "eleve" : "info";
    const badge = x.categorie === "alerte" ? "rouge" : x.categorie === "avis" ? "orange" : "bleu";
    return `<article class="carte ${cls}">
      <div class="meta"><span class="badge ${badge}">${echapper(x.categorie.toUpperCase())}</span>
        ${date(x.date)} ${etiquette(produit(x, "certfr"))} ${badgesCve(x.cves)}</div>
      <h3>${lien(x.lien, echapper(x.titre))}</h3>
      ${x.resume ? `<p>${echapper(x.resume)}</p>` : ""}
      <span class="lire" aria-hidden="true">Lire le bulletin ↗</span>
    </article>`;
  },
  kev: (x) => `<article class="carte critique">
      <div class="meta"><span class="badge rouge">${echapper(x.cve)}</span>
        ${date(x.date)} ${etiquette(produit(x, "kev"))}
        ${x.produit ? `<span>${echapper(x.produit)}</span>` : ""}
        ${x.ransomware ? '<span class="badge orange">ransomware</span>' : ""}</div>
      <h3>${lien(x.lien, echapper(x.titre))}</h3>
      <p>${echapper(x.resume)}</p>
      ${x.action ? `<p><strong>Action :</strong> ${echapper(x.action)}</p>` : ""}
      <span class="lire" aria-hidden="true">Fiche NVD ↗</span>
    </article>`,
  nvd: (x) => `<article class="carte critique">
      <div class="meta"><span class="badge rouge">CVSS ${x.score ?? "?"}</span>
        ${date(x.date)} ${etiquette(produit(x, "nvd"))}</div>
      <h3>${lien(x.lien, `<span class="mono">${echapper(x.cve)}</span>`)}</h3>
      <p>${echapper(x.resume)}</p>
      <span class="lire" aria-hidden="true">Fiche NVD ↗</span>
    </article>`,
  presse: (x) => `<article class="carte ${x.attaque ? "eleve" : "info"}">
      <div class="meta"><span class="badge ${x.attaque ? "orange" : "bleu"}">${echapper(x.source)}</span>
        ${date(x.date)} ${etiquette(produit(x, "presse"))}
        ${x.attaque ? '<span class="badge rouge">attaque</span>' : ""} ${badgesCve(x.cves)}</div>
      <h3>${lien(x.lien, echapper(x.titre))}</h3>
      ${x.resume ? `<p>${echapper(x.resume)}</p>` : ""}
      <span class="lire" aria-hidden="true">Lire l'article ↗</span>
    </article>`,
};

function afficher() {
  const d = etat.data;
  if (!d || !d.genere_le) {
    $("#maj").textContent = "Aucune donnée pour l'instant — lance le workflow GitHub une première fois.";
    afficherStats({});
    $("#sous-filtres").innerHTML = "";
    $("#liste").innerHTML = '<p class="vide">Rien à afficher.</p>';
    return;
  }

  $("#maj").innerHTML = `Mis à jour le <span class="mono">${dateFr(d.genere_le, true)}</span> · ${d.fenetre_jours} derniers jours`;
  afficherStats(d.stats);

  const tous = d[etat.onglet] || [];
  afficherSousFiltres(tous);

  const defs = SOUS_FILTRES[etat.onglet] || [];
  const sous = (defs.find(([id]) => id === etat.sousFiltre) || [null, null, () => true])[2];
  const f = etat.filtre.toLowerCase();
  const elements = tous
    .filter(sous)
    .filter((x) => !f || (JSON.stringify(x) + " " + (produit(x, etat.onglet) || "")).toLowerCase().includes(f));

  $("#liste").innerHTML = elements.length
    ? elements.map(rendus[etat.onglet]).join("")
    : '<p class="vide">Aucun élément sur cette période.</p>';

  $("#erreurs").textContent = d.erreurs?.length ? `Sources indisponibles : ${d.erreurs.join(" · ")}` : "";
}

// --------------------------------------------------------------------------
// Onglets, recherche, raccourcis clavier
// --------------------------------------------------------------------------

function changerOnglet(onglet, sous = "tout") {
  etat.onglet = onglet;
  etat.sousFiltre = sous;
  $$(".onglet").forEach((o) => {
    const actif = o.dataset.onglet === onglet;
    o.classList.toggle("actif", actif);
    o.setAttribute("aria-selected", actif);
  });
  afficher();
}

$$(".onglet").forEach((b) => b.addEventListener("click", () => changerOnglet(b.dataset.onglet)));

$("#recherche").addEventListener("input", (e) => { etat.filtre = e.target.value; afficher(); });
$("#jour").addEventListener("change", (e) => charger(e.target.value));

// « / » ou Ctrl+K (Cmd+K sur Mac) : aller au filtre — Échap : vider et quitter
const estMac = /Mac|iPhone|iPad/.test(navigator.platform);
$("#raccourci").textContent = "/";
$("#raccourci").title = `Raccourci : / ou ${estMac ? "⌘" : "Ctrl"}+K`;

document.addEventListener("keydown", (e) => {
  const champ = $("#recherche");
  const dansUnChamp = ["INPUT", "SELECT", "TEXTAREA"].includes(document.activeElement?.tagName);
  if ((e.key === "k" || e.key === "K") && (e.ctrlKey || e.metaKey)) {
    e.preventDefault(); champ.focus(); champ.select(); return;
  }
  if (e.key === "/" && !dansUnChamp) {
    e.preventDefault(); champ.focus(); return;
  }
  if (e.key === "Escape" && document.activeElement === champ) {
    champ.value = ""; etat.filtre = ""; champ.blur(); afficher();
  }
});

chargerArchives();
charger();
