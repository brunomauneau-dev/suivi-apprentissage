// Fenêtre du bouton « Ajouter au suivi » : lit le mail affiché, pré-remplit la demande, l'envoie dans la table Suivi de Grist.

const zone = document.getElementById("zone");
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const norm = s => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
const GENERIQUES = /^(gmail|yahoo|hotmail|outlook|orange|free|wanadoo|laposte|sfr|live|icloud|ac-[a-z-]+)\./;
const msg = (classe, html) => `<div class="msg ${classe}">${html}</div>`;

function texteDuMail(partie) {
  let plain = "", html = "";
  (function parcourir(p) {
    if (!p) return;
    const t = String(p.contentType || "").toLowerCase();
    if (t === "text/plain" && p.body && !plain) plain = p.body;
    else if (t === "text/html" && p.body && !html) html = p.body;
    (p.parts || []).forEach(parcourir);
  })(partie);
  return { plain, html };
}

async function mailAffiche() {
  const [onglet] = await browser.tabs.query({ active: true, currentWindow: true });
  let m = null;
  if (browser.messageDisplay.getDisplayedMessages) {
    const r = await browser.messageDisplay.getDisplayedMessages(onglet.id);
    m = Array.isArray(r) ? r[0] : (r && r.messages ? r.messages[0] : null);
  }
  if (!m && browser.messageDisplay.getDisplayedMessage) m = await browser.messageDisplay.getDisplayedMessage(onglet.id);
  if (!m) throw new Error("aucun mail affiché");
  const complet = await browser.messages.getFull(m.id);
  return { entete: m, ...texteDuMail(complet) };
}

function dateIso(d) {
  const x = new Date(d || Date.now());
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
}

// Retrouve l'établissement déjà suivi : même mail de contact, sinon même domaine, sinon même nom
function etablissementConnu(lignes, mail, devine) {
  const avec = lignes.filter(l => l.Etablissement);
  if (mail) {
    const exact = avec.find(l => String(l.Contact_email || "").toLowerCase() === mail);
    if (exact) return exact.Etablissement;
    const dom = mail.split("@")[1] || "";
    if (dom && !GENERIQUES.test(dom)) {
      const meme = avec.find(l => String(l.Contact_email || "").toLowerCase().endsWith("@" + dom));
      if (meme) return meme.Etablissement;
    }
  }
  const n = norm(devine);
  if (n.length >= 4) {
    const m = avec.find(l => norm(l.Etablissement) === n) || avec.find(l => norm(l.Etablissement).includes(n) || n.includes(norm(l.Etablissement)));
    if (m) return m.Etablissement;
  }
  return "";
}

