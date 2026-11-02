// Widget Grist « Suivi des référencements en apprentissage »
// Tables : Suivi (une ligne par formation demandée), Fiches (formulaire en ligne), Catalogue (export Carif-Oref), Parametres.
// 7 étapes : mail reçu → lien envoyé → fiche reçue → UAI → RNCP → Carif-Oref (auto, export) → catalogue national (manuel).

const JOUR = 86400;
const DELAI_FICHE = 10;    // jours après l'envoi du lien avant de relancer pour la fiche
const DELAI_RELANCE = 7;   // une relance masque l'établissement pendant ce nombre de jours
const ACADEMIE = "Bordeaux";
const ETAPES = [
  { col: "Mail_recu", nom: "Mail reçu", type: "date" },
  { col: "Lien_envoye", nom: "Lien envoyé", type: "date" },
  { col: "Fiche_recue", nom: "Fiche reçue", type: "date" },
  { col: "UAI", nom: "UAI", type: "verif" },
  { col: "RNCP", nom: "RNCP", type: "verif" },
  { col: null, nom: "Carif-Oref", type: "auto" },
  { col: "Publiee", nom: "Catalogue national", type: "pub" },
];

// ------------------------------------------------------------------ utilitaires

const norm = s => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/\s+/g, " ").trim();
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const chiffres = v => String(v ?? "").replace(/\.0$/, "").replace(/\D/g, "");
const code = v => String(v ?? "").trim().toUpperCase().replace(/\.0$/, "");
function aujourdhui() { const d = new Date(); return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 1000; }
function dateCourte(sec) {
  if (!sec) return "";
  const d = new Date(sec * 1000);
  return String(d.getUTCDate()).padStart(2, "0") + "/" + String(d.getUTCMonth() + 1).padStart(2, "0");
}
const versInput = sec => sec ? new Date(sec * 1000).toISOString().slice(0, 10) : "";
function depuisInput(v) { if (!v) return null; const [a, m, j] = v.split("-").map(Number); return Date.UTC(a, m - 1, j) / 1000; }
function lignes(table) {
  if (!table || !table.id) return [];
  const cols = Object.keys(table);
  return table.id.map((_, i) => { const r = {}; for (const c of cols) r[c] = table[c][i]; return r; });
}
function uaiValide(v) {
  const u = code(v);
  return /^\d{7}[A-Z]$/.test(u) && "ABCDEFGHJKLMNPRSTUVWXYZ"[Number(u.slice(0, 7)) % 23] === u[7];
}
function siretValide(v) {
  const s = chiffres(v);
  if (s.length !== 14) return false;
  let t = 0;
  for (let i = 0; i < 14; i++) { let n = Number(s[13 - i]) * (i % 2 ? 2 : 1); t += n > 9 ? n - 9 : n; }
  return t % 10 === 0 || s.startsWith("356000000");
}

// ------------------------------------------------------------------ données

let DEMO = false, ROWS = [], FICHES = [], CATALOGUE = [], PARAM = {};
let INDEX = null;

function indexer() {
  INDEX = { siret: new Map(), uai: new Map() };
  const ajoute = (m, k, c) => { if (!k) return; if (!m.has(k)) m.set(k, []); m.get(k).push(c); };
  for (const c of CATALOGUE) {
    c._sf = chiffres(c.Siret_formateur).padStart(14, "0"); c._sg = chiffres(c.Siret_gestionnaire).padStart(14, "0");
    c._uai = code(c.UAI_validee); c._rncp = chiffres(c.Code_RNCP); c._cfd = code(c.Code_scolarite).padStart(8, "0");
    ajoute(INDEX.siret, c._sf, c); if (c._sg !== c._sf) ajoute(INDEX.siret, c._sg, c); ajoute(INDEX.uai, c._uai, c);
  }
}

function ficheDe(r) {
  const fs = FICHES.filter(f => f.Code && code(f.Code) === code(r.Code));
  return fs.sort((a, b) => (b.Recu_le || 0) - (a.Recu_le || 0))[0] || null;
}

// Retrouve la formation de la fiche dans l'export Carif-Oref : même organisme (SIRET ou UAI) + même RNCP ou code diplôme
function trouverCatalogue(f) {
  if (!f || !CATALOGUE.length) return null;
  if (!INDEX) indexer();
  const siret = chiffres(f.Siret).padStart(14, "0");
  const uais = [f.UAI_formateur, f.UAI_lieu, f.UAI_gestionnaire].map(code).filter(Boolean);
  const cands = new Set([...(INDEX.siret.get(siret) || []), ...uais.flatMap(u => INDEX.uai.get(u) || [])]);
  const rncp = chiffres(f.Code_RNCP), cfd = f.Code_diplome ? code(f.Code_diplome).padStart(8, "0") : "";
  let best = null, score = 0;
  for (const c of cands) {
    let s = (cfd && c._cfd === cfd ? 2 : 0) + (rncp && c._rncp === rncp ? 2 : 0);
    if (!s) continue;
    s += (String(c.CP || "").slice(0, 5) === String(f.Code_postal || "").slice(0, 5) ? 1 : 0) + (uais.includes(c._uai) ? 1 : 0);
    if (s > score) { best = c; score = s; }
  }
  return best;
}

// ------------------------------------------------------------------ logique de suivi

