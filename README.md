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

Bibliothèques jsPDF et jsPDF-AutoTable dans `lib/` (licence MIT), chargées au premier export seulement.

## Lignes de l'export

Dans la fenêtre « Retrouver dans l'export Carif-Oref », le lien « Lignes de l'export ▸ » sous chaque formation affiche
toutes ses lignes du fichier Excel (une par session, toutes les colonnes non vides) ; les colonnes qui changent d'une ligne
à l'autre sont surlignées. Le bouton « ⤓ Lignes de l'export (.xlsx) » télécharge les lignes de toutes les formations proposées.

Ces lignes sont enregistrées à chaque import dans la table Grist `Export_lignes` (créée automatiquement, une ligne par formation),
lue seulement à la demande : le chargement du widget n'est pas ralenti. Elles ne sont disponibles qu'après un premier import
fait avec cette version.

## Fermetures sur Parcoursup (vigilance)

Le bouton « ⚠ Fermetures » liste les formations fermées sur Parcoursup (table Grist `Fermetures`, créée au premier import)
et permet d'importer le fichier Excel des fermetures (colonnes UAI, Etablissement, formation, code formation, remarques) ;
ce fichier est aussi reconnu par « importer le nouvel export » et par le glisser-déposer. Seules les lignes nouvelles
sont ajoutées : la table peut aussi être complétée à la main dans Grist.

Signalement, pour surveiller les établissements avant d'ouvrir de nouvelles formations :
- pastille « ⚠ N fermetures » sur l'établissement (même UAI ou même nom d'organisme), rouge si une de ses formations est elle-même dans la liste ;
- mention « ⚠ Fermée sur Parcoursup » sur la ligne de la formation dont le n° Parcoursup est dans la liste ;
- dans la fiche : contrôle « Aucune formation de cet organisme fermée sur Parcoursup » et tableau des fermetures concernées.

## Module Thunderbird « Ajouter au suivi »

Dossier `thunderbird/` (paquet prêt à installer : `suivi-apprentissage-thunderbird.xpi`).
Sur un mail ouvert, le bouton « Ajouter au suivi » lit l'expéditeur, la date, la signature et les formations citées,
puis ajoute les formations dans la table `Suivi` du document Grist (API, clé personnelle saisie dans les réglages du module).
Installation : Thunderbird → Modules et thèmes → roue dentée → « Installer un module depuis un fichier… » → le fichier .xpi.

## À faire

- Formulaire de fiche : ajouter dans le libellé de la case « Je certifie avoir pris connaissance de la charte Parcoursup » un lien vers la charte 2027, dès sa publication.
