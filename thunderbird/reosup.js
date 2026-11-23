// REOSUP IUT : envois automatiques depuis Thunderbird (accusé de réception au candidat, invitation Grist et mail
// « nouveau dossier » au référent du BUT). Tourne en tâche de fond (background.js) toutes les N minutes, quand Thunderbird est ouvert.
//
// Document Grist REOSUP-IUT :
//   REOSUP_CANDIDATS  : NOM, PRENOM, EMAIL, BUT_demande, Date_de_depot_de_la_candidature, Emails_referents (« |a@x|b@y| »)
//                       + Accuse_envoye_le, Referent_prevenu_le (créées par le module si absentes)
//   REOSUP_FORMATIONS : Nom_de_la_formation, Adresse_mail (+ Invite_le, créée par le module si absente)
// « Première ligne à traiter » se saisit avec le numéro AFFICHÉ dans Grist (ordre de la table) ; le module l'enregistre sous
// l'identifiant interne de la ligne, qui ne change jamais : supprimer ou trier des lignes ne fait pas repartir d'envois.
// Les dossiers des lignes précédentes ne reçoivent rien.

const REOSUP_LIEN_DOC = "https://grist.numerique.gouv.fr/o/docs/fNcACNZe239j/REOSUP-IUT";

// ——— Textes des mails (à modifier ici) ———
function mailAccuse(c) {
  return {
    objet: "REOSUP IUT – Votre candidature a bien été reçue",
    texte:
`Bonjour ${c.prenom} ${c.nom},

Nous avons bien reçu votre dossier de candidature pour la formation :
${c.but}${c.depot ? `\ndéposé le ${c.depot}.` : ""}

Il est transmis au référent de la formation, qui l'étudiera. Vous recevrez une réponse au plus tard le 15 décembre.

Cordialement,
SAIO – Rectorat de Bordeaux`,
  };
}

function mailReferent(candidats, invite) {
  const n = candidats.length;
  const buts = [...new Set(candidats.map(c => c.but))];
  return {
    objet: `REOSUP IUT – ${n > 1 ? n + " nouveaux dossiers" : "Nouveau dossier"} pour « ${buts.join(" », « ")} »`,
    texte:
`Bonjour,

${n > 1 ? `${n} nouveaux dossiers de candidature REOSUP vous attendent` : "Un nouveau dossier de candidature REOSUP vous attend"} pour ${buts.length > 1 ? "les formations dont vous êtes référent(e)" : `la formation « ${buts[0]} », dont vous êtes référent(e)`} :
${candidats.map(c => `- ${c.prenom} ${c.nom}${buts.length > 1 ? ` (${c.but})` : ""}${c.depot ? ` – déposé le ${c.depot}` : ""}`).join("\n")}

Pour ${n > 1 ? "les" : "le"} consulter : ${REOSUP_LIEN_DOC}
${invite ? "Vous recevez par ailleurs une invitation Grist pour accéder au document." : "Connectez-vous à Grist avec cette adresse mail."} Vous n'y verrez que les candidats des formations dont vous êtes référent(e). Merci d'y indiquer votre avis (colonne AVIS) et, si besoin, un commentaire.

Cordialement,
SAIO – Rectorat de Bordeaux`,
  };
}

// ——— Outils ———
const reosupMailValide = s => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(s || "").trim());
const reosupDateFr = sec => sec ? new Date(sec * 1000).toLocaleDateString("fr-FR", { timeZone: "UTC" }) : "";
const reosupMaintenant = () => Math.round(Date.now() / 1000);

