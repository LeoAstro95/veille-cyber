// Veille Cyber — affichage des données générées par scripts/fetch_veille.py

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

// --------------------------------------------------------------------------
// Mémoire du navigateur (préférences de l'utilisateur)
// --------------------------------------------------------------------------
const memoire = {
  lire(cle, defaut) {
    try { const v = localStorage.getItem("veille-" + cle); return v ? JSON.parse(v) : defaut; }
    catch (_) { return defaut; }
  },
  ecrire(cle, valeur) {
    try { localStorage.setItem("veille-" + cle, JSON.stringify(valeur)); } catch (_) { /* navigation privée */ }
  },
};

const etat = {
  data: null,
  onglet: "priorites",
  sousFiltre: "tout",
  recherche: "",
  origine: memoire.lire("origine", "tout"),          // tout | fr | int
  technos: new Set(memoire.lire("technos", [])),      // ex. {"windows", "reseau"}
  mesProduits: memoire.lire("mes-produits", []),      // ex. ["Fortinet", "Windows Server"]
  seulMesProduits: memoire.lire("seul-mes-produits", false),
};

function sauvegarder() {
  memoire.ecrire("origine", etat.origine);
  memoire.ecrire("technos", [...etat.technos]);
  memoire.ecrire("mes-produits", etat.mesProduits);
  memoire.ecrire("seul-mes-produits", etat.seulMesProduits);
}

// --------------------------------------------------------------------------
// Outils
// --------------------------------------------------------------------------
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

const pluriel = (n, mot) => `${n} ${mot}${n > 1 ? "s" : ""}`;

// --------------------------------------------------------------------------
// Origine des informations (France / international)
// --------------------------------------------------------------------------
const ORIGINE_SOURCES = {
  "CERT-FR": "fr", "IT-Connect": "fr", "Le Monde Informatique": "fr", "ZATAZ": "fr",
};
const ORIGINES = [
  { id: "tout", label: "Toutes les sources", icone: "🌐" },
  { id: "fr", label: "France", icone: "🇫🇷" },
  { id: "int", label: "International", icone: "🌍" },
];

function origines(x) {
  if (Array.isArray(x.origines)) return x.origines;
  if (x.origine) return [x.origine];
  return [ORIGINE_SOURCES[x.source] || "int"];
}

// --------------------------------------------------------------------------
// Technologies (groupes logiques, pensés pour le SISR)
// --------------------------------------------------------------------------
const TECHNOS = [
  { id: "windows", label: "Windows & Microsoft", icone: "🪟",
    re: /windows|microsoft|active directory|\bexchange\b|sharepoint|kerberos|azure|\boffice\b|outlook|hyper-v|\biis\b|wsus|\.net\b|\bntlm\b|\brdp\b|smb/i },
  { id: "linux", label: "Linux & Unix", icone: "🐧",
    re: /linux|ubuntu|debian|red hat|redhat|rhel|suse|fedora|centos|noyau|kernel|openssh|glibc|\bsudo\b|systemd|freebsd|unix/i },
  { id: "reseau", label: "Réseau & pare-feu", icone: "🛡️",
    re: /cisco|fortinet|forti\w+|palo alto|pan-os|juniper|junos|sonicwall|zyxel|check point|\bf5\b|big-ip|ivanti|pulse secure|citrix|netscaler|\bvpn\b|firewall|pare-feu|routeur|router|switch|mikrotik|pfsense|opnsense|tp-link|d-link|netgear|aruba|ubiquiti|\bise\b/i },
  { id: "web", label: "Web & applications", icone: "🌐",
    re: /chrome|chromium|firefox|mozilla|safari|\bedge\b|navigateur|browser|wordpress|drupal|joomla|apache|nginx|tomcat|\bphp\b|\bjava\b|oracle|\bsap\b|atlassian|confluence|jira|gitlab|github|jenkins|node\.js|\bnpm\b|python|adobe|acrobat|moveit|zimbra|roundcube|\bv8\b|plugin/i },
  { id: "virtu", label: "Virtualisation & cloud", icone: "☁️",
    re: /vmware|esxi|vcenter|vsphere|hyper-v|docker|kubernetes|\baws\b|amazon web|azure|google cloud|\bgcp\b|proxmox|veeam|nutanix|cloud|\bsaas\b|container/i },
  { id: "mobile", label: "Mobile & Apple", icone: "📱",
    re: /android|\bios\b|iphone|ipad|macos|apple|samsung|qualcomm|mobile|smartphone|whatsapp/i },
];

