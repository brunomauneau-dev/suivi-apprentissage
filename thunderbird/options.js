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
