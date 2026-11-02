// Widget Grist « Suivi des référencements en apprentissage »
// Une seule table « Suivi » : une ligne par formation demandée, regroupées par établissement.
// Tout se fait dans le widget : cliquer sur une étape pour la valider, ajouter des formations, commenter.

const TABLE = "Suivi";
const ETAPES = [
  { col: "Mail_recu", nom: "Mail reçu", type: "date" },
  { col: "Lien_envoye", nom: "Lien envoyé", type: "date" },
  { col: "Fiche_recue", nom: "Fiche reçue", type: "date" },
  { col: "UAI", nom: "UAI", type: "verif" },
  { col: "RNCP", nom: "RNCP", type: "verif" },
  { col: "Publiee", nom: "Publiée", type: "pub" },
];
const JOUR = 86400;
const DELAI_FICHE = 10;    // jours après l'envoi du lien avant de relancer pour la fiche
const DELAI_RELANCE = 7;   // une relance masque l'établissement pendant ce nombre de jours

// ------------------------------------------------------------------ utilitaires

function norm(s) {
  return String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/\s+/g, " ").trim();
}
function esc(s) {
  return String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}
function aujourdhui() {
  const d = new Date();
  return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 1000;
}
function dateCourte(sec) {
  if (!sec) return "";
  const d = new Date(sec * 1000);
  return String(d.getUTCDate()).padStart(2, "0") + "/" + String(d.getUTCMonth() + 1).padStart(2, "0");
}
function versInput(sec) {
  return sec ? new Date(sec * 1000).toISOString().slice(0, 10) : "";
}
function depuisInput(v) {
  if (!v) return null;
  const [a, m, j] = v.split("-").map(Number);
  return Date.UTC(a, m - 1, j) / 1000;
}
function lignes(table) {
  if (!table || !table.id) return [];
  const cols = Object.keys(table);
  return table.id.map((_, i) => { const r = {}; for (const c of cols) r[c] = table[c][i]; return r; });
}

// ------------------------------------------------------------------ logique de suivi

function etatEtape(r, et) {
  const v = r[et.col];
  if (et.type === "date") return v ? { s: "done", t: dateCourte(v) } : { s: "todo" };
  if (et.type === "verif") return v === "Conforme" ? { s: "done" } : v === "À corriger" ? { s: "ko" } : { s: "todo" };
  return v === "Publiée" ? { s: "done" } : { s: "todo" };
}

function analyser(r, maintenant) {
  const e = ETAPES.map(et => etatEtape(r, et));
  const ancienne = !!r.Origine && !r.Mail_recu && r.Publiee === "Publiée";
  if (ancienne) return { e, cat: "parcoursup", next: { cls: "", titre: "Déjà sur Parcoursup", txt: r.g_ta_cod ? "n° " + r.g_ta_cod : "" } };
  if (r.Publiee === "Publiée") return { e, cat: "publie", next: { cls: "ok", titre: "Terminé", txt: "Publiée au catalogue" } };
  if (e[3].s === "ko") return { e, cat: "action", next: { cls: "ko", titre: "À corriger", txt: "UAI" + (r.Commentaire ? " — " + r.Commentaire : "") } };
  if (e[4].s === "ko") return { e, cat: "action", next: { cls: "ko", titre: "À corriger", txt: "RNCP" + (r.Commentaire ? " — " + r.Commentaire : "") } };
  if (!r.Lien_envoye && !r.Fiche_recue) return { e, cat: "action", next: { cls: "ko", titre: "Action requise", txt: "Envoyer le lien de la fiche" } };
  if (!r.Fiche_recue) {
    const j = Math.floor((maintenant - r.Lien_envoye) / JOUR);
    return { e, cat: "attente", next: j >= 10
      ? { cls: "warn", titre: "Fiche attendue", txt: `Lien envoyé il y a ${j} j : relancer` }
      : { cls: "warn", titre: "Fiche attendue", txt: "En attente de l'établissement" } };
  }
  if (e[3].s === "todo") return { e, cat: "action", next: { cls: "ko", titre: "Action requise", txt: "Vérifier l'UAI" } };
  if (e[4].s === "todo") return { e, cat: "action", next: { cls: "ko", titre: "Action requise", txt: "Vérifier le RNCP" } };
  return { e, cat: "autre", next: { cls: "warn", titre: "Validée par le SAIO", txt: "En attente de publication au catalogue" } };
}

