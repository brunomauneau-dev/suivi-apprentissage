// Widget Grist « Suivi des référencements en apprentissage »
// Lit le document Suivi_formations_apprentissage : Etablissements, Demandes, Fiches, Mails, Parametres, Accueil.
// Une ligne par formation demandée, regroupées par établissement.

const ETAPES = ["Mail reçu", "Lien envoyé", "Fiche reçue", "UAI", "RNCP", "Publiée"];

// Abréviations courantes <-> intitulés, pour rapprocher les formations annoncées dans le mail et les fiches reçues
const ALIAS = [
  ["NDRC", "NEGOCIATION ET DIGITALISATION"], ["MCO", "MANAGEMENT COMMERCIAL OPERATIONNEL"],
  ["GPME", "GESTION DE LA PME"], ["SAM", "SUPPORT A L ACTION MANAGERIALE"], ["CG", "COMPTABILITE ET GESTION"],
  ["CJN", "COLLABORATEUR JURISTE NOTARIAL"], ["GTLA", "TRANSPORTS ET LOGISTIQUE"],
  ["SIO", "SERVICES INFORMATIQUES AUX ORGANISATIONS"], ["CIEL", "CYBERSECURITE"], ["MHR", "MANAGEMENT EN HOTELLERIE"],
  ["MECP", "ESTHETIQUE"], ["PI", "PROFESSIONS IMMOBILIERES"], ["CI", "COMMERCE INTERNATIONAL"],
  ["COMMUNICATION", "COMMUNICATION"], ["TOURISME", "TOURISME"], ["ASSURANCE", "ASSURANCE"],
];

// ------------------------------------------------------------------ utilitaires

function norm(s) {
  return String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ").replace(/\b(EN APPRENTISSAGE|APPRENTISSAGE|SERVICES|PRODUCTION|BTS)\b/g, " ")
    .replace(/\s+/g, " ").trim();
}

function cles(libelle) {
  // ensemble de « clés » qui identifient une formation (abréviation + intitulé)
  const n = norm(libelle);
  const k = new Set(n ? [n] : []);
  for (const [abr, long] of ALIAS) {
    if (new RegExp(`\\b${abr}\\b`).test(n) || n.includes(long)) k.add(abr);
  }
  return k;
}

function memeFormation(a, b) {
  const ka = cles(a), kb = cles(b);
  for (const x of ka) if (kb.has(x)) return true;
  const na = norm(a), nb = norm(b);
  return !!(na && nb && (na.includes(nb) || nb.includes(na)));
}

function dateCourte(sec) {
  if (!sec) return "";
  const d = new Date(sec * 1000);
  return String(d.getUTCDate()).padStart(2, "0") + "/" + String(d.getUTCMonth() + 1).padStart(2, "0");
}

function liste(v) {
  return Array.isArray(v) ? (v[0] === "L" ? v.slice(1) : v) : [];
}

// Grist renvoie les tables en colonnes : on les remet en lignes
function lignes(table) {
  if (!table || !table.id) return [];
  const cols = Object.keys(table);
  return table.id.map((_, i) => {
    const r = {};
    for (const c of cols) r[c] = table[c][i];
    return r;
  });
}

// ------------------------------------------------------------------ construction du suivi