function analyser(r, maintenant) {
  const fiche = ficheDe(r);
  const cat = trouverCatalogue(fiche);
  const ficheDate = (fiche && fiche.Recu_le) || r.Fiche_recue;
  const etat = (s, t) => ({ s, t });
  const verif = v => v === "Conforme" ? etat("done") : v === "À corriger" ? etat("ko") : etat("todo");
  const e = [
    r.Mail_recu ? etat("done", dateCourte(r.Mail_recu)) : etat("todo"),
    r.Lien_envoye ? etat("done", dateCourte(r.Lien_envoye)) : etat(ficheDate ? "done" : "todo"),
    ficheDate ? etat("done", dateCourte(ficheDate)) : etat("todo"),
    verif(r.UAI), verif(r.RNCP),
    cat ? etat("done") : (fiche && CATALOGUE.length ? etat("ko") : etat("todo")),
    r.Publiee === "Publiée" ? etat("done", dateCourte(r.Publiee_le)) : etat("todo"),
  ];
  const base = { e, fiche, cat };
  // déjà ouverte sur Parcoursup : le circuit complet a été fait, toutes les étapes sont validées
  if (r.Origine && !r.Mail_recu && !fiche) return { ...base, e: ETAPES.map(() => etat("done")), cat_: "parcoursup",
    next: { cls: "ok", titre: "Terminé", txt: "Déjà ouverte sur Parcoursup" + (r.g_ta_cod ? " (n° " + r.g_ta_cod + ")" : "") } };
  if (r.Publiee === "Publiée") return { ...base, cat_: "publie", next: { cls: "ok", titre: "Terminé", txt: "Publiée au catalogue national" } };
  if (e[3].s === "ko") return { ...base, cat_: "relance", next: { cls: "ko", titre: "À corriger par l'établissement", txt: "UAI" + (r.Commentaire ? " — " + r.Commentaire : "") } };
  if (e[4].s === "ko") return { ...base, cat_: "relance", next: { cls: "ko", titre: "À corriger par l'établissement", txt: "RNCP" + (r.Commentaire ? " — " + r.Commentaire : "") } };
  if (!r.Lien_envoye && !ficheDate) return { ...base, cat_: "saio", next: { cls: "ko", titre: "À faire au SAIO", txt: "Envoyer le lien de la fiche" } };
  if (!ficheDate) {
    const j = Math.floor((maintenant - r.Lien_envoye) / JOUR);
    return j >= DELAI_FICHE
      ? { ...base, cat_: "relance", next: { cls: "ko", titre: "À relancer", txt: `Fiche non reçue (lien envoyé il y a ${j} j)` } }
      : { ...base, cat_: "attente", next: { cls: "warn", titre: "Fiche attendue", txt: `Lien envoyé il y a ${j} j` } };
  }
  if (e[3].s === "todo") return { ...base, cat_: "saio", next: { cls: "warn", titre: "À faire au SAIO", txt: "Vérifier l'UAI (voir la fiche)" } };
  if (e[4].s === "todo") return { ...base, cat_: "saio", next: { cls: "warn", titre: "À faire au SAIO", txt: "Vérifier le RNCP (voir la fiche)" } };
  if (e[5].s === "ko") return { ...base, cat_: "relance", next: { cls: "ko", titre: "À relancer", txt: "Absente de l'export Carif-Oref : à déclarer auprès du Carif-Oref" } };
  if (e[5].s === "todo") return { ...base, cat_: "attente", next: { cls: "warn", titre: "En attente", txt: "Importer l'export Carif-Oref pour vérifier" } };
  return { ...base, cat_: "saio", next: { cls: "warn", titre: "À faire au SAIO", txt: "Publier au catalogue national" } };
}

function motifRelance(f) {
  return f.cat_ === "relance" ? f.next.txt : null;
}

function construire(rows, maintenant = aujourdhui()) {
  const groupes = new Map();
  for (const r of rows) {
    const nom = (r.Etablissement || "").trim() || "Sans établissement", k = norm(nom);
    if (!groupes.has(k)) groupes.set(k, { cle: k, nom, formations: [] });
    groupes.get(k).formations.push({ r, ...analyser(r, maintenant) });
  }
  const ordre = { relance: 0, saio: 1, attente: 2, publie: 3, parcoursup: 4 };
  const gs = [...groupes.values()];
  for (const g of gs) g.formations.sort((a, b) => ordre[a.cat_] - ordre[b.cat_] || String(a.r.Formation).localeCompare(String(b.r.Formation)));
  const actif = g => g.formations.some(f => f.cat_ !== "parcoursup");
  gs.sort((a, b) => (actif(b) - actif(a)) || a.nom.localeCompare(b.nom));
  return gs;
}

// ------------------------------------------------------------------ écriture dans Grist

async function actions(acts) {
  if (DEMO) return;
  await grist.docApi.applyUserActions(acts);
}
async function maj(id, champs) {
  if (DEMO) { Object.assign(ROWS.find(x => x.id === id), champs); rendre(); return; }
  await actions([["UpdateRecord", "Suivi", id, champs]]);
  await charger();
}
async function ajouter(liste) {
  if (DEMO) { for (const c of liste) ROWS.push({ id: Math.max(0, ...ROWS.map(r => r.id)) + 1, ...c }); ROWS.forEach(r => r.Code = r.Code || "F-" + String(r.id).padStart(4, "0")); rendre(); return; }
  const cols = {};
  for (const k of new Set(liste.flatMap(Object.keys))) cols[k] = liste.map(x => x[k] ?? null);
  await actions([["BulkAddRecord", "Suivi", liste.map(() => null), cols]]);
  await charger();
}

// ------------------------------------------------------------------ affichage principal

let filtre = "tous", recherche = "";
const ouverts = new Set();

