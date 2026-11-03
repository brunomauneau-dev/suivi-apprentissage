// Widget Grist « Suivi des référencements en apprentissage »
// Tables : Suivi (une ligne par formation demandée), Fiches (formulaire en ligne), Catalogue (export Carif-Oref), Parametres.
// 7 étapes : mail reçu → lien envoyé → fiche reçue → UAI → RNCP → Carif-Oref (auto, export) → catalogue national (manuel).

const JOUR = 86400;
const DELAI_FICHE = 10;    // jours après l'envoi du lien avant de relancer pour la fiche
const DELAI_RELANCE = 7;   // une relance masque l'établissement pendant ce nombre de jours
const ACADEMIE = "Bordeaux";
// Campagne Parcoursup en cours : de septembre N à août N+1 on prépare la rentrée N+1
function rentreeCible() { const d = new Date(); return d.getMonth() >= 8 ? d.getFullYear() + 1 : d.getFullYear(); }

// Problèmes de la formation dans l'export Carif-Oref qui empêchent la publication sur Parcoursup
// Une session « de rentrée » doit démarrer en début d'année scolaire : entre ces deux dates de l'année cible (mois 1 à 12)
const RENTREE_DU = [6, 1], RENTREE_AU = [12, 31];
function fenetreRentree() { const a = rentreeCible(); return [Date.UTC(a, RENTREE_DU[0] - 1, RENTREE_DU[1]), Date.UTC(a, RENTREE_AU[0] - 1, RENTREE_AU[1])]; }
function texteFenetre() { const [d, f] = fenetreRentree(), x = t => new Date(t).toLocaleDateString("fr-FR", { timeZone: "UTC" }); return `entre le ${x(d)} et le ${x(f)}`; }
function debutsSessions(c) {
  return String((c && c.Debuts_sessions) || "").split(/[,;\s]+/).map(t => /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(t)).filter(Boolean)
    .map(m => ({ txt: m[0], t: Date.UTC(+m[3], +m[2] - 1, +m[1]) }));
}
// true / false selon les dates de début de session (ou l'année de rentrée si l'export n'a pas les dates), null si inconnu
function rentreeOk(c) {
  const d = debutsSessions(c);
  if (d.length) { const [a, b] = fenetreRentree(); return d.some(x => x.t >= a && x.t <= b); }
  const ans = String((c && c.Annee_de_rentree) || "").split(/[,;\s]+/).filter(Boolean);
  return ans.length ? ans.includes(String(rentreeCible())) : null;
}
function texteRentree(c) {
  const d = debutsSessions(c);
  return d.length ? "débuts de session : " + d.map(x => x.txt).join(", ") : "rentrées : " + ((c && c.Annee_de_rentree) || "?");
}
function problemesCarif(c) {
  if (!c) return [];
  const pb = [], cible = rentreeCible();
  if (/archiv/i.test(c.Etat_diplome || "")) pb.push("diplôme archivé (code expiré) : mise à conformité RNCP / code diplôme");
  if (rentreeOk(c) === false) {
    const d = debutsSessions(c);
    pb.push(`pas de session à la rentrée ${cible} (${d.length ? "dernière : " + d[d.length - 1].txt : texteRentree(c)}) → dates à mettre à jour`);
  }
  return pb;
}
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
    c._torg = jetons(c.Formateur_RS, c.Gestionnaire_RS); c._tform = jetons(c.Libelle_formation, c.Diplome || "");
    c._tlieu = jetons(c.Formateur_RS, c.Ville, c.Adresse_de_formation);
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

// Formations historiques (déjà sur Parcoursup, sans fiche ni codes) : rapprochées une fois pour toutes d'une formation
// de l'export (colonne Suivi.Cle_carif = clé de l'export, ou « ABSENTE »), automatiquement quand c'est sûr, sinon à la main.
const MOTS_VIDES = new Set("de du des la le les et en a l d au aux pour par sur dans bts formation formations professionnelle professionnel services production agricole titre apprentissage alternance contrat bac specialite option campus diplome niveau ecole ecoles management commerce cfa site".split(" "));
function jetons(...txt) {
  return new Set(txt.join(" ").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().split(/[^a-z0-9]+/).filter(t => t.length > 2 && !MOTS_VIDES.has(t)));
}
const part = (a, b) => { if (!a.size) return 0; let n = 0; for (const t of a) if (b.has(t)) n++; return n / a.size; };
const estHistorique = r => !!(r.Origine && !r.Mail_recu && !ficheDe(r));

function catalogueLie(r) {
  if (!r.Cle_carif || r.Cle_carif === "ABSENTE") return null;
  return CATALOGUE.find(c => c.Cle_ME === r.Cle_carif) || null;
}

// Formations de l'export qui peuvent correspondre, les plus probables d'abord ; sur = un seul candidat nettement en tête
function candidatsHistorique(r) {
  if (!INDEX) indexer();
  const etab = jetons(r.Etablissement);
  const intitule = String(r.Formation || "").replace(/\(([^)]*)\)\s*(- en apprentissage)?\s*$/i, "");
  const precision = jetons(r.Lieu || "", (String(r.Formation || "").match(/\(([^)]*)\)\s*(- en apprentissage)?\s*$/i) || [])[1] || "");
  const form = jetons(intitule);
  const liste = [];
  for (const c of CATALOGUE) {
    const se = part(etab, c._torg);
    if (se < 0.5) continue;
    const sf = part(form, c._tform);
    if (sf < 0.5) continue;
    const sl = precision.size ? part(precision, c._tlieu) : 0;
    liste.push({ c, score: se + sf + sl + (c.Statut_catalogue === "Publiée" ? 0.1 : 0), sf });
  }
  liste.sort((a, b) => b.score - a.score);
  const sur = liste.length > 0 && liste[0].sf >= 0.6 && (liste.length === 1 || liste[1].score < liste[0].score - 0.25);
  return { liste, sur };
}

