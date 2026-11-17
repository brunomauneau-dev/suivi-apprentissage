// Formations fermées sur Parcoursup (table Grist « Fermetures ») : point de vigilance avant d'ouvrir de nouvelles formations.
// Un établissement qui a déjà eu des formations fermées (même UAI ou même nom d'organisme) est signalé dans la liste
// et dans la fiche ; une formation dont le n° Parcoursup figure dans la liste est signalée sur sa ligne.
// La liste s'importe depuis le fichier Excel des fermetures (colonnes UAI, Etablissement, formation, code formation, remarques)
// et se complète aussi à la main dans Grist.
// Utilise les variables et fonctions de suivi.js (ROWS, DEMO, esc, colle, code, actions, charger, nouvellePop…).

let FERMETURES = [];
const TABLE_FERMETURES = "Fermetures";
const COLS_FERMETURES = [
  { id: "UAI", type: "Text" },
  { id: "Etablissement", type: "Text" },
  { id: "Formation", type: "Text" },
  { id: "Code_formation", type: "Text" },   // n° de la formation sur Parcoursup (g_ta_cod)
  { id: "Remarque", type: "Text" },
  { id: "Campagne", type: "Text" },         // campagne Parcoursup de la fermeture (ex. 2026)
];

const nettoie = v => String(v ?? "").replace(/\s+/g, " ").trim().replace(/^[-\s]+|[-\s.]+$/g, "");

// Le classeur est-il la liste des fermetures ? (en-tête avec « UAI » et « code formation » dans les premières lignes)
function enteteFermetures(feuille) {
  const t = XLSX.utils.sheet_to_json(feuille, { header: 1, defval: null, raw: true });
  for (let i = 0; i < Math.min(5, t.length); i++) {
    const h = (t[i] || []).map(x => norm(x));
    const cUai = h.indexOf("UAI"), cCode = h.findIndex(x => /^CODE FORMATION/.test(x));
    if (cUai >= 0 && cCode >= 0) return { t, i, cUai, cCode, cEtab: h.findIndex(x => /^ETABLISSEMENT/.test(x)), cForm: h.findIndex(x => /^FORMATION/.test(x)),
      cCamp: h.findIndex(x => /^(CAMPAGNE|ANNEE)/.test(x)) };
  }
  return null;
}

// Lignes du fichier : les colonnes sans en-tête après les colonnes connues sont des remarques (« site gestionnaire Lyon », motif…).
// Campagne : colonne « Campagne » ou « Année » du fichier si elle existe, sinon celle indiquée à l'import.
function lireFermetures(e, campagne) {
  const connues = new Set([e.cUai, e.cCode, e.cEtab, e.cForm, e.cCamp]);
  return e.t.slice(e.i + 1).map(l => ({
    Campagne: (e.cCamp >= 0 && String(l[e.cCamp] ?? "").replace(/\.0$/, "").trim()) || campagne,
    UAI: code(l[e.cUai]), Etablissement: nettoie(l[e.cEtab]), Formation: nettoie(l[e.cForm]),
    Code_formation: String(l[e.cCode] ?? "").replace(/\.0$/, "").trim(),
    Remarque: l.map((v, k) => connues.has(k) ? "" : nettoie(v)).filter(Boolean).join(" · "),
  })).filter(x => x.UAI || x.Code_formation || x.Etablissement);
}

