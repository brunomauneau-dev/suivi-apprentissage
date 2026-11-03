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