function rendre() {
  const zone = document.getElementById("liste");
  if (!zone) return;
  const maintenant = aujourdhui();
  const groupes = construire(ROWS, maintenant);
  const toutes = groupes.flatMap(g => g.formations);
  const n = c => toutes.filter(f => f.cat_ === c).length;

  // sous-titre : état de l'export
  const st = document.getElementById("sous-titre");
  if (st) {
    const cleDate = d => { const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(d || ""); return m ? m[3] + m[2] + m[1] : ""; };
    const dates = CATALOGUE.map(c => c.Date_MAJ).filter(d => cleDate(d)).sort((x, y) => cleDate(x).localeCompare(cleDate(y)));
    st.textContent = CATALOGUE.length
      ? `Export Carif-Oref importé : ${CATALOGUE.length} formations${dates.length ? " (données du " + dates[dates.length - 1] + ")" : ""}`
      : "Aucun export Carif-Oref importé : cliquez sur « Importer l'export Carif-Oref »";
  }
  const kpis = document.getElementById("kpis");
  const relances = aRelancer(groupes, maintenant);
  if (kpis) kpis.innerHTML = `
    <div class="kpi ko"><b>${relances.filter(x => !x.masque).length}</b><span>établissements à relancer</span></div>
    <div class="kpi warn"><b>${n("saio")}</b><span>à faire au SAIO</span></div>
    <div class="kpi"><b>${n("attente")}</b><span>en attente</span></div>
    <div class="kpi ok"><b>${n("publie") + n("parcoursup")}</b><span>terminées</span></div>`;
  const ban = document.getElementById("bandeaux");
  if (ban) ban.innerHTML = (DEMO ? `<div class="demo">Mode démonstration : données fictives (le widget n'est pas ouvert dans Grist).</div>` : "") +
    (!DEMO && !PARAM.URL_formulaire ? `<div class="banner">Le formulaire de fiche n'est pas encore publié : page « Formulaire fiche » → Publier, puis collez son adresse dans la page « Paramètres ». Les liens à envoyer se créeront alors tout seuls.</div>` : "");

  panneaux(groupes, relances);

  const q = norm(recherche);
  const html = groupes.map(g => {
    const fs = g.formations.filter(f => (filtre === "tous" || f.cat_ === filtre) && (!q || norm(g.nom).includes(q) || norm(f.r.Formation).includes(q)));
    if (!fs.length) return "";
    const tot = g.formations.length, c = k => g.formations.filter(f => f.cat_ === k).length;
    const rel = c("relance"), sai = c("saio"), att = c("attente"), pub = c("publie"), ps = c("parcoursup");
    const seg = (k, col) => k ? `<i style="width:${100 * k / tot}%;background:${col}"></i>` : "";
    const pl = k => k > 1 ? "s" : "";
    const tags = [
      rel ? `<span class="tag ko">${rel} à relancer</span>` : "", sai ? `<span class="tag warn">${sai} à faire SAIO</span>` : "",
      att ? `<span class="tag wait">${att} en attente</span>` : "", pub + ps ? `<span class="tag ok">${pub + ps} terminée${pl(pub + ps)}</span>` : ""].join("");
    const ouvert = ouverts.has(g.cle) || !!q || filtre !== "tous";
    return `<section class="etab${ouvert ? " open" : ""}" data-cle="${esc(g.cle)}">
      <div class="etab-head"><span class="chev">▶</span>
        <div class="etab-name"><b>${esc(g.nom)}</b> <button class="btn-lien" data-renom-etab="${esc(g.nom)}" title="Renommer l'établissement">✎ renommer</button><span>${tot} formation${pl(tot)}${tot - ps - pub ? " · " + (tot - ps - pub) + " en cours" : ""}</span></div>
        <div><div class="progress">${seg(pub + ps, "var(--green)")}${seg(att, "#9fd8b0")}${seg(sai, "#f5a000")}${seg(rel, "var(--red)")}</div>
          <div class="progress-label">${pub + ps} / ${tot} terminée${pl(pub + ps)}</div></div>
        <div class="tags">${tags}</div></div>
      <div class="forms">${fs.map(ligneFormation).join("")}
        <div class="ajout-ligne">${(() => { const n = g.formations.filter(f => !f.r.Lien_envoye && !f.fiche && f.cat_ !== "parcoursup" && f.cat_ !== "publie").length;
          return n ? `<button class="btn petit" data-mail="${esc(g.nom)}">✉ Envoyer ${n > 1 ? "les " + n + " fiches" : "la fiche"} par mail</button> &nbsp; ` : ""; })()}
          <button class="btn-lien" data-ajout="${esc(g.nom)}">+ Ajouter une formation pour ${esc(g.nom)}</button></div></div>
    </section>`;
  }).join("");
  zone.innerHTML = html || `<div class="empty">${ROWS.length ? "Aucune formation ne correspond." : "Aucune formation suivie. Cliquez sur « + Nouvelle demande »."}</div>`;
  brancher(zone);
}

function aRelancer(groupes, maintenant) {
  const out = [];
  for (const g of groupes) {
    const ls = g.formations.filter(f => motifRelance(f));
    if (!ls.length) continue;
    const derniere = Math.max(0, ...ls.map(f => f.r.Relance_le || 0));
    out.push({ nom: g.nom, lignes: ls.map(f => ({ formation: f.r.Formation, motif: motifRelance(f) })), ids: ls.map(f => f.r.id),
      derniere, masque: derniere && (maintenant - derniere) / JOUR < DELAI_RELANCE });
  }
  return out.sort((a, b) => a.masque - b.masque || a.nom.localeCompare(b.nom));
}

function panneaux(groupes, relances) {
  const pan = document.getElementById("panneaux");
  if (!pan) return;
  const act = relances.filter(e => !e.masque), mas = relances.filter(e => e.masque);
  const taches = groupes.flatMap(g => g.formations.filter(f => f.cat_ === "saio").map(f => ({ etab: g.nom, f })));
  pan.innerHTML = `
    <section class="panneau"><h2>À relancer <span class="compte ${act.length ? "ko" : "ok"}">${act.length} établissement${act.length > 1 ? "s" : ""}</span></h2>
      ${act.length ? `<div class="cartes">${act.map(e => `<div class="carte"><div class="carte-tete"><b>${esc(e.nom)}</b>
          <button class="btn petit" data-relance="${e.ids.join(",")}">Relancé aujourd'hui</button></div>
          <ul>${e.lignes.map(l => `<li><b>${esc(l.formation)}</b> — ${esc(l.motif)}</li>`).join("")}</ul></div>`).join("")}</div>`
        : `<p class="rien">Personne à relancer pour le moment.</p>`}
      ${mas.length ? `<p class="rien">Relancés récemment (réapparaissent après ${DELAI_RELANCE} jours si rien ne bouge) : ${mas.map(e => esc(e.nom) + " le " + dateCourte(e.derniere)).join(", ")}</p>` : ""}
    </section>
    <section class="panneau"><h2>À faire au SAIO <span class="compte ${taches.length ? "warn" : "ok"}">${taches.length}</span></h2>
      ${taches.length ? `<ul class="taches">${taches.map(t => `<li><span class="tag warn">${esc(t.f.next.txt)}</span> ${esc(t.etab)} — ${esc(t.f.r.Formation)}
          ${t.f.fiche ? ` <button class="btn-lien" data-fiche="${t.f.r.id}">voir la fiche</button>` : ""}</li>`).join("")}</ul>`
        : `<p class="rien">Rien à faire pour le moment.</p>`}
    </section>`;
  pan.querySelectorAll("[data-relance]").forEach(b => b.addEventListener("click", async () => {
    const ids = b.dataset.relance.split(",").map(Number), d = aujourdhui();
    if (DEMO) { ROWS.forEach(r => { if (ids.includes(r.id)) r.Relance_le = d; }); rendre(); return; }
    await actions([["BulkUpdateRecord", "Suivi", ids, { Relance_le: ids.map(() => d) }]]);
    await charger();
  }));
  pan.querySelectorAll("[data-fiche]").forEach(b => b.addEventListener("click", ev => { ev.stopPropagation(); voirFiche(Number(b.dataset.fiche)); }));
}