// Ce qu'il faut demander à l'établissement (relance) ou faire au SAIO
function motifs(r, maintenant) {
  const ancienne = !!r.Origine && !r.Mail_recu && r.Publiee === "Publiée";
  if (ancienne || r.Publiee === "Publiée") return { relance: [], saio: [] };
  const relance = [], saio = [];
  if (r.UAI === "À corriger") relance.push("UAI à corriger" + (r.Commentaire ? " : " + r.Commentaire : ""));
  if (r.RNCP === "À corriger") relance.push("RNCP à corriger" + (r.Commentaire && r.UAI !== "À corriger" ? " : " + r.Commentaire : ""));
  if (!r.Fiche_recue && r.Lien_envoye) {
    const j = Math.floor((maintenant - r.Lien_envoye) / JOUR);
    if (j >= DELAI_FICHE) relance.push(`fiche non reçue (lien envoyé il y a ${j} jours)`);
  }
  if (!r.Lien_envoye && !r.Fiche_recue) saio.push("envoyer le lien de la fiche");
  else if (r.Fiche_recue && !r.UAI) saio.push("vérifier l'UAI");
  else if (r.Fiche_recue && r.UAI === "Conforme" && !r.RNCP) saio.push("vérifier le RNCP");
  else if (r.UAI === "Conforme" && r.RNCP === "Conforme") saio.push("attendre la publication au catalogue");
  return { relance, saio };
}

function aRelancer(rows, maintenant = aujourdhui()) {
  const parEtab = new Map();
  for (const r of rows) {
    const m = motifs(r, maintenant);
    if (!m.relance.length) continue;
    const nom = (r.Etablissement || "").trim() || "Sans établissement", k = norm(nom);
    if (!parEtab.has(k)) parEtab.set(k, { nom, lignes: [], derniere: 0, ids: [] });
    const e = parEtab.get(k);
    e.lignes.push({ formation: r.Formation, motifs: m.relance });
    e.ids.push(r.id);
    e.derniere = Math.max(e.derniere, r.Relance_le || 0);
  }
  return [...parEtab.values()]
    .map(e => ({ ...e, masque: e.derniere && (maintenant - e.derniere) / JOUR < DELAI_RELANCE }))
    .sort((a, b) => a.masque - b.masque || a.nom.localeCompare(b.nom));
}

function tachesSaio(rows, maintenant = aujourdhui()) {
  const t = [];
  for (const r of rows) {
    const m = motifs(r, maintenant);
    for (const x of m.saio) if (x !== "attendre la publication au catalogue") t.push({ etab: r.Etablissement, formation: r.Formation, tache: x });
  }
  return t.sort((a, b) => String(a.tache).localeCompare(b.tache) || String(a.etab).localeCompare(b.etab));
}

function construire(rows, maintenant = aujourdhui()) {
  const groupes = new Map();
  for (const r of rows) {
    const nom = (r.Etablissement || "").trim() || "Sans établissement";
    const k = norm(nom);
    if (!groupes.has(k)) groupes.set(k, { cle: k, nom, formations: [] });
    groupes.get(k).formations.push({ r, ...analyser(r, maintenant) });
  }
  const ordre = { action: 0, attente: 1, autre: 2, publie: 3, parcoursup: 4 };
  const gs = [...groupes.values()];
  for (const g of gs) g.formations.sort((a, b) => ordre[a.cat] - ordre[b.cat] || String(a.r.Formation).localeCompare(String(b.r.Formation)));
  const actif = g => g.formations.some(f => f.cat !== "parcoursup");
  gs.sort((a, b) => (actif(b) - actif(a)) || a.nom.localeCompare(b.nom));
  return gs;
}

// ------------------------------------------------------------------ écriture dans Grist

let DEMO = false, ROWS = [];

async function maj(id, champs) {
  if (DEMO) { const r = ROWS.find(x => x.id === id); Object.assign(r, champs); rendre(); return; }
  await grist.docApi.applyUserActions([["UpdateRecord", TABLE, id, champs]]);
  await charger();
}
async function ajouter(liste) {
  if (DEMO) { for (const c of liste) ROWS.push({ id: Math.max(0, ...ROWS.map(r => r.id)) + 1, ...c }); rendre(); return; }
  await grist.docApi.applyUserActions([["BulkAddRecord", TABLE, liste.map(() => null), colonnes(liste)]]);
  await charger();
}
async function supprimer(id) {
  if (DEMO) { ROWS = ROWS.filter(r => r.id !== id); rendre(); return; }
  await grist.docApi.applyUserActions([["RemoveRecord", TABLE, id]]);
  await charger();
}
function colonnes(liste) {
  const cols = {};
  for (const k of new Set(liste.flatMap(Object.keys))) cols[k] = liste.map(x => x[k] ?? null);
  return cols;
}