// Ajoute les fermetures pas encore connues (même n° Parcoursup, ou même UAI + intitulé) ;
// pour les autres, met à jour la remarque si elle a changé et complète la campagne si elle manque
async function importerFermetures(e, info) {
  let campagne = "";
  if (e.cCamp < 0) {
    const rep = prompt("Campagne Parcoursup de ces fermetures (année) :", String(rentreeCible() - 1));
    if (rep === null) { info("Import des fermetures annulé."); return false; }
    campagne = rep.trim();
  }
  const lues = lireFermetures(e, campagne);
  const cle = x => x.Code_formation ? "C" + x.Code_formation : "U" + x.UAI + "|" + colle(x.Formation);
  const deja = new Map(FERMETURES.map(x => [cle(x), x]));
  const nouvelles = lues.filter(x => !deja.has(cle(x)));
  const aMettreAJour = lues.filter(x => deja.has(cle(x))).map(x => {
    const y = deja.get(cle(x)), champs = {};
    if (x.Remarque && x.Remarque !== (y.Remarque || "")) champs.Remarque = x.Remarque;
    if (x.Campagne && !y.Campagne) champs.Campagne = x.Campagne;
    return { y, champs };
  }).filter(m => Object.keys(m.champs).length);
  if (DEMO) {
    FERMETURES.push(...nouvelles.map((x, i) => ({ id: 1000 + FERMETURES.length + i, ...x })));
    for (const m of aMettreAJour) Object.assign(m.y, m.champs);
  } else {
    const tables = await grist.docApi.listTables();
    const acts = tables.includes(TABLE_FERMETURES) ? [] : [["AddTable", TABLE_FERMETURES, COLS_FERMETURES]];
    if (nouvelles.length) acts.push(["BulkAddRecord", TABLE_FERMETURES, nouvelles.map(() => null),
      Object.fromEntries(COLS_FERMETURES.map(c => [c.id, nouvelles.map(x => x[c.id] || null)]))]);
    for (const m of aMettreAJour) acts.push(["UpdateRecord", TABLE_FERMETURES, m.y.id, m.champs]);
    if (acts.length) await actions(acts);
  }
  if (DEMO) rendre(); else await charger();   // le réaffichage vide les bandeaux : le bilan vient après
  info(`Fermetures : ${lues.length} lues dans le fichier, ${nouvelles.length} ajoutée${nouvelles.length > 1 ? "s" : ""}` +
    (aMettreAJour.length ? `, ${aMettreAJour.length} mise${aMettreAJour.length > 1 ? "s" : ""} à jour` : "") + (campagne ? ` (campagne ${campagne})` : "") + ".");
  return true;
}

// Fermetures qui concernent un organisme : { noms, uais, codes } → [{ x, raison }] (même formation, même UAI, même nom)
function fermeturesPour({ noms = [], uais = [], codes = [] }) {
  const u = new Set(uais.map(code).filter(Boolean)), c = new Set(codes.map(v => String(v || "").trim()).filter(Boolean));
  const n = noms.map(colle).filter(x => x.length >= 4);
  const out = [];
  for (const x of FERMETURES) {
    const xc = colle(x.Etablissement);
    const raison = c.has(String(x.Code_formation || "").trim()) ? "cette formation"
      : u.has(code(x.UAI)) ? "même UAI " + code(x.UAI)
      : xc.length >= 4 && n.some(k => xc.includes(k) || k.includes(xc)) ? "même nom d'organisme" : "";
    if (raison) out.push({ x, raison });
  }
  const rang = r => r === "cette formation" ? 0 : r.startsWith("même UAI") ? 1 : 2;
  return out.sort((a, b) => rang(a.raison) - rang(b.raison) || String(b.x.Campagne || "").localeCompare(String(a.x.Campagne || "")));
}

// Campagnes concernées, la plus récente d'abord : « 2026 », « 2026, 2025 »
const campagnes = fs => [...new Set(fs.map(f => f.x.Campagne).filter(Boolean))].sort().reverse().join(", ");

// Fermetures qui concernent l'établissement saisi dans « Nouvelle demande » (établissement déjà suivi : UAI et n° compris)
function fermeturesNom(nom) {
  if (!FERMETURES.length || colle(nom).length < 4) return [];
  const g = construire(ROWS).find(x => x.cle === norm(nom));
  return g ? fermeturesEtab(g) : fermeturesPour({ noms: [nom] });
}

// Une ligne d'avertissement (vide si rien) : nombre, campagne, intitulés
function avertissementFermetures(nom) {
  const fs = fermeturesNom(nom);
  if (!fs.length) return "";
  const camp = campagnes(fs), court = t => (t = String(t || "")).length > 60 ? t.slice(0, 57).trim() + "…" : t;
  const titres = fs.slice(0, 2).map(f => court(f.x.Formation)).join(" · ") + (fs.length > 2 ? " · …" : "");
  return `⚠ ${fs.length} formation${fs.length > 1 ? "s" : ""} de cet organisme fermée${fs.length > 1 ? "s" : ""} sur Parcoursup${camp ? " (campagne " + camp + ")" : ""} : ${titres}`;
}

// Pour un groupe d'établissement de la liste : nom, UAI des fiches et des formations de l'export rapprochées, n° Parcoursup
function fermeturesEtab(g) {
  if (!FERMETURES.length) return [];
  const uais = g.formations.flatMap(f => [f.fiche && f.fiche.UAI_lieu, f.fiche && f.fiche.UAI_formateur, f.fiche && f.fiche.UAI_gestionnaire, f.cat && f.cat.UAI_validee]);
  const noms = [g.nom, ...g.formations.flatMap(f => [f.fiche && f.fiche.Organisme, f.cat && f.cat.Formateur_RS])];
  return fermeturesPour({ noms: [...new Set(noms.filter(Boolean))], uais, codes: g.formations.map(f => f.r.g_ta_cod) });
}

