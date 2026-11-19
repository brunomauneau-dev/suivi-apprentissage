// Grist refuse toute requête « Origin: moz-extension://… » accompagnée d'une clé d'accès (403 « Credentials not supported
// for cross-origin requests »). Thunderbird ajoute cet en-tête aux envois (POST, PATCH) du module : on le retire,
// uniquement pour les requêtes faites par ce module vers l'API Grist.
const BASE = browser.runtime.getURL("");

browser.webRequest.onBeforeSendHeaders.addListener(
  details => {
    const source = details.originUrl || details.documentUrl || "";
    if (!source.startsWith(BASE)) return {};
    return { requestHeaders: details.requestHeaders.filter(h => h.name.toLowerCase() !== "origin") };
  },
  { urls: ["https://*/api/docs/*", "http://localhost/api/docs/*", "http://localhost:*/api/docs/*"] },
  ["blocking", "requestHeaders"]
);

// Bouton « Ajouter au suivi » : le formulaire s'ouvre dans une petite fenêtre séparée. Contrairement à la fenêtre surgissante
// attachée au bouton, elle reste ouverte quand on clique dans le mail (pour y copier un téléphone, une adresse…).
// Le mail affiché au moment du clic lui est transmis ; un nouveau clic remplace la fenêtre précédente.
let fenetre = null;
browser.messageDisplayAction.onClicked.addListener(async tab => {
  let m = null;
  try {
    if (browser.messageDisplay.getDisplayedMessages) {
      const r = await browser.messageDisplay.getDisplayedMessages(tab.id);
      m = Array.isArray(r) ? r[0] : (r && r.messages ? r.messages[0] : null);
    }
    if (!m && browser.messageDisplay.getDisplayedMessage) m = await browser.messageDisplay.getDisplayedMessage(tab.id);
  } catch (e) { /* le formulaire signalera l'absence de mail */ }
  if (fenetre !== null) { try { await browser.windows.remove(fenetre); } catch (e) { /* déjà fermée */ } }
  const w = await browser.windows.create({ url: browser.runtime.getURL("popup.html" + (m ? "?message=" + m.id : "")), type: "popup", width: 500, height: 720, allowScriptsToClose: true });
  fenetre = w.id;
});
browser.windows.onRemoved.addListener(id => { if (id === fenetre) fenetre = null; });
