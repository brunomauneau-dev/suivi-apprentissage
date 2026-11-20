const $ = id => document.getElementById(id);

(async () => {
  const r = await browser.storage.local.get(["serveur", "document", "cle", "adresse"]);
  $("doc").value = r.adresse || r.document || "";
  $("cle").value = r.cle || "";
  $("serveur").value = r.serveur || SERVEUR_DEFAUT;
})();

$("enregistrer").onclick = async () => {
  const adresse = $("doc").value.trim();
  let serveur = $("serveur").value.trim() || SERVEUR_DEFAUT;
  try { if (/^https?:/.test(adresse)) serveur = new URL(adresse).origin; } catch (e) { /* adresse non valide */ }
  const document_ = idDocument(adresse);
  const cle = $("cle").value.trim();
  await browser.storage.local.set({ serveur, document: document_, cle, adresse });
  $("serveur").value = serveur;
  const res = $("resultat");
  if (!document_ || !cle) { res.innerHTML = `<div class="msg ko">Renseignez l'adresse du document et la clé d'accès.</div>`; return; }
  res.innerHTML = `<div class="msg info">Test de connexion…</div>`;
  try {
    const n = (await appelGrist({ serveur, document: document_, cle }, "GET", "/tables/Suivi/records?limit=1")).records.length;
    res.innerHTML = `<div class="msg ok">✓ Connexion réussie au document${n ? "" : " (table Suivi vide)"}. Vous pouvez fermer cette fenêtre.</div>`;
  } catch (e) {
    res.innerHTML = `<div class="msg ko">${e.message.replace(/</g, "&lt;")}</div>`;
  }
};

// ——— REOSUP IUT ———
const echapper = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
(async () => {
  const r = await browser.storage.local.get(["reosup_adresse", "reosup_document", "reosup_expediteur", "reosup_minutes", "reosup_premiere_ligne", "reosup_actif", "reosup_bilan"]);
  $("r_doc").value = r.reosup_adresse || r.reosup_document || "";
  $("r_exp").value = r.reosup_expediteur || "";
  $("r_min").value = r.reosup_minutes || 5;
  $("r_ligne").value = r.reosup_premiere_ligne || "";
  $("r_actif").checked = !!r.reosup_actif;
  if (r.reosup_bilan) $("r_resultat").innerHTML = afficherBilan(r.reosup_bilan, "Dernier passage");
})();

function afficherBilan(b, titre) {
  const liste = (t, l) => l && l.length ? `<b>${t} (${l.length})</b><br>${l.map(echapper).join("<br>")}<br>` : "";
  const corps = liste(b.apercu ? "Accusés à envoyer" : "Accusés envoyés", b.accuses) + liste(b.apercu ? "Référents à prévenir" : "Référents prévenus", b.referents)
    + liste(b.apercu ? "Invitations Grist à envoyer" : "Invitations Grist envoyées", b.invitations) + liste("BUT sans référent (en attente)", b.sansReferent);
  const err = b.erreurs && b.erreurs.length ? `<div class="msg ko">${b.erreurs.map(echapper).join("<br>")}</div>` : "";
  return `<div class="msg ${err ? "info" : "ok"}">${titre}${b.date ? " — " + echapper(b.date) : ""}<br>${corps || "Rien à envoyer."}</div>${err}`;
}

async function enregistrerReosup() {
  const adresse = $("r_doc").value.trim();
  let ligne = Number($("r_ligne").value) || 0;
  const actif = $("r_actif").checked;
  const doc = idDocument(adresse);
  if (actif && !ligne && doc) {
    // par défaut : seuls les dossiers déposés après l'activation sont traités
    const g = await reglages();
    try {
      const recs = (await appelGrist({ ...g, document: doc }, "GET", "/tables/REOSUP_CANDIDATS/records")).records;
      ligne = Math.max(0, ...recs.map(x => x.id)) + 1;
      $("r_ligne").value = ligne;
    } catch (e) { $("r_resultat").innerHTML = `<div class="msg ko">${echapper(e.message)}</div>`; return false; }
  }
  await browser.storage.local.set({
    reosup_adresse: adresse, reosup_document: doc, reosup_expediteur: $("r_exp").value.trim(),
    reosup_minutes: Math.max(1, Number($("r_min").value) || 5), reosup_premiere_ligne: ligne, reosup_actif: actif,
  });
  return true;
}

$("r_enregistrer").onclick = async () => {
  if (await enregistrerReosup()) $("r_resultat").innerHTML = `<div class="msg ok">✓ Enregistré${$("r_actif").checked ? ` — envois automatiques actifs à partir de la ligne ${echapper($("r_ligne").value)}` : " — envois automatiques désactivés"}.</div>`;
};
$("r_apercu").onclick = async () => {
  if (!(await enregistrerReosup())) return;
  $("r_resultat").innerHTML = `<div class="msg info">Lecture du document…</div>`;
  const b = await browser.runtime.sendMessage({ reosup: "apercu" });
  $("r_resultat").innerHTML = b ? afficherBilan(b, "Aperçu — rien n'a été envoyé") : `<div class="msg info">Un passage est déjà en cours, réessayez.</div>`;
};
$("r_envoyer").onclick = async () => {
  if (!(await enregistrerReosup())) return;
  if (!confirm("Envoyer maintenant les accusés de réception, invitations et mails aux référents ?")) return;
  $("r_resultat").innerHTML = `<div class="msg info">Envoi en cours…</div>`;
  const b = await browser.runtime.sendMessage({ reosup: "envoyer" });
  $("r_resultat").innerHTML = b ? afficherBilan(b, "Envoi") : `<div class="msg info">Un passage est déjà en cours, réessayez.</div>`;
};