// ------------------------------------------------------------------ affichage

let filtre = "tous", recherche = "";
const ouverts = new Set();

function rendre() {
  const zone = document.getElementById("liste");
  if (!zone) return;
  const groupes = construire(ROWS);
  const toutes = groupes.flatMap(g => g.formations);
  const n = c => toutes.filter(f => f.cat === c).length;
  const kpis = document.getElementById("kpis");
  if (kpis) kpis.innerHTML = `
    <div class="kpi ko"><b>${n("action")}</b><span>action requise</span></div>
    <div class="kpi warn"><b>${n("attente")}</b><span>fiche attendue</span></div>
    <div class="kpi"><b>${n("autre")}</b><span>attente catalogue</span></div>
    <div class="kpi ok"><b>${n("publie")}</b><span>publiées</span></div>
    <div class="kpi"><b>${n("parcoursup")}</b><span>déjà sur Parcoursup</span></div>`;
  const ban = document.getElementById("bandeaux");
  if (ban) ban.innerHTML = DEMO ? `<div class="demo">Mode démonstration : données fictives (le widget n'est pas ouvert dans Grist).</div>` : "";

  const rel = aRelancer(ROWS), act = rel.filter(e => !e.masque), mas = rel.filter(e => e.masque);
  const taches = tachesSaio(ROWS);
  const pan = document.getElementById("panneaux");
  if (pan) pan.innerHTML = `
    <section class="panneau">
      <h2>À relancer <span class="compte ${act.length ? "ko" : "ok"}">${act.length} établissement${act.length > 1 ? "s" : ""}</span></h2>
      ${act.length ? `<div class="cartes">${act.map(e => `
        <div class="carte">
          <div class="carte-tete"><b>${esc(e.nom)}</b>
            <button class="btn petit" data-relance="${e.ids.join(",")}">Relancé aujourd'hui</button></div>
          <ul>${e.lignes.map(l => `<li><b>${esc(l.formation)}</b> — ${l.motifs.map(esc).join(" ; ")}</li>`).join("")}</ul>
        </div>`).join("")}</div>` : `<p class="rien">Personne à relancer pour le moment.</p>`}
      ${mas.length ? `<p class="rien">Relancés récemment (réapparaîtront dans ${DELAI_RELANCE} jours si rien ne bouge) : ${mas.map(e => esc(e.nom) + " le " + dateCourte(e.derniere)).join(", ")}</p>` : ""}
    </section>
    <section class="panneau">
      <h2>À faire au SAIO <span class="compte ${taches.length ? "warn" : "ok"}">${taches.length}</span></h2>
      ${taches.length ? `<ul class="taches">${taches.map(t => `<li><span class="tag warn">${esc(t.tache)}</span> ${esc(t.etab)} — ${esc(t.formation)}</li>`).join("")}</ul>`
        : `<p class="rien">Rien à faire pour le moment.</p>`}
    </section>`;
  if (pan) pan.querySelectorAll("[data-relance]").forEach(b => b.addEventListener("click", async () => {
    const ids = b.dataset.relance.split(",").map(Number);
    const d = aujourdhui();
    if (DEMO) { for (const r of ROWS) if (ids.includes(r.id)) r.Relance_le = d; rendre(); return; }
    await grist.docApi.applyUserActions([["BulkUpdateRecord", TABLE, ids, { Relance_le: ids.map(() => d) }]]);
    await charger();
  }));

  const q = norm(recherche);
  const html = groupes.map(g => {
    const fs = g.formations.filter(f => (filtre === "tous" || f.cat === filtre) &&
      (!q || norm(g.nom).includes(q) || norm(f.r.Formation).includes(q)));
    if (!fs.length) return "";
    const tot = g.formations.length, c = k => g.formations.filter(f => f.cat === k).length;
    const act = c("action"), att = c("attente"), aut = c("autre"), pub = c("publie"), ps = c("parcoursup");
    const enCours = tot - ps;
    const seg = (k, col) => k ? `<i style="width:${100 * k / tot}%;background:${col}"></i>` : "";
    const pl = k => k > 1 ? "s" : "";
    const tags = [
      act ? `<span class="tag ko">${act} action${pl(act)} requise${pl(act)}</span>` : "",
      att ? `<span class="tag warn">${att} fiche${pl(att)} attendue${pl(att)}</span>` : "",
      aut ? `<span class="tag wait">${aut} en attente catalogue</span>` : "",
      pub ? `<span class="tag ok">${pub} publiée${pl(pub)}</span>` : "",
      ps ? `<span class="tag wait">${ps} déjà sur Parcoursup</span>` : "",
    ].join("");
    const ouvert = ouverts.has(g.cle) || !!q || filtre !== "tous";
    return `<section class="etab${ouvert ? " open" : ""}" data-cle="${esc(g.cle)}">
      <div class="etab-head">
        <span class="chev">▶</span>
        <div class="etab-name"><b>${esc(g.nom)}</b><span>${enCours ? enCours + " demande" + pl(enCours) + " en cours" : "aucune demande en cours"}${ps ? " · " + ps + " déjà sur Parcoursup" : ""}</span></div>
        <div><div class="progress">${seg(pub + ps, "var(--green)")}${seg(aut, "#9fd8b0")}${seg(att, "#f5a000")}${seg(act, "var(--red)")}</div>
          <div class="progress-label">${pub + ps} / ${tot} publiée${pl(pub + ps)}</div></div>
        <div class="tags">${tags}</div>
      </div>
      <div class="forms">${fs.map(ligneFormation).join("")}
        <div class="ajout-ligne"><button class="btn-lien" data-ajout="${esc(g.nom)}">+ Ajouter une formation pour ${esc(g.nom)}</button></div>
      </div>
    </section>`;
  }).join("");
  zone.innerHTML = html || `<div class="empty">${ROWS.length ? "Aucune formation ne correspond." : "Aucune formation suivie. Cliquez sur « + Nouvelle demande » pour commencer."}</div>`;
  brancher(zone);
}