function ligneFormation(f) {
  const r = f.r;
  const steps = ETAPES.map((et, i) => {
    const s = f.e[i].s, ic = s === "done" ? "✓" : s === "ko" ? "!" : "";
    return `<button class="step ${s}" data-id="${r.id}" data-etape="${i}" title="${et.type === "auto" ? "Vérifié automatiquement avec l'export" : "Cliquer pour modifier"}">
      <span class="dot">${ic}</span>${et.nom}${f.e[i].t ? `<em>${esc(f.e[i].t)}</em>` : ""}</button>`;
  }).join("");
  const sous = [];
  if (r.Lieu) sous.push(esc(r.Lieu));
  if (r.Lien_Parcoursup) sous.push(`<a href="${esc(r.Lien_Parcoursup)}" target="_blank" rel="noopener">fiche Parcoursup</a>`);
  const outils = [
    f.cat_ !== "parcoursup" && f.cat_ !== "publie" ? `<button class="btn-lien" data-lien="${r.id}">Copier le lien de la fiche</button>` : "",
    f.fiche ? `<button class="btn-lien" data-fiche="${r.id}"><b>Voir la fiche</b></button>` : "",
    `<button class="btn-lien" data-renom="${r.id}">Renommer</button>`,
    `<button class="btn-lien" data-com="${r.id}">${r.Commentaire ? "Commentaire" : "+ Commentaire"}</button>`,
    `<button class="btn-lien rouge" data-suppr="${r.id}">Supprimer</button>`].join("");
  return `<div class="form" data-id="${r.id}">
    <div class="form-name"><b>${esc(r.Formation || "(sans intitulé)")}</b><span>${sous.join(" · ")}</span></div>
    <div class="steps">${steps}</div>
    <div class="next ${f.next.cls}"><b>${esc(f.next.titre)}</b>${esc(f.next.txt)}
      <div class="outils">${outils}</div>
      ${r.Commentaire && !/corriger/.test(f.next.titre) ? `<div class="com">${esc(r.Commentaire)}</div>` : ""}</div>
  </div>`;
}

function brancher(zone) {
  zone.querySelectorAll(".etab-head").forEach(h => h.addEventListener("click", () => {
    const s = h.parentElement; s.classList.toggle("open");
    if (s.classList.contains("open")) ouverts.add(s.dataset.cle); else ouverts.delete(s.dataset.cle);
  }));
  zone.querySelectorAll(".step").forEach(b => b.addEventListener("click", ev => { ev.stopPropagation(); ouvrirEtape(b, Number(b.dataset.id), Number(b.dataset.etape)); }));
  zone.querySelectorAll("[data-com]").forEach(b => b.addEventListener("click", () => {
    const id = Number(b.dataset.com), r = ROWS.find(x => x.id === id);
    const t = prompt("Commentaire pour « " + (r.Formation || "") + " » :", r.Commentaire || "");
    if (t !== null) maj(id, { Commentaire: t.trim() });
  }));
  zone.querySelectorAll("[data-suppr]").forEach(b => b.addEventListener("click", async () => {
    const id = Number(b.dataset.suppr), r = ROWS.find(x => x.id === id);
    if (!confirm("Supprimer « " + (r.Formation || "") + " » du suivi ?")) return;
    if (DEMO) { ROWS = ROWS.filter(x => x.id !== id); rendre(); return; }
    await actions([["RemoveRecord", "Suivi", id]]); await charger();
  }));
  zone.querySelectorAll("[data-ajout]").forEach(b => b.addEventListener("click", ev => { ev.stopPropagation(); ouvrirAjout(b.dataset.ajout); }));
  zone.querySelectorAll("[data-renom-etab]").forEach(b => b.addEventListener("click", async ev => {
    ev.stopPropagation();
    const ancien = b.dataset.renomEtab;
    const nouveau = (prompt("Nouveau nom de l'établissement :", ancien) || "").trim();
    if (!nouveau || nouveau === ancien) return;
    const ids = ROWS.filter(r => norm(r.Etablissement) === norm(ancien)).map(r => r.id);
    if (ouverts.has(norm(ancien))) ouverts.add(norm(nouveau));
    await bulkMaj(ids, { Etablissement: nouveau });
  }));
  zone.querySelectorAll("[data-renom]").forEach(b => b.addEventListener("click", async ev => {
    ev.stopPropagation();
    const id = Number(b.dataset.renom), r = ROWS.find(x => x.id === id);
    const nouveau = (prompt("Nouvel intitulé de la formation :", r.Formation || "") || "").trim();
    if (nouveau && nouveau !== r.Formation) await maj(id, { Formation: nouveau });
  }));
  zone.querySelectorAll("[data-mail]").forEach(b => b.addEventListener("click", ev => { ev.stopPropagation(); preparerMail(b.dataset.mail, null, b); }));
  zone.querySelectorAll("[data-fiche]").forEach(b => b.addEventListener("click", ev => { ev.stopPropagation(); voirFiche(Number(b.dataset.fiche)); }));
  zone.querySelectorAll("[data-lien]").forEach(b => b.addEventListener("click", ev => { ev.stopPropagation(); copierLien(b, Number(b.dataset.lien)); }));
}

// ------------------------------------------------------------------ fenêtres

function fermerPop() { const p = document.getElementById("pop"); if (p) p.remove(); }
function placer(pop, ancre) {
  document.body.appendChild(pop);
  if (ancre) {
    const rect = ancre.getBoundingClientRect();
    pop.style.top = (window.scrollY + rect.bottom + 6) + "px";
    pop.style.left = Math.max(8, Math.min(window.innerWidth - pop.offsetWidth - 8, window.scrollX + rect.left - 60)) + "px";
  } else {
    pop.style.top = (window.scrollY + 40) + "px";
    pop.style.left = Math.max(8, (window.innerWidth - pop.offsetWidth) / 2) + "px";
  }
}
function nouvellePop(classe) {
  fermerPop();
  const pop = document.createElement("div");
  pop.id = "pop"; pop.className = "pop " + (classe || "");
  pop.addEventListener("click", ev => ev.stopPropagation());
  return pop;
}