// Candidats dans l'ordre affiché par Grist : numéro affiché = position (1, 2, 3…)
async function reosupLignes(r) {
  const recs = (await appelGrist(r, "GET", "/tables/REOSUP_CANDIDATS/records?sort=manualSort")).records;
  return recs.map((x, i) => ({ ...x, numero: i + 1 }));
}
const reosupNomCandidat = x => `${String(x.fields.PRENOM || "").trim()} ${String(x.fields.NOM || "").trim()}`.trim() || "(sans nom)";
// numéro affiché -> identifiant interne (au-delà de la dernière ligne : le prochain dossier déposé)
function reosupIdDepuisNumero(lignes, numero) {
  if (numero >= 1 && numero <= lignes.length) return lignes[numero - 1].id;
  return Math.max(0, ...lignes.map(x => x.id)) + 1;
}
// identifiant interne enregistré -> ligne affichée aujourd'hui (la première ligne encore présente à partir de cet identifiant)
function reosupLigneDepuisId(lignes, id) {
  const suivantes = lignes.filter(x => x.id >= id);
  return suivantes.length ? suivantes.reduce((a, b) => (a.numero < b.numero ? a : b)) : null;
}

async function reosupReglages() {
  const g = await reglages();   // serveur et clé : ceux du module (grist.js)
  const r = await browser.storage.local.get(["reosup_document", "reosup_actif", "reosup_minutes", "reosup_premier_id", "reosup_premiere_ligne", "reosup_expediteur"]);
  return {
    serveur: g.serveur, cle: g.cle, document: r.reosup_document || "",
    actif: !!r.reosup_actif, minutes: Number(r.reosup_minutes) || 5,
    premierId: Number(r.reosup_premier_id) || Number(r.reosup_premiere_ligne) || 0, expediteur: (r.reosup_expediteur || "").trim().toLowerCase(),
  };
}

// Identité Thunderbird qui envoie (adresse choisie dans les réglages, sinon l'identité par défaut)
async function reosupIdentite(adresse) {
  const comptes = await browser.accounts.list();
  const ids = comptes.flatMap(c => c.identities || []);
  const trouve = adresse && ids.find(i => String(i.email || "").toLowerCase() === adresse);
  if (adresse && !trouve) throw new Error(`aucune identité Thunderbird n'a l'adresse ${adresse}`);
  return trouve || null;
}

async function reosupEnvoyer(identite, a, mail) {
  const tab = await browser.compose.beginNew(null, {
    identityId: identite ? identite.id : undefined,
    to: [a], subject: mail.objet, isPlainText: true, plainTextBody: mail.texte,
  });
  await browser.compose.sendMessage(tab.id, { mode: "sendNow" });
}

// Crée les colonnes de suivi manquantes (une par une, simples, sans formule)
async function reosupColonnes(r, table, voulues) {
  const presentes = new Set((await appelGrist(r, "GET", `/tables/${table}/columns`)).columns.map(c => c.id));
  for (const [id, label] of voulues) {
    if (!presentes.has(id)) await appelGrist(r, "POST", `/tables/${table}/columns`, { columns: [{ id, fields: { label, type: "DateTime:Europe/Paris" } }] });
  }
}

