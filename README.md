# Suivi des référencements en apprentissage — widget Grist

Vue « accordéon » du document Grist *Suivi_formations_apprentissage* (SAIO Bordeaux) :
une ligne par formation demandée, regroupées par établissement, avec les 6 étapes
(mail reçu → lien envoyé → fiche reçue → UAI → RNCP → publiée) et la prochaine action à faire.

Adresse du widget : https://brunomauneau-dev.github.io/suivi-apprentissage/

Dans Grist : Ajouter → Ajouter une page → Widget personnalisé → URL personnalisée → coller l'adresse,
données : table *Fiches*, accès : **accès complet au document**.

Hors de Grist, la page s'affiche en mode démonstration (données fictives).

## Module Thunderbird « Ajouter au suivi »

Dossier `thunderbird/` (paquet prêt à installer : `suivi-apprentissage-thunderbird.xpi`).
Sur un mail ouvert, le bouton « Ajouter au suivi » lit l'expéditeur, la date, la signature et les formations citées,
puis ajoute les formations dans la table `Suivi` du document Grist (API, clé personnelle saisie dans les réglages du module).
Installation : Thunderbird → Modules et thèmes → roue dentée → « Installer un module depuis un fichier… » → le fichier .xpi.