function ouvrirEtape(bouton, id, i) {
  const r = ROWS.find(x => x.id === id), et = ETAPES[i];
  if (!r) return;
  const pop = nouvellePop();
  if (et.type === "auto") {
    const f = construire([r])[0].formations[0];
    pop.innerHTML = `<b>${esc(r.Formation)} — Carif-Oref</b><p class="rien">Cette étape se vérifie automatiquement : elle est validée quand la formation de la fiche
      est trouvée dans l'export Carif-Oref (même organisme + même RNCP ou code diplôme).</p>
      <p>${f.cat ? "✓ Trouvée dans l'export : <b>" + esc(f.cat.Libelle_formation) + "</b> (" + esc(f.cat.Formateur_RS) + ")"
        : f.fiche ? (CATALOGUE.length ? "✗ Non trouvée dans l'export importé." : "Aucun export importé.") : "Fiche pas encore reçue."}</p>`;
    placer(pop, bouton);
    return;
  }
  if (et.col === "Lien_envoye" && !r.Lien_envoye) { preparerMail(r.Etablissement, [id], bouton); return; }
  const effacer = r[et.col] ? `<button class="btn gris" data-v="vide">Effacer</button>` : "";
  let corps;
  if (et.type === "date") {
    corps = `<label>${et.nom} le <input type="date" id="pop-date" value="${versInput(r[et.col]) || versInput(aujourdhui())}"></label>
      <div class="pop-btns"><button class="btn" data-v="ok">Valider</button>${effacer}</div>`;
  } else if (et.type === "verif") {
    corps = `<div class="pop-btns"><button class="btn vert" data-v="Conforme">Conforme</button><button class="btn rouge" data-v="À corriger">À corriger</button>${effacer}</div>`;
  } else {
    corps = `<p class="rien">À cocher après avoir cliqué « Publier » dans le catalogue national.</p>
      <div class="pop-btns"><button class="btn vert" data-v="Publiée">Publiée au catalogue national</button>${effacer}</div>`;
  }
  pop.innerHTML = `<b>${esc(r.Formation || "")} — ${et.nom}</b>${corps}`;
  placer(pop, bouton);
  pop.querySelectorAll("[data-v]").forEach(b => b.addEventListener("click", async () => {
    const v = b.dataset.v, champs = {};
    if (v === "vide") { champs[et.col] = null; if (et.type === "pub") champs.Publiee_le = null; }
    else if (et.type === "date") { const d = document.getElementById("pop-date"); champs[et.col] = (d && depuisInput(d.value)) || aujourdhui(); }
    else { champs[et.col] = v; if (et.type === "pub") champs.Publiee_le = aujourdhui(); }
    if (v === "À corriger") { const t = prompt("Que faut-il corriger ?", r.Commentaire || ""); if (t !== null && t.trim()) champs.Commentaire = t.trim(); }
    fermerPop();
    await maj(id, champs);
  }));
}

function ouvrirAjout(etab) {
  const noms = [...new Set(ROWS.map(r => (r.Etablissement || "").trim()).filter(Boolean))].sort();
  const pop = nouvellePop("pop-large");
  pop.innerHTML = `<b>${etab ? "Ajouter des formations pour " + esc(etab) : "Nouvelle demande de référencement"}</b>
    <label>Établissement <input id="aj-etab" list="aj-liste" value="${esc(etab || "")}" placeholder="Nom de l'établissement"></label>
    <datalist id="aj-liste">${noms.map(n => `<option value="${esc(n)}">`).join("")}</datalist>
    <label>Formations demandées <small>(une par ligne)</small><textarea id="aj-forms" rows="4" placeholder="BTS NDRC&#10;BTS MCO"></textarea></label>
    <label>Lieu / campus <small>(facultatif)</small><input id="aj-lieu"></label>
    <label>Mail reçu le <input type="date" id="aj-date" value="${versInput(aujourdhui())}"></label>
    <div class="pop-btns"><button class="btn" id="aj-ok">Ajouter</button><button class="btn gris" id="aj-annul">Annuler</button></div>`;
  placer(pop, null);
  const champ = document.getElementById(etab ? "aj-forms" : "aj-etab"); if (champ) champ.focus();
  const annul = document.getElementById("aj-annul"); if (annul) annul.addEventListener("click", fermerPop);
  const ok = document.getElementById("aj-ok");
  if (ok) ok.addEventListener("click", async () => {
    const v = id => { const el = document.getElementById(id); return el ? el.value : ""; };
    const e = v("aj-etab").trim(), forms = v("aj-forms").split(/\n|;/).map(x => x.trim()).filter(Boolean);
    if (!e || !forms.length) { alert("Indiquez l'établissement et au moins une formation."); return; }
    const lieu = v("aj-lieu").trim(), date = depuisInput(v("aj-date")) || aujourdhui();
    fermerPop(); ouverts.add(norm(e));
    await ajouter(forms.map(f => ({ Etablissement: e, Formation: f, Lieu: lieu || null, Mail_recu: date })));
  });
}

// Prépare dans la messagerie (Thunderbird…) le mail avec les liens des fiches, puis coche « Lien envoyé »
function preparerMail(etab, idsChoisis, ancre) {
  const k = norm(etab);
  const candidats = ROWS.filter(r => norm(r.Etablissement) === k && !r.Lien_envoye && !ficheDe(r) && !(r.Origine && !r.Mail_recu) && r.Publiee !== "Publiée");
  const choisis = new Set(idsChoisis && idsChoisis.length ? idsChoisis : candidats.map(r => r.id));
  const email = (ROWS.find(r => norm(r.Etablissement) === k && r.Contact_email) || {}).Contact_email || "";
  const pop = nouvellePop("pop-large");
  if (!DEMO && !PARAM.URL_formulaire) {
    pop.innerHTML = `<b>Envoyer la fiche — ${esc(etab)}</b><p class="rien">Le formulaire n'est pas encore publié : page « Formulaire fiche » → Publier,
      puis collez son adresse dans la page « Paramètres ». Les liens pré-remplis pourront alors être envoyés.</p>
      <div class="pop-btns"><button class="btn gris" id="m-date">J'ai déjà envoyé le lien autrement : noter la date</button></div>`;
    placer(pop, ancre);
    const d = document.getElementById("m-date");
    if (d) d.addEventListener("click", async () => { fermerPop(); await bulkMaj([...choisis], { Lien_envoye: aujourdhui() }); });
    return;
  }
  pop.innerHTML = `<b>Envoyer la fiche de renseignement — ${esc(etab)}</b>
    <label>Adresse mail de l'établissement <input id="m-email" type="email" value="${esc(email)}" placeholder="contact@etablissement.fr"></label>
    <div><span class="rien">Formations à inclure (une fiche par formation, déjà pré-remplie) :</span>
      ${candidats.map(r => `<label class="case"><input type="checkbox" value="${r.id}" ${choisis.has(r.id) ? "checked" : ""}> ${esc(r.Formation)}</label>`).join("")}</div>
    <div class="pop-btns"><button class="btn" id="m-ok">✉ Préparer le mail</button><button class="btn gris" id="m-date">Déjà envoyé autrement : noter la date</button></div>
    <p class="rien">Le mail s'ouvre dans votre messagerie, prêt à partir : relisez-le et cliquez « Envoyer ». L'étape « Lien envoyé » est cochée à aujourd'hui.</p>`;
  placer(pop, ancre);
  const ids = () => [...pop.querySelectorAll("input[type=checkbox]:checked")].map(x => Number(x.value));
  const ok = document.getElementById("m-ok"), dt = document.getElementById("m-date");
  if (dt) dt.addEventListener("click", async () => { const l = ids(); fermerPop(); if (l.length) await bulkMaj(l, { Lien_envoye: aujourdhui() }); });
  if (ok) ok.addEventListener("click", async () => {
    const l = ids(), el = document.getElementById("m-email"), adr = el ? el.value.trim() : "";
    if (!l.length) { alert("Cochez au moins une formation."); return; }
    const rows = l.map(id => ROWS.find(r => r.id === id));
    const lien = r => r.Lien_fiche || (PARAM.URL_formulaire || "") + "?Code=" + encodeURIComponent(r.Code || "");
    const objet = `Référencement Parcoursup en apprentissage - fiche de renseignement - ${etab}`;
    const corps = `Bonjour,

Pour donner suite à votre demande de référencement sur Parcoursup, merci de compléter la fiche de renseignement en ligne, une fiche par formation, en utilisant les liens ci-dessous (le nom de l'établissement et la formation sont déjà renseignés) :

${rows.map(r => "- " + r.Formation + " :\n  " + lien(r)).join("\n\n")}

Nous restons à votre disposition pour toute question.

Cordialement,
SAIO - Académie de Bordeaux`;
    const a = document.createElement("a");
    a.href = "mailto:" + encodeURIComponent(adr) + "?subject=" + encodeURIComponent(objet) + "&body=" + encodeURIComponent(corps);
    a.target = "_blank"; a.rel = "noopener";
    document.body.appendChild(a); a.click(); a.remove();
    fermerPop();
    await bulkMaj(l, { Lien_envoye: aujourdhui(), ...(adr ? { Contact_email: adr } : {}) });
  });
}