async function demarrer() {
  const r = await reglages();
  if (!r.document || !r.cle) {
    zone.innerHTML = msg("info", "Le module n'est pas encore relié au document Grist.") +
      `<button class="btn" id="regler">Ouvrir les réglages</button>`;
    document.getElementById("regler").onclick = () => browser.runtime.openOptionsPage();
    return;
  }
  let mail, lignes;
  try {
    mail = await mailAffiche();
  } catch (e) {
    zone.innerHTML = msg("ko", "Impossible de lire le mail affiché (" + esc(e.message) + ").");
    return;
  }
  try {
    lignes = (await appelGrist(r, "GET", "/tables/Suivi/records")).records.map(x => ({ id: x.id, ...x.fields }));
  } catch (e) {
    zone.innerHTML = msg("ko", esc(e.message)) + `<button class="btn" id="regler">Ouvrir les réglages</button>`;
    document.getElementById("regler").onclick = () => browser.runtime.openOptionsPage();
    return;
  }
  const a = analyserMail({ author: mail.entete.author, texte: mail.plain, html: mail.html, sujet: mail.entete.subject });
  // l'établissement écrit dans le mail (signature) prime ; l'adresse de l'expéditeur ne sert que s'il n'y en a pas
  const parMail = etablissementConnu(lignes, a.contact_email, "");
  const connu = a.etablissement_signe ? etablissementConnu(lignes, "", a.etablissement) : (parMail || etablissementConnu(lignes, "", a.etablissement));
  const etab = connu || a.etablissement;
  const autreEtab = parMail && norm(parMail) !== norm(etab) ? parMail : "";
  const deja = connu ? lignes.find(l => l.Etablissement === connu && (l.Contact_nom || l.Contact_tel || l.Contact_email)) || {} : {};
  const noms = [...new Set(lignes.map(l => l.Etablissement).filter(Boolean))].sort((x, y) => x.localeCompare(y, "fr"));

  zone.innerHTML = `
    <label for="etab">Établissement</label>
    <input id="etab" list="etabs" value="${esc(etab)}" placeholder="Nom de l'établissement">
    <datalist id="etabs">${noms.map(n => `<option value="${esc(n)}">`).join("")}</datalist>
    <div id="etat-etab" class="connu"></div>
    ${autreEtab ? `<div class="aide">Cette adresse est aussi celle du contact de <a href="#" id="autre-etab">${esc(autreEtab)}</a>.</div>` : ""}
    <div class="ligne">
      <div><label for="cnom">Contact (nom, fonction)</label><input id="cnom" value="${esc(a.contact_nom || deja.Contact_nom || "")}"></div>
      <div><label for="ctel">Téléphone</label><input id="ctel" value="${esc(a.contact_tel || deja.Contact_tel || "")}"></div>
    </div>
    <div class="ligne">
      <div><label for="cmail">Mail du contact</label><input id="cmail" value="${esc(a.contact_email || deja.Contact_email || "")}"></div>
      <div><label for="date">Mail reçu le</label><input id="date" type="date" value="${dateIso(mail.entete.date)}"></div>
    </div>
    <label for="forms">Formations demandées (une par ligne)</label>
    <textarea id="forms" placeholder="BTS MCO&#10;CAP Cuisine">${esc(a.formations.join("\n"))}</textarea>
    <div class="aide" id="aide-forms"></div>
    <button class="btn" id="ajouter">Ajouter au suivi</button>
    <div id="resultat"></div>`;

  const $ = id => document.getElementById(id);
  const formations = () => $("forms").value.split("\n").map(s => s.trim()).filter(Boolean);
  const existantes = () => new Set(lignes.filter(l => norm(l.Etablissement) === norm($("etab").value)).map(l => norm(l.Formation)));
  const majAide = () => {
    const ex = existantes(), fs = formations(), doublons = fs.filter(f => ex.has(norm(f)));
    const nouvelles = fs.length - doublons.length;
    $("etat-etab").textContent = noms.some(n => norm(n) === norm($("etab").value))
      ? `✓ Établissement déjà suivi (${ex.size} formation${ex.size > 1 ? "s" : ""})` : ($("etab").value ? "Nouvel établissement" : "");
    $("aide-forms").textContent = (fs.length ? "" : "Aucune formation repérée dans le mail : saisissez-les. ")
      + (doublons.length ? (doublons.length > 1 ? "Déjà suivies, ne seront pas ajoutées : " : "Déjà suivie, ne sera pas ajoutée : ") + doublons.join(", ") + "." : "");
    $("ajouter").textContent = nouvelles > 1 ? `Ajouter ${nouvelles} formations au suivi` : nouvelles === 1 ? "Ajouter 1 formation au suivi" : "Ajouter au suivi";
    $("ajouter").disabled = !$("etab").value.trim() || nouvelles < 1;
  };
  ["etab", "forms"].forEach(id => $(id).addEventListener("input", majAide));
  const ae = $("autre-etab");
  if (ae) ae.onclick = ev => { ev.preventDefault(); $("etab").value = autreEtab; majAide(); };
  majAide();

  $("ajouter").onclick = async () => {
    const b = $("ajouter");
    b.disabled = true; b.textContent = "Envoi…";
    const etabNom = $("etab").value.trim();
    const ex = existantes();
    const nouvelles = formations().filter(f => !ex.has(norm(f)));
    const [an, mo, jo] = $("date").value.split("-").map(Number);
    const recu = an ? Date.UTC(an, mo - 1, jo) / 1000 : null;
    const contact = { Contact_nom: $("cnom").value.trim(), Contact_tel: $("ctel").value.trim(), Contact_email: $("cmail").value.trim() };
    try {
      const champs = f => ({ Etablissement: etabNom, Formation: f, Mail_recu: recu, ...contact });
      try {
        await appelGrist(r, "POST", "/tables/Suivi/records", { records: nouvelles.map(f => ({ fields: champs(f) })) });
      } catch (e) {
        if (!/column|colonne|400/i.test(e.message)) throw e;
        // document sans colonnes de contact : on les crée (comme le fait le widget), sinon on ajoute sans le contact
        await appelGrist(r, "POST", "/tables/Suivi/columns", { columns: [["Contact_nom", "Contact (nom)"], ["Contact_tel", "Contact (téléphone)"], ["Contact_email", "Contact (mail)"]]
          .map(([id, label]) => ({ id, fields: { label, type: "Text" } })) }).catch(() => null);
        await appelGrist(r, "POST", "/tables/Suivi/records", { records: nouvelles.map(f => ({ fields: champs(f) })) })
          .catch(() => appelGrist(r, "POST", "/tables/Suivi/records", { records: nouvelles.map(f => ({ fields: { Etablissement: etabNom, Formation: f, Mail_recu: recu } })) }));
      }
      // le contact est commun à toutes les formations de l'établissement
      const autres = lignes.filter(l => norm(l.Etablissement) === norm(etabNom));
      const aJour = Object.fromEntries(Object.entries(contact).filter(([, v]) => v));
      if (autres.length && Object.keys(aJour).length) {
        await appelGrist(r, "PATCH", "/tables/Suivi/records", { records: autres.map(l => ({ id: l.id, fields: aJour })) }).catch(() => null);
      }
      zone.innerHTML = msg("ok", `✓ ${nouvelles.length} formation${nouvelles.length > 1 ? "s ajoutées" : " ajoutée"} au suivi pour <b>${esc(etabNom)}</b>.<br>
        Prochaine étape dans l'outil : « ✉ Envoyer les fiches par mail ».`) +
        `<button class="btn" id="ouvrir">Ouvrir le suivi dans Grist</button>`;
      $("ouvrir").onclick = () => { browser.windows.openDefaultBrowser(`${r.serveur}/doc/${encodeURIComponent(r.document)}`); window.close(); };
    } catch (e) {
      $("resultat").innerHTML = msg("ko", "Échec : " + esc(e.message));
      b.disabled = false; majAide();
    }
  };
}

demarrer().catch(e => { zone.innerHTML = msg("ko", "Erreur : " + esc(e.message)); });
