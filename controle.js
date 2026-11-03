// Onglet « Contrôle d'affichage » : vérification, sur le site de chaque formation ouverte sur Parcoursup,
// que la procédure d'admission Parcoursup est bien présentée (table Grist « Affichage », une ligne par formation).
// Utilise les variables et fonctions de suivi.js (ROWS, DEMO, esc, norm, aujourdhui, contactDe, rentreeCible…).

let AFFICHAGE = [], CTRL_SEL = null, CTRL_BROUILLON = null;
const CTRL_OUVERTS = new Set();   // établissements dépliés dans la liste (repliés par défaut)
let CTRL_DEFIL = 0;               // position de défilement de la liste, conservée d'un affichage à l'autre

const CRITERES = [
  { col: "Mention_exclusivite_PS", nom: "Inscription exclusivement via Parcoursup", aide: "Le site indique que la candidature se fait sur Parcoursup.",
    choix: [["Oui", "✓ Conforme", "ok"], ["Non", "✗ Non conforme", "ko"], ["Non trouvé", "Non trouvé", "nt"]] },
  { col: "Mention_hors_PS", nom: "Pas d'admission hors Parcoursup", aide: "Aucune candidature directe, dossier école ou formulaire parallèle.",
    choix: [["Non", "✓ Conforme", "ok"], ["Oui", "✗ Non conforme", "ko"]] },
  { col: "Pieces_non_necessaires", nom: "Pas de pièces non nécessaires demandées", aide: "Pas de frais de dossier, photo, pièce d'identité… au stade de la candidature.",
    choix: [["Non", "✓ Conforme", "ok"], ["Oui", "✗ Non conforme", "ko"]] },
  { col: "Entretien_admission", nom: "Entretien d'admission mentionné", aide: "Pour information.", choix: [["Oui", "Oui", "info"], ["Non", "Non", "info"]] },
  { col: "Formation_identique_initiale", nom: "Formation identique en initial", aide: "La même formation existe-t-elle hors apprentissage ? Pour information.",
    choix: [["Oui", "Oui", "info"], ["Non", "Non", "info"]] },
];
const POINTS_MAIL = {
  Mention_exclusivite_PS: "la procédure d'admission via Parcoursup n'est pas indiquée sur votre site : merci de préciser que les candidatures se font exclusivement sur la plateforme Parcoursup ;",
  Mention_hors_PS: "votre site propose une candidature en dehors de Parcoursup (formulaire, dossier ou candidature directe) : merci de la retirer ou de renvoyer vers Parcoursup ;",
  Pieces_non_necessaires: "des pièces non nécessaires sont demandées au stade de la candidature (frais de dossier, pièces justificatives…) : merci de les retirer ;",
};

// La campagne de contrôle commence le 1er septembre précédant la rentrée visée
function debutCampagne() { return Date.UTC(rentreeCible() - 1, 8, 1) / 1000; }
// Toutes les formations suivies : déjà ouvertes et nouvelles demandes (le site peut être contrôlé dès la demande)
function perimetreControle() { return ROWS.filter(r => r.Formation); }
function affDe(id) { return AFFICHAGE.find(a => Number(a.Formation) === id) || null; }

// Résultat d'un contrôle (valeurs des critères) : ok, surv (à surveiller), ko, incomplet
function verdict(v) {
  if (!v || !v.Mention_exclusivite_PS || !v.Mention_hors_PS || !v.Pieces_non_necessaires) return { s: "incomplet", n: 0 };
  const n = (v.Mention_exclusivite_PS === "Non" ? 1 : 0) + (v.Mention_hors_PS === "Oui" ? 1 : 0) + (v.Pieces_non_necessaires === "Oui" ? 1 : 0);
  if (n) return { s: "ko", n };
  if (v.Mention_exclusivite_PS === "Non trouvé") return { s: "surv", n: 0 };
  return { s: "ok", n: 0 };
}
function etatControle(r) {
  const a = affDe(r.id);
  if (!a) return { s: "afaire", a };
  // contrôles de l'ancien tableau : saisis sans date, ils comptent comme faits
  if (!a.Date_controle) return CRITERES.some(c => a[c.col]) ? { ...verdict(a), a, ancien: true } : { s: "afaire", a };
  if (a.Date_controle < debutCampagne()) return { s: "afaire", a };
  return { ...verdict(a), a };
}
const LIB_ETAT = { afaire: "à contrôler", ok: "conforme", surv: "à surveiller", ko: "non conforme", incomplet: "à compléter" };