async function bulkMaj(ids, champs) {
  if (DEMO) { ROWS.forEach(r => { if (ids.includes(r.id)) Object.assign(r, champs); }); rendre(); return; }
  const cols = {};
  for (const k of Object.keys(champs)) cols[k] = ids.map(() => champs[k]);
  await actions([["BulkUpdateRecord", "Suivi", ids, cols]]);
  await charger();
}

async function copierLien(bouton, id) {
  const r = ROWS.find(x => x.id === id);
  const lien = r && r.Lien_fiche;
  const pop = nouvellePop();
  if (!lien) {
    pop.innerHTML = `<b>Lien pas encore disponible</b><p class="rien">Publiez d'abord le formulaire (page « Formulaire fiche » → Publier),
      puis collez son adresse dans la page « Paramètres ».</p>`;
    placer(pop, bouton); return;
  }
  let copie = false;
  try { await navigator.clipboard.writeText(lien); copie = true; } catch (e) { copie = false; }
  pop.innerHTML = `<b>Lien de la fiche — ${esc(r.Formation)}</b>
    <p class="rien">${copie ? "✓ Lien copié : collez-le dans votre mail (Ctrl+V)." : "Sélectionnez le lien ci-dessous et copiez-le (Ctrl+C)."}</p>
    <input id="pop-lien" value="${esc(lien)}" readonly>
    ${!r.Lien_envoye ? `<div class="pop-btns"><button class="btn" id="pop-envoye">Marquer « lien envoyé » aujourd'hui</button></div>` : ""}`;
  placer(pop, bouton);
  const inp = document.getElementById("pop-lien"); if (inp) { inp.focus(); inp.select(); }
  const env = document.getElementById("pop-envoye");
  if (env) env.addEventListener("click", async () => { fermerPop(); await maj(id, { Lien_envoye: aujourdhui() }); });
}

// ------------------------------------------------------------------ consultation de la fiche

function voirFiche(id) {
  const r = ROWS.find(x => x.id === id);
  const f = construire([r])[0].formations[0];
  const fi = f.fiche, c = f.cat;
  if (!fi) return;
  const ok = b => b ? `<span class="ok">✓</span>` : `<span class="ko">✗</span>`;
  const controles = [
    ["SIRET valide", siretValide(fi.Siret)],
    ["UAI lieu valide", uaiValide(fi.UAI_lieu)], ["UAI formateur valide", uaiValide(fi.UAI_formateur)],
    ["UAI gestionnaire valide", uaiValide(fi.UAI_gestionnaire)],
    ["Code postal dans l'académie (24, 33, 40, 47, 64)", ["24", "33", "40", "47", "64"].includes(String(fi.Code_postal || "").slice(0, 2))],
    ["Certifié Qualiopi (avec n°)", (fi.Certification || []).includes("Qualiopi") && !!fi.Num_Qualiopi],
    ["Référencée Carif-Oref (déclaré)", fi.Referencee_Carif_Oref === "Oui"],
    ["Attestation cochée", !!fi.Attestation],
  ];
  const comp = c ? [
    ["SIRET", fi.Siret, c.Siret_formateur + (c._sg !== c._sf ? " / gest. " + c.Siret_gestionnaire : ""), [c._sf, c._sg].includes(chiffres(fi.Siret).padStart(14, "0"))],
    ["UAI formateur", fi.UAI_formateur, c.UAI_validee, code(fi.UAI_formateur) === c._uai],
    ["Code RNCP", fi.Code_RNCP, c.Code_RNCP, chiffres(fi.Code_RNCP) === c._rncp],
    ["Code diplôme", fi.Code_diplome, c.Code_scolarite, code(fi.Code_diplome).padStart(8, "0") === c._cfd],
    ["Code postal", fi.Code_postal, c.CP, String(fi.Code_postal || "").slice(0, 5) === String(c.CP || "").slice(0, 5)],
  ] : null;
  const champ = (l, v) => `<div class="champ"><span>${esc(l)}</span><b>${esc(Array.isArray(v) ? v.filter(x => x !== "L").join(", ") : v === true ? "Oui" : v === false ? "Non" : v ?? "")}</b></div>`;
  const pop = nouvellePop("pop-fiche");
  pop.innerHTML = `<div class="fiche-tete"><b>Fiche de renseignement — ${esc(r.Formation)}</b><button class="btn gris petit" id="pop-fermer">Fermer</button></div>
    <p class="rien">${esc(fi.Organisme)} · reçue le ${fi.Recu_le ? new Date(fi.Recu_le * 1000).toLocaleString("fr-FR") : "?"} · code ${esc(fi.Code)}</p>
    <div class="fiche-grille">
      <div><h3>Organisme</h3>${champ("Nom", fi.Organisme)}${champ("Appellation", fi.Appellation)}${champ("SIRET", fi.Siret)}
        ${champ("Certification", fi.Certification)}${champ("N° Qualiopi", fi.Num_Qualiopi)}${champ("Autre certification", fi.Certification_autre)}</div>
      <div><h3>Formation</h3>${champ("Libellé", fi.Libelle_formation)}${champ("Référencée Carif-Oref", fi.Referencee_Carif_Oref)}
        ${champ("Statut", fi.Statut)}${champ("Places (mixité)", fi.Places_mixite)}${champ("Durée", fi.Duree)}${champ("Précision durée", fi.Duree_precision)}
        ${champ("Code diplôme", fi.Code_diplome)}${champ("Code RNCP", fi.Code_RNCP)}</div>
      <div><h3>Lieu et UAI</h3>${champ("UAI lieu", fi.UAI_lieu)}${champ("UAI formateur", fi.UAI_formateur)}${champ("UAI gestionnaire", fi.UAI_gestionnaire)}
        ${champ("Adresse", fi.Lieu_adresse)}${champ("Commune", fi.Commune)}${champ("Code postal", fi.Code_postal)}${champ("Signataire", fi.Signataire)}</div>
    </div>
    <h3>Contrôles automatiques</h3><ul class="controles">${controles.map(([l, b]) => `<li>${ok(b)} ${esc(l)}</li>`).join("")}</ul>
    <h3>Comparaison avec l'export Carif-Oref</h3>
    ${comp ? `<table class="comp"><tr><th></th><th>Fiche</th><th>Export Carif-Oref</th><th></th></tr>
      ${comp.map(([l, a, b, eg]) => `<tr><td>${esc(l)}</td><td>${esc(a)}</td><td>${esc(b)}</td><td>${ok(eg)}</td></tr>`).join("")}</table>
      <p class="rien">Formation trouvée : ${esc(c.Libelle_formation)} — ${esc(c.Formateur_RS)} (${esc(c.Ville)}) · catalogue général : ${esc(c.Statut_catalogue)}</p>`
      : `<p class="rien">${CATALOGUE.length ? "Formation non trouvée dans l'export : vérifier les codes (SIRET, UAI, RNCP, code diplôme) ou la déclaration au Carif-Oref." : "Aucun export Carif-Oref importé."}</p>`}
    <h3>Ma vérification</h3>
    <div class="pop-btns">
      <button class="btn ${r.UAI === "Conforme" ? "vert" : "gris"}" data-v="UAI|Conforme">UAI conforme</button>
      <button class="btn ${r.UAI === "À corriger" ? "rouge" : "gris"}" data-v="UAI|À corriger">UAI à corriger</button>
      <button class="btn ${r.RNCP === "Conforme" ? "vert" : "gris"}" data-v="RNCP|Conforme">RNCP conforme</button>
      <button class="btn ${r.RNCP === "À corriger" ? "rouge" : "gris"}" data-v="RNCP|À corriger">RNCP à corriger</button>
    </div>`;
  placer(pop, null);
  const fer = document.getElementById("pop-fermer"); if (fer) fer.addEventListener("click", fermerPop);
  pop.querySelectorAll("[data-v]").forEach(b => b.addEventListener("click", async () => {
    const [col, v] = b.dataset.v.split("|"), champs = { [col]: v };
    if (v === "À corriger") { const t = prompt("Que faut-il corriger ?", r.Commentaire || ""); if (t !== null && t.trim()) champs.Commentaire = t.trim(); }
    await maj(id, champs);
    voirFiche(id);
  }));
}