function construire(t, maintenant = Date.now() / 1000) {
  const param = lignes(t.Parametres)[0] || {};
  const campagne = param.Campagne || null;
  const etabs = new Map(lignes(t.Etablissements).map(e => [e.id, e]));
  const deCampagne = r => !campagne || !r.Campagne || r.Campagne === campagne;
  const demandes = lignes(t.Demandes).filter(deCampagne);
  const fiches = lignes(t.Fiches).filter(deCampagne).filter(f => f.Decision !== "Remplacée");

  const groupes = new Map();   // id établissement -> { etab, formations[] }
  const groupe = id => {
    if (!groupes.has(id)) {
      const e = etabs.get(id) || {};
      groupes.set(id, { id, nom: e.Nom || "Établissement non identifié", formations: [] });
    }
    return groupes.get(id);
  };

  // 1. formations annoncées dans les demandes (mails) — plusieurs demandes d'un même établissement sont fusionnées
  const parEtab = new Map();
  for (const d of demandes) {
    const id = d.Etablissement || 0;
    const annoncees = String(d.Formations_annoncees || "").split(/\s*[,;\n]\s*/).filter(Boolean);
    if (!parEtab.has(id)) { parEtab.set(id, { d: { ...d }, annoncees: [], nb: 0 }); }
    const m = parEtab.get(id);
    if (d.Date_mail && (!m.d.Date_mail || d.Date_mail < m.d.Date_mail)) m.d.Date_mail = d.Date_mail;
    if (d.Date_envoi_lien && (!m.d.Date_envoi_lien || d.Date_envoi_lien > m.d.Date_envoi_lien)) m.d.Date_envoi_lien = d.Date_envoi_lien;
    for (const a of annoncees) if (!m.annoncees.some(x => memeFormation(x, a))) m.annoncees.push(a);
    m.nb = Math.max(m.nb, Number(d.Nb_annoncees) || 0);
  }
  for (const [id, m] of parEtab) {
    const g = groupe(id), d = m.d, annoncees = m.annoncees;
    const n = Math.max(annoncees.length, m.nb, 1);
    for (let i = 0; i < n; i++) {
      g.formations.push({ nom: annoncees[i] || "Formation " + (i + 1) + " (non précisée)", demande: d, fiche: null });
    }
  }

  // 2. fiches reçues : rattachées à une formation annoncée si possible, sinon ligne à part
  for (const f of fiches) {
    const g = groupe(f.Etablissement || 0);
    const libre = g.formations.find(x => !x.fiche && memeFormation(x.nom, f.Libelle_formation))
      || g.formations.find(x => !x.fiche && /non précisée/.test(x.nom));
    const dem = parEtab.has(f.Etablissement || 0) ? parEtab.get(f.Etablissement || 0).d : null;
    if (libre) { libre.fiche = f; libre.nom = f.Libelle_formation || libre.nom; }
    else g.formations.push({ nom: f.Libelle_formation || "Fiche sans libellé", demande: dem, fiche: f });
  }

  // 3. formations déjà sur Parcoursup (tableau de suivi d'origine)
  for (const fp of lignes(t.Formations)) {
    const g = groupe(fp.Etablissement || 0);
    const deja = g.formations.find(x => x.fiche && fp.g_ta_cod && String(x.fiche.g_ta_cod || "") === String(fp.g_ta_cod));
    if (deja) { deja.parcoursup = fp; continue; }
    g.formations.push({ nom: fp.Intitule || "Formation " + fp.g_ta_cod, lieu: fp.Site_campus || "", parcoursup: fp, demande: null, fiche: null });
  }

  // 4. étapes et prochaine action de chaque formation
  for (const g of groupes.values()) {
    for (const x of g.formations) Object.assign(x, x.parcoursup && !x.fiche && !x.demande ? surParcoursup(x.parcoursup) : etapes(x, maintenant));
    g.formations.sort((a, b) => ordre(a) - ordre(b) || a.nom.localeCompare(b.nom));
  }

  const mailsATraiter = lignes(t.Mails).filter(m => m.Statut === "Établissement à identifier" || m.Statut === "Demande à créer").length;
  const accueil = lignes(t.Accueil)[0] || {};
  return {
    campagne, mailsATraiter, dernierImport: accueil.Dernier_import || null,
    groupes: [...groupes.values()].sort((a, b) => a.nom.localeCompare(b.nom)),
  };
}