// Rapproche automatiquement les cas sûrs (une seule fois par chargement)
let RAPPRO_FAIT = false;
async function rapprocherAuto() {
  if (RAPPRO_FAIT || !CATALOGUE.length) return false;
  RAPPRO_FAIT = true;
  const ids = [], cles = [];
  for (const r of ROWS) {
    if (r.Cle_carif || !estHistorique(r)) continue;
    const { liste, sur } = candidatsHistorique(r);
    if (sur) { ids.push(r.id); cles.push(liste[0].c.Cle_ME); }
  }
  if (!ids.length) return false;
  if (DEMO) { ids.forEach((id, i) => { ROWS.find(x => x.id === id).Cle_carif = cles[i]; }); return true; }
  await actions([["BulkUpdateRecord", "Suivi", ids, { Cle_carif: cles }]]);
  return true;
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
    cat ? (problemesCarif(cat).length ? etat("ko") : etat("done")) : (fiche && CATALOGUE.length ? etat("ko") : etat("todo")),
    r.Publiee === "Publiée" ? etat("done", dateCourte(r.Publiee_le)) : etat("todo"),
  ];
  const base = { e, fiche, cat };
  // déjà ouverte sur Parcoursup : le circuit complet a été fait ; à chaque campagne on revérifie seulement l'export Carif-Oref
  if (r.Origine && !r.Mail_recu && !fiche) {
    const lie = catalogueLie(r), cible = rentreeCible();
    const pb = lie ? problemesCarif(lie) : [];
    const e6 = !CATALOGUE.length ? etat("todo") : r.Cle_carif === "ABSENTE" || pb.length ? etat("ko") : lie ? etat("done") : etat("todo");
    const h = { ...base, cat: lie, historique: true, e: ETAPES.map((x, i) => i === 5 ? e6 : etat("done")) };
    const pub = r.Publiee_le ? new Date(r.Publiee_le * 1000).toLocaleDateString("fr-FR", { timeZone: "UTC" }) : "";
    const num = `Ouverte en ${cible - 1} sur Parcoursup${pub ? " (publiée le " + pub + ")" : ""}${r.g_ta_cod ? " · n° " + r.g_ta_cod : ""}`;
    if (!CATALOGUE.length) return { ...h, cat_: "attente", next: { cls: "warn", titre: "Revérification " + cible, txt: "Importer l'export Carif-Oref pour vérifier" } };
    if (r.Cle_carif === "ABSENTE") return { ...h, cat_: "nonpub", next: { cls: "wait", titre: "Non publiable pour " + cible,
      txt: "Absente de l'export Carif-Oref" } };
    if (!lie) return { ...h, rappro: true, cat_: "saio", next: { cls: "warn", titre: "À faire au SAIO", txt: "Retrouver la formation dans l'export Carif-Oref" } };
    if (pb.length) return { ...h, cat_: "nonpub", next: { cls: "wait", titre: "Non publiable pour " + cible, txt: pb.join(" · ").replace(/ → dates à mettre à jour/g, "") } };
    return { ...h, cat_: "parcoursup", next: { cls: "ok", titre: "Publiable", txt: `${num} · publiable pour la rentrée ${cible}` } };
  }
  if (r.Publiee === "Publiée") return { ...base, cat_: "publie", next: { cls: "ok", titre: "Terminé", txt: "Publiée au catalogue national" } };
  if (e[3].s === "ko" || e[4].s === "ko") {
    const statut = v => v === "Conforme" ? "conforme" : v === "À corriger" ? "à corriger" : "à vérifier";
    return { ...base, cat_: "relance", next: { cls: "ko", titre: "À corriger par l'établissement", txt: `UAI : ${statut(r.UAI)} · RNCP : ${statut(r.RNCP)}` } };
  }
  if (!r.Lien_envoye && !ficheDate) return { ...base, cat_: "saio", next: { cls: "ko", titre: "À faire au SAIO", txt: "Envoyer le lien de la fiche" } };
  if (!ficheDate) {
    const j = Math.floor((maintenant - r.Lien_envoye) / JOUR);
    return j >= DELAI_FICHE
      ? { ...base, cat_: "relance", next: { cls: "ko", titre: "À relancer", txt: `Fiche non reçue (lien envoyé il y a ${j} j)` } }
      : { ...base, cat_: "attente", next: { cls: "warn", titre: "Fiche attendue", txt: `Lien envoyé il y a ${j} j` } };
  }
  if (e[3].s === "todo") return { ...base, cat_: "saio", next: { cls: "warn", titre: "À faire au SAIO", txt: "Vérifier l'UAI (voir la fiche)" } };
  if (e[4].s === "todo") return { ...base, cat_: "saio", next: { cls: "warn", titre: "À faire au SAIO", txt: "Vérifier le RNCP (voir la fiche)" } };
  if (e[5].s === "ko") return { ...base, cat_: "relance", next: { cls: "ko", titre: "À corriger dans le Carif-Oref",
    txt: cat ? problemesCarif(cat).join(" · ") : "Absente de l'export Carif-Oref : à déclarer auprès du Carif-Oref" } };
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
  const ordre = { relance: 0, saio: 1, attente: 2, nonpub: 3, publie: 4, parcoursup: 4 };
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
let onglet = "demandes";
try { onglet = localStorage.getItem("suivi-onglet") === "ouvertes" ? "ouvertes" : "demandes"; } catch (e) { /* stockage indisponible */ }
const PASTILLE = { relance: ["ko", "À relancer"], saio: ["warn", "À faire SAIO"], attente: ["wait", "En attente"], publie: ["ok", "Publiée"], parcoursup: ["ok", "Publiable"], nonpub: ["wait", "Non publiable"] };
const CHIPS = {
  demandes: [["tous", "Tous"], ["relance", "À relancer"], ["saio", "À faire SAIO"], ["attente", "En attente"], ["publie", "Publiées"]],
  ouvertes: [["tous", "Tous"], ["parcoursup", "Publiables"], ["nonpub", "Non publiables"], ["saio", "À retrouver dans l'export"]],
};
const ouverts = new Set();