function kpisControle() {
  const e = perimetreControle().map(etatControle);
  const n = s => e.filter(x => x.s === s).length;
  return tuile("afaire", "warn", n("afaire") + n("incomplet"), "à contrôler") + tuile("ko", "ko", n("ko"), "non conformes")
    + tuile("surv", "", n("surv"), "à surveiller") + tuile("ok", "ok", n("ok"), "conformes");
}
function aControler() { return perimetreControle().filter(r => ["afaire", "incomplet"].includes(etatControle(r).s)).length; }

function listeControle(q, filtre) {
  return perimetreControle()
    .map(r => ({ r, e: etatControle(r) }))
    .filter(x => filtre === "tous" || (filtre === "afaire" ? ["afaire", "incomplet"].includes(x.e.s) : x.e.s === filtre))
    .filter(x => !q || norm(x.r.Etablissement).includes(q) || norm(x.r.Formation).includes(q) || norm(x.r.Lieu).includes(q))
    .sort((a, b) => String(a.r.Etablissement).localeCompare(String(b.r.Etablissement)) || String(a.r.Formation).localeCompare(String(b.r.Formation)));
}

function dateLongue(sec) { return sec ? new Date(sec * 1000).toLocaleDateString("fr-FR", { timeZone: "UTC" }) : ""; }

function htmlControle(q, filtre) {
  const liste = listeControle(q, filtre);
  if (!liste.length) { CTRL_SEL = null; return `<div class="empty">${perimetreControle().length ? "Aucune formation ne correspond." : "Aucune formation ouverte sur Parcoursup à contrôler."}</div>`; }
  if (CTRL_SEL && !liste.some(x => x.r.id === CTRL_SEL)) { CTRL_SEL = null; CTRL_BROUILLON = null; }
  const groupes = new Map();
  for (const x of liste) { const k = x.r.Etablissement || "Sans établissement"; if (!groupes.has(k)) groupes.set(k, []); groupes.get(k).push(x); }
  const sel = CTRL_SEL ? ROWS.find(r => r.id === CTRL_SEL) : null;
  const items = [...groupes].map(([nom, xs]) => {
    const ouvert = CTRL_OUVERTS.has(nom) || !!q || (sel && (sel.Etablissement || "Sans établissement") === nom);
    const c = s => xs.filter(x => x.e.s === s).length;
    const resume = [c("afaire") + c("incomplet") ? `<span class="tag warn">${c("afaire") + c("incomplet")} à contrôler</span>` : "",
      c("ko") ? `<span class="tag ko">${c("ko")} non conforme${c("ko") > 1 ? "s" : ""}</span>` : "", c("surv") ? `<span class="tag wait">${c("surv")} à surveiller</span>` : "",
      c("ok") ? `<span class="tag ok">${c("ok")} conforme${c("ok") > 1 ? "s" : ""}</span>` : ""].join("");
    const forms = ouvert ? xs.map(({ r, e }) => {
      const info = e.s === "afaire" ? (e.a && e.a.Date_controle ? `dernier contrôle le ${dateLongue(e.a.Date_controle)}` : "jamais contrôlée")
        : `${e.ancien ? "contrôlée (ancien tableau)" : "contrôlée le " + dateLongue(e.a.Date_controle)} · ${LIB_ETAT[e.s]}${e.s === "ko" ? ` (${e.n} point${e.n > 1 ? "s" : ""})` : ""}${e.a.Mail_envoye_le ? ` · mail le ${dateLongue(e.a.Mail_envoye_le)}` : ""}`;
      return `<button class="c-item${r.id === CTRL_SEL ? " sel" : ""}" data-ctrl="${r.id}"><span class="c-pt ${e.s}"></span>
        <span><b>${esc(r.Formation)}</b><small>${esc(info)}</small></span></button>`;
    }).join("") : "";
    return `<div class="c-groupe${ouvert ? " open" : ""}"><button class="c-etab" data-ctrl-etab="${esc(nom)}"><span class="chev">${ouvert ? "▼" : "▶"}</span>
      <span><b>${esc(nom)}</b><small>${xs.length} formation${xs.length > 1 ? "s" : ""}</small></span><span class="c-tags">${resume}</span></button>${forms}</div>`;
  }).join("");
  return `<div class="c-grille"><div class="card-c c-liste">${items}</div><div class="card-c c-det">${CTRL_SEL ? detailControle(liste)
    : `<p class="rien" style="padding:30px 10px;text-align:center">Dépliez un établissement à gauche et choisissez une formation à contrôler.</p>`}</div></div>`;
}