function etapes(x, maintenant) {
  const d = x.demande || {}, f = x.fiche;
  const e = [
    d.Date_mail ? { s: "done", t: dateCourte(d.Date_mail) } : { s: x.demande ? "done" : "todo" },
    d.Date_envoi_lien ? { s: "done", t: dateCourte(d.Date_envoi_lien) } : { s: f ? "done" : "todo" },
    f ? { s: "done", t: dateCourte(f.Recu_le) } : { s: "todo" },
    verif(f && f.Verif_UAI), verif(f && f.Verif_RNCP),
    { s: "todo" },
  ];
  if (f && f.Catalogue === "Publiée") e[5] = { s: "done" };
  else if (f && f.Verif_UAI === "Conforme" && f.Verif_RNCP === "Conforme") e[5] = { s: "warn" };

  if (f && f.Decision === "Refusée") return { e, cat: "autre", next: { cls: "", titre: "Refusée", txt: f.Note_SAIO || "" }, refusee: true };

  const rap = liste(f && f.Rapprochement);
  let next;
  if (e[3].s === "ko") next = { cls: "ko", titre: "À corriger", txt: "UAI" + (f.Cat_UAI ? " (catalogue : " + f.Cat_UAI + ")" : "") };
  else if (e[4].s === "ko") next = { cls: "ko", titre: "À corriger", txt: "RNCP" + (f.Cat_RNCP ? " (catalogue : " + f.Cat_RNCP + ")" : "") };
  else if (!x.demande && !f) next = { cls: "ko", titre: "Action requise", txt: "Enregistrer la demande" };
  else if (e[1].s === "todo" && !f) next = { cls: "ko", titre: "Action requise", txt: "Envoyer le lien de la fiche" };
  else if (!f) {
    const j = d.Date_envoi_lien ? Math.floor((maintenant - d.Date_envoi_lien) / 86400) : 0;
    next = j >= 10 ? { cls: "warn", titre: "Fiche attendue", txt: `Lien envoyé il y a ${j} j : relancer` }
      : { cls: "warn", titre: "Fiche attendue", txt: "En attente de l'établissement" };
  } else if (e[3].s === "todo") next = { cls: "ko", titre: "Action requise", txt: "Vérifier l'UAI" + (rap.includes("UAI ≠ catalogue") ? " — différent du catalogue" : rap.includes("UAI = catalogue") ? " — identique au catalogue" : "") };
  else if (e[4].s === "todo") next = { cls: "ko", titre: "Action requise", txt: "Vérifier le RNCP" + (rap.includes("RNCP ≠ catalogue") ? " — différent du catalogue" : rap.includes("RNCP = catalogue") ? " — identique au catalogue" : "") };
  else if (e[5].s !== "done") next = { cls: "warn", titre: "Validée par le SAIO", txt: f.Catalogue === "Absente du catalogue" ? "Pas encore au catalogue" : "En attente de publication au catalogue" };
  else next = { cls: "ok", titre: "Terminé", txt: "Publiée au catalogue national" };

  const cat = next.cls === "ok" ? "publie" : next.titre === "Fiche attendue" ? "attente" : next.cls === "ko" ? "action" : "autre";
  return { e, cat, next };
}

function surParcoursup(fp) {
  const c = fp.Conformite || "Non contrôlé";
  const e = ETAPES.map(() => ({ s: "done" }));
  e[5] = { s: "done", t: fp.g_ta_cod ? "n° " + fp.g_ta_cod : "" };
  const cls = c === "Non conforme" ? "ko" : c === "À surveiller" ? "warn" : c === "Conforme" ? "ok" : "";
  return { e, cat: "parcoursup", next: { cls, titre: "Sur Parcoursup — affichage", txt: c }, lien: fp.Lien_Parcoursup || "" };
}

function verif(v) {
  if (v === "Conforme") return { s: "done" };
  if (v === "À corriger") return { s: "ko" };
  return { s: "todo" };
}

function ordre(x) {
  return { action: 0, attente: 1, autre: 2, publie: 3, parcoursup: 4 }[x.cat] ?? 5;
}

// ------------------------------------------------------------------ affichage

let DONNEES = null, filtre = "tous", recherche = "";
const ouverts = new Set();