function ligneFormation(f) {
  const r = f.r;
  const steps = ETAPES.map((et, i) => {
    const s = f.e[i].s;
    const ic = s === "done" ? "✓" : s === "ko" ? "!" : "";
    return `<button class="step ${s}" data-id="${r.id}" data-etape="${i}" title="Cliquer pour modifier">
      <span class="dot">${ic}</span>${et.nom}${f.e[i].t ? `<em>${esc(f.e[i].t)}</em>` : ""}</button>`;
  }).join("");
  const sous = [];
  if (r.Lieu) sous.push(esc(r.Lieu));
  if (r.Lien_Parcoursup) sous.push(`<a href="${esc(r.Lien_Parcoursup)}" target="_blank" rel="noopener">fiche Parcoursup</a>`);
  return `<div class="form" data-id="${r.id}">
    <div class="form-name"><b>${esc(r.Formation || "(sans intitulé)")}</b><span>${sous.join(" · ")}</span></div>
    <div class="steps">${steps}</div>
    <div class="next ${f.next.cls}"><b>${esc(f.next.titre)}</b>${esc(f.next.txt)}
      <div class="outils"><button class="btn-lien" data-com="${r.id}">${r.Commentaire ? "Modifier le commentaire" : "+ Commentaire"}</button>
      <button class="btn-lien rouge" data-suppr="${r.id}">Supprimer</button></div>
      ${r.Commentaire && f.next.titre !== "À corriger" ? `<div class="com">${esc(r.Commentaire)}</div>` : ""}
    </div>
  </div>`;
}

function brancher(zone) {
  zone.querySelectorAll(".etab-head").forEach(h => h.addEventListener("click", () => {
    const s = h.parentElement;
    s.classList.toggle("open");
    if (s.classList.contains("open")) ouverts.add(s.dataset.cle); else ouverts.delete(s.dataset.cle);
  }));
  zone.querySelectorAll(".step").forEach(b => b.addEventListener("click", ev => {
    ev.stopPropagation();
    ouvrirEtape(b, Number(b.dataset.id), Number(b.dataset.etape));
  }));
  zone.querySelectorAll("[data-com]").forEach(b => b.addEventListener("click", () => {
    const id = Number(b.dataset.com), r = ROWS.find(x => x.id === id);
    const t = prompt("Commentaire pour « " + (r.Formation || "") + " » :", r.Commentaire || "");
    if (t !== null) maj(id, { Commentaire: t.trim() });
  }));
  zone.querySelectorAll("[data-suppr]").forEach(b => b.addEventListener("click", () => {
    const id = Number(b.dataset.suppr), r = ROWS.find(x => x.id === id);
    if (confirm("Supprimer « " + (r.Formation || "") + " » du suivi ?")) supprimer(id);
  }));
  zone.querySelectorAll("[data-ajout]").forEach(b => b.addEventListener("click", ev => { ev.stopPropagation(); ouvrirAjout(b.dataset.ajout); }));
}