function detailControle(liste) {
  const r = ROWS.find(x => x.id === CTRL_SEL);
  if (!r) return "";
  const a = affDe(r.id);
  if (!CTRL_BROUILLON || CTRL_BROUILLON.id !== r.id) {
    CTRL_BROUILLON = { id: r.id, captures: [] };
    for (const c of CRITERES) CTRL_BROUILLON[c.col] = a ? a[c.col] || null : null;
    CTRL_BROUILLON.Commentaire = a ? a.Commentaire || "" : "";
    CTRL_BROUILLON.Lien_site = r.Lien_site || "";
  }
  const b = CTRL_BROUILLON, v = verdict(b);
  const ancien = a && a.Date_controle ? (a.Date_controle < debutCampagne()
    ? `Valeurs reprises du contrôle du ${dateLongue(a.Date_controle)} (campagne précédente) : à confirmer.`
    : `Contrôlée le ${dateLongue(a.Date_controle)}.`) : a && CRITERES.some(c => a[c.col]) ? "Contrôle repris de l'ancien tableau (sans date). Modifiez si besoin puis enregistrez pour le dater." : "Première vérification de cette formation.";
  const nbCaptures = a && Array.isArray(a.Captures) ? a.Captures.length - 1 : 0;
  const lignes = CRITERES.map(c => `<tr><td class="c-crit"><b>${esc(c.nom)}</b><small>${esc(c.aide)}</small></td>
    <td class="c-choix"><span class="seg">${c.choix.map(([val, lib, cls]) =>
      `<button class="${b[c.col] === val ? "on " + cls : ""}" data-crit="${c.col}" data-val="${esc(val)}">${esc(lib)}</button>`).join("")}</span></td></tr>`).join("");
  const res = { incomplet: ["wait", "à compléter (3 premiers critères)"], ok: ["ok", "Conforme"], surv: ["warn", "À surveiller (Parcoursup non trouvé)"],
    ko: ["ko", `Non conforme (${v.n} point${v.n > 1 ? "s" : ""})`] }[v.s];
  const i = liste.findIndex(x => x.r.id === r.id), suivant = liste[i + 1] && liste[i + 1].r.Etablissement === r.Etablissement ? liste[i + 1] : null;
  return `<h2>${esc(r.Formation)}</h2>
    <div class="c-sous">${esc(r.Etablissement || "")}${r.Lieu ? " · " + esc(r.Lieu) : ""}${r.g_ta_cod ? " · fiche Parcoursup n° " + esc(r.g_ta_cod) : ""}</div>
    <div class="c-liens">
      ${b.Lien_site ? `<a class="btn" href="${esc(b.Lien_site)}" target="_blank" rel="noopener">Ouvrir le site de la formation ↗</a>` : ""}
      ${r.Lien_Parcoursup ? `<a class="btn gris" href="${esc(r.Lien_Parcoursup)}" target="_blank" rel="noopener">Ouvrir la fiche Parcoursup ↗</a>` : ""}
      <input id="ctl-site" value="${esc(b.Lien_site)}" placeholder="Adresse du site de la formation (https://…)" title="Adresse de la page de la formation sur le site de l'établissement">
    </div>
    <p class="rien">${esc(ancien)}</p>
    <table class="c-table">${lignes}</table>
    <div class="c-bas"><div><b>Commentaire</b><textarea id="ctl-com" placeholder="Ce que vous avez constaté (page, bouton, formulaire…)">${esc(b.Commentaire)}</textarea></div>
      <div class="ctl-capt" id="ctl-capt" tabindex="0"><b>Capture du site</b>
        ${b.captures.map(x => `<img src="${x.url}" alt="capture">`).join("")}
        <small>${nbCaptures ? nbCaptures + " capture(s) déjà enregistrée(s) · " : ""}copiez une capture (Win+Maj+S) puis cliquez ici et collez (Ctrl+V)</small></div></div>
    <div class="c-actions"><span>Résultat : <b class="res ${res[0]}">${esc(res[1])}</b></span>
      <span>${v.s === "ko" || v.s === "surv" ? `<button class="btn gris" id="ctl-mail">✉ Préparer le mail à l'établissement</button>` : ""}
        <button class="btn vert" id="ctl-ok" ${v.s === "incomplet" ? "disabled" : ""}>Enregistrer${suivant ? " et formation suivante →" : ""}</button></span></div>`;
}

function brancherControle(zone) {
  const l = zone.querySelector(".c-liste");
  if (l) { l.scrollTop = CTRL_DEFIL; l.addEventListener("scroll", () => { CTRL_DEFIL = l.scrollTop; }); }
  zone.querySelectorAll("[data-ctrl]").forEach(x => x.addEventListener("click", () => { CTRL_SEL = Number(x.dataset.ctrl); CTRL_BROUILLON = null; rendre(); }));
  zone.querySelectorAll("[data-ctrl-etab]").forEach(x => x.addEventListener("click", () => {
    const k = x.dataset.ctrlEtab, sel = CTRL_SEL ? ROWS.find(r => r.id === CTRL_SEL) : null;
    if (CTRL_OUVERTS.has(k) || (sel && (sel.Etablissement || "Sans établissement") === k)) {
      CTRL_OUVERTS.delete(k);
      if (sel && (sel.Etablissement || "Sans établissement") === k) { CTRL_SEL = null; CTRL_BROUILLON = null; }
    } else CTRL_OUVERTS.add(k);
    rendre();
  }));
  zone.querySelectorAll("[data-crit]").forEach(x => x.addEventListener("click", () => {
    if (!CTRL_BROUILLON) return;
    lireChampsControle();
    CTRL_BROUILLON[x.dataset.crit] = CTRL_BROUILLON[x.dataset.crit] === x.dataset.val ? null : x.dataset.val;
    rendre();
  }));
  const capt = document.getElementById("ctl-capt");
  if (capt) capt.addEventListener("paste", async ev => {
    const it = [...(ev.clipboardData ? ev.clipboardData.items : [])].find(i => i.type.startsWith("image/"));
    if (!it || !CTRL_BROUILLON) return;
    ev.preventDefault();
    const blob = it.getAsFile();
    lireChampsControle();
    CTRL_BROUILLON.captures.push({ blob, url: URL.createObjectURL(blob) });
    rendre();
  });
  const com = document.getElementById("ctl-com"), site = document.getElementById("ctl-site");
  if (com) com.addEventListener("input", lireChampsControle);
  if (site) site.addEventListener("input", lireChampsControle);
  const mail = document.getElementById("ctl-mail");
  if (mail) mail.addEventListener("click", () => { lireChampsControle(); mailControle(); });
  const ok = document.getElementById("ctl-ok");
  if (ok) ok.addEventListener("click", async () => { lireChampsControle(); ok.disabled = true; ok.textContent = "Enregistrement…"; await enregistrerControle(); });
}

function lireChampsControle() {
  if (!CTRL_BROUILLON) return;
  const c = document.getElementById("ctl-com"), s = document.getElementById("ctl-site");
  if (c) CTRL_BROUILLON.Commentaire = c.value;
  if (s) CTRL_BROUILLON.Lien_site = s.value.trim();
}

async function envoyerCapture(blob, nom) {
  const tk = await grist.docApi.getAccessToken({ readOnly: false });
  const fd = new FormData();
  fd.append("upload", blob, nom);
  const rep = await fetch(`${tk.baseUrl}/attachments?auth=${encodeURIComponent(tk.token)}`, { method: "POST", body: fd });
  if (!rep.ok) throw new Error("envoi de la capture refusé (" + rep.status + ")");
  return (await rep.json())[0];
}

async function enregistrerControle(avecMail) {
  const b = CTRL_BROUILLON, r = ROWS.find(x => x.id === b.id);
  if (!r) return;
  const liste = listeControle(norm(recherche), filtre), i = liste.findIndex(x => x.r.id === r.id);
  const suivant = !avecMail && liste[i + 1] && liste[i + 1].r.Etablissement === r.Etablissement ? liste[i + 1].r.id : avecMail ? r.id : null;
  const a = affDe(r.id), champs = { Date_controle: aujourdhui(), Commentaire: b.Commentaire || null };
  for (const c of CRITERES) champs[c.col] = b[c.col] || null;
  if (avecMail) champs.Mail_envoye_le = aujourdhui();
  try {
    if (b.captures.length && !DEMO) {
      const ids = [];
      for (const [k, x] of b.captures.entries()) ids.push(await envoyerCapture(x.blob, `capture_${r.id}_${new Date().toISOString().slice(0, 10)}_${k + 1}.png`));
      champs.Captures = ["L", ...((a && Array.isArray(a.Captures) ? a.Captures.slice(1) : [])), ...ids];
    }
    if (DEMO) {
      if (a) Object.assign(a, champs); else AFFICHAGE.push({ id: AFFICHAGE.length + 1, Formation: r.id, ...champs });
      r.Lien_site = b.Lien_site;
    } else {
      const acts = [a ? ["UpdateRecord", "Affichage", a.id, champs] : ["AddRecord", "Affichage", null, { Formation: r.id, ...champs }]];
      if ((b.Lien_site || "") !== (r.Lien_site || "")) acts.push(["UpdateRecord", "Suivi", r.id, { Lien_site: b.Lien_site || null }]);
      await actions(acts);
    }
    CTRL_SEL = suivant; CTRL_BROUILLON = null;
    if (DEMO) rendre(); else await charger();
  } catch (e) {
    const ban = document.getElementById("bandeaux");
    if (ban) ban.innerHTML = `<div class="banner">Échec de l'enregistrement : ${esc(e && e.message || e)}</div>`;
    rendre();
  }
}