// Pastille dans l'en-tête de l'établissement
function tagFermetures(g) {
  const fs = fermeturesEtab(g);
  if (!fs.length) return "";
  const meme = fs.some(f => f.raison === "cette formation");
  return `<button class="tag ferm${meme ? " ko" : ""}" data-fermetures="${esc(g.cle)}" title="Formations de cet organisme fermées sur Parcoursup${campagnes(fs) ? " (campagne " + campagnes(fs) + ")" : ""} : à surveiller avant toute ouverture">⚠ ${fs.length} fermeture${fs.length > 1 ? "s" : ""}</button>`;
}

// Mention sur la ligne d'une formation dont le n° Parcoursup est dans la liste des fermetures
function noteFermeture(r) {
  if (!r.g_ta_cod || !FERMETURES.length) return "";
  const x = FERMETURES.find(y => String(y.Code_formation || "").trim() === String(r.g_ta_cod).trim());
  return x ? `<div class="ferm-ligne">⚠ Fermée sur Parcoursup${x.Campagne ? " en " + esc(x.Campagne) : ""}${x.Remarque ? " : " + esc(x.Remarque) : ""}</div>` : "";
}

function tableFermetures(liste, avecRaison) {
  return `<table class="comp ferm-table"><tr><th>Établissement</th><th>Formation</th><th>N° Parcoursup</th><th>Campagne</th><th>Remarque</th>${avecRaison ? "<th>Lien</th>" : ""}</tr>
    ${liste.map(({ x, raison }) => `<tr${raison === "cette formation" ? ' class="meme"' : ""}><td>${esc(x.Etablissement)}<div class="rien">${esc(x.UAI || "")}</div></td>
      <td>${esc(x.Formation)}</td><td>${esc(x.Code_formation || "")}</td><td>${esc(x.Campagne || "")}</td><td>${esc(x.Remarque || "")}</td>${avecRaison ? `<td>${esc(raison)}</td>` : ""}</tr>`).join("")}</table>`;
}

// Fenêtre des fermetures d'un établissement
function ouvrirFermetures(cleEtab, ancre) {
  const g = construire(ROWS).find(x => x.cle === cleEtab);
  if (!g) return;
  const fs = fermeturesEtab(g);
  const pop = nouvellePop("pop-fiche");
  pop.innerHTML = `<div class="fiche-tete"><b>Fermetures sur Parcoursup — ${esc(g.nom)}</b><button class="btn gris petit" id="pop-fermer">Fermer</button></div>
    <p class="rien">Formations de cet organisme déjà fermées sur Parcoursup : point de vigilance avant d'ouvrir une nouvelle formation
      (vérifier le paramétrage, le site gestionnaire, les signalements de candidats).</p>
    ${fs.length ? tableFermetures(fs, true) : `<p class="rien">Aucune fermeture connue.</p>`}`;
  placer(pop, null);
  const fer = document.getElementById("pop-fermer"); if (fer) fer.addEventListener("click", fermerPop);
}

// Fenêtre de toutes les fermetures (bouton de l'en-tête) : consultation et import du fichier
function ouvrirToutesFermetures(ancre) {
  const pop = nouvellePop("pop-fiche");
  const parEtab = [...FERMETURES].sort((a, b) => String(a.Etablissement).localeCompare(String(b.Etablissement)));
  pop.innerHTML = `<div class="fiche-tete"><b>Formations fermées sur Parcoursup (${FERMETURES.length})</b><button class="btn gris petit" id="pop-fermer">Fermer</button></div>
    <p class="rien">Les établissements concernés (même UAI ou même nom d'organisme) sont signalés par « ⚠ fermeture » dans la liste et dans leurs fiches.
      Importez le fichier Excel des fermetures (colonnes UAI, Etablissement, formation, code formation) : seules les lignes nouvelles sont ajoutées.
      La liste se complète aussi à la main dans la table « Fermetures » du document.</p>
    <div class="pop-btns"><button class="btn petit" id="ferm-importer">Importer le fichier des fermetures</button></div>
    ${FERMETURES.length ? tableFermetures(parEtab.map(x => ({ x })), false) : `<p class="rien">Aucune fermeture enregistrée.</p>`}`;
  placer(pop, null);
  const fer = document.getElementById("pop-fermer"); if (fer) fer.addEventListener("click", fermerPop);
  const imp = document.getElementById("ferm-importer"), fic = document.getElementById("fichier-export");
  if (imp && fic) imp.addEventListener("click", () => { fermerPop(); fic.click(); });
}
