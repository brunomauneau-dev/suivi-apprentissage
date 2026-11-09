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

## Module Thunderbird « Ajouter au suivi »

Dossier `thunderbird/` (paquet prêt à installer : `suivi-apprentissage-thunderbird.xpi`).
Sur un mail ouvert, le bouton « Ajouter au suivi » lit l'expéditeur, la date, la signature et les formations citées,
puis ajoute les formations dans la table `Suivi` du document Grist (API, clé personnelle saisie dans les réglages du module).
Installation : Thunderbird → Modules et thèmes → roue dentée → « Installer un module depuis un fichier… » → le fichier .xpi.

## À faire

- Formulaire de fiche : ajouter dans le libellé de la case « Je certifie avoir pris connaissance de la charte Parcoursup » un lien vers la charte 2027, dès sa publication.