function esc(s) {
  return String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

function rendre() {
  const liste_ = document.getElementById("liste");
  if (!liste_ || !DONNEES) return;
  const toutes = DONNEES.groupes.flatMap(g => g.formations);
  const n = c => toutes.filter(f => f.cat === c).length;
  const kpis = document.getElementById("kpis");
  if (kpis) kpis.innerHTML = `
    <div class="kpi"><b>${toutes.length}</b><span>formations</span></div>
    <div class="kpi ko"><b>${n("action")}</b><span>action requise</span></div>
    <div class="kpi warn"><b>${n("attente")}</b><span>fiche attendue</span></div>
    <div class="kpi ok"><b>${n("publie")}</b><span>publiées</span></div>
    <div class="kpi"><b>${n("parcoursup")}</b><span>déjà sur Parcoursup</span></div>`;
  const st = document.getElementById("sous-titre");
  if (st) st.textContent = (DONNEES.campagne ? "Campagne Parcoursup " + DONNEES.campagne : "Toutes campagnes") +
    (DONNEES.dernierImport ? " · catalogue importé le " + new Date(DONNEES.dernierImport * 1000).toLocaleDateString("fr-FR") : " · aucun export du catalogue importé");
  const ban = document.getElementById("bandeaux");
  if (ban) ban.innerHTML = (DONNEES.alerte ? `<div class="banner" style="background:var(--red-bg);color:var(--red)">${esc(DONNEES.alerte)}</div>` : "") + (DONNEES.demo ? `<div class="demo">Mode démonstration : données fictives (le widget n'est pas ouvert dans Grist).</div>` : "") +
    (DONNEES.mailsATraiter ? `<div class="banner">${DONNEES.mailsATraiter} mail${DONNEES.mailsATraiter > 1 ? "s" : ""} de demande à traiter : page « 1. Mails reçus ».</div>` : "");

  const q = norm(recherche);
  const html = DONNEES.groupes.map(g => {
    const fs = g.formations.filter(f => (filtre === "tous" || f.cat === filtre) && (!q || norm(g.nom).includes(q) || norm(f.nom).includes(q)));
    if (!fs.length) return "";
    const tot = g.formations.length;
    const c = k => g.formations.filter(f => f.cat === k).length;
    const ps = c("parcoursup"), pub = c("publie") + ps, act = c("action"), att = c("attente"), aut = tot - pub - act - att;
    const seg = (k, col) => k ? `<i style="width:${100 * k / tot}%;background:${col}"></i>` : "";
    const pl = k => k > 1 ? "s" : "";
    const tags = [
      act ? `<span class="tag ko">${act} action${pl(act)} requise${pl(act)}</span>` : "",
      att ? `<span class="tag warn">${att} fiche${pl(att)} attendue${pl(att)}</span>` : "",
      aut ? `<span class="tag wait">${aut} en attente</span>` : "",
      pub - ps ? `<span class="tag ok">${pub - ps} publiée${pl(pub - ps)}</span>` : "",
      ps ? `<span class="tag wait">${ps} déjà sur Parcoursup</span>` : "",
    ].join("");
    const ouvert = ouverts.has(g.id) || q || filtre !== "tous";
    const lignesHtml = fs.map(f => {
      const steps = ETAPES.map((nom, i) => {
        const s = f.e[i].s;
        const ic = s === "done" ? "✓" : s === "ko" ? "!" : s === "warn" ? "…" : "";
        return `<div class="step ${s}"><div class="dot">${ic}</div>${nom}${f.e[i].t ? `<em>${esc(f.e[i].t)}</em>` : ""}</div>`;
      }).join("");
      return `<div class="form${f.refusee ? " refusee" : ""}">
        <div class="form-name"><b>${esc(f.nom)}</b><span>${f.lien ? `<a href="${esc(f.lien)}" target="_blank" rel="noopener">fiche Parcoursup</a>${f.lieu ? " · " + esc(f.lieu) : ""}` : esc(f.fiche ? (f.fiche.Commune || "") : "fiche non reçue")}</span></div>
        ${f.cat === "parcoursup" ? `<div class="steps" style="color:var(--muted);font-size:13px">Déjà ouverte sur Parcoursup${f.parcoursup && f.parcoursup.g_ta_cod ? " (n° " + esc(f.parcoursup.g_ta_cod) + ")" : ""} — pas de demande cette campagne</div>` : `<div class="steps">${steps}</div>`}
        <div class="next ${f.next.cls}"><b>${esc(f.next.titre)}</b>${esc(f.next.txt)}</div>
      </div>`;
    }).join("");
    return `<section class="etab${ouvert ? " open" : ""}" data-id="${g.id}">
      <div class="etab-head">
        <span class="chev">▶</span>
        <div class="etab-name"><b>${esc(g.nom)}</b><span>${tot} formation${pl(tot)}</span></div>
        <div><div class="progress">${seg(pub, "var(--green)")}${seg(aut, "#9fd8b0")}${seg(att, "#f5a000")}${seg(act, "var(--red)")}</div>
          <div class="progress-label">${pub} / ${tot} publiée${pl(pub)}</div></div>
        <div class="tags">${tags}</div>
      </div>
      <div class="forms">${lignesHtml}</div>
    </section>`;
  }).join("");
  liste_.innerHTML = html || `<div class="empty">${DONNEES.groupes.length ? "Aucune formation ne correspond." :
    "Aucune demande pour cette campagne. Enregistrez une demande (page « 2. Suivi par établissement ») pour la voir apparaître ici."}</div>`;
  liste_.querySelectorAll(".etab-head").forEach(h => h.addEventListener("click", () => {
    const s = h.parentElement, id = Number(s.dataset.id);
    s.classList.toggle("open");
    if (s.classList.contains("open")) ouverts.add(id); else ouverts.delete(id);
  }));
}

// ------------------------------------------------------------------ données Grist (ou démonstration)

const TABLES = ["Parametres", "Etablissements", "Demandes", "Fiches", "Mails", "Accueil", "Formations"];

async function charger() {
  const t = {};
  let refus = 0, absentes = [];
  for (const nom of TABLES) {
    try { t[nom] = await grist.docApi.fetchTable(nom); }
    catch (e) {
      t[nom] = null;
      if (/access|denied|permission|not allowed/i.test(String(e && e.message || e))) refus++; else absentes.push(nom);
    }
  }
  DONNEES = construire(t);
  if (refus) DONNEES.alerte = "Le widget n'a pas l'accès complet au document. Dans le panneau de droite (onglet « Personnalisée »), choisissez « Accès complet au document » puis acceptez.";
  else if (!t.Etablissements || !t.Fiches) DONNEES.alerte = "Ce document ne contient pas les tables du suivi (" + absentes.join(", ") + "). Le widget doit être ajouté dans le document « Suivi_formations_apprentissage ».";
  rendre();
}

function demo() {
  const j = s => Date.UTC(2026, Number(s.slice(3, 5)) - 1, Number(s.slice(0, 2))) / 1000;
  const t = {
    Parametres: { id: [1], Campagne: [2027] },
    Etablissements: { id: [1, 2, 3, 4], Nom: ["TALIS", "CAMPUS DU LAC", "ADREC", "PIGIER"] },
    Demandes: {
      id: [1, 2, 3, 4], Etablissement: [1, 2, 3, 4], Campagne: [2027, 2027, 2027, 2027],
      Date_mail: [j("20/10"), j("29/10"), j("15/10"), j("08/10")],
      Formations_annoncees: ["BTS NDRC, BTS MCO, BTS Communication", "BTS GPME",
        "Titre professionnel Négociateur technico-commercial, Titre professionnel Gestionnaire de paie", "BTS GPME, Bachelor RH"],
      Nb_annoncees: [3, 1, 2, 2], Date_envoi_lien: [j("21/10"), null, j("16/10"), j("09/10")],
    },
    Fiches: {
      id: [1, 2, 3, 4, 5, 6], Etablissement: [1, 1, 3, 3, 4, 4], Campagne: [2027, 2027, 2027, 2027, 2027, 2027],
      Libelle_formation: ["BTS NDRC", "BTS Management Commercial Opérationnel", "Titre professionnel Négociateur technico-commercial",
        "Titre professionnel Gestionnaire de paie", "BTS GPME", "Bachelor RH"],
      Recu_le: [j("25/10"), j("25/10"), j("22/10"), j("22/10"), j("14/10"), j("14/10")],
      Verif_UAI: ["Conforme", "Conforme", "À corriger", "Conforme", "Conforme", "Conforme"],
      Verif_RNCP: ["Conforme", null, null, "Conforme", "Conforme", "Conforme"],
      Catalogue: ["Publiée", "Publiée", "Non publiée", "Non publiée", "Publiée", "Publiée"],
      Rapprochement: [["L", "UAI = catalogue", "RNCP = catalogue"], ["L", "UAI = catalogue", "RNCP ≠ catalogue"], ["L", "UAI ≠ catalogue"], null, null, null],
      Cat_UAI: [null, null, "0333233K", null, null, null], Cat_RNCP: [null, "38362", null, null, null, null],
      Commune: ["Bordeaux", "Bordeaux", "Bordeaux", "Bordeaux", "Bordeaux", "Bordeaux"],
      Decision: ["En cours", "En cours", "En cours", "En cours", "En cours", "En cours"],
    },
    Mails: { id: [1, 2], Statut: ["Demande à créer", "Rattaché à une demande"] },
    Accueil: { id: [1], Dernier_import: [j("02/11")] },
  };
  DONNEES = construire(t, j("02/11"));
  DONNEES.demo = true;
  rendre();
}

if (typeof window !== "undefined") {
  window.addEventListener("DOMContentLoaded", () => {
    const q = document.getElementById("q");
    if (q) q.addEventListener("input", e => { recherche = e.target.value; rendre(); });
    document.querySelectorAll(".chip").forEach(c => c.addEventListener("click", () => {
      document.querySelectorAll(".chip").forEach(x => x.classList.remove("on"));
      c.classList.add("on"); filtre = c.dataset.f; rendre();
    }));
    const r = document.getElementById("refresh");
    if (r) r.addEventListener("click", () => (window.grist && window.self !== window.top) ? charger() : demo());

    if (window.grist && window.self !== window.top) {
      grist.ready({ requiredAccess: "full" });
      let attente = null;
      const recharger = () => { clearTimeout(attente); attente = setTimeout(charger, 300); };
      grist.onRecords(recharger);
      grist.onRecord(recharger);
      charger();
      setInterval(charger, 30000);
    } else {
      demo();
    }
  });
}

if (typeof module !== "undefined") module.exports = { construire, memeFormation, lignes };