function texteDe(x) {
  return [x.titre, x.resume, x.editeur, x.produit, x.cve, (x.cves || []).join(" "), x.source].filter(Boolean).join(" ");
}

function technosDe(x) {
  const t = texteDe(x);
  return TECHNOS.filter((g) => g.re.test(t)).map((g) => g.id);
}

// --------------------------------------------------------------------------
// Étiquette produit / éditeur
// --------------------------------------------------------------------------
const PRODUITS = [
  ["WSUS", /\bwsus\b/i], ["Active Directory", /active directory/i], ["Exchange", /\bexchange\b/i],
  ["SharePoint", /sharepoint/i], ["Kerberos", /kerberos/i], ["Windows", /\bwindows\b/i],
  ["Microsoft", /microsoft|\bazure\b|\boutlook\b/i],
  ["Chrome", /\bchrome\b|chromium/i], ["Android", /\bandroid\b/i], ["Google", /\bgoogle\b/i],
  ["iOS / macOS", /\bios\b|\bmacos\b|\biphone\b/i], ["Apple", /\bapple\b/i],
  ["FortiOS", /fortios|fortigate/i], ["Fortinet", /fortinet|forti\w+/i],
  ["Cisco ISE", /cisco ise|identity services engine/i], ["Cisco", /\bcisco\b/i],
  ["Palo Alto", /palo alto|pan-os/i], ["Ivanti", /ivanti/i],
  ["Citrix", /citrix|netscaler/i], ["VMware ESXi", /esxi/i], ["VMware", /vmware|vcenter/i], ["Veeam", /veeam/i],
  ["Juniper", /juniper|junos/i], ["SonicWall", /sonicwall/i], ["Zyxel", /zyxel/i],
  ["Check Point", /check point/i], ["F5", /\bf5\b|big-ip/i],
  ["Noyau Linux", /noyau linux|linux kernel/i], ["Linux", /\blinux\b|ubuntu|debian|red hat|redhat|suse/i],
  ["OpenSSH", /openssh/i], ["OpenSSL", /openssl/i], ["Apache", /\bapache\b|tomcat/i], ["Nginx", /nginx/i],
  ["Oracle", /\boracle\b|\bjava\b/i], ["SAP", /\bsap\b/i], ["Adobe", /adobe|acrobat/i],
  ["WordPress", /wordpress/i], ["Atlassian", /atlassian|confluence|jira/i],
  ["GitLab", /gitlab/i], ["Jenkins", /jenkins/i], ["Docker", /docker/i], ["Kubernetes", /kubernetes/i],
  ["Mozilla", /mozilla|firefox|thunderbird/i], ["Synology", /synology/i], ["QNAP", /qnap/i],
  ["Samsung", /samsung/i], ["Qualcomm", /qualcomm/i], ["Intel", /\bintel\b/i], ["NVIDIA", /nvidia/i],
  ["Zimbra", /zimbra/i], ["Roundcube", /roundcube/i], ["MOVEit", /moveit/i], ["SolarWinds", /solarwinds/i],
];

function produitConnu(texte) {
  for (const [nom, re] of PRODUITS) if (re.test(texte)) return nom;
  return null;
}