// ------------------------------------------------------------------ import de l'export Carif-Oref

const COLS_EXPORT = { "CLE MINISTERES EDUCATIFS": "Cle_ME", "Catalogue Général National": "Statut_catalogue", "Libelle_formation": "Libelle_formation",
  "Gestionnaire_RS": "Gestionnaire_RS", "Siret_gestionnaire": "Siret_gestionnaire", "Formateur_RS": "Formateur_RS", "Siret_formateur": "Siret_formateur",
  "UAI validée référentiel": "UAI_validee", "Code_RNCP": "Code_RNCP", "Code_scolarite": "Code_scolarite", "Annee_de_rentree": "Annee_de_rentree",
  "Adresse_de_formation": "Adresse_de_formation", "CP": "CP", "Ville": "Ville", "Ref_formation_Carif": "Ref_formation_Carif", "Date_MAJ": "Date_MAJ" };

function texteCellule(v) {
  if (v === null || v === undefined) return "";
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : String(v);
  const s = String(v).trim();
  return s === "NULL" ? "" : s.replace(/^(\d+)\.0$/, "$1");
}

function preparerExport(lignesBrutes) {
  const best = new Map(), annees = new Map();
  for (const l of lignesBrutes) {
    if (texteCellule(l["Académie"]) !== ACADEMIE) continue;
    let cle = texteCellule(l["CLE MINISTERES EDUCATIFS"]);
    if (!cle.includes("#")) cle = "CARIF-" + texteCellule(l["Ref_formation_Carif"]);
    const an = texteCellule(l["Annee_de_rentree"]);
    if (!annees.has(cle)) annees.set(cle, new Set());
    if (an) annees.get(cle).add(an);
    if (!best.has(cle) || an > texteCellule(best.get(cle)["Annee_de_rentree"])) best.set(cle, { ...l, "CLE MINISTERES EDUCATIFS": cle });
  }
  return [...best.entries()].map(([cle, l]) => {
    const o = {};
    for (const [src, dst] of Object.entries(COLS_EXPORT)) o[dst] = texteCellule(l[src]);
    if (typeof l["Date_MAJ"] === "number") {
      const d = new Date(Math.round((l["Date_MAJ"] - 25569) * 86400000));
      o.Date_MAJ = String(d.getUTCDate()).padStart(2, "0") + "/" + String(d.getUTCMonth() + 1).padStart(2, "0") + "/" + d.getUTCFullYear();
    }
    for (const k of ["Siret_gestionnaire", "Siret_formateur"]) if (/^\d+$/.test(o[k])) o[k] = o[k].padStart(14, "0");
    if (/^\d+$/.test(o.Code_scolarite)) o.Code_scolarite = o.Code_scolarite.padStart(8, "0");
    o.Annee_de_rentree = [...annees.get(cle)].sort().join(", ");
    return o;
  });
}

async function importerExport(fichier) {
  const ban = document.getElementById("bandeaux");
  const info = t => { if (ban) ban.innerHTML = `<div class="banner">${esc(t)}</div>`; };
  try {
    info("Lecture de l'export…");
    const wb = XLSX.read(await fichier.arrayBuffer(), { type: "array" });
    const brut = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: null, raw: true });
    const rows = preparerExport(brut);
    if (!rows.length) { info("Aucune formation de l'académie de " + ACADEMIE + " dans ce fichier : est-ce bien l'export Apprentissage ?"); return; }
    if (DEMO) { CATALOGUE = rows; INDEX = null; rendre(); return; }
    info(`Import de ${rows.length} formations…`);
    const ids = CATALOGUE.map(c => c.id);
    const acts = [];
    if (ids.length) acts.push(["BulkRemoveRecord", "Catalogue", ids]);
    for (let i = 0; i < rows.length; i += 1000) {
      const part = rows.slice(i, i + 1000), cols = {};
      for (const k of Object.keys(part[0])) cols[k] = part.map(x => x[k]);
      acts.push(["BulkAddRecord", "Catalogue", part.map(() => null), cols]);
    }
    await actions(acts);
    await charger();
  } catch (e) {
    info("Échec de l'import : " + (e && e.message || e));
  }
}

