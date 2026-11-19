# Suivi des référencements en apprentissage — widget Grist

Vue « accordéon » du document Grist *Suivi_formations_apprentissage* (SAIO Bordeaux) :
une ligne par formation demandée, regroupées par établissement, avec les 6 étapes
(mail reçu → lien envoyé → fiche reçue → UAI → RNCP → publiée) et la prochaine action à faire.

Adresse du widget : https://brunomauneau-dev.github.io/suivi-apprentissage/

Dans Grist : Ajouter → Ajouter une page → Widget personnalisé → URL personnalisée → coller l'adresse,
données : table *Fiches*, accès : **accès complet au document**.

Hors de Grist, la page s'affiche en mode démonstration (données fictives).

## Export PDF

Le bouton « ⤓ PDF » (à côté de la recherche) télécharge le tableau de l'onglet affiché en A4 paysage,
avec le filtre et la recherche en cours, regroupé par établissement :
- *Nouvelles demandes* : les 7 étapes, la prochaine action et la dernière note ;
- *Formations déjà ouvertes* : formation retrouvée dans l'export, diplôme, session de rentrée, statut, dernière note ;
- *Contrôle d'affichage* : état, date du contrôle, critères, mail envoyé, commentaire.

Dans les trois onglets, un bandeau « Vigilance » sous l'établissement liste ses formations fermées sur Parcoursup
(rouge si une formation suivie est elle-même fermée, orange sinon), et la formation fermée porte la mention « FERMÉE SUR PARCOURSUP ».

Bibliothèques jsPDF et jsPDF-AutoTable dans `lib/` (licence MIT), chargées au premier export seulement.

## Demande d'une formation déjà ouverte

Une nouvelle demande dont l'intitulé correspond à une formation du même établissement dans l'onglet « Formations déjà ouvertes »
(tous les mots utiles de l'intitulé demandé s'y retrouvent ; « BTS », « Titre professionnel », « Bac +2 »… sont ignorés)
passe en « À faire au SAIO — Vérifier : déjà ouverte en 2025-2026 » (année scolaire de la campagne d'ouverture : d'après la date
de publication, sinon la campagne précédente), tant que la fiche n'est pas reçue.
Sous son nom : le n° Parcoursup de la formation ouverte, « voir », « supprimer la demande » ou « ce n'est pas la même »
(colonne Suivi.Deja_ouverte = NON, créée automatiquement).
Le bouton « ✓ Vérifiée » (prochaine action) confirme que c'est bien la formation déjà ouverte : la demande sort des « à faire »
(Deja_ouverte = OUI, « annuler » pour revenir en arrière) et reste visible avec le filtre « Tous », pastille « déjà ouverte ». La fiche n'est pas proposée à l'envoi par mail pour ces demandes.
La fenêtre « + Nouvelle demande » le signale aussi pendant la saisie.

## Lignes de l'export

Dans la fenêtre « Retrouver dans l'export Carif-Oref », le lien « Lignes de l'export ▸ » sous chaque formation affiche
toutes ses lignes du fichier Excel (une par session, toutes les colonnes non vides) ; les colonnes qui changent d'une ligne
à l'autre sont surlignées. Le bouton « ⤓ Lignes de l'export (.xlsx) » télécharge les lignes de toutes les formations proposées.

Ces lignes sont enregistrées à chaque import dans la table Grist `Export_lignes` (créée automatiquement, une ligne par formation),
lue seulement à la demande : le chargement du widget n'est pas ralenti. Elles ne sont disponibles qu'après un premier import
fait avec cette version.

## Mail d'envoi des fiches (validation interne)

« ✉ Envoyer les fiches par mail » prépare le mail pour validation interne : il est adressé à saio@ac-bordeaux.fr
(modifiable), avec des agents en copie, l'objet commence par « [À valider] » et indique l'adresse de l'établissement,
à qui le mail est transmis une fois validé. Les adresses de validation et de copie sont enregistrées dans la table
Grist « Parametres » (colonnes Mail_validation et Mail_copie, créées automatiquement) depuis la fenêtre d'envoi :
elles ne figurent pas dans le code, le dépôt étant public.

## Fermetures sur Parcoursup (vigilance)

Le bouton « ⚠ Fermetures » liste les formations fermées sur Parcoursup (table Grist `Fermetures`, créée au premier import)
et permet d'importer le fichier Excel des fermetures (colonnes UAI, Etablissement, formation, code formation, remarques) ;
ce fichier est aussi reconnu par « importer le nouvel export » et par le glisser-déposer. Seules les lignes nouvelles
sont ajoutées : la table peut aussi être complétée à la main dans Grist.
À l'import, l'outil demande la campagne Parcoursup des fermetures (par défaut l'année précédant la rentrée visée),
sauf si le fichier a une colonne « Campagne » ou « Année » ; un réimport complète la campagne des lignes qui n'en ont pas.
Toutes les campagnes enregistrées sont prises en compte ; la campagne est indiquée dans chaque signalement.

Signalement, pour surveiller les établissements avant d'ouvrir de nouvelles formations :
- pastille « ⚠ N fermetures » sur l'établissement (même UAI ou même nom d'organisme), rouge si une de ses formations est elle-même dans la liste ;
- mention « ⚠ Fermée sur Parcoursup » sur la ligne de la formation dont le n° Parcoursup est dans la liste ;
- dans la fenêtre « + Nouvelle demande » : une ligne d'avertissement dès que le nom saisi correspond à une fermeture ;
- dans la fiche : contrôle « Aucune formation de cet organisme fermée sur Parcoursup » et tableau des fermetures concernées ;
- dans l'export PDF : bandeau « Vigilance » sous l'établissement et mention sur la formation fermée.

## Module Thunderbird « Ajouter au suivi »

Dossier `thunderbird/` (paquet prêt à installer : `suivi-apprentissage-thunderbird.xpi`).
Sur un mail ouvert, le bouton « Ajouter au suivi » lit l'expéditeur, la date, la signature et les formations citées,
puis ajoute les formations dans la table `Suivi` du document Grist (API, clé personnelle saisie dans les réglages du module).
Le formulaire s'ouvre dans une petite fenêtre séparée (version 1.4) : elle reste ouverte quand on clique dans le mail pour y chercher
un téléphone ou une adresse ; un nouveau clic sur le bouton la remplace par celle du mail affiché.
Installation : Thunderbird → Modules et thèmes → roue dentée → « Installer un module depuis un fichier… » → le fichier .xpi.

## À faire

- Formulaire de fiche : ajouter dans le libellé de la case « Je certifie avoir pris connaissance de la charte Parcoursup » un lien vers la charte 2027, dès sa publication.