function rendre() {
  const zone = document.getElementById("liste");
  if (!zone) return;
  const maintenant = aujourdhui();
  const tousGroupes = construire(ROWS, maintenant);
  const toutes = tousGroupes.flatMap(g => g.formations);
  const dansOnglet = f => !!f.historique === (onglet === "ouvertes");
  const groupes = tousGroupes.map(g => ({ ...g, formations: g.formations.filter(dansOnglet) })).filter(g => g.formations.length);
  const n = c => toutes.filter(f => dansOnglet(f) && f.cat_ === c).length;

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
  if (kpis) kpis.innerHTML = onglet === "ouvertes" ? `
    <div class="kpi ok"><b>${n("parcoursup")}</b><span>publiables ${rentreeCible()}</span></div>
    <div class="kpi"><b>${n("nonpub")}</b><span>non publiables en l'état</span></div>
    <div class="kpi warn"><b>${n("saio")}</b><span>à retrouver dans l'export</span></div>` : `
    <div class="kpi ko"><b>${relances.filter(x => !x.masque).length}</b><span>établissements à relancer</span></div>
    <div class="kpi warn"><b>${n("saio")}</b><span>à faire au SAIO</span></div>
    <div class="kpi"><b>${n("attente")}</b><span>en attente</span></div>
    <div class="kpi ok"><b>${n("publie") + n("parcoursup")}</b><span>terminées</span></div>`;
  const ban = document.getElementById("bandeaux");
  if (ban) ban.innerHTML = (DEMO ? `<div class="demo">Mode démonstration : données fictives (le widget n'est pas ouvert dans Grist).</div>` : "") +
    (!DEMO && !PARAM.URL_formulaire ? `<div class="banner">Le formulaire de fiche n'est pas encore publié : page « Formulaire fiche » → Publier, puis collez son adresse dans la page « Paramètres ». Les liens à envoyer se créeront alors tout seuls.</div>` : "");

  panneaux(groupes, relances);

  const cible = rentreeCible();
  const nDem = toutes.filter(f => !f.historique).length, nOuv = toutes.filter(f => f.historique).length;
  const aRel = h => toutes.filter(f => !!f.historique === h && f.cat_ === "relance").length, aSaio = h => toutes.filter(f => !!f.historique === h && f.cat_ === "saio").length;
  const badges = h => h
    ? (aSaio(h) ? `<em class="b-warn">${aSaio(h)} à retrouver</em>` : "")
    : (aRel(h) ? `<em class="b-ko">${aRel(h)} à relancer</em>` : "") + (aSaio(h) ? `<em class="b-warn">${aSaio(h)} à faire</em>` : "");
  const ong = document.getElementById("onglets");
  if (ong) {
    ong.innerHTML = `<button class="onglet${onglet === "demandes" ? " on" : ""}" data-onglet="demandes">Nouvelles demandes <span>${nDem}</span>${badges(false)}</button>
      <button class="onglet${onglet === "ouvertes" ? " on" : ""}" data-onglet="ouvertes">Formations ouvertes en ${cible - 1} — revérification ${cible} <span>${nOuv}</span>${badges(true)}</button>`;
    ong.querySelectorAll("[data-onglet]").forEach(b => b.addEventListener("click", () => {
      onglet = b.dataset.onglet; filtre = "tous";
      try { localStorage.setItem("suivi-onglet", onglet); } catch (e) { /* stockage indisponible */ }
      rendre();
    }));
  }
  const chips = document.getElementById("chips");
  if (chips) {
    if (!CHIPS[onglet].some(([k]) => k === filtre)) filtre = "tous";
    chips.innerHTML = CHIPS[onglet].map(([k, l]) => `<button class="chip${filtre === k ? " on" : ""}" data-f="${k}">${l}</button>`).join("");
    chips.querySelectorAll(".chip").forEach(c => c.addEventListener("click", () => { filtre = c.dataset.f; rendre(); }));
  }
  const q = norm(recherche);
  const garde = (g, f) => (filtre === "tous" || f.cat_ === filtre) && (!q || norm(g.nom).includes(q) || norm(f.r.Formation).includes(q) || norm(f.r.Lieu).includes(q));
  let html;
  if (onglet === "ouvertes") {
    const ordre = { saio: 0, attente: 1, nonpub: 2, relance: 2, parcoursup: 3, publie: 3 };
    html = groupes.map(g => {
      const fs = g.formations.filter(f => garde(g, f))
        .sort((a, b) => ordre[a.cat_] - ordre[b.cat_] || String(a.r.Formation).localeCompare(String(b.r.Formation)));
      if (!fs.length) return "";
      const tot = g.formations.length, c = k => g.formations.filter(f => f.cat_ === k).length, pl = k => k > 1 ? "s" : "";
      const ok = c("parcoursup"), np = c("nonpub"), ar = c("saio");
      const tags = [ar ? `<span class="tag warn">${ar} à retrouver</span>` : "", np ? `<span class="tag wait">${np} non publiable${pl(np)}</span>` : "",
        ok ? `<span class="tag ok">${ok} publiable${pl(ok)}</span>` : ""].join("");
      const seg = (k, col) => k ? `<i style="width:${100 * k / tot}%;background:${col}"></i>` : "";
      const ouvert = ouverts.has(g.cle) || !!q;
      return `<section class="etab${ouvert ? " open" : ""}" data-cle="${esc(g.cle)}">
        <div class="etab-head"><span class="chev">▶</span>
          <div class="etab-name"><b>${esc(g.nom)}</b> <button class="btn-lien" data-renom-etab="${esc(g.nom)}" title="Renommer l'établissement">✎ renommer</button><span>${tot} formation${pl(tot)} ouverte${pl(tot)} en ${cible - 1}</span></div>
          <div><div class="progress">${seg(ok, "var(--green)")}${seg(np, "#b9bec8")}${seg(ar, "#f5a000")}</div>
            <div class="progress-label">${ok} / ${tot} publiable${pl(ok)} pour ${cible}</div></div>
          <div class="tags">${tags}</div></div>
        <div class="forms"><table class="liste-ouvertes">
          <tr><th>Formation</th><th>Retrouvée dans l'export</th><th>Diplôme</th><th>Session rentrée ${cible}</th><th>Statut</th></tr>
          ${fs.map(f => ligneOuverte(g, f)).join("")}</table></div>
      </section>`;
    }).join("");
  } else {
    html = groupes.map(g => {
      const toutesG = g.formations.filter(f => !f.historique);
      const fs = toutesG.filter(f => garde(g, f));
      if (!fs.length) return "";
      const tot = toutesG.length, c = k => toutesG.filter(f => f.cat_ === k).length;
      const rel = c("relance"), sai = c("saio"), att = c("attente"), fin = c("publie");
      const pl = k => k > 1 ? "s" : "";
      const tags = [rel ? `<span class="tag ko">${rel} à relancer</span>` : "", sai ? `<span class="tag warn">${sai} à faire SAIO</span>` : "",
        att ? `<span class="tag wait">${att} en attente</span>` : "", fin ? `<span class="tag ok">${fin} publiée${pl(fin)}</span>` : ""].join("");
      const ouvert = ouverts.has(g.cle) || !!q;
      const aEnvoyer = toutesG.filter(f => !f.r.Lien_envoye && !f.fiche && f.cat_ !== "publie").length;
      return `<section class="etab${ouvert ? " open" : ""}" data-cle="${esc(g.cle)}">
        <div class="etab-head"><span class="chev">▶</span>
          <div class="etab-name"><b>${esc(g.nom)}</b> <button class="btn-lien" data-renom-etab="${esc(g.nom)}" title="Renommer l'établissement">✎ renommer</button><span>${tot} formation${pl(tot)}</span>
            <span class="contact">${contactHtml(contactDe(g.nom))} <button class="btn-lien" data-contact="${esc(g.nom)}">✎ contact</button></span></div>
          <div class="tags">${tags}</div></div>
        <div class="forms"><table class="liste-demandes">
          <tr><th>Formation</th><th>Statut</th><th>Raison</th><th>Étapes</th><th></th></tr>
          ${fs.map(ligneFormation).join("")}</table>
          <div class="ajout-ligne">${aEnvoyer ? `<button class="btn petit" data-mail="${esc(g.nom)}">✉ Envoyer ${aEnvoyer > 1 ? "les " + aEnvoyer + " fiches" : "la fiche"} par mail</button> &nbsp; ` : ""}
            <button class="btn-lien" data-ajout="${esc(g.nom)}">+ Ajouter une formation pour ${esc(g.nom)}</button></div></div>
      </section>`;
    }).join("");
  }
  zone.innerHTML = html || `<div class="empty">${(onglet === "ouvertes" ? nOuv : nDem) ? "Aucune formation ne correspond."
    : onglet === "ouvertes" ? "Aucune formation ouverte les années précédentes." : "Aucune nouvelle demande. Cliquez sur « + Nouvelle demande »."}</div>`;
  brancher(zone);
}

function aRelancer(groupes, maintenant) {
  const out = [];
  for (const g of groupes) {
    const ls = g.formations.filter(f => motifRelance(f));
    if (!ls.length) continue;
    const derniere = Math.max(0, ...ls.map(f => f.r.Relance_le || 0));
    out.push({ nom: g.nom, lignes: ls.map(f => ({ formation: f.r.Formation, motif: motifRelance(f), com: f.r.Commentaire })), ids: ls.map(f => f.r.id),
      derniere, masque: derniere && (maintenant - derniere) / JOUR < DELAI_RELANCE });
  }
  return out.sort((a, b) => a.masque - b.masque || a.nom.localeCompare(b.nom));
}

let RELANCES_TOUTES = false;

// Motif de relance en quelques mots (pour le résumé par établissement)
function motifsCourts(m) {
  const k = [];
  if (/Fiche non reçue/i.test(m)) k.push("fiche non reçue");
  if (/UAI : à corriger/.test(m)) k.push("UAI à corriger");
  if (/RNCP : à corriger/.test(m)) k.push("RNCP à corriger");
  if (/archiv/i.test(m)) k.push("diplôme archivé");
  if (/pas de session|aucune session/i.test(m)) k.push("dates de session " + rentreeCible());
  if (/Absente/i.test(m)) k.push("absente de l'export");
  return k.length ? k : [m.length > 40 ? m.slice(0, 40) + "…" : m];
}