function produitCertfr(titre) {
  const m = titre.match(/\bdans\s+(.+)$/i);
  if (!m) return produitConnu(titre);
  let p = m[1]
    .replace(/\s*\([^)]*\)\s*$/, "")
    .replace(/^(les?|la|l['’]|des)\s+/i, "")
    .replace(/^(produits?|solutions?|logiciels?|équipements?)\s+/i, "")
    .trim();
  if (!p) return produitConnu(titre);
  p = p.charAt(0).toUpperCase() + p.slice(1);
  return p.length > 32 ? (produitConnu(p) || p.slice(0, 30) + "…") : p;
}

function produit(x, onglet) {
  if (x.editeur && x.editeur !== "Unknown" && (onglet === "kev" || onglet === "priorites")) {
    return produitConnu(`${x.editeur} ${x.produit || ""}`) || x.editeur;
  }
  if (onglet === "certfr") return produitCertfr(x.titre || "");
  return produitConnu(texteDe(x));
}

const etiquette = (p) => (p ? `<span class="produit" title="${echapper(p)}">${echapper(p)}</span>` : "");

// --------------------------------------------------------------------------
// Mes produits
// --------------------------------------------------------------------------
function concerneMesProduits(x) {
  if (!etat.mesProduits.length) return false;
  const t = texteDe(x).toLowerCase();
  return etat.mesProduits.some((p) => t.includes(p.toLowerCase()));
}

function afficherMesProduits() {
  $("#mes-produits").innerHTML = etat.mesProduits.map((p, i) => `
    <span class="puce-produit">${echapper(p)}
      <button type="button" data-i="${i}" aria-label="Retirer ${echapper(p)}">×</button>
    </span>`).join("");
  $("#seul-mes-produits").checked = etat.seulMesProduits;
  $("#seul-mes-produits").disabled = !etat.mesProduits.length;
}

$("#ajout-produit").addEventListener("submit", (e) => {
  e.preventDefault();
  const champ = $("#nouveau-produit");
  const v = champ.value.trim();
  if (v && !etat.mesProduits.some((p) => p.toLowerCase() === v.toLowerCase())) {
    etat.mesProduits.push(v);
    sauvegarder();
  }
  champ.value = "";
  afficherMesProduits();
  afficher();
});

$("#mes-produits").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-i]");
  if (!b) return;
  etat.mesProduits.splice(+b.dataset.i, 1);
  if (!etat.mesProduits.length) etat.seulMesProduits = false;
  sauvegarder();
  afficherMesProduits();
  afficher();
});

$("#seul-mes-produits").addEventListener("change", (e) => {
  etat.seulMesProduits = e.target.checked;
  sauvegarder();
  afficher();
});

// --------------------------------------------------------------------------
// Chargement des données
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
  { cle: "urgentes", lib: "Failles prioritaires", cls: "rouge", onglet: "priorites", sous: "urgentes" },
  { cle: "alertes_certfr", lib: "Alertes CERT-FR", cls: "rouge", onglet: "certfr", sous: "alerte" },
  { cle: "avis_certfr", lib: "Avis CERT-FR", cls: "", onglet: "certfr", sous: "avis" },
  { cle: "kev", lib: "Failles exploitées", cls: "rouge", onglet: "kev", sous: "tout" },
  { cle: "cve_critiques", lib: "CVE critiques", cls: "orange", onglet: "nvd", sous: "tout" },
  { cle: "attaques", lib: "Articles sur des attaques", cls: "orange", onglet: "presse", sous: "attaques" },
];

