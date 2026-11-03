// Accès à l'API Grist (réglages enregistrés dans Thunderbird : serveur, document, clé)

const SERVEUR_DEFAUT = "https://grist.numerique.gouv.fr";

async function reglages() {
  const r = await browser.storage.local.get(["serveur", "document", "cle"]);
  return { serveur: (r.serveur || SERVEUR_DEFAUT).replace(/\/+$/, ""), document: r.document || "", cle: r.cle || "" };
}

// Accepte l'identifiant seul ou l'adresse complète du document (…/o/docs/AbCdEf123456/Suivi…)
function idDocument(saisie) {
  const s = String(saisie || "").trim();
  try {
    const u = new URL(s);
    const seg = u.pathname.split("/").filter(Boolean);
    const i = seg.indexOf("doc");
    if (i >= 0 && seg[i + 1]) return seg[i + 1];
    const o = seg[0] === "o" ? 2 : 0;
    return (seg.slice(o).find(x => /^[A-Za-z0-9]{12,}$/.test(x)) || "");
  } catch (e) { return s; }
}

async function appelGrist(r, methode, chemin, corps) {
  const rep = await fetch(`${r.serveur}/api/docs/${encodeURIComponent(r.document)}${chemin}`, {
    method: methode,
    credentials: "omit",   // Grist refuse les cookies dans une requête venant d'un module : seule la clé d'accès est envoyée
    headers: { Authorization: "Bearer " + r.cle, "Content-Type": "application/json" },
    body: corps ? JSON.stringify(corps) : undefined,
  });
  if (!rep.ok) {
    let detail = "";
    try { detail = (await rep.json()).error || ""; } catch (e) { /* rien */ }
    if ((rep.status === 401 || rep.status === 403) && !/cross-origin/i.test(detail)) throw new Error("accès refusé : vérifiez la clé d'accès Grist dans les réglages du module" + (detail ? " (" + detail + ")" : ""));
    if (rep.status === 404) throw new Error("document ou table « Suivi » introuvable : vérifiez l'adresse du document dans les réglages du module");
    throw new Error(`Grist a répondu ${rep.status}${detail ? " : " + detail : ""}`);
  }
  return rep.status === 204 ? null : rep.json();
}