// ------------------------------------------------------------------ fenêtre de modification d'une étape

function fermerPop() {
  const p = document.getElementById("pop");
  if (p) p.remove();
}

function placer(pop, ancre) {
  document.body.appendChild(pop);
  if (ancre) {
    const rect = ancre.getBoundingClientRect();
    pop.style.top = (window.scrollY + rect.bottom + 6) + "px";
    pop.style.left = Math.max(8, Math.min(window.innerWidth - pop.offsetWidth - 8, window.scrollX + rect.left - 60)) + "px";
  } else {
    pop.style.top = (window.scrollY + 90) + "px";
    pop.style.left = Math.max(8, (window.innerWidth - pop.offsetWidth) / 2) + "px";
  }
}

function ouvrirEtape(bouton, id, i) {
  fermerPop();
  const r = ROWS.find(x => x.id === id), et = ETAPES[i];
  if (!r) return;
  const pop = document.createElement("div");
  pop.id = "pop"; pop.className = "pop";
  const effacer = r[et.col] ? `<button class="btn gris" data-v="vide">Effacer</button>` : "";
  let corps;
  if (et.type === "date") {
    corps = `<label>${et.nom} le <input type="date" id="pop-date" value="${versInput(r[et.col]) || versInput(aujourdhui())}"></label>
      <div class="pop-btns"><button class="btn" data-v="ok">Valider</button>${effacer}</div>`;
  } else if (et.type === "verif") {
    corps = `<div class="pop-btns"><button class="btn vert" data-v="Conforme">Conforme</button>
      <button class="btn rouge" data-v="À corriger">À corriger</button>${effacer}</div>`;
  } else {
    corps = `<div class="pop-btns"><button class="btn vert" data-v="Publiée">Publiée au catalogue</button>${effacer}</div>`;
  }
  pop.innerHTML = `<b>${esc(r.Formation || "")} — ${et.nom}</b>${corps}`;
  placer(pop, bouton);
  pop.querySelectorAll("[data-v]").forEach(b => b.addEventListener("click", async () => {
    const v = b.dataset.v, champs = {};
    if (v === "vide") champs[et.col] = null;
    else if (et.type === "date") {
      const d = document.getElementById("pop-date");
      champs[et.col] = (d && depuisInput(d.value)) || aujourdhui();
    } else champs[et.col] = v;
    if (v === "À corriger") {
      const t = prompt("Que faut-il corriger ? (facultatif)", r.Commentaire || "");
      if (t !== null && t.trim()) champs.Commentaire = t.trim();
    }
    fermerPop();
    await maj(id, champs);
  }));
}

// ------------------------------------------------------------------ ajout d'établissement / de formations

function ouvrirAjout(etab) {
  fermerPop();
  const noms = [...new Set(ROWS.map(r => (r.Etablissement || "").trim()).filter(Boolean))].sort();
  const pop = document.createElement("div");
  pop.id = "pop"; pop.className = "pop pop-large";
  pop.innerHTML = `<b>${etab ? "Ajouter des formations pour " + esc(etab) : "Nouvelle demande de référencement"}</b>
    <label>Établissement <input id="aj-etab" list="aj-liste" value="${esc(etab || "")}" placeholder="Nom de l'établissement"></label>
    <datalist id="aj-liste">${noms.map(n => `<option value="${esc(n)}">`).join("")}</datalist>
    <label>Formations demandées <small>(une par ligne)</small>
      <textarea id="aj-forms" rows="4" placeholder="BTS NDRC&#10;BTS MCO"></textarea></label>
    <label>Lieu / campus <small>(facultatif)</small> <input id="aj-lieu"></label>
    <label>Mail reçu le <input type="date" id="aj-date" value="${versInput(aujourdhui())}"></label>
    <div class="pop-btns"><button class="btn" id="aj-ok">Ajouter</button><button class="btn gris" id="aj-annul">Annuler</button></div>`;
  placer(pop, null);
  const champ = document.getElementById(etab ? "aj-forms" : "aj-etab");
  if (champ) champ.focus();
  const annul = document.getElementById("aj-annul");
  if (annul) annul.addEventListener("click", fermerPop);
  const ok = document.getElementById("aj-ok");
  if (ok) ok.addEventListener("click", async () => {
    const eEl = document.getElementById("aj-etab"), fEl = document.getElementById("aj-forms");
    const lEl = document.getElementById("aj-lieu"), dEl = document.getElementById("aj-date");
    const e = eEl ? eEl.value.trim() : "";
    const forms = (fEl ? fEl.value : "").split(/\n|;/).map(x => x.trim()).filter(Boolean);
    if (!e || !forms.length) { alert("Indiquez l'établissement et au moins une formation."); return; }
    const lieu = lEl ? lEl.value.trim() : "";
    const date = (dEl && depuisInput(dEl.value)) || aujourdhui();
    fermerPop();
    ouverts.add(norm(e));
    await ajouter(forms.map(f => ({ Etablissement: e, Formation: f, Lieu: lieu || null, Mail_recu: date })));
  });
}