function panneaux(groupes, relances) {
  const pan = document.getElementById("panneaux");
  if (!pan) return;
  const act = relances.filter(e => !e.masque), mas = relances.filter(e => e.masque);
  const MAX = 6, vus = RELANCES_TOUTES ? act : act.slice(0, MAX);
  const ligneRelance = e => {
    const types = new Map();
    e.lignes.forEach(l => motifsCourts(l.motif).forEach(k => types.set(k, (types.get(k) || 0) + 1)));
    const c = contactDe(e.nom);
    const contact = [c.nom ? esc(c.nom) : "", c.tel ? `<a href="tel:${esc(c.tel.replace(/\s/g, ""))}">${esc(c.tel)}</a>` : "", c.email ? `<a href="mailto:${esc(c.email)}">${esc(c.email)}</a>` : ""].filter(Boolean);
    return `<tr><td><b>${esc(e.nom)}</b><small>${e.lignes.length} formation${e.lignes.length > 1 ? "s" : ""}</small></td>
      <td class="contact-cell">${contact.length ? contact.join("<br>") : `<button class="btn-lien gris" data-contact="${esc(e.nom)}">+ ajouter un contact</button>`}</td>
      <td>${[...types].map(([k, v]) => `<span class="motif">${esc(k)}${e.lignes.length > 1 ? ` <b>${v}</b>` : ""}</span>`).join(" ")}</td>
      <td class="actions"><button class="btn-lien" data-voir-etab="${esc(e.nom)}">détail</button>
        <button class="btn petit" data-relance="${e.ids.join(",")}">Relancé aujourd'hui</button></td></tr>`;
  };
  // à faire au SAIO : regroupé par action
  const taches = groupes.flatMap(g => g.formations.filter(f => f.cat_ === "saio").map(f => ({ etab: g.nom, f })));
  const parAction = new Map();
  for (const t of taches) {
    const k = t.f.next.txt.replace(/\s*\(voir la fiche\)/, "");
    if (!parAction.has(k)) parAction.set(k, []);
    parAction.get(k).push(t);
  }
  const ordreAct = [...parAction].sort((a, b) => b[1].length - a[1].length);
  // onglet des formations ouvertes : pas de relance, un simple état des lieux de ce qui n'est pas publiable
  const np = groupes.flatMap(g => g.formations.filter(f => f.cat_ === "nonpub"));
  const parMotif = new Map();
  np.forEach(f => motifsCourts(f.next.txt).forEach(k => parMotif.set(k, (parMotif.get(k) || 0) + 1)));
  const gaucheOuvertes = `<section class="panneau"><h2>Non publiables pour ${rentreeCible()} en l'état <span class="compte">${np.length}</span></h2>
    <p class="rien">Pour information : une formation qui ne rouvre pas n'a pas à se signaler, il n'y a donc pas de relance à faire.
      Elle redeviendra publiable d'elle-même si l'établissement met à jour le Carif-Oref.</p>
    ${np.length ? `<table class="tab-panneau">${[...parMotif].sort((a, b) => b[1] - a[1]).map(([k, v]) =>
      `<tr><td><b>${esc(/^dates de session/.test(k) ? "Pas de session à la rentrée " + rentreeCible() : k.charAt(0).toUpperCase() + k.slice(1))}</b></td><td class="nb gris">${v}</td></tr>`).join("")}</table>
      <button class="btn petit gris" data-voir-filtre="nonpub">Afficher ces formations</button>` : ""}</section>`;
  pan.innerHTML = onglet === "ouvertes" ? gaucheOuvertes + `
    <section class="panneau"><h2>À faire au SAIO <span class="compte ${taches.length ? "warn" : "ok"}">${taches.length}</span></h2>
      ${taches.length ? `<p>${taches.length} formation${taches.length > 1 ? "s" : ""} à retrouver dans l'export Carif-Oref (une seule fois par formation).</p>
        <button class="btn petit" data-voir-filtre="saio">Afficher ces formations</button>` : `<p class="rien">Toutes les formations sont retrouvées dans l'export.</p>`}
    </section>` : `
    <section class="panneau"><h2>À relancer <span class="compte ${act.length ? "ko" : "ok"}">${act.length} établissement${act.length > 1 ? "s" : ""}</span></h2>
      ${act.length ? `<table class="tab-panneau">${vus.map(ligneRelance).join("")}</table>
        ${act.length > MAX ? `<button class="btn-lien" id="relances-toutes">${RELANCES_TOUTES ? "Réduire" : `Afficher les ${act.length - MAX} autres établissements`}</button>` : ""}`
        : `<p class="rien">Personne à relancer pour le moment.</p>`}
      ${mas.length ? `<p class="rien">Relancés récemment (reviennent après ${DELAI_RELANCE} jours si rien ne bouge) : ${mas.map(e => esc(e.nom) + " le " + dateCourte(e.derniere)).join(", ")}</p>` : ""}
    </section>
    <section class="panneau"><h2>À faire au SAIO <span class="compte ${taches.length ? "warn" : "ok"}">${taches.length}</span></h2>
      ${taches.length ? `<table class="tab-panneau">${ordreAct.map(([k, ts]) => {
        const etabs = [...new Set(ts.map(t => t.etab))];
        return `<tr><td><b>${esc(k)}</b><small>${esc(etabs.slice(0, 4).join(", "))}${etabs.length > 4 ? ` et ${etabs.length - 4} autre${etabs.length > 5 ? "s" : ""}` : ""}</small></td>
          <td class="nb">${ts.length}</td>
          <td class="actions">${ts.length === 1 && ts[0].f.fiche ? `<button class="btn petit" data-fiche="${ts[0].f.r.id}">Voir la fiche</button>`
            : ts.length === 1 && ts[0].f.rappro ? `<button class="btn petit" data-rappro="${ts[0].f.r.id}">Retrouver</button>`
            : `<button class="btn petit gris" data-voir-saio="${esc(k)}">Afficher</button>`}</td></tr>`;
      }).join("")}</table>` : `<p class="rien">Rien à faire pour le moment.</p>`}
    </section>`;
  const tout = document.getElementById("relances-toutes");
  if (tout) tout.addEventListener("click", () => { RELANCES_TOUTES = !RELANCES_TOUTES; rendre(); });
  pan.querySelectorAll("[data-relance]").forEach(b => b.addEventListener("click", async () => {
    const ids = b.dataset.relance.split(",").map(Number), d = aujourdhui();
    if (DEMO) { ROWS.forEach(r => { if (ids.includes(r.id)) r.Relance_le = d; }); rendre(); return; }
    await actions([["BulkUpdateRecord", "Suivi", ids, { Relance_le: ids.map(() => d) }]]);
    await charger();
  }));
  pan.querySelectorAll("[data-fiche]").forEach(b => b.addEventListener("click", ev => { ev.stopPropagation(); voirFiche(Number(b.dataset.fiche)); }));
  pan.querySelectorAll("[data-rappro]").forEach(b => b.addEventListener("click", ev => { ev.stopPropagation(); rapprocher(Number(b.dataset.rappro)); }));
  pan.querySelectorAll("[data-contact]").forEach(b => b.addEventListener("click", ev => { ev.stopPropagation(); editerContact(b.dataset.contact, b); }));
  const versListe = () => { rendre(); const l = document.getElementById("chips"); if (l) l.scrollIntoView({ behavior: "smooth" }); };
  pan.querySelectorAll("[data-voir-filtre]").forEach(b => b.addEventListener("click", () => {
    filtre = b.dataset.voirFiltre; recherche = ""; const q = document.getElementById("q"); if (q) q.value = ""; versListe();
  }));
  pan.querySelectorAll("[data-voir-saio]").forEach(b => b.addEventListener("click", () => {
    filtre = "saio"; recherche = ""; const q = document.getElementById("q"); if (q) q.value = ""; versListe();
  }));
  pan.querySelectorAll("[data-voir-etab]").forEach(b => b.addEventListener("click", () => {
    recherche = b.dataset.voirEtab; filtre = "relance";
    const q = document.getElementById("q"); if (q) q.value = recherche;
    versListe();
  }));
}

function pastille(f) {
  const [cls, txt] = f.historique && f.cat_ === "saio" ? ["warn", "À retrouver"] : PASTILLE[f.cat_] || ["wait", ""];
  return `<span class="pill ${cls}">${txt}</span>`;
}

function outilsFormation(f) {
  const r = f.r;
  return [f.fiche ? `<button class="btn petit" data-fiche="${r.id}">Voir la fiche</button>` : "",
    f.rappro ? `<button class="btn petit" data-rappro="${r.id}">Retrouver dans l'export</button>` : "",
    `<button class="btn-lien" data-com="${r.id}">${r.Commentaire ? "✎ commentaire" : "+ commentaire"}</button>`].join(" ");
}

