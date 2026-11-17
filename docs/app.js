// Veille Cyber — affichage des données générées par scripts/fetch_veille.py

const etat = { data: null, onglet: "certfr", filtre: "" };

const $ = (sel) => document.querySelector(sel);

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

function afficherStats(s) {
  const tuiles = [
    ["alertes_certfr", "Alertes CERT-FR", "rouge"],
    ["avis_certfr", "Avis CERT-FR", ""],
    ["kev", "Failles exploitées (KEV)", "rouge"],
    ["cve_critiques", "CVE critiques (NVD)", "orange"],
    ["attaques", "Articles sur des attaques", "orange"],
  ];
  $("#stats").innerHTML = tuiles.map(([cle, lib, cls]) => `
    <div class="stat ${cls}">
      <div class="nombre">${s?.[cle] ?? 0}</div>
      <div class="libelle">${lib}</div>
    </div>`).join("");
}

function badgesCve(cves = []) {
  return cves.slice(0, 6).map((c) => `<span class="badge">${echapper(c)}</span>`).join("");
}

const rendus = {
  certfr: (x) => {
    const cls = x.categorie === "alerte" ? "critique" : x.categorie === "avis" ? "eleve" : "info";
    const badge = x.categorie === "alerte" ? "rouge" : x.categorie === "avis" ? "orange" : "bleu";
    return `<article class="carte ${cls}">
      <div class="meta"><span class="badge ${badge}">${echapper(x.categorie.toUpperCase())}</span>
        ${dateFr(x.date)} ${badgesCve(x.cves)}</div>
      <h3><a href="${echapper(x.lien)}" target="_blank" rel="noopener">${echapper(x.titre)}</a></h3>
      ${x.resume ? `<p>${echapper(x.resume)}</p>` : ""}
    </article>`;
  },
  kev: (x) => `<article class="carte critique">
      <div class="meta"><span class="badge rouge">${echapper(x.cve)}</span>
        ${echapper(x.editeur)} · ${echapper(x.produit)} · ajoutée le ${dateFr(x.date)}
        ${x.ransomware ? '<span class="badge orange">utilisée par des ransomwares</span>' : ""}</div>
      <h3><a href="${echapper(x.lien)}" target="_blank" rel="noopener">${echapper(x.titre)}</a></h3>
      <p>${echapper(x.resume)}</p>
      ${x.action ? `<p><strong>Action :</strong> ${echapper(x.action)}</p>` : ""}
    </article>`,
  nvd: (x) => `<article class="carte critique">
      <div class="meta"><span class="badge rouge">CVSS ${x.score ?? "?"}</span>
        <span class="badge">${echapper(x.cve)}</span> publiée le ${dateFr(x.date)}</div>
      <h3><a href="${echapper(x.lien)}" target="_blank" rel="noopener">${echapper(x.cve)}</a></h3>
      <p>${echapper(x.resume)}</p>
    </article>`,
  presse: (x) => `<article class="carte ${x.attaque ? "eleve" : "info"}">
      <div class="meta"><span class="badge ${x.attaque ? "orange" : "bleu"}">${echapper(x.source)}</span>
        ${dateFr(x.date)} ${x.attaque ? '<span class="badge rouge">attaque</span>' : ""} ${badgesCve(x.cves)}</div>
      <h3><a href="${echapper(x.lien)}" target="_blank" rel="noopener">${echapper(x.titre)}</a></h3>
      ${x.resume ? `<p>${echapper(x.resume)}</p>` : ""}
    </article>`,
};

function afficher() {
  const d = etat.data;
  if (!d || !d.genere_le) {
    $("#maj").textContent = "Aucune donnée pour l'instant — lance le workflow GitHub une première fois.";
    afficherStats({});
    $("#liste").innerHTML = '<p class="vide">Rien à afficher.</p>';
    return;
  }

  $("#maj").textContent = `Mis à jour le ${dateFr(d.genere_le, true)} · ${d.fenetre_jours} derniers jours`;
  afficherStats(d.stats);

  const f = etat.filtre.toLowerCase();
  const elements = (d[etat.onglet] || []).filter((x) => !f || JSON.stringify(x).toLowerCase().includes(f));

  $("#liste").innerHTML = elements.length
    ? elements.map(rendus[etat.onglet]).join("")
    : '<p class="vide">Aucun élément sur cette période.</p>';

  $("#erreurs").textContent = d.erreurs?.length ? `Sources indisponibles : ${d.erreurs.join(" · ")}` : "";
}

document.querySelectorAll(".onglet").forEach((b) => b.addEventListener("click", () => {
  document.querySelectorAll(".onglet").forEach((o) => o.classList.remove("actif"));
  b.classList.add("actif");
  etat.onglet = b.dataset.onglet;
  afficher();
}));

$("#recherche").addEventListener("input", (e) => { etat.filtre = e.target.value; afficher(); });
$("#jour").addEventListener("change", (e) => charger(e.target.value));

chargerArchives();
charger();