// ------------------------------------------------------------------ chargement

async function charger() {
  try {
    ROWS = lignes(await grist.docApi.fetchTable(TABLE));
    DEMO = false;
  } catch (e) {
    const ban = document.getElementById("bandeaux");
    if (ban) ban.innerHTML = `<div class="banner" style="background:var(--red-bg);color:var(--red)">Impossible de lire la table « ${TABLE} » (${esc(e && e.message || e)}).
      Vérifiez que le widget a l'« Accès complet au document » : panneau de droite, onglet « Personnalisée ».</div>`;
    return;
  }
  rendre();
}

function demo() {
  DEMO = true;
  const j = s => Date.UTC(2026, Number(s.slice(3, 5)) - 1, Number(s.slice(0, 2))) / 1000;
  ROWS = [
    { id: 1, Etablissement: "TALIS", Formation: "BTS NDRC", Lieu: "TALIS Bordeaux", Mail_recu: j("20/10"), Lien_envoye: j("21/10"), Fiche_recue: j("25/10"), UAI: "Conforme", RNCP: "Conforme", Publiee: "Publiée" },
    { id: 2, Etablissement: "TALIS", Formation: "BTS MCO", Lieu: "TALIS Bordeaux", Mail_recu: j("20/10"), Lien_envoye: j("21/10"), Fiche_recue: j("25/10"), UAI: "Conforme", RNCP: "À corriger", Commentaire: "RNCP de la fiche ≠ catalogue (38362 attendu)" },
    { id: 3, Etablissement: "TALIS", Formation: "BTS Communication", Lieu: "TALIS Bayonne", Mail_recu: j("10/10"), Lien_envoye: j("12/10") },
    { id: 7, Etablissement: "ADREC", Formation: "TP Négociateur technico-commercial", Mail_recu: j("15/10"), Lien_envoye: j("16/10"), Fiche_recue: j("22/10"), UAI: "À corriger", Commentaire: "UAI formateur ≠ catalogue (0333233K attendu)" },
    { id: 4, Etablissement: "CAMPUS DU LAC", Formation: "BTS GPME", Mail_recu: j("29/10") },
    { id: 5, Etablissement: "ADREC", Formation: "TP Gestionnaire de paie", Mail_recu: j("15/10"), Lien_envoye: j("16/10"), Fiche_recue: j("22/10"), UAI: "Conforme", RNCP: "Conforme" },
    { id: 6, Etablissement: "PIGIER", Formation: "BTS GPME - en apprentissage", Lieu: "PIGIER BORDEAUX (33)", Publiee: "Publiée", Origine: "Tableau initial", g_ta_cod: "34388" },
  ];
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
    document.addEventListener("click", ev => {
      const p = document.getElementById("pop");
      if (p && !p.contains(ev.target)) fermerPop();
    });
    document.addEventListener("keydown", ev => { if (ev.key === "Escape") fermerPop(); });

    if (window.grist && window.self !== window.top) {
      grist.ready({ requiredAccess: "full" });
      let t = null;
      grist.onRecords(() => { clearTimeout(t); t = setTimeout(charger, 200); });
      charger();
    } else {
      demo();
    }
  });
}

if (typeof module !== "undefined") module.exports = { construire, analyser, aRelancer, tachesSaio };