// Onglet « Nouvelles demandes » : une ligne par formation — statut, raison, étapes en points, actions
function ligneFormation(f) {
  const r = f.r;
  const points = ETAPES.map((et, i) => {
    const st = f.e[i].s, lib = st === "done" ? "fait" : st === "ko" ? "problème" : "à faire";
    return `<button class="point ${st}" data-id="${r.id}" data-etape="${i}" title="${esc(et.nom)} : ${lib}${f.e[i].t ? " (" + esc(f.e[i].t) + ")" : ""}"></button>`;
  }).join("");
  const prochaine = ETAPES.findIndex((et, i) => f.e[i].s !== "done");
  const sous = [];
  if (r.Lieu) sous.push(esc(r.Lieu));
  if (r.Lien_Parcoursup) sous.push(`<a href="${esc(r.Lien_Parcoursup)}" target="_blank" rel="noopener">fiche Parcoursup</a>`);
  sous.push(`<button class="btn-lien" data-renom="${r.id}">renommer</button>`, `<button class="btn-lien rouge" data-suppr="${r.id}">supprimer</button>`);
  const titre = f.next.titre && !/^(À relancer|À faire au SAIO|Terminé|En attente)$/.test(f.next.titre) ? `<b>${esc(f.next.titre)}</b>` : "";
  return `<tr class="ligne-f" data-id="${r.id}">
    <td class="f-nom"><b>${esc(r.Formation || "(sans intitulé)")}</b><small>${sous.join(" · ")}</small></td>
    <td>${pastille(f)}</td>
    <td class="raison">${titre}${esc(f.next.txt)}${r.Commentaire ? `<div class="com">${esc(r.Commentaire)}</div>` : ""}</td>
    <td class="points">${points}<small>${prochaine < 0 ? "7/7" : ETAPES[prochaine].nom}</small></td>
    <td class="outils">${outilsFormation(f)}</td></tr>`;
}

// Onglet « Formations ouvertes » : ce qui compte pour la nouvelle campagne
function ligneOuverte(g, f) {
  const r = f.r, c = f.cat, ok = '<span class="ok">✓</span>', ko = '<span class="ko">✗</span>';
  const pub = r.Publiee_le ? "publiée le " + new Date(r.Publiee_le * 1000).toLocaleDateString("fr-FR", { timeZone: "UTC" }) : "";
  const sous = [r.Lieu ? esc(r.Lieu) : "", r.Lien_Parcoursup ? `<a href="${esc(r.Lien_Parcoursup)}" target="_blank" rel="noopener">fiche Parcoursup${r.g_ta_cod ? " n° " + esc(r.g_ta_cod) : ""}</a>` : "", pub].filter(Boolean);
  let export_, dip = "—", ses = "—";
  if (!CATALOGUE.length) export_ = `<span class="gris">export non importé</span>`;
  else if (r.Cle_carif === "ABSENTE") export_ = `${ko} absente <button class="btn-lien" data-rappro="${r.id}">changer</button>`;
  else if (!c) export_ = `<button class="btn petit" data-rappro="${r.id}">Retrouver</button>`;
  else {
    export_ = `${ok} <button class="btn-lien noir" data-rappro="${r.id}" title="Changer la formation rapprochée">${esc(c.Formateur_RS || c.Libelle_formation)}</button><small>${esc(c.Ville || "")}${c.UAI_validee ? " · " + esc(c.UAI_validee) : ""}</small>`;
    dip = /archiv/i.test(c.Etat_diplome || "") ? `${ko} archivé` : c.Etat_diplome ? `${ok} valide` : "?";
    const d = debutsSessions(c), rok = rentreeOk(c), [a, b] = fenetreRentree();
    const bonne = d.find(x => x.t >= a && x.t <= b);
    ses = rok === false ? `${ko} ${d.length ? "dernière : " + d[d.length - 1].txt : "aucune pour " + rentreeCible()}` : rok ? `${ok} ${bonne ? bonne.txt : rentreeCible()}` : "?";
  }
  return `<tr class="ligne-o">
    <td class="f-nom"><b>${esc(r.Formation || "")}</b><small>${sous.join(" · ")}</small>${r.Commentaire ? `<div class="com">${esc(r.Commentaire)}</div>` : ""}</td>
    <td class="export">${export_}</td><td class="ck">${dip}</td><td class="ck">${ses}</td>
    <td class="statut">${pastille(f)}<button class="btn-lien" data-com="${r.id}">${r.Commentaire ? "✎ commentaire" : "+ commentaire"}</button></td></tr>`;
}