// ——— Passage : apercu=true ne fait qu'énumérer ce qui serait envoyé ———
let reosupEnCours = false;
async function reosupPassage({ apercu = false, force = false } = {}) {
  const r = await reosupReglages();
  if (!force && !r.actif) return null;
  if (!r.document || !r.cle) throw new Error("adresse du document REOSUP ou clé Grist manquante dans les réglages");
  if (!r.premierId) throw new Error("« première ligne à traiter » non renseignée dans les réglages");
  if (reosupEnCours) return null;
  reosupEnCours = true;
  const bilan = { date: new Date().toLocaleString("fr-FR"), apercu, accuses: [], referents: [], invitations: [], sansReferent: [], erreurs: [] };
  try {
    if (!apercu) {
      await reosupColonnes(r, "REOSUP_CANDIDATS", [["Accuse_envoye_le", "Accusé envoyé le"], ["Referent_prevenu_le", "Référent prévenu le"]]);
      await reosupColonnes(r, "REOSUP_FORMATIONS", [["Invite_le", "Invité le"]]);
    }
    const [cand, form, acces] = await Promise.all([
      reosupLignes(r),
      appelGrist(r, "GET", "/tables/REOSUP_FORMATIONS/records"),
      appelGrist(r, "GET", "/access"),
    ]);
    const membres = new Set(acces.users.filter(u => u.access).map(u => String(u.email).toLowerCase()));
    const identite = apercu ? null : await reosupIdentite(r.expediteur);
    const candidats = cand.filter(x => x.id >= r.premierId).map(x => ({
      id: x.id, numero: x.numero, nom: String(x.fields.NOM || "").trim(), prenom: String(x.fields.PRENOM || "").trim(),
      email: String(x.fields.EMAIL || "").trim(), but: String(x.fields.BUT_demande || "").trim(),
      depot: reosupDateFr(x.fields.Date_de_depot_de_la_candidature),
      referents: String(x.fields.Emails_referents || "").split("|").map(s => s.trim().toLowerCase()).filter(Boolean),
      accuse: x.fields.Accuse_envoye_le, prevenu: x.fields.Referent_prevenu_le,
    }));

    // 1) Accusé de réception au candidat
    for (const c of candidats.filter(c => !c.accuse && c.but)) {
      if (!reosupMailValide(c.email)) { bilan.erreurs.push(`ligne ${c.numero} (${c.prenom} ${c.nom}) : adresse du candidat invalide (${c.email || "vide"})`); continue; }
      try {
        if (!apercu) {
          await reosupEnvoyer(identite, c.email, mailAccuse(c));
          await appelGrist(r, "PATCH", "/tables/REOSUP_CANDIDATS/records", { records: [{ id: c.id, fields: { Accuse_envoye_le: reosupMaintenant() } }] });
        }
        bilan.accuses.push(`ligne ${c.numero} (${c.prenom} ${c.nom}) → ${c.email}`);
      } catch (e) { bilan.erreurs.push(`accusé ligne ${c.numero} : ${e.message}`); }
    }

    // 2) Référents : invitation Grist si besoin, puis un mail par référent listant ses nouveaux dossiers
    const parReferent = new Map();
    for (const c of candidats.filter(c => !c.prevenu && c.but)) {
      if (!c.referents.length) { bilan.sansReferent.push(`ligne ${c.numero} (${c.prenom} ${c.nom}, ${c.but})`); continue; }
      for (const a of c.referents) { if (!parReferent.has(a)) parReferent.set(a, []); parReferent.get(a).push(c); }
    }
    const prevenus = new Map();   // id candidat -> nb de référents restant à prévenir
    for (const c of candidats) prevenus.set(c.id, c.referents.length);
    for (const [a, liste] of parReferent) {
      try {
        const invite = !membres.has(a);
        if (!apercu) {
          if (invite) {
            await appelGrist(r, "PATCH", "/access", { delta: { users: { [a]: "editors" } } });
            const lignes = form.records.filter(f => String(f.fields.Adresse_mail || "").trim().toLowerCase() === a);
            if (lignes.length) await appelGrist(r, "PATCH", "/tables/REOSUP_FORMATIONS/records", { records: lignes.map(f => ({ id: f.id, fields: { Invite_le: reosupMaintenant() } })) });
            membres.add(a);
          }
          await reosupEnvoyer(identite, a, mailReferent(liste, invite));
        }
        if (invite) bilan.invitations.push(a);
        bilan.referents.push(`${a} : ${liste.length} dossier(s) (ligne${liste.length > 1 ? "s" : ""} ${liste.map(c => c.numero).join(", ")})`);
        for (const c of liste) prevenus.set(c.id, prevenus.get(c.id) - 1);
      } catch (e) { bilan.erreurs.push(`référent ${a} : ${e.message}`); }
    }
    // un candidat est « prévenu » quand tous ses référents ont reçu le mail
    const faits = [...parReferent.values()].flat().filter((c, i, t) => t.indexOf(c) === i && prevenus.get(c.id) === 0);
    if (!apercu && faits.length) {
      await appelGrist(r, "PATCH", "/tables/REOSUP_CANDIDATS/records", { records: faits.map(c => ({ id: c.id, fields: { Referent_prevenu_le: reosupMaintenant() } })) });
    }
  } catch (e) {
    bilan.erreurs.push(e.message);
  } finally {
    reosupEnCours = false;
  }
  if (!apercu) await browser.storage.local.set({ reosup_bilan: bilan });
  return bilan;
}
