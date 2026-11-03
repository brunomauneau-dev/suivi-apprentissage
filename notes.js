// Notes datées par formation (table Grist « Notes » : Formation → Suivi, Date, Texte, Auteur rempli automatiquement).
// Remplacent le commentaire libre : l'ancien commentaire de chaque formation est repris une fois comme première note.
// Utilise les variables et fonctions de suivi.js (ROWS, DEMO, esc, norm, aujourdhui, actions, charger, nouvellePop…).

let NOTES = [];
const COLS_NOTES = [
  { id: "Formation", type: "Ref:Suivi" },
  { id: "Date", type: "Date", widgetOptions: JSON.stringify({ dateFormat: "DD/MM/YYYY" }) },
  { id: "Texte", type: "Text" },
  { id: "Auteur", type: "Text", isFormula: false, formula: "user.Name if user else None" },   // rempli à la création
  { id: "Reprise", type: "Bool" },                                                          // ancien commentaire repris
];

// Crée la table au premier usage
async function preparerNotes(table) {
  if (table) return table;
  await grist.docApi.applyUserActions([["AddTable", "Notes", COLS_NOTES]]);
  return grist.docApi.fetchTable("Notes");
}

// Reprend une fois l'ancien commentaire de chaque formation comme première note (le commentaire d'origine n'est pas effacé)
async function reprendreCommentaires() {
  const deja = new Set(NOTES.filter(n => n.Reprise).map(n => Number(n.Formation)));
  const a = ROWS.filter(r => r.Commentaire && String(r.Commentaire).trim() && !deja.has(r.id));
  if (!a.length) return false;
  const lignes = a.map(r => ({ Formation: r.id, Date: null, Texte: String(r.Commentaire).trim(), Reprise: true }));
  if (DEMO) { lignes.forEach(l => NOTES.push({ id: NOTES.length + 1, Auteur: "", ...l })); return true; }
  const cols = {};
  for (const k of Object.keys(lignes[0])) cols[k] = lignes.map(l => l[k]);
  await actions([["BulkAddRecord", "Notes", lignes.map(() => null), cols]]);
  return true;
}

// Notes d'une formation, les plus récentes d'abord (l'ancien commentaire, sans date, en dernier)
function notesDe(id) {
  return NOTES.filter(n => Number(n.Formation) === id).sort((a, b) => (b.Date || 0) - (a.Date || 0) || b.id - a.id);
}
function enteteNote(n) {
  if (n.Reprise || !n.Date) return "ancien commentaire";
  return new Date(n.Date * 1000).toLocaleDateString("fr-FR", { timeZone: "UTC" }) + (n.Auteur ? " · " + n.Auteur : "");
}

// Sous le nom de la formation : la dernière note et l'accès au fil
function resumeNotes(r) {
  const ns = notesDe(r.id);
  if (!ns.length) return "";
  const t = ns[0].Texte || "";
  return `<div class="com note-derniere"><b>${esc(enteteNote(ns[0]))}</b> : ${esc(t.length > 140 ? t.slice(0, 140) + "…" : t)}
    ${ns.length > 1 ? ` <button class="btn-lien" data-com="${r.id}">voir les ${ns.length} notes</button>` : ""}</div>`;
}
function lienNote(r) { return `<button class="btn-lien" data-com="${r.id}">+ note</button>`; }