function brancher(zone) {
  zone.querySelectorAll(".etab-head").forEach(h => h.addEventListener("click", () => {
    const s = h.parentElement; s.classList.toggle("open");
    if (s.classList.contains("open")) ouverts.add(s.dataset.cle); else ouverts.delete(s.dataset.cle);
  }));
  zone.querySelectorAll("[data-etape]").forEach(b => b.addEventListener("click", ev => { ev.stopPropagation(); ouvrirEtape(b, Number(b.dataset.id), Number(b.dataset.etape)); }));
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
  zone.querySelectorAll("[data-commentaire]").forEach(b => b.addEventListener("click", ev => { ev.stopPropagation(); editerCommentaire(b.dataset.commentaire, b); }));
  zone.querySelectorAll("[data-contact]").forEach(b => b.addEventListener("click", ev => { ev.stopPropagation(); editerContact(b.dataset.contact, b); }));
  zone.querySelectorAll(".contact a").forEach(a => a.addEventListener("click", ev => ev.stopPropagation()));
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
  zone.querySelectorAll("[data-rappro]").forEach(b => b.addEventListener("click", ev => { ev.stopPropagation(); rapprocher(Number(b.dataset.rappro)); }));
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
    if (f.historique) { rapprocher(id); return; }
    pop.innerHTML = `<b>${esc(r.Formation)} — Carif-Oref</b><p class="rien">Cette étape se vérifie automatiquement : elle est validée quand la formation de la fiche
      est trouvée dans l'export Carif-Oref (même organisme + même RNCP ou code diplôme).</p>
      <p>${f.cat ? "✓ Trouvée dans l'export : <b>" + esc(f.cat.Libelle_formation) + "</b> (" + esc(f.cat.Formateur_RS) + ")"
        : f.fiche ? (CATALOGUE.length ? "✗ Non trouvée dans l'export importé." : "Aucun export importé.") : "Fiche pas encore reçue."}</p>
      ${f.cat ? `<ul class="controles" style="columns:1">
        <li>${/archiv/i.test(f.cat.Etat_diplome || "") ? '<span class="ko">✗</span>' : f.cat.Etat_diplome ? '<span class="ok">✓</span>' : "?"} Diplôme : ${esc(f.cat.Etat_diplome || "état inconnu (réimporter l'export)")}</li>
        <li>${rentreeOk(f.cat) === false ? '<span class="ko">✗</span>' : rentreeOk(f.cat) ? '<span class="ok">✓</span>' : "?"} Sessions — ${esc(texteRentree(f.cat))} (attendu : un début ${texteFenetre()})</li></ul>` : ""}`;
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
      <label>Publiée le <input type="date" id="pop-date" value="${versInput(r.Publiee_le) || versInput(aujourdhui())}"></label>
      <div class="pop-btns"><button class="btn vert" data-v="Publiée">${r.Publiee === "Publiée" ? "Enregistrer la date" : "Publiée au catalogue national"}</button>${effacer}</div>`;
  }
  pop.innerHTML = `<b>${esc(r.Formation || "")} — ${et.nom}</b>${corps}`;
  placer(pop, bouton);
  pop.querySelectorAll("[data-v]").forEach(b => b.addEventListener("click", async () => {
    const v = b.dataset.v, champs = {};
    if (v === "vide") { champs[et.col] = null; if (et.type === "pub") champs.Publiee_le = null; }
    else if (et.type === "date") { const d = document.getElementById("pop-date"); champs[et.col] = (d && depuisInput(d.value)) || aujourdhui(); }
    else { champs[et.col] = v; if (et.type === "pub") { const d = document.getElementById("pop-date"); champs.Publiee_le = (d && depuisInput(d.value)) || aujourdhui(); } }
    fermerPop();
    await maj(id, champs);
  }));
}

// Choix de la formation de l'export qui correspond à une formation historique
function rapprocher(id, recherche) {
  const r = ROWS.find(x => x.id === id);
  if (!r) return;
  if (!CATALOGUE.length) { const pop = nouvellePop(); pop.innerHTML = `<b>${esc(r.Formation)}</b><p class="rien">Importez d'abord l'export Carif-Oref.</p>`; placer(pop, null); return; }
  if (!INDEX) indexer();
  const lie = catalogueLie(r);
  let liste;
  if (recherche && recherche.trim().length >= 3) {
    const q = jetons(recherche);
    liste = CATALOGUE.map(c => ({ c, score: part(q, new Set([...c._torg, ...c._tform, ...c._tlieu])) })).filter(x => x.score >= 0.99 || (q.size > 1 && x.score >= 0.6))
      .sort((a, b) => b.score - a.score).slice(0, 25);
  } else liste = candidatsHistorique(r).liste.slice(0, 8);
  const ligne = c => {
    const pb = problemesCarif(c);
    return `<tr class="${lie && lie.Cle_ME === c.Cle_ME ? "choisi" : ""}"><td><b>${esc(c.Libelle_formation)}</b><div class="rien">${esc(c.Formateur_RS)}${c.Gestionnaire_RS && c.Gestionnaire_RS !== c.Formateur_RS ? " · gest. " + esc(c.Gestionnaire_RS) : ""}</div></td>
      <td>${esc(c.Ville)} ${esc(String(c.CP || "").slice(0, 2))}</td><td>${esc(c.UAI_validee)}</td><td>${esc(c.Statut_catalogue)}</td>
      <td>${pb.length ? '<span class="ko">✗</span> ' + esc(pb.map(x => /archiv/.test(x) ? "diplôme archivé" : "pas de session à la rentrée").join(" · ")) + `<div class="rien">${esc(texteRentree(c))}</div>` : '<span class="ok">✓</span> publiable'}</td>
      <td><button class="btn petit vert" data-choix="${esc(c.Cle_ME)}">C'est celle-ci</button></td></tr>`;
  };
  const pop = nouvellePop("pop-fiche");
  pop.innerHTML = `<div class="fiche-tete"><b>Retrouver dans l'export Carif-Oref — ${esc(r.Etablissement)} · ${esc(r.Formation)}</b><button class="btn gris petit" id="pop-fermer">Fermer</button></div>
    <p class="rien">Formation déjà ouverte sur Parcoursup${r.g_ta_cod ? ` (<a href="${esc(r.Lien_Parcoursup || "#")}" target="_blank" rel="noopener">fiche n° ${esc(r.g_ta_cod)}</a>)` : ""} :
      indiquez une fois pour toutes la formation de l'export qui lui correspond (même site). Elle sera ensuite contrôlée à chaque import.</p>
    ${lie ? `<p>Actuellement rapprochée de : <b>${esc(lie.Libelle_formation)}</b> — ${esc(lie.Formateur_RS)} (${esc(lie.Ville)})</p>` : ""}
    <div class="ligne-recherche"><input id="rappro-q" placeholder="Chercher dans l'export : organisme, ville, intitulé…" value="${esc(recherche || "")}">
      <button class="btn petit" id="rappro-chercher">Chercher</button></div>
    ${liste.length ? `<table class="comp rappro"><tr><th>Formation de l'export</th><th>Ville</th><th>UAI</th><th>Catalogue</th><th>Rentrée ${rentreeCible()}</th><th></th></tr>${liste.map(x => ligne(x.c)).join("")}</table>`
      : `<p class="rien">Aucune formation proposée : cherchez par nom d'organisme ou de ville.</p>`}
    <div class="pop-btns"><button class="btn rouge" data-choix="ABSENTE">Elle n'est pas dans l'export</button>${r.Cle_carif ? `<button class="btn gris" data-choix="">Annuler le rapprochement</button>` : ""}</div>`;
  placer(pop, null);
  const fer = document.getElementById("pop-fermer"); if (fer) fer.addEventListener("click", fermerPop);
  const q = document.getElementById("rappro-q"), go = () => rapprocher(id, q ? q.value : "");
  const bq = document.getElementById("rappro-chercher"); if (bq) bq.addEventListener("click", go);
  if (q) { q.addEventListener("keydown", ev => { if (ev.key === "Enter") go(); }); if (recherche) { q.focus(); q.setSelectionRange(q.value.length, q.value.length); } }
  pop.querySelectorAll("[data-choix]").forEach(b => b.addEventListener("click", async () => {
    fermerPop();
    await maj(id, { Cle_carif: b.dataset.choix || null });
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
    <fieldset class="contact-saisie"><legend>Contact de l'établissement <small>(repris automatiquement s'il est déjà connu)</small></legend>
      <label>Nom (et fonction) <input id="aj-cnom" placeholder="M. Dupont, directeur"></label>
      <label>Téléphone <input id="aj-ctel"></label>
      <label>Mail <input id="aj-cmail" type="email"></label></fieldset>
    <div class="pop-btns"><button class="btn" id="aj-ok">Ajouter</button><button class="btn gris" id="aj-annul">Annuler</button></div>`;
  placer(pop, null);
  const champ = document.getElementById(etab ? "aj-forms" : "aj-etab"); if (champ) champ.focus();
  const remplirContact = () => {
    const el = document.getElementById("aj-etab"), c = contactDe(el ? el.value : "");
    for (const [id, v] of [["aj-cnom", c.nom], ["aj-ctel", c.tel], ["aj-cmail", c.email]]) {
      const f = document.getElementById(id); if (f && !f.value) f.value = v;
    }
  };
  remplirContact();
  const etEl = document.getElementById("aj-etab"); if (etEl) etEl.addEventListener("change", remplirContact);
  const annul = document.getElementById("aj-annul"); if (annul) annul.addEventListener("click", fermerPop);
  const ok = document.getElementById("aj-ok");
  if (ok) ok.addEventListener("click", async () => {
    const v = id => { const el = document.getElementById(id); return el ? el.value : ""; };
    const e = v("aj-etab").trim(), forms = v("aj-forms").split(/\n|;/).map(x => x.trim()).filter(Boolean);
    if (!e || !forms.length) { alert("Indiquez l'établissement et au moins une formation."); return; }
    const lieu = v("aj-lieu").trim(), date = depuisInput(v("aj-date")) || aujourdhui();
    const contact = { Contact_nom: v("aj-cnom").trim() || null, Contact_tel: v("aj-ctel").trim() || null, Contact_email: v("aj-cmail").trim() || null };
    fermerPop(); ouverts.add(norm(e));
    const existants = ROWS.filter(r => norm(r.Etablissement) === norm(e)).map(r => r.id);
    if (existants.length && (contact.Contact_nom || contact.Contact_tel || contact.Contact_email)) await bulkMaj(existants, contact);
    await ajouter(forms.map(f => ({ Etablissement: e, Formation: f, Lieu: lieu || null, Mail_recu: date, ...contact })));
  });
}

