# Sync-in-avec-FreeIPA

## Intégration d'un serveur Sync-in dans un environnement FreeIPA

**Cette documentation fournit une méthodologie pour mettre en place une plateforme collaborative Sync-in conteneurisée dans une infrastructure d'authentification centralisée avec FreeIPA**

### 🎯 Objectifs

- Serveur FreeIPA sur RHEL 10
- Serveur Sync-in en container Podman rootless
- Authentification LDAPS des utilisateurs Sync-in via l'annuaire FreeIPA
- Synchronisation des données utilisateurs sur un poste client Linux Mint ↔ serveur Sync-in
- Sécurisation des données sensibles et des connexions

### 📚 Contenu

- Installation et configuration minimale du serveur FreeIPA
- Jointure du client Linux Mint au domaine
- Containerisation de Sync-in avec Podman (rootless)
- Création d'une image personnalisée pour l'intégration du certificat auto-signé du serveur FreeIPA nécessaire aux connexions LDAPS
- Mise en place d'une synchronisation d'un dossier local avec le client Linux Sync-in

### 🤝 Retours et améliorations appréciés

**La documentation est [ici](./rhel-sync-in-freeipa.md)**