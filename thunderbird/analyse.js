// Lecture d'un mail de demande de référencement : contact, téléphone, établissement, formations citées.
// Utilisé par le bouton Thunderbird (popup.js) ; testable seul avec Node.

const SIGLES = /\b(BTSA?|BUT|DUT|CAPA?|BEP|BPA?|BTM|BMA|MC|CQP|DEUST|DNMADE|DSCG|DCG|DE)\b/;
const MOTS = /\b(bac\s*\+?\s*pro(fessionnel)?|baccalaur[ée]at\s+professionnel|mention\s+compl[ée]mentaire|titre\s+(pro|professionnel)\b|titre\s+[àa]\s+finalit[ée]|licence(\s+pro(fessionnelle)?)?|master|bachelor|dipl[ôo]me\s+d'[ée]tat|certificat\s+de\s+sp[ée]cialisation|brevet\s+(professionnel|de\s+ma[îi]trise|de\s+technicien))\b/i;
const ETAB = /\b(lyc[ée]e|cfa|campus|[ée]cole|institut|mfr|maison\s+familiale|iut|universit[ée]|centre\s+de\s+formation|ufa|afpa|cci|cma|chambre\s+de|greta|compagnons|facult[ée]|enil|eplefpa|ifsi|ifa|ifria|ism|esc)\b/i;
const FONCTION = /\b(provise(ur|ure)|directeur|directrice|responsable|charg[ée]e?|coordinat(eur|rice)|assistante?|secr[ée]taire|d[ée]veloppeu?r|conseill[eè]re?|chef|cheffe|ddfpt|cpe|gestionnaire|r[ée]f[ée]rente?)\b/i;

function nettoyerLigne(l) {
  return l.replace(/^[\s>*•·\-–—▪◦●○■□✓✔\d.)]+/, "").replace(/[\s;:,.]+$/, "").replace(/\s+/g, " ").trim();
}

// Retire l'historique cité (réponse / transfert)
function corpsUtile(texte) {
  const lignes = String(texte || "").replace(/\r/g, "").split("\n");
  const fin = lignes.findIndex(l => /^\s*>/.test(l) || /^-{2,}\s*(original|message d'origine|message transf)/i.test(l)
    || /^(le .{5,80} a [ée]crit\s*:|on .{5,80} wrote:)\s*$/i.test(l.trim()) || /^(de|from)\s*:\s*.+@/i.test(l.trim()));
  return (fin > 3 ? lignes.slice(0, fin) : lignes).join("\n");
}

function htmlEnTexte(html) {
  return String(html || "").replace(/<(br|\/p|\/div|\/li|\/tr|\/h\d)[^>]*>/gi, "\n").replace(/<li[^>]*>/gi, "\n- ")
    .replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&eacute;/g, "é")
    .replace(/&egrave;/g, "è").replace(/&agrave;/g, "à").replace(/&ccedil;/g, "ç").replace(/&ecirc;/g, "ê").replace(/&ocirc;/g, "ô");
}

function formationsDe(texte) {
  const out = [], vus = new Set();
  const ajouter = f => {
    f = nettoyerLigne(f).replace(/^(et|ou|la|le|les|un|une|des|du|en|pour|formation|formations)\s+/i, "");
    if (f.length < 3 || f.length > 140) return;
    const k = f.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ");
    if (!vus.has(k)) { vus.add(k); out.push(f); }
  };
  for (const brut of texte.split("\n")) {
    const l = brut.trim();
    if (!l || l.length > 400) continue;
    if (!(SIGLES.test(l) || MOTS.test(l))) continue;
    // plusieurs diplômes sur une même ligne : « BTS MCO, BTS NDRC et CAP Cuisine »
    const morceaux = l.split(/\s*(?:[,;/]|\bet\b|\+)\s*(?=(?:le |la |les |un |une |des |du )?(?:BTSA?|BUT|DUT|CAPA?|BEP|BPA?|BTM|BMA|MC|CQP|DE|bac|titre|licence|master|bachelor|mention|dipl|brevet|certificat)\b)/i);
    const tous = morceaux.filter(m => SIGLES.test(m) || MOTS.test(m));
    if (tous.length > 1) { tous.forEach(m => ajouter(extraireDiplome(m))); continue; }
    ajouter(extraireDiplome(l));
  }
  return out;
}

// Dans une phrase, garde le diplôme et ce qui suit (« … ouvrir le BTS MCO en apprentissage » → « BTS MCO »)
function extraireDiplome(phrase) {
  const p = nettoyerLigne(phrase);
  const m = p.match(SIGLES) || p.match(MOTS);
  if (!m) return p;
  let s = p.slice(m.index);
  s = s.replace(/\s+(en\s+apprentissage|par\s+apprentissage|en\s+alternance|à\s+la\s+rentr[ée]e|pour\s+la\s+rentr[ée]e|sur\s+parcoursup|dans\s+parcoursup|au\s+sein|à\s+partir|d[èe]s\s+la)\b.*$/i, "");
  s = s.replace(/\s*[(\[].*?(apprentissage|alternance|rentr[ée]e).*?[)\]]\s*/gi, " ").replace(/[\s.!?]+$/, "");
  return s.length > 3 ? s : p;
}

function telephoneDe(texte) {
  const m = texte.match(/(?:\+33\s?\(?0?\)?\s?|\b0)[1-9](?:[\s.\-]?\d{2}){4}\b/);
  if (!m) return "";
  const d = m[0].replace(/\D/g, "").replace(/^330?/, "0");
  return d.length === 10 ? d.replace(/(\d{2})(?=\d)/g, "$1 ") : m[0].trim();
}

function auteur(author) {
  const a = String(author || "");
  const mail = (a.match(/[\w.+\-]+@[\w\-]+(?:\.[\w\-]+)+/) || [""])[0].toLowerCase();
  let nom = a.replace(/<[^>]*>/, "").replace(mail, "").replace(/["']/g, "").trim();
  if (!nom || nom.includes("@")) nom = "";
  return { mail, nom };
}

function etablissementDe(texte, mail) {
  const lignes = texte.split("\n").map(nettoyerLigne).filter(Boolean);
  const fin = lignes.slice(-18);
  const cand = fin.find(l => ETAB.test(l) && l.length < 90 && !SIGLES.test(l) && !/@|https?:|www\./i.test(l))
    || lignes.find(l => ETAB.test(l) && l.length < 70 && !SIGLES.test(l) && !/@|https?:|www\./i.test(l));
  if (cand) return cand;
  const dom = (mail.split("@")[1] || "").split(".")[0];
  if (!dom || /^(gmail|yahoo|hotmail|outlook|orange|free|wanadoo|laposte|sfr|live|icloud|ac-[a-z\-]+)$/.test(dom)) return "";
  return dom.replace(/[-_]/g, " ").toUpperCase();
}

function fonctionDe(texte, nom) {
  if (!nom) return "";
  const lignes = texte.split("\n").map(nettoyerLigne).filter(Boolean);
  const i = lignes.findIndex(l => l.toLowerCase().includes(nom.split(" ").slice(-1)[0].toLowerCase()));
  for (const l of (i >= 0 ? lignes.slice(i, i + 4) : lignes.slice(-12))) {
    if (FONCTION.test(l) && l.length < 80 && !SIGLES.test(l)) return l.replace(nom, "").replace(/^[\s,\-–]+/, "");
  }
  return "";
}

function analyserMail({ author, texte, html }) {
  const brut = texte && texte.trim() ? texte : htmlEnTexte(html);
  const corps = corpsUtile(brut);
  const { mail, nom } = auteur(author);
  const fonction = fonctionDe(corps, nom);
  return {
    contact_email: mail,
    contact_nom: nom ? nom + (fonction ? ", " + fonction.charAt(0).toLowerCase() + fonction.slice(1) : "") : "",
    contact_tel: telephoneDe(corps),
    etablissement: etablissementDe(corps, mail),
    formations: formationsDe(corps),
  };
}

if (typeof module !== "undefined") module.exports = { analyserMail, formationsDe, telephoneDe, etablissementDe, corpsUtile, htmlEnTexte };
