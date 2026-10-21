# Validation E2E et préparation pilote Greenhouse — 21 octobre 2026

## Verdict

Le parcours local compte → profil → CV → préférences → offres → matching →
swipes → brouillon → documents → approbation → statut non envoyé est validé
sur Supabase local, desktop et mobile.

Limite de preuve : le sélecteur de fichier Chrome a refusé `setFiles` parce que
l'extension de contrôle n'a pas l'autorisation d'accéder aux URL de fichiers.
Le même PDF a été envoyé à la route authentifiée réelle `POST /api/resumes`, qui
a répondu `201`; la page rechargée a affiché le fichier et ses données extraites.
Le parcours fonctionnel est donc validé, mais le geste natif de sélection du
fichier reste bloqué par ce réglage du navigateur de test.

Aucune candidature externe n'a été soumise. La seule candidature locale est
approuvée, `submitted_at` est nul, `submission_evidence` est nul et
`application_submissions` ne contient aucune ligne pour ce parcours.

## Parcours observé

1. création du compte local `camille.e2e.20261021@example.test` ;
2. déconnexion puis reconnexion avec session SSR ;
3. import réel d'un PDF factuel, réponse HTTP `201`, extraction et affichage ;
4. identité, expérience, compétences et préférences persistées ;
5. 29 offres externes actives consultables après exclusion des fixtures de test ;
6. score déterministe et trois catégories d'explication visibles ;
7. swipe gauche persistant puis swipe droite persistant ;
8. une seule candidature `saved` créée et dossier préparé automatiquement ;
9. CV ciblé et lettre visibles, deux exports `application/pdf` vérifiés avec
   signature `%PDF` ;
10. aucun champ obligatoire manquant sur le dossier testé ;
11. approbation explicite, version figée et empreinte SHA-256 conservée ;
12. tableau de bord : `Acceptée` / `Dossier approuvé`, sans statut soumis.

## Captures

- [Inscription desktop](e2e-evidence/2026-10-21/signup-desktop.jpg)
- [Onboarding et CV desktop](e2e-evidence/2026-10-21/onboarding-desktop.jpg)
- [Offres et matching desktop](e2e-evidence/2026-10-21/jobs-desktop.jpg)
- [Tableau de bord desktop](e2e-evidence/2026-10-21/dashboard-desktop.jpg)
- [Dossier approuvé desktop](e2e-evidence/2026-10-21/application-approved-desktop.jpg)
- [Offres mobile 390 × 844](e2e-evidence/2026-10-21/jobs-mobile.jpg)
- [Tableau de bord mobile 390 × 844](e2e-evidence/2026-10-21/dashboard-mobile.jpg)
- [Dossier approuvé mobile 390 × 844](e2e-evidence/2026-10-21/application-approved-mobile.jpg)

## Anomalies corrigées

- Les fixtures Supabase `local-test` restaient visibles après les tests : leur
  suppression était tentée avant la cascade utilisateur et l'erreur était
  ignorée. Le nettoyage s'exécute maintenant après les comptes et propage toute
  erreur. Les 26 fixtures historiques ont été reclassées localement `is_demo=true`.
- Après rechargement, les offres refusées ou acceptées réapparaissaient : la
  relation PostgREST plusieurs-vers-un était lue uniquement comme un tableau.
  Les deux formes sont maintenant normalisées ; 27 offres restent après deux
  décisions.
- Le texte Remote OK `Sothebyâs` était affiché corrompu et faisait échouer les
  exports PDF en `500`. Le texte est réparé à l'ingestion et à l'affichage ; le
  générateur remplace aussi tout caractère non encodable.
- Les PDF ont des métadonnées temporelles déterministes afin que leur contenu
  Base64 et le hash du payload restent stables entre enqueue et worker.

## Greenhouse

L'adaptateur prépare maintenant le CV et la lettre en PDF Base64 avec les noms
officiels `resume_content`, `resume_content_filename`,
`cover_letter_content` et `cover_letter_content_filename`. Les tests décodent
les deux valeurs et vérifient la signature `%PDF`.

L'adaptateur continue de déclarer `supportsIdempotencyKey=false` et
`canVerifyConfirmation=false`. Le worker D1 refuse donc son enqueue. Un HTTP
2xx resterait `uncertain`, et `reconcile()` resterait `inconclusive`. Le détail
des gates employeur et serveur est dans [GREENHOUSE_PILOT.md](GREENHOUSE_PILOT.md).

## Gates exécutées

- `pnpm typecheck` : réussi ;
- `pnpm lint` : réussi ;
- `pnpm test` : 74 réussis, 6 intégrations opt-in ignorées ;
- `pnpm test:supabase` : 6/6 réussis ;
- `pnpm test:db` : pgTAP 34/34 ;
- `pnpm build` : réussi.

Le contrôle final doit confirmer 29 offres externes non démo, aucune nouvelle
fixture non démo et aucune soumission réelle.