// Contact d'un établissement (repris de n'importe laquelle de ses lignes)
function contactDe(etab) {
  const k = norm(etab), c = { nom: "", tel: "", email: "" };
  for (const r of ROWS) {
    if (norm(r.Etablissement) !== k) continue;
    c.nom = c.nom || r.Contact_nom || ""; c.tel = c.tel || r.Contact_tel || ""; c.email = c.email || r.Contact_email || "";
  }
  return c;
}
function commentaireDe(etab) {
  const k = norm(etab);
  const r = ROWS.find(x => norm(x.Etablissement) === k && x.Commentaire && !(x.Origine && !x.Mail_recu));
  return r ? r.Commentaire : "";
}

function editerCommentaire(etab, ancre) {
  const pop = nouvellePop("pop-large");
  pop.innerHTML = `<b>Commentaire sur la demande — ${esc(etab)}</b>
    <textarea id="com-txt" rows="5">${esc(commentaireDe(etab))}</textarea>
    <div class="pop-btns"><button class="btn" id="com-ok">Enregistrer</button><button class="btn gris" id="com-annul">Annuler</button></div>`;
  placer(pop, ancre);
  const t = document.getElementById("com-txt"); if (t) t.focus();
  const an = document.getElementById("com-annul"); if (an) an.addEventListener("click", fermerPop);
  const ok = document.getElementById("com-ok");
  if (ok) ok.addEventListener("click", async () => {
    const el = document.getElementById("com-txt"), val = el ? el.value.trim() : "";
    const ids = ROWS.filter(r => norm(r.Etablissement) === norm(etab) && !(r.Origine && !r.Mail_recu)).map(r => r.id);
    fermerPop();
    if (ids.length) await bulkMaj(ids, { Commentaire: val || null });
  });
}

function contactHtml(c, vide) {
  const p = [];
  if (c.nom) p.push("👤 " + esc(c.nom));
  if (c.tel) p.push(`☎ <a href="tel:${esc(c.tel.replace(/\s/g, ""))}">${esc(c.tel)}</a>`);
  if (c.email) p.push(`✉ <a href="mailto:${esc(c.email)}">${esc(c.email)}</a>`);
  return p.length ? p.join(" · ") : (vide || "");
}

function editerContact(etab, ancre) {
  const c = contactDe(etab);
  const pop = nouvellePop("pop-large");
  pop.innerHTML = `<b>Contact — ${esc(etab)}</b>
    <label>Nom (et fonction) <input id="c-nom" value="${esc(c.nom)}" placeholder="M. Dupont, directeur"></label>
    <label>Téléphone <input id="c-tel" value="${esc(c.tel)}" placeholder="05 56 00 00 00"></label>
    <label>Mail <input id="c-mail" type="email" value="${esc(c.email)}" placeholder="contact@etablissement.fr"></label>
    <div class="pop-btns"><button class="btn" id="c-ok">Enregistrer</button><button class="btn gris" id="c-annul">Annuler</button></div>`;
  placer(pop, ancre);
  const an = document.getElementById("c-annul"); if (an) an.addEventListener("click", fermerPop);
  const ok = document.getElementById("c-ok");
  if (ok) ok.addEventListener("click", async () => {
    const v = id => { const el = document.getElementById(id); return el ? el.value.trim() : ""; };
    const ids = ROWS.filter(r => norm(r.Etablissement) === norm(etab)).map(r => r.id);
    const champs = { Contact_nom: v("c-nom") || null, Contact_tel: v("c-tel") || null, Contact_email: v("c-mail") || null };
    fermerPop();
    await bulkMaj(ids, champs);
  });
}

// Prépare dans la messagerie (Thunderbird…) le mail avec les liens des fiches, puis coche « Lien envoyé »
function preparerMail(etab, idsChoisis, ancre) {
  const k = norm(etab);
  const candidats = ROWS.filter(r => norm(r.Etablissement) === k && !r.Lien_envoye && !ficheDe(r) && !(r.Origine && !r.Mail_recu) && r.Publiee !== "Publiée");
  const choisis = new Set(idsChoisis && idsChoisis.length ? idsChoisis : candidats.map(r => r.id));
  const email = contactDe(etab).email;
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
    ["État du diplôme", "", c.Etat_diplome || "inconnu (réimporter l'export)", !/archiv/i.test(c.Etat_diplome || "")],
    ["Début de session", "début attendu " + texteFenetre(), texteRentree(c), rentreeOk(c) !== false],
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
    await maj(id, champs);
    voirFiche(id);
  }));
}

// ------------------------------------------------------------------ import de l'export Carif-Oref

const COLS_EXPORT = { "CLE MINISTERES EDUCATIFS": "Cle_ME", "Catalogue Général National": "Statut_catalogue", "Libelle_formation": "Libelle_formation",
  "Gestionnaire_RS": "Gestionnaire_RS", "Siret_gestionnaire": "Siret_gestionnaire", "Formateur_RS": "Formateur_RS", "Siret_formateur": "Siret_formateur",
  "UAI validée référentiel": "UAI_validee", "Code_RNCP": "Code_RNCP", "Code_scolarite": "Code_scolarite", "Annee_de_rentree": "Annee_de_rentree",
  "Adresse_de_formation": "Adresse_de_formation", "CP": "CP", "Ville": "Ville", "Ref_formation_Carif": "Ref_formation_Carif", "Date_MAJ": "Date_MAJ", "Etat_diplome": "Etat_diplome", "Diplome": "Diplome" };

function texteCellule(v) {
  if (v === null || v === undefined) return "";
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : String(v);
  const s = String(v).trim();
  return s === "NULL" ? "" : s.replace(/^(\d+)\.0$/, "$1");
}

// Date de l'export (nombre Excel, jj/mm/aaaa ou aaaa-mm-jj) → « jj/mm/aaaa »
function dateExport(v) {
  if (typeof v === "number" && v > 20000) {
    const d = new Date(Math.round((v - 25569) * 86400000));
    return String(d.getUTCDate()).padStart(2, "0") + "/" + String(d.getUTCMonth() + 1).padStart(2, "0") + "/" + d.getUTCFullYear();
  }
  const s = texteCellule(v), m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s), f = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(s);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  if (f) return f[1].padStart(2, "0") + "/" + f[2].padStart(2, "0") + "/" + f[3];
  return "";
}

function preparerExport(lignesBrutes) {
  const best = new Map(), annees = new Map(), debuts = new Map();
  for (const l of lignesBrutes) {
    if (texteCellule(l["Académie"]) !== ACADEMIE) continue;
    let cle = texteCellule(l["CLE MINISTERES EDUCATIFS"]);
    if (!cle.includes("#")) cle = "CARIF-" + texteCellule(l["Ref_formation_Carif"]);
    const an = texteCellule(l["Annee_de_rentree"]);
    if (!annees.has(cle)) annees.set(cle, new Set());
    if (an) annees.get(cle).add(an);
    if (!debuts.has(cle)) debuts.set(cle, new Set());
    const dd = dateExport(l["Date_debut"]);
    if (dd) debuts.get(cle).add(dd);
    if (!best.has(cle) || an > texteCellule(best.get(cle)["Annee_de_rentree"])) best.set(cle, { ...l, "CLE MINISTERES EDUCATIFS": cle });
  }
  return [...best.entries()].map(([cle, l]) => {
    const o = {};
    for (const [src, dst] of Object.entries(COLS_EXPORT)) o[dst] = texteCellule(l[src]);
    if (typeof l["Date_MAJ"] === "number") o.Date_MAJ = dateExport(l["Date_MAJ"]);
    for (const k of ["Siret_gestionnaire", "Siret_formateur"]) if (/^\d+$/.test(o[k])) o[k] = o[k].padStart(14, "0");
    if (/^\d+$/.test(o.Code_scolarite)) o.Code_scolarite = o.Code_scolarite.padStart(8, "0");
    o.Annee_de_rentree = [...annees.get(cle)].sort().join(", ");
    const cleD = x => x.slice(6) + x.slice(3, 5) + x.slice(0, 2);
    o.Debuts_sessions = [...debuts.get(cle)].sort((a, b) => cleD(a).localeCompare(cleD(b))).join(", ");
    return o;
  });
}