// ------------------------------------------------------------------ chargement

async function charger() {
  try {
    const [s, f, c, p] = await Promise.all(["Suivi", "Fiches", "Catalogue", "Parametres"].map(t => grist.docApi.fetchTable(t).catch(() => null)));
    if (!s) throw new Error("table « Suivi » introuvable ou accès refusé");
    if (!("Contact_email" in s)) {
      await grist.docApi.applyUserActions([["AddColumn", "Suivi", "Contact_email", { type: "Text", label: "Email de contact", isFormula: false }]]);
      s.Contact_email = s.id.map(() => null);
    }
    ROWS = lignes(s); FICHES = lignes(f); CATALOGUE = lignes(c); PARAM = lignes(p)[0] || {}; INDEX = null; DEMO = false;
  } catch (e) {
    const ban = document.getElementById("bandeaux");
    if (ban) ban.innerHTML = `<div class="banner" style="background:var(--red-bg);color:var(--red)">Impossible de lire le document (${esc(e && e.message || e)}).
      Vérifiez que le widget a l'« Accès complet au document » (panneau de droite, onglet « Personnalisée »).</div>`;
    return;
  }
  rendre();
}

function demo() {
  DEMO = true;
  const j = s => Date.UTC(2026, Number(s.slice(3, 5)) - 1, Number(s.slice(0, 2))) / 1000;
  ROWS = [
    { id: 1, Code: "F-0001", Etablissement: "TALIS", Formation: "BTS MCO", Lieu: "TALIS Bordeaux", Mail_recu: j("10/10"), Lien_envoye: j("12/10"), UAI: "Conforme", RNCP: "Conforme", Publiee: "Publiée", Publiee_le: j("28/10") },
    { id: 2, Code: "F-0002", Etablissement: "TALIS", Formation: "BTS Communication", Lieu: "TALIS Bordeaux", Mail_recu: j("10/10"), Lien_envoye: j("12/10") },
    { id: 3, Code: "F-0003", Etablissement: "TALIS", Formation: "BTS NDRC", Lieu: "TALIS Bordeaux", Mail_recu: j("10/10"), Lien_envoye: j("12/10") },
    { id: 4, Code: "F-0004", Etablissement: "CAMPUS DU LAC", Formation: "BTS GPME", Mail_recu: j("29/10") },
    { id: 5, Code: "F-0005", Etablissement: "PIGIER", Formation: "BTS GPME - en apprentissage", Lieu: "PIGIER BORDEAUX (33)", Publiee: "Publiée", Origine: "Tableau initial", g_ta_cod: "34388" },
  ];
  FICHES = [
    { id: 1, Code: "F-0001", Organisme: "TALIS", Siret: "33851631300099", Libelle_formation: "BTS MCO", Code_RNCP: "RNCP38362", Code_diplome: "32031213", UAI_lieu: "0333460G", UAI_formateur: "0333460G", UAI_gestionnaire: "0333460G", Code_postal: "33000", Commune: "Bordeaux", Certification: ["L", "Qualiopi"], Num_Qualiopi: "Q-1", Referencee_Carif_Oref: "Oui", Statut: "Groupe autonome", Duree: "2 ans", Attestation: true, Signataire: "S. Martin", Recu_le: j("15/10") },
    { id: 2, Code: "F-0003", Organisme: "TALIS", Siret: "33851631300099", Libelle_formation: "BTS NDRC", Code_RNCP: "38368", Code_diplome: "32031212", UAI_lieu: "0333460G", UAI_formateur: "0333233K", UAI_gestionnaire: "0333460G", Code_postal: "33000", Commune: "Bordeaux", Certification: ["L", "Qualiopi"], Num_Qualiopi: "", Referencee_Carif_Oref: "Oui", Statut: "Groupe autonome", Duree: "2 ans", Attestation: true, Signataire: "S. Martin", Recu_le: j("16/10") },
  ];
  CATALOGUE = [
    { Cle_ME: "x1", Statut_catalogue: "Publiée", Libelle_formation: "BTS Management Commercial Opérationnel", Formateur_RS: "TALIS BORDEAUX", Siret_formateur: "33851631300099", Siret_gestionnaire: "33851631300099", UAI_validee: "0333460G", Code_RNCP: "38362", Code_scolarite: "32031213", CP: "33000", Ville: "Bordeaux", Date_MAJ: "02/11/2026" },
    { Cle_ME: "x2", Statut_catalogue: "Publiée", Libelle_formation: "BTS Négociation et digitalisation de la relation client", Formateur_RS: "TALIS BORDEAUX", Siret_formateur: "33851631300099", Siret_gestionnaire: "33851631300099", UAI_validee: "0333460G", Code_RNCP: "38368", Code_scolarite: "32031212", CP: "33000", Ville: "Bordeaux", Date_MAJ: "02/11/2026" },
  ];
  PARAM = { URL_formulaire: "https://exemple/forms/abc" };
  ROWS.forEach(r => { r.Lien_fiche = PARAM.URL_formulaire + "?Code=" + r.Code; });
  INDEX = null;
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
    const nouv = document.getElementById("nouveau");
    if (nouv) nouv.addEventListener("click", ev => { ev.stopPropagation(); ouvrirAjout(""); });
    const imp = document.getElementById("importer"), fic = document.getElementById("fichier-export");
    if (imp && fic) {
      imp.addEventListener("click", () => fic.click());
      fic.addEventListener("change", () => { if (fic.files && fic.files[0]) importerExport(fic.files[0]); fic.value = ""; });
    }
    document.addEventListener("click", () => fermerPop());
    document.addEventListener("keydown", ev => { if (ev.key === "Escape") fermerPop(); });

    if (window.grist && window.self !== window.top) {
      grist.ready({ requiredAccess: "full" });
      let t = null;
      grist.onRecords(() => { clearTimeout(t); t = setTimeout(charger, 200); });
      charger();
      setInterval(charger, 60000);
    } else {
      demo();
    }
  });
}

if (typeof module !== "undefined") module.exports = { construire, analyser, preparerExport, trouverCatalogue };
