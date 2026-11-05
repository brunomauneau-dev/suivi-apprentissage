// Export PDF de l'onglet affiché (« Nouvelles demandes », « Formations déjà ouvertes », « Contrôle d'affichage »),
// avec le filtre et la recherche en cours. Tableau à plat, regroupé par établissement, en A4 paysage.
// Utilise les variables et fonctions de suivi.js, controle.js et notes.js (ROWS, CATALOGUE, onglet, filtre, recherche…).
// jsPDF n'est chargé qu'au premier export (lib/, comme SheetJS).

let PDF_PRET = null;
function chargerPdf() {
  if (window.jspdf && window.jspdf.jsPDF && window.jspdf.jsPDF.API.autoTable) return Promise.resolve();
  const script = src => new Promise((ok, ko) => {
    const s = document.createElement("script");
    s.src = src; s.onload = ok; s.onerror = () => ko(new Error("chargement de " + src + " impossible"));
    document.head.appendChild(s);
  });
  PDF_PRET = PDF_PRET || script("lib/jspdf.umd.min.js").then(() => script("lib/jspdf.plugin.autotable.min.js"))
    .catch(e => { PDF_PRET = null; throw e; });
  return PDF_PRET;
}

// Les polices standard du PDF ne connaissent que le jeu Windows-1252 : on remplace ou retire le reste (✓, →, espaces fines…)
const PDF_CP1252 = "€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ";
function txt(v) {
  return String(v ?? "").replace(/[   ]/g, " ").replace(/→/g, "->").replace(/[✓✔]/g, "").replace(/[✗✘]/g, "")
    .replace(/[^\x00-\xFF]/g, c => PDF_CP1252.includes(c) ? c : "").replace(/\r/g, "").replace(/[^\S\n]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}
const dateFr = sec => sec ? new Date(sec * 1000).toLocaleDateString("fr-FR", { timeZone: "UTC" }) : "";
function derniereNote(r) {
  const n = (typeof notesDe === "function" ? notesDe(r.id) : [])[0];
  if (!n) return "";
  const t = String(n.Texte || "");
  return (n.Reprise || !n.Date ? "" : dateFr(n.Date) + " : ") + (t.length > 220 ? t.slice(0, 220) + "…" : t);
}

const COULEURS_PDF = { ok: [227, 244, 232], ko: [253, 232, 231], warn: [255, 241, 224], wait: [240, 240, 240] };
const TEXTES_PDF = { ok: [24, 117, 60], ko: [206, 5, 0], warn: [179, 64, 0], wait: [102, 102, 102] };
// cellule colorée (fond + texte) selon l'état
const cel = (content, etat, extra) => etat ? { content: txt(content), styles: { fillColor: COULEURS_PDF[etat], textColor: TEXTES_PDF[etat], ...extra } } : { content: txt(content), styles: extra || {} };

// Lignes de l'onglet en cours, mêmes règles que l'affichage (rendre)
function groupesAffiches() {
  const q = norm(recherche);
  const dansOnglet = f => !!f.historique === (onglet === "ouvertes");
  const garde = (g, f) => (filtre === "tous" || f.cat_ === filtre) && (!q || norm(g.nom).includes(q) || norm(f.r.Formation).includes(q) || norm(f.r.Lieu).includes(q));
  const ordre = { saio: 0, attente: 1, nonpub: 2, parcoursup: 3, publie: 3 };
  return construire(ROWS).map(g => ({ ...g, tot: g.formations.filter(dansOnglet).length,
    formations: g.formations.filter(f => dansOnglet(f) && garde(g, f))
      .sort((a, b) => ordre[a.cat_] - ordre[b.cat_] || String(a.r.Formation).localeCompare(String(b.r.Formation))) }))
    .filter(g => g.formations.length);
}
const pl = n => n > 1 ? "s" : "";

function tableDemandes() {
  const etapes = ETAPES.map(et => et.nom === "Catalogue national" ? "Catalogue" : et.nom);
  const head = ["Formation", ...etapes, "Prochaine action", "Dernière note"];
  const corps = [];
  let n = 0;
  for (const g of groupesAffiches()) {
    const c = contactDe(g.nom), contact = [c.nom, c.tel, c.email].filter(Boolean).join(" · ");
    corps.push({ etab: true, cells: [`${g.nom} — ${g.tot} formation${pl(g.tot)}${contact ? " — contact : " + contact : ""}`] });
    for (const f of g.formations) {
      n++;
      const r = f.r, prochaine = ETAPES.findIndex((et, i) => f.e[i].s !== "done");
      const cases = ETAPES.map((et, i) => {
        const s = f.e[i].s;
        if (s === "done") return cel(f.e[i].t || "OK", "ok", { halign: "center" });
        if (s === "ko") return cel(et.type === "date" ? "!" : "à corriger", "ko", { halign: "center" });
        if (i === prochaine) return cel(A_FAIRE[i], "warn", { halign: "center" });
        return cel("—", null, { halign: "center", textColor: [170, 170, 170] });
      });
      const etat = { saio: "warn", attente: "wait", publie: "ok" }[f.cat_] || "wait";
      corps.push({ cells: [
        { content: txt(r.Formation || "(sans intitulé)") + (r.Lieu ? "\n" + txt(r.Lieu) : ""), styles: { fontStyle: "bold" } },
        ...cases,
        cel((f.cat_ === "saio" ? "À faire au SAIO" : f.next.titre) + "\n" + f.next.txt, etat),
        cel(derniereNote(r)),
      ] });
    }
  }
  const largeurs = { 0: { cellWidth: 52 }, 8: { cellWidth: 60 } };   // la dernière note prend la place restante
  for (let i = 1; i <= ETAPES.length; i++) largeurs[i] = { cellWidth: 17 };
  return { head, corps, n, largeurs };
}

function tableOuvertes() {
  const cible = rentreeCible();
  const head = ["Formation", "Retrouvée dans l'export Carif-Oref", "Diplôme", `Session rentrée ${cible}`, "Statut", "Dernière note"];
  const corps = [];
  let n = 0;
  for (const g of groupesAffiches()) {
    corps.push({ etab: true, cells: [`${g.nom} — ${g.tot} formation${pl(g.tot)}`] });
    for (const f of g.formations) {
      n++;
      const r = f.r, c = f.cat;
      const sous = [r.Lieu, r.g_ta_cod ? "Parcoursup n° " + r.g_ta_cod : "", r.Publiee_le ? "publiée le " + dateFr(r.Publiee_le) : ""].filter(Boolean).join(" · ");
      let exp, dip = cel("—"), ses = cel("—");
      if (!CATALOGUE.length) exp = cel("export non importé", "wait");
      else if (r.Cle_carif === "ABSENTE") exp = cel("absente de l'export", "ko");
      else if (!c) exp = cel("à retrouver", "warn");
      else {
        exp = cel([c.Formateur_RS || c.Libelle_formation, c.Ville, c.UAI_validee].filter(Boolean).join(" · "));
        dip = /archiv/i.test(c.Etat_diplome || "") ? cel("archivé", "ko") : c.Etat_diplome ? cel("valide", "ok") : cel("?");
        const d = debutsSessions(c), rok = rentreeOk(c), [a, b] = fenetreRentree(), bonne = d.find(x => x.t >= a && x.t <= b);
        ses = rok === false ? cel(d.length ? "non (dernière : " + d[d.length - 1].txt + ")" : "aucune pour " + cible, "ko")
          : rok ? cel(bonne ? bonne.txt : String(cible), "ok") : cel("?");
      }
      const [cls, lib] = f.cat_ === "saio" ? ["warn", "À retrouver"] : PASTILLE[f.cat_] || ["wait", ""];
      corps.push({ cells: [
        { content: txt(r.Formation || "") + (sous ? "\n" + txt(sous) : ""), styles: { fontStyle: "bold" } },
        exp, dip, ses,
        cel(lib + (f.cat_ === "nonpub" && f.next.txt ? "\n" + f.next.txt : ""), cls),
        cel(derniereNote(r)),
      ] });
    }
  }
  return { head, corps, n, largeurs: { 0: { cellWidth: 70 }, 2: { cellWidth: 20 }, 3: { cellWidth: 32 }, 4: { cellWidth: 42 }, 5: { cellWidth: 55 } } };
}

function tableControle() {
  const head = ["Formation", "État", "Contrôlée le", ...CRITERES.map(c => c.nom), "Mail envoyé le", "Commentaire"];
  const corps = [];
  const etatCouleur = { ok: "ok", ko: "ko", surv: "warn", afaire: "wait", incomplet: "warn" };
  const liste = listeControle(norm(recherche), filtre);
  let courant = null;
  for (const { r, e } of liste) {
    const nom = r.Etablissement || "Sans établissement";
    if (nom !== courant) {
      courant = nom;
      const nb = liste.filter(x => (x.r.Etablissement || "Sans établissement") === nom).length;
      corps.push({ etab: true, cells: [`${nom} — ${nb} formation${pl(nb)}`] });
    }
    const a = e.a, fait = e.s !== "afaire";
    const crit = CRITERES.map(c => {
      if (!fait || !a[c.col]) return cel("—", null, { halign: "center", textColor: [170, 170, 170] });
      const ch = c.choix.find(([v]) => v === a[c.col]);
      return ch ? cel(ch[1], ch[2] === "ok" ? "ok" : ch[2] === "ko" ? "ko" : ch[2] === "nt" ? "warn" : null, { halign: "center" }) : cel(a[c.col]);
    });
    const quand = !fait ? (a && a.Date_controle ? "dernier : " + dateFr(a.Date_controle) : "jamais") : e.ancien ? "ancien tableau" : dateFr(a.Date_controle);
    corps.push({ cells: [
      { content: txt(r.Formation) + ([r.Lieu, r.Lien_site].filter(Boolean).length ? "\n" + txt([r.Lieu, r.Lien_site].filter(Boolean).join(" · ")) : ""), styles: { fontStyle: "bold" } },
      cel(LIB_ETAT[e.s] + (e.s === "ko" ? ` (${e.n} point${pl(e.n)})` : ""), etatCouleur[e.s]),
      cel(quand), ...crit,
      cel(a && a.Mail_envoye_le ? dateFr(a.Mail_envoye_le) : ""),
      cel(fait && a.Commentaire ? a.Commentaire : ""),
    ] });
  }
  const largeurs = { 0: { cellWidth: 62 }, 1: { cellWidth: 24 }, 2: { cellWidth: 21 }, [3 + CRITERES.length]: { cellWidth: 19 } };
  CRITERES.forEach((c, i) => { largeurs[3 + i] = { cellWidth: 23 }; });
  return { head, corps, n: liste.length, largeurs };
}

async function exporterPdf() {
  const bouton = document.getElementById("export-pdf");
  if (bouton) { bouton.disabled = true; bouton.textContent = "PDF en cours…"; }
  try {
    await chargerPdf();
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
    const titres = { demandes: "Nouvelles demandes", ouvertes: `Formations déjà ouvertes — revérification pour la rentrée ${rentreeCible()}`, controle: "Contrôle d'affichage" };
    const t = onglet === "controle" ? tableControle() : onglet === "ouvertes" ? tableOuvertes() : tableDemandes();
    const chips = CHIPS[onglet] || [];
    const libFiltre = filtre !== "tous" ? (chips.find(([k]) => k === filtre) || [, filtre])[1] : "";
    const maintenant = new Date();
    const infos = [`Édité le ${maintenant.toLocaleDateString("fr-FR")} à ${maintenant.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}`,
      `${t.n} formation${pl(t.n)}`, libFiltre ? "filtre : " + libFiltre : "", recherche.trim() ? `recherche : « ${recherche.trim()} »` : "",
      DEMO ? "données de démonstration" : ""].filter(Boolean).join(" · ");
    const export_ = document.getElementById("sous-titre");

    const marge = 10, larg = doc.internal.pageSize.getWidth(), haut = doc.internal.pageSize.getHeight();
    doc.setFont("helvetica", "bold"); doc.setFontSize(14); doc.setTextColor(0, 0, 145);
    doc.text(txt("Suivi des référencements en apprentissage — " + titres[onglet]), marge, 14);
    doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.setTextColor(90);
    doc.text(txt(infos), marge, 20);
    if (export_ && onglet !== "controle") doc.text(txt(export_.textContent), marge, 24.5);

    const nbCol = t.head.length;
    doc.autoTable({
      startY: onglet !== "controle" && export_ ? 28 : 24,
      margin: { left: marge, right: marge, top: 12, bottom: 12 },
      head: [t.head.map(txt)],
      body: t.corps.length ? t.corps.map(l => l.etab
        ? [{ content: txt(l.cells[0]), colSpan: nbCol, styles: { fontStyle: "bold", fillColor: [232, 235, 247], textColor: [0, 0, 145], fontSize: 9 } }]
        : l.cells) : [[{ content: "Aucune formation ne correspond.", colSpan: nbCol, styles: { halign: "center", textColor: [120, 120, 120] } }]],
      theme: "grid",
      styles: { font: "helvetica", fontSize: 7.5, cellPadding: 1.6, valign: "middle", lineColor: [220, 220, 220], lineWidth: 0.2, textColor: [30, 30, 30], overflow: "linebreak" },
      headStyles: { fillColor: [0, 0, 145], textColor: 255, fontStyle: "bold", fontSize: 7.5, halign: "center" },
      columnStyles: t.largeurs,
      showHead: "everyPage",
      rowPageBreak: "avoid",
    });
    const nbPages = doc.internal.getNumberOfPages();
    for (let p = 1; p <= nbPages; p++) {
      doc.setPage(p); doc.setFontSize(8); doc.setTextColor(130);
      doc.text(txt(`SAIO ${ACADEMIE} — ${titres[onglet].split(" — ")[0]}`), marge, haut - 5);
      doc.text(`${p} / ${nbPages}`, larg - marge, haut - 5, { align: "right" });
    }
    const j = maintenant.toISOString().slice(0, 10);
    doc.save(`suivi-${{ demandes: "nouvelles-demandes", ouvertes: "formations-ouvertes", controle: "controle-affichage" }[onglet]}-${j}.pdf`);
  } catch (e) {
    alert("Export PDF impossible : " + (e && e.message || e));
  } finally {
    if (bouton) { bouton.disabled = false; bouton.textContent = "⤓ PDF"; }
  }
}