function afficherStats(s) {
  $("#stats").innerHTML = TUILES.map((t, i) => {
    const actif = etat.onglet === t.onglet && etat.sousFiltre === t.sous;
    return `<button class="stat ${t.cls}${actif ? " actif" : ""}" data-i="${i}" title="Afficher : ${echapper(t.lib)}">
      <span class="nombre">${s?.[t.cle] ?? "–"}</span>
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
// Onglets, sous-filtres et textes d'introduction
// --------------------------------------------------------------------------
const INTROS = {
  priorites: "Les failles classées selon leur impact : exploitation active, gravité (CVSS), probabilité d'exploitation (EPSS), produits très répandus et nombre de sources qui en parlent.",
  certfr: "Les bulletins officiels de l'ANSSI (CERT-FR).",
  kev: "Failles ajoutées récemment au catalogue américain des vulnérabilités activement exploitées (CISA KEV).",
  nvd: "Nouvelles CVE notées critiques (CVSS ≥ 9) dans la base américaine NVD.",
  presse: "Articles des médias spécialisés, français et internationaux.",
};

const SOUS_FILTRES = {
  priorites: [
    ["tout", "Toutes", () => true],
    ["urgentes", "Score ≥ 70", (x) => x.score >= 70],
    ["exploitees", "Exploitées", (x) => (x.raisons || []).some((r) => r.code === "kev")],
  ],
  certfr: [
    ["tout", "Tout", () => true],
    ["alerte", "Alertes", (x) => x.categorie === "alerte"],
    ["avis", "Avis", (x) => x.categorie === "avis"],
    ["actualite", "Actualités", (x) => x.categorie === "actualite"],
  ],
  kev: [
    ["tout", "Tout", () => true],
    ["ransomware", "Utilisées par des ransomwares", (x) => x.ransomware],
  ],
  presse: [
    ["tout", "Tout", () => true],
    ["attaques", "Attaques uniquement", (x) => x.attaque],
  ],
};

function filtreSous() {
  const defs = SOUS_FILTRES[etat.onglet] || [];
  return (defs.find(([id]) => id === etat.sousFiltre) || [null, null, () => true])[2];
}

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

$("#sous-filtres").addEventListener("click", (e) => {
  const b = e.target.closest(".puce");
  if (!b) return;
  etat.sousFiltre = b.dataset.sous;
  afficher();
});

// --------------------------------------------------------------------------
// Filtrage (avec option pour ignorer un filtre, afin de calculer les compteurs)
// --------------------------------------------------------------------------
function filtrer(items, { sansOrigine = false, sansTechno = false, sansSous = false } = {}) {
  const r = etat.recherche.toLowerCase();
  const sous = filtreSous();
  return items.filter((x) => {
    if (!sansSous && !sous(x)) return false;
    if (!sansOrigine && etat.origine !== "tout" && !origines(x).includes(etat.origine)) return false;
    if (!sansTechno && etat.technos.size && !technosDe(x).some((t) => etat.technos.has(t))) return false;
    if (etat.seulMesProduits && !concerneMesProduits(x)) return false;
    if (r && !(JSON.stringify(x) + " " + (produit(x, etat.onglet) || "")).toLowerCase().includes(r)) return false;
    return true;
  });
}

// --------------------------------------------------------------------------
// Barre latérale : compteurs, origine, technologies
// --------------------------------------------------------------------------
function afficherFiltres(tous) {
  const pourOrigine = filtrer(tous, { sansOrigine: true });
  $("#filtre-origine").innerHTML = ORIGINES.map((o) => {
    const n = o.id === "tout" ? pourOrigine.length : pourOrigine.filter((x) => origines(x).includes(o.id)).length;
    return `<label class="option${n ? "" : " vide"}">
      <input type="radio" name="origine" value="${o.id}"${etat.origine === o.id ? " checked" : ""}>
      <span class="icone">${o.icone}</span><span>${o.label}</span><span class="compte">${n}</span>
    </label>`;
  }).join("");

  const pourTechno = filtrer(tous, { sansTechno: true });
  $("#filtre-techno").innerHTML = TECHNOS.map((g) => {
    const n = pourTechno.filter((x) => technosDe(x).includes(g.id)).length;
    return `<label class="option${n ? "" : " vide"}">
      <input type="checkbox" value="${g.id}"${etat.technos.has(g.id) ? " checked" : ""}>
      <span class="icone">${g.icone}</span><span>${g.label}</span><span class="compte">${n}</span>
    </label>`;
  }).join("");

  const nMes = etat.mesProduits.length ? filtrer(tous).filter(concerneMesProduits).length : "";
  $("#compte-mes-produits").textContent = nMes;

  const nb = (etat.origine !== "tout" ? 1 : 0) + etat.technos.size + (etat.seulMesProduits ? 1 : 0);
  $("#nb-filtres").textContent = nb || "";
}

$("#filtre-origine").addEventListener("change", (e) => {
  etat.origine = e.target.value;
  sauvegarder();
  afficher();
});

$("#filtre-techno").addEventListener("change", (e) => {
  if (e.target.checked) etat.technos.add(e.target.value);
  else etat.technos.delete(e.target.value);
  sauvegarder();
  afficher();
});

function reinitialiser() {
  etat.origine = "tout";
  etat.technos.clear();
  etat.seulMesProduits = false;
  etat.recherche = "";
  $("#recherche").value = "";
  sauvegarder();
  afficherMesProduits();
  afficher();
}
$("#reinit").addEventListener("click", reinitialiser);

$("#bouton-filtres").addEventListener("click", () => {
  const ouvert = $("#filtres").classList.toggle("ouvert");
  $("#bouton-filtres").setAttribute("aria-expanded", ouvert);
  if (ouvert) $("#filtres").scrollIntoView({ behavior: "smooth", block: "start" });
});

// Filtres actifs (puces au-dessus de la liste)
function afficherFiltresActifs() {
  const puces = [];
  if (etat.origine !== "tout") {
    const o = ORIGINES.find((v) => v.id === etat.origine);
    puces.push(`<button class="filtre-actif" data-type="origine">${o.icone} ${o.label} <span>×</span></button>`);
  }
  etat.technos.forEach((id) => {
    const g = TECHNOS.find((v) => v.id === id);
    if (g) puces.push(`<button class="filtre-actif" data-type="techno" data-id="${id}">${g.icone} ${g.label} <span>×</span></button>`);
  });
  if (etat.seulMesProduits) puces.push(`<button class="filtre-actif" data-type="mes">⭐ Mes produits <span>×</span></button>`);
  if (etat.recherche) puces.push(`<button class="filtre-actif" data-type="recherche">🔎 « ${echapper(etat.recherche)} » <span>×</span></button>`);
  if (puces.length > 1) puces.push(`<button class="tout-effacer" data-type="tout">Tout effacer</button>`);
  $("#filtres-actifs").innerHTML = puces.join("");
}

$("#filtres-actifs").addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (!b) return;
  const type = b.dataset.type;
  if (type === "origine") etat.origine = "tout";
  if (type === "techno") etat.technos.delete(b.dataset.id);
  if (type === "mes") { etat.seulMesProduits = false; afficherMesProduits(); }
  if (type === "recherche") { etat.recherche = ""; $("#recherche").value = ""; }
  if (type === "tout") return reinitialiser();
  sauvegarder();
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
const etoile = (x) => (concerneMesProduits(x) ? '<span class="etoile" title="Concerne un de mes produits">★</span>' : "");
const drapeau = (x) => (origines(x).includes("fr") && x.source !== "CERT-FR" ? '<span class="drapeau">FR</span>' : "");

const COULEUR_RAISON = {
  kev: "r-rouge", alerte: "r-rouge", ransomware: "r-orange", avis: "r-orange",
  cvss: "r-rouge", epss: "r-orange", repandu: "r-bleu", medias: "r-bleu",
};

const rendus = {
  priorites: (x, i) => {
    const niveau = x.score >= 70 ? "critique" : x.score >= 40 ? "eleve" : "info";
    const sources = (x.sources || []);
    const listeSources = sources.slice(0, 5).map((s) => lien(s.lien, echapper(s.nom))).join(" · ")
      + (sources.length > 5 ? ` · +${sources.length - 5}` : "");
    return `<article class="carte prio ${niveau}">
      <div class="rang">
        <span>#${i + 1}</span>
        <span class="score" style="--score:${x.score}" title="Score de priorité : ${x.score}/100"><span>${x.score}</span></span>
      </div>
      <div class="corps">
        <div class="meta">${etoile(x)}
          ${x.cve ? `<span class="badge rouge">${echapper(x.cve)}</span>` : ""}
          ${etiquette(produit(x, "priorites"))} ${date(x.date)}</div>
        <h3>${lien(x.lien, echapper(x.titre))}</h3>
        <div class="raisons">${(x.raisons || []).map((r) =>
          `<span class="raison ${COULEUR_RAISON[r.code] || ""}">${echapper(r.label)}</span>`).join("")}</div>
        ${x.resume ? `<p>${echapper(x.resume)}</p>` : ""}
        <div class="sources-carte">Sources : ${listeSources}</div>
      </div>
      <span class="lire" aria-hidden="true">Voir le détail ↗</span>
    </article>`;
  },
  certfr: (x) => {
    const cls = x.categorie === "alerte" ? "critique" : x.categorie === "avis" ? "eleve" : "info";
    const badge = x.categorie === "alerte" ? "rouge" : x.categorie === "avis" ? "orange" : "bleu";
    return `<article class="carte ${cls}">
      <div class="meta">${etoile(x)}<span class="badge ${badge}">${echapper(x.categorie.toUpperCase())}</span>
        ${date(x.date)} ${etiquette(produit(x, "certfr"))} ${badgesCve(x.cves)}</div>
      <h3>${lien(x.lien, echapper(x.titre))}</h3>
      ${x.resume ? `<p>${echapper(x.resume)}</p>` : ""}
      <span class="lire" aria-hidden="true">Lire le bulletin ↗</span>
    </article>`;
  },
  kev: (x) => `<article class="carte critique">
      <div class="meta">${etoile(x)}<span class="badge rouge">${echapper(x.cve)}</span>
        ${date(x.date)} ${etiquette(produit(x, "kev"))}
        ${x.produit ? `<span>${echapper(x.produit)}</span>` : ""}
        ${x.ransomware ? '<span class="badge orange">ransomware</span>' : ""}</div>
      <h3>${lien(x.lien, echapper(x.titre))}</h3>
      <p>${echapper(x.resume)}</p>
      ${x.action ? `<p><strong>Action :</strong> ${echapper(x.action)}</p>` : ""}
      <span class="lire" aria-hidden="true">Fiche NVD ↗</span>
    </article>`,
  nvd: (x) => `<article class="carte critique">
      <div class="meta">${etoile(x)}<span class="badge rouge">CVSS ${x.score ?? "?"}</span>
        ${date(x.date)} ${etiquette(produit(x, "nvd"))}</div>
      <h3>${lien(x.lien, `<span class="mono">${echapper(x.cve)}</span>`)}</h3>
      <p>${echapper(x.resume)}</p>
      <span class="lire" aria-hidden="true">Fiche NVD ↗</span>
    </article>`,
  presse: (x) => `<article class="carte ${x.attaque ? "eleve" : "info"}">
      <div class="meta">${etoile(x)}<span class="badge ${x.attaque ? "orange" : "bleu"}">${echapper(x.source)}</span>
        ${drapeau(x)} ${date(x.date)} ${etiquette(produit(x, "presse"))}
        ${x.attaque ? '<span class="badge rouge">attaque</span>' : ""} ${badgesCve(x.cves)}</div>
      <h3>${lien(x.lien, echapper(x.titre))}</h3>
      ${x.resume ? `<p>${echapper(x.resume)}</p>` : ""}
      <span class="lire" aria-hidden="true">Lire l'article ↗</span>
    </article>`,
};

// --------------------------------------------------------------------------
// Affichage général
// --------------------------------------------------------------------------
function afficherSousFiltres(tous) {
  const defs = SOUS_FILTRES[etat.onglet];
  if (!defs) { $("#sous-filtres").innerHTML = ""; return; }
  const base = filtrer(tous, { sansSous: true });
  $("#sous-filtres").innerHTML = defs.map(([id, lib, f]) => `
    <button class="puce${etat.sousFiltre === id ? " actif" : ""}" data-sous="${id}">
      ${lib}<span class="compte">${base.filter(f).length}</span>
    </button>`).join("");
}

function afficher() {
  const d = etat.data;
  $("#intro-onglet").textContent = INTROS[etat.onglet] || "";

  if (!d || !d.genere_le) {
    $("#maj").textContent = "Aucune donnée pour l'instant — lance le workflow GitHub une première fois.";
    afficherStats({});
    afficherFiltres([]);
    $("#sous-filtres").innerHTML = "";
    $("#liste").innerHTML = '<p class="vide">Rien à afficher.</p>';
    return;
  }

  $("#maj").innerHTML = `Mis à jour le <span class="mono">${dateFr(d.genere_le, true)}</span> · ${d.fenetre_jours} derniers jours`;
  afficherStats(d.stats);

  const tous = d[etat.onglet] || [];
  afficherFiltres(tous);
  afficherFiltresActifs();
  afficherSousFiltres(tous);

  if (etat.onglet === "priorites" && !d.priorites) {
    $("#liste").innerHTML = '<p class="vide">La vue « Prioritaires » apparaîtra après la prochaine mise à jour (7h, 12h ou 18h).</p>';
    return;
  }

  const elements = filtrer(tous);
  const rendu = rendus[etat.onglet];
  $("#liste").innerHTML = elements.length
    ? elements.map((x, i) => rendu(x, i)).join("")
    : `<p class="vide">Aucun élément ne correspond${tous.length ? " à ces filtres" : " sur cette période"}.</p>`;

  $("#erreurs").textContent = d.erreurs?.length ? `Sources indisponibles : ${d.erreurs.join(" · ")}` : "";
}

// --------------------------------------------------------------------------
// Recherche et raccourcis clavier
// --------------------------------------------------------------------------
$("#recherche").addEventListener("input", (e) => { etat.recherche = e.target.value.trim(); afficher(); });
$("#jour").addEventListener("change", (e) => charger(e.target.value));

const estMac = /Mac|iPhone|iPad/.test(navigator.platform);
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
    champ.value = ""; etat.recherche = ""; champ.blur(); afficher();
  }
});

afficherMesProduits();
chargerArchives();
charger();