function ouvrirNotes(id) {
  const r = ROWS.find(x => x.id === id);
  if (!r) return;
  const ns = notesDe(id);
  const autres = ROWS.filter(x => x.id !== id && norm(x.Etablissement) === norm(r.Etablissement));
  const pop = nouvellePop("pop-large");
  pop.innerHTML = `<div class="fiche-tete"><b>Notes — ${esc(r.Formation || "")}</b><button class="btn gris petit" id="n-fermer">Fermer</button></div>
    <p class="rien">${esc(r.Etablissement || "")}</p>
    <textarea id="n-texte" rows="3" placeholder="ex. appel du proviseur : la fiche sera remplie cette semaine"></textarea>
    ${autres.length ? `<label class="case"><input type="checkbox" id="n-toutes"> Ajouter aussi aux ${autres.length} autre${autres.length > 1 ? "s" : ""} formation${autres.length > 1 ? "s" : ""} de ${esc(r.Etablissement)}</label>` : ""}
    <div class="pop-btns"><button class="btn" id="n-ok">Ajouter la note</button></div>
    ${ns.length ? `<ul class="notes">${ns.map(n => `<li data-note="${n.id}"><b>${esc(enteteNote(n))}
        <span class="n-actions"><button class="btn-lien" data-n-modif="${n.id}">modifier</button> · <button class="btn-lien rouge" data-n-suppr="${n.id}">supprimer</button></span></b>
        <span class="n-texte">${esc(n.Texte || "")}</span></li>`).join("")}</ul>`
      : `<p class="rien">Aucune note pour le moment.</p>`}`;
  placer(pop, null);
  const f = document.getElementById("n-fermer"); if (f) f.addEventListener("click", fermerPop);
  const t = document.getElementById("n-texte"); if (t) t.focus();
  // modifier une note : le texte devient éditable sur place
  pop.querySelectorAll("[data-n-modif]").forEach(b => b.addEventListener("click", () => {
    const nid = Number(b.dataset.nModif), n = NOTES.find(x => x.id === nid), li = pop.querySelector(`[data-note="${nid}"]`);
    if (!n || !li) return;
    const zone = li.querySelector(".n-texte");
    zone.innerHTML = `<textarea rows="3" class="n-edit">${esc(n.Texte || "")}</textarea>
      <span class="pop-btns"><button class="btn petit" data-n-save>Enregistrer</button><button class="btn petit gris" data-n-annul>Annuler</button></span>`;
    const ta = zone.querySelector("textarea"); if (ta) ta.focus();
    const an = zone.querySelector("[data-n-annul]"); if (an) an.addEventListener("click", () => ouvrirNotes(id));
    const sv = zone.querySelector("[data-n-save]");
    if (sv) sv.addEventListener("click", async () => {
      const texte = ta ? ta.value.trim() : "";
      if (!texte) { if (ta) ta.focus(); return; }
      sv.disabled = true;
      try {
        if (DEMO) n.Texte = texte; else await actions([["UpdateRecord", "Notes", nid, { Texte: texte }]]);
        if (DEMO) rendre(); else await charger();
        ouvrirNotes(id);
      } catch (e) { sv.disabled = false; alert("Échec de la modification : " + (e && e.message || e)); }
    });
  }));
  pop.querySelectorAll("[data-n-suppr]").forEach(b => b.addEventListener("click", async () => {
    const nid = Number(b.dataset.nSuppr);
    if (!confirm("Supprimer cette note ?")) return;
    try {
      if (DEMO) NOTES = NOTES.filter(x => x.id !== nid); else await actions([["RemoveRecord", "Notes", nid]]);
      if (DEMO) rendre(); else await charger();
      ouvrirNotes(id);
    } catch (e) { alert("Échec de la suppression : " + (e && e.message || e)); }
  }));
  const ok = document.getElementById("n-ok");
  if (ok) ok.addEventListener("click", async () => {
    const el = document.getElementById("n-texte"), texte = el ? el.value.trim() : "";
    if (!texte) { if (el) el.focus(); return; }
    const tous = document.getElementById("n-toutes");
    const ids = [id, ...(tous && tous.checked ? autres.map(x => x.id) : [])];
    ok.disabled = true;
    try {
      if (DEMO) ids.forEach(i => NOTES.push({ id: NOTES.length + 1, Formation: i, Date: aujourdhui(), Texte: texte, Auteur: "vous" }));
      else await actions([["BulkAddRecord", "Notes", ids.map(() => null), { Formation: ids, Date: ids.map(() => aujourdhui()), Texte: ids.map(() => texte) }]]);
      if (DEMO) rendre(); else await charger();
      ouvrirNotes(id);
    } catch (e) {
      ok.disabled = false;
      alert("Échec de l'enregistrement de la note : " + (e && e.message || e));
    }
  });
}