function mailControle() {
  const b = CTRL_BROUILLON, r = ROWS.find(x => x.id === b.id);
  if (!r) return;
  const points = [];
  if (b.Mention_exclusivite_PS === "Non" || b.Mention_exclusivite_PS === "Non trouvé") points.push(POINTS_MAIL.Mention_exclusivite_PS);
  if (b.Mention_hors_PS === "Oui") points.push(POINTS_MAIL.Mention_hors_PS);
  if (b.Pieces_non_necessaires === "Oui") points.push(POINTS_MAIL.Pieces_non_necessaires);
  const c = contactDe(r.Etablissement);
  const objet = `Parcoursup - présentation de la formation ${r.Formation} sur votre site`;
  const corps = `Bonjour,

Dans le cadre du suivi des formations en apprentissage proposées sur Parcoursup, nous avons consulté la page de la formation « ${r.Formation} » sur votre site${b.Lien_site ? " (" + b.Lien_site + ")" : ""}.

Nous constatons les points suivants :
${points.map(p => "- " + p).join("\n")}
${b.Commentaire ? "\nPrécision : " + b.Commentaire + "\n" : ""}
Les admissions dans cette formation se font exclusivement via Parcoursup. Nous vous remercions de bien vouloir mettre votre site à jour et de nous en informer.

Cordialement,
SAIO - Académie de Bordeaux`;
  const lien = document.createElement("a");
  lien.href = `mailto:${encodeURIComponent(c.email || "")}?subject=${encodeURIComponent(objet)}&body=${encodeURIComponent(corps)}`;
  lien.target = "_blank"; lien.rel = "noopener";
  document.body.appendChild(lien); lien.click(); lien.remove();
  enregistrerControle(true);
}

// Adresses des sites issues du tableau initial (liens_sites.json, par n° Parcoursup) : reprises une fois si la colonne est vide
async function completerLiensSites() {
  try {
    const manque = ROWS.filter(r => !r.Lien_site && r.g_ta_cod);
    if (!manque.length) return false;
    const liens = await (await fetch("liens_sites.json", { cache: "no-store" })).json();
    const maj = manque.filter(r => liens[String(r.g_ta_cod)]);
    if (!maj.length) return false;
    if (DEMO) { maj.forEach(r => { r.Lien_site = liens[String(r.g_ta_cod)]; }); return true; }
    await actions([["BulkUpdateRecord", "Suivi", maj.map(r => r.id), { Lien_site: maj.map(r => liens[String(r.g_ta_cod)]) }]]);
    return true;
  } catch (e) { return false; }
}