// Page de partage CAP Métiers où l'export Apprentissage est toujours déposé (modifiable dans Paramètres : colonne URL_export)
const URL_EXPORT = "https://cirrus.cap-metiers.pro/s/fTkMqHbXYGertCs";
function urlExport() { return String(PARAM.URL_export || URL_EXPORT).replace(/\/+$/, ""); }

// Bouton « Importer l'export » : on tente de récupérer le fichier directement sur la page CAP Métiers ;
// si le navigateur ou le réseau le bloque, on propose d'ouvrir la page puis de choisir le fichier téléchargé.
async function importerDepuisCapMetiers() {
  const ban = document.getElementById("bandeaux");
  if (ban) ban.innerHTML = `<div class="banner">Récupération de l'export sur la page CAP Métiers…</div>`;
  let donnees = null;
  try {
    const ctl = new AbortController(), minuterie = setTimeout(() => ctl.abort(), 30000);
    const rep = await fetch(urlExport() + "/download", { signal: ctl.signal });
    clearTimeout(minuterie);
    if (rep.ok) donnees = await rep.arrayBuffer();
  } catch (e) { donnees = null; }
  if (donnees && await importerExport(donnees, true)) return;
  if (ban) ban.innerHTML = `<div class="banner">Récupération automatique impossible depuis ce poste.
    <a href="${esc(urlExport())}" target="_blank" rel="noopener">① Ouvrir la page CAP Métiers</a> et télécharger l'export, puis
    <button class="btn petit" id="choisir-export">② Choisir le fichier téléchargé</button></div>`;
  const b = document.getElementById("choisir-export"), fic = document.getElementById("fichier-export");
  if (b && fic) b.addEventListener("click", ev => { ev.stopPropagation(); fic.click(); });
}

// fichier : File (choisi à la main) ou ArrayBuffer (téléchargé). silencieux : renvoie false sans message si ce n'est pas un export lisible.
async function importerExport(fichier, silencieux) {
  const ban = document.getElementById("bandeaux");
  const info = t => { if (ban) ban.innerHTML = `<div class="banner">${esc(t)}</div>`; };
  try {
    info("Lecture de l'export…");
    const wb = XLSX.read(fichier instanceof ArrayBuffer ? fichier : await fichier.arrayBuffer(), { type: "array" });
    const brut = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: null, raw: true });
    const rows = preparerExport(brut);
    if (!rows.length) { if (silencieux) return false; info("Aucune formation de l'académie de " + ACADEMIE + " dans ce fichier : est-ce bien l'export Apprentissage ?"); return false; }
    RAPPRO_FAIT = false;
    if (DEMO) { CATALOGUE = rows; INDEX = null; await rapprocherAuto(); rendre(); return true; }
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
    return true;
  } catch (e) {
    if (silencieux) return false;
    info("Échec de l'import : " + (e && e.message || e));
    return false;
  }
}

// ------------------------------------------------------------------ chargement

async function charger() {
  try {
    const [s, f, c, p] = await Promise.all(["Suivi", "Fiches", "Catalogue", "Parametres"].map(t => grist.docApi.fetchTable(t).catch(() => null)));
    if (!s) throw new Error("table « Suivi » introuvable ou accès refusé");
    const manquantes = [["Contact_nom", "Contact (nom)"], ["Contact_tel", "Contact (téléphone)"], ["Contact_email", "Contact (mail)"],
      ["Motif_UAI", "Correction UAI demandée"], ["Motif_RNCP", "Correction RNCP demandée"], ["Cle_carif", "Formation de l'export (clé)"]]
      .filter(([c]) => !(c in s));
    if (manquantes.length) {
      await grist.docApi.applyUserActions(manquantes.map(([c, l]) => ["AddColumn", "Suivi", c, { type: "Text", label: l, isFormula: false }]));
      for (const [c] of manquantes) s[c] = s.id.map(() => null);
    }
    const manquantesC = c ? ["Etat_diplome", "Debuts_sessions", "Diplome"].filter(k => !(k in c)) : [];
    if (manquantesC.length) {
      await grist.docApi.applyUserActions(manquantesC.map(k => ["AddColumn", "Catalogue", k, { type: "Text", label: k, isFormula: false }]));
      for (const k of manquantesC) c[k] = c.id.map(() => null);
    }
    ROWS = lignes(s); FICHES = lignes(f); CATALOGUE = lignes(c); PARAM = lignes(p)[0] || {}; INDEX = null; DEMO = false;
  } catch (e) {
    const ban = document.getElementById("bandeaux");
    if (ban) ban.innerHTML = `<div class="banner" style="background:var(--red-bg);color:var(--red)">Impossible de lire le document (${esc(e && e.message || e)}).
      Vérifiez que le widget a l'« Accès complet au document » (panneau de droite, onglet « Personnalisée »).</div>`;
    return;
  }
  try { if (await rapprocherAuto()) return charger(); } catch (e) { /* rapprochement automatique non bloquant */ }
  rendre();
}

function demo() {
  DEMO = true;
  const j = s => Date.UTC(2026, Number(s.slice(3, 5)) - 1, Number(s.slice(0, 2))) / 1000;
  ROWS = [
    { id: 1, Code: "F-0001", Etablissement: "TALIS", Contact_nom: "Mme Martin, directrice", Contact_tel: "05 56 00 00 00", Contact_email: "s.martin@talis.fr", Formation: "BTS MCO", Lieu: "TALIS Bordeaux", Mail_recu: j("10/10"), Lien_envoye: j("12/10"), UAI: "Conforme", RNCP: "Conforme", Publiee: "Publiée", Publiee_le: j("28/10") },
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
    { Cle_ME: "x1", Statut_catalogue: "Publiée", Libelle_formation: "BTS Management Commercial Opérationnel", Formateur_RS: "TALIS BORDEAUX", Siret_formateur: "33851631300099", Siret_gestionnaire: "33851631300099", UAI_validee: "0333460G", Code_RNCP: "38362", Code_scolarite: "32031213", CP: "33000", Ville: "Bordeaux", Date_MAJ: "02/11/2026", Etat_diplome: "Diplôme en cours de validité", Annee_de_rentree: "2026, 2027", Debuts_sessions: "01/09/2026, 06/09/2027" },
    { Cle_ME: "x2", Statut_catalogue: "Publiée", Libelle_formation: "BTS Négociation et digitalisation de la relation client", Formateur_RS: "TALIS BORDEAUX", Siret_formateur: "33851631300099", Siret_gestionnaire: "33851631300099", UAI_validee: "0333460G", Code_RNCP: "38368", Code_scolarite: "32031212", CP: "33000", Ville: "Bordeaux", Date_MAJ: "02/11/2026", Etat_diplome: "Diplôme en état archivé", Annee_de_rentree: "2025, 2026", Debuts_sessions: "02/09/2025, 07/09/2026" },
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
    const nouv = document.getElementById("nouveau");
    if (nouv) nouv.addEventListener("click", ev => { ev.stopPropagation(); ouvrirAjout(""); });
    const imp = document.getElementById("importer"), fic = document.getElementById("fichier-export");
    if (imp && fic) {
      imp.addEventListener("click", ev => { ev.stopPropagation(); importerDepuisCapMetiers(); });
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
