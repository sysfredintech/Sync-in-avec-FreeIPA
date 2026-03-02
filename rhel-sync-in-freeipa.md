# Intégration d'un serveur Sync-in dans un environnement FreeIPA

## Présentation des outils utilisés

- FreeIPA: Une solution intégrée d'identité et d'authentification pour les environnements réseau Linux développée par Red Hat
- Sync-in: Une plateforme open source pour stocker, partager, collaborer et synchroniser des données

## Objectifs

- Mise en place d'un serveur FreeIPA sur RHEL 10
- Installation d'un service Sync-in dans un container Podman rootless sur RHEL 10
- Protéger les données sensibles de la configuration de Sync-in
- Authentification via l'annuaire LDAP du serveur FreeIPA dans Sync-in
- Sécuriser les connexions à l'annuaire avec le protocole LDAPS
- Synchroniser les données utilisateurs avec l'application Sync-in

## Contexte

- Une première VM RHEL 10 pour l'installation de FreeIPA-server (2 cores - 4Go RAM)
- Une seconde VM RHEL 10 pour l'installation de Sync-in avec Podman (2 cores - 4Go RAM)
- Un client Linux Mint pour les connexions utilisateurs Sync-in
- Une passerelle et un serveur DNS principal en 192.168.10.254

## À savoir

FreeIPA est une solution très complète et complexe qui ne sera pas étudiée de manière approfondie dans ce lab, l'objectif étant l'authentification à Sync-in via l'annuaire. Se référer à la [documentation officielle](https://www.freeipa.org/page/Documentation.html) pour mettre en place une configuration complète d'infrastructure

---

## Installation du serveur FreeIPA sur la première VM RHEL 10

### Configuration réseau

- Définir le nom d'hôte du serveur, un adressage IPv4 fixe et son DNS
```bash
sudo -i
nmcli con show
nmcli con mod ens18 ipv4.method manual ipv4.addresses 192.168.10.245/24 ipv4.gateway 192.168.10.254 ipv4.dns 192.168.10.254 ipv4.dns-search home.lab
nmcli con down ens18
nmcli con up ens18
hostnamectl set-hostname srv-lab-ipa
vim /etc/hosts
```
Ajouter cette ligne
`192.168.10.245 srv-lab-ipa.home.lab srv-lab-ipa`

_Ces valeurs sont à adapter en fonction de l'architecture en place et du nom de l'interface_

### Installation du service IPA-server

```bash
dnf install ipa-server ipa-server-dns -y
ipa-server-install --hostname=srv-lab-ipa.home.lab -n home.lab -r HOME.LAB --auto-forwarder --setup-dns --allow-zone-overlap --reverse-zone=10.168.192.in-addr.arpa.
```
Le message suivant est normal car le DNS principal ne connaît pas le domaine home.lab
```
DNS check for domain home.lab. failed: All nameservers failed to answer the query home.lab. IN SOA: Server Do53:192.168.10.254@53 answered The DNS operation timed out.; Server Do53:192.168.10.254@53 answered SERVFAIL.
Checking DNS forwarders, please wait ...
```
La confirmation doit ressembler à cette sortie
```
The IPA Master Server will be configured with:
Hostname:       srv-lab-ipa.home.lab
IP address(es): 192.168.10.245
Domain name:    home.lab
Realm name:     HOME.LAB

The CA will be configured with:
Subject DN:   CN=Certificate Authority,O=HOME.LAB
Subject base: O=HOME.LAB
Chaining:     self-signed

BIND DNS server will be configured to serve IPA domain with:
Forwarders:       192.168.10.254
Forward policy:   only
Reverse zone(s):  10.168.192.in-addr.arpa.

Continue to configure the system with these values? [no]: yes
```
`yes`

_L'installation peut prendre un certain temps selon les performances de la VM_

Si l'installation se déroule normalement, la sortie renvoie
```
Setup complete

Next steps:
	1. You must make sure these network ports are open:
		TCP Ports:
		  * 80, 443: HTTP/HTTPS
		  * 389, 636: LDAP/LDAPS
		  * 88, 464: kerberos
		  * 53: bind
		UDP Ports:
		  * 88, 464: kerberos
		  * 53: bind
		  * 123: ntp

	2. You can now obtain a kerberos ticket using the command: 'kinit admin'
	   This ticket will allow you to use the IPA tools (e.g., ipa user-add)
	   and the web user interface.

Be sure to back up the CA certificates stored in /root/cacert.p12
These files are required to create replicas. The password for these
files is the Directory Manager password
The ipa-server-install command was successful
```

### Ouverture des ports nécessaires au service IPA-server

```bash
firewall-cmd --add-service=http --add-service=https --add-service=ldap --add-service=ldaps --add-service=kerberos --add-service=ntp --permanent
firewall-cmd --add-port=53/tcp --add-port=53/udp --add-port=88/tcp --add-port=464/udp --add-port=464/tcp --permanent
firewall-cmd --reload
```

### Obtention d'un ticket Kerberos

```bash
kinit admin
```
`Password for admin@HOME.LAB:`
```bash
klist
```
```
Ticket cache: KCM:0
Default principal: admin@HOME.LAB

Valid starting       Expires              Service principal
02/26/2026 18:09:21  02/27/2026 17:49:37  krbtgt/HOME.LAB@HOME.LAB
```

### Vérification du bon fonctionnement du serveur

```bash
ipa user-find admin
```
Cette commande doit renvoyer
```
--------------
1 user matched
--------------
  User login: admin
  Last name: Administrator
  Home directory: /home/admin
  Login shell: /bin/bash
  Principal name: admin@HOME.LAB
  Principal alias: admin@HOME.LAB, root@HOME.LAB
  UID: 549600000
  GID: 549600000
  Account disabled: False
----------------------------
Number of entries returned 1
----------------------------
```

### Création d'un compte système pour Sync-in

```bash
vim create-syncin-account.ldif
```
```
dn: uid=sync-in,cn=sysaccounts,cn=etc,dc=home,dc=lab
changetype: add
objectclass: account
objectclass: simplesecurityobject
uid: sync-in
userPassword: Password9999 # Mot de passe à changer
passwordExpirationTime: 20380119031407Z # Date lointaine pour éviter l'expiration du mot de passe
nsIdleTimeout: 0
```
```bash
ldapmodify -Y GSSAPI -H ldaps://srv-lab-ipa.home.lab:636 -f create-syncin-account.ldif
```


### Connexion à la WebUI d'administration de FreeIPA

- Se connecter avec un navigateur à l'adresse `https://srv-lab-ipa.home.lab/ipa/ui/`

Accepter le certificat auto-signé

![web-self-signed](./images/web-self-signed.png)

Entrer les identifiants du compte administrateur défini précédemment

![web-login](./images/web-login.png)

Créer un utilisateur test pour réaliser la connexion depuis un poste client

![web-user](./images/web-test-user.png)

Lui attribuer un login et un mot de passe qui devra être modifié à la première connexion

![web-user-2](./images/web-test-user-2.png)


---

## Jointure au domaine sur le client Linux Mint

### Configuration réseau

- Définir les paramètres réseaux via l'interface graphique

![client-net-conf](./images/client-net-conf.png)

- Préparer le système avant la jointure au domaine

```bash
sudo -i
hostnamectl set-hostname lab-client-mint
apt install chrony -y
echo 'server 192.168.10.245 iburst' > /etc/chrony/sources.d/ipa-srv.sources
systemctl restart chronyd
nano /etc/resolv.conf
```
```
nameserver 192.168.10.245
options edns0 trust-ad
search home.lab
```
```bash
apt install freeipa-client -y
```

Indiquer les informations relatives au domaine et au serveur IPA

![client-net-conf-2](./images/client-net-conf-2.png)

![client-net-conf-3](./images/client-net-conf-3.png)

![client-net-conf-4](./images/client-net-conf-4.png)

- Joindre la machine au domaine

```bash
ipa-client-install --hostname=lab-client-mint.home.lab --mkhomedir
```

La sortie doit être semblable à celle-ci
```
This program will set up IPA client.
Version 4.11.1

WARNING: conflicting time&date synchronization service 'ntp' will be disabled in favor of chronyd

DNS discovery failed to determine your DNS domain
Provide the domain name of your IPA server (ex: example.com): ^CThe ipa-client-install command failed. See /var/log/ipaclient-install.log for more information
root@lab-client-mint:~# nano /etc/resolv.conf 
root@lab-client-mint:~# ipa-client-install --hostname=lab-client-mint.home.lab --mkhomedir
This program will set up IPA client.
Version 4.11.1

WARNING: conflicting time&date synchronization service 'ntp' will be disabled in favor of chronyd

Discovery was successful!
Do you want to configure chrony with NTP server or pool address? [no]: 
Client hostname: lab-client-mint.home.lab
Realm: HOME.LAB
DNS Domain: home.lab
IPA Server: srv-lab-ipa.home.lab
BaseDN: dc=home,dc=lab

Continue to configure the system with these values? [no]: yes
Synchronizing time
No SRV records of NTP servers found and no NTP server or pool address was provided.
Using default chrony configuration.
Attempting to sync time with chronyc.
Time synchronization was successful.
User authorized to enroll computers: admin
Password for admin@HOME.LAB: 
Successfully retrieved CA cert
    Subject:     CN=Certificate Authority,O=HOME.LAB
    Issuer:      CN=Certificate Authority,O=HOME.LAB
    Valid From:  2026-02-26 15:58:01+00:00
    Valid Until: 2046-02-26 15:58:01+00:00

Enrolled in IPA realm HOME.LAB
Created /etc/ipa/default.conf
Configured /etc/sssd/sssd.conf
Systemwide CA database updated.
Hostname (lab-client-mint.home.lab) does not have A/AAAA record.
Missing reverse record(s) for address(es): 192.168.10.140.
SSSD enabled
/etc/ldap/ldap.conf does not exist.
Failed to configure /etc/openldap/ldap.conf
Configured /etc/ssh/ssh_config
/etc/ssh/sshd_config not found, skipping configuration
Configuring home.lab as NIS domain.
Configured /etc/krb5.conf for IPA realm HOME.LAB
Client configuration complete.
The ipa-client-install command was successful
```

- Il est possible de vérifier côté serveur que la machine a bien été enrollée

![enroll-ok](./images/enroll-ok.png)

- Afin que le gestionnaire de sessions laisse la possibilité d'entrer un login inconnu localement, il faut modifier la configuration de lightdm

```bash
nano /etc/lightdm/lightdm.conf.d/99-freeipa.conf
```
```
[SeatDefaults]
greeter-show-manual-login = true
greeter-hide-users = true
allow-guest = false
```

- Redémarrer le poste client

Saisir les identifiants de l'utilisateur créé précédemment sur le serveur IPA

![connect-client-1](./images/connect-client-1.png)

L'utilisateur est invité à changer son mot de passe lors de la première connexion

![connect-client-2](./images/connect-client-2.png)

L'utilisateur est bien connecté au poste client avec son compte LDAP et son dossier personnel a bien été créé

![connect-client-3](./images/connect-client-3.png)

---

## Installation de Sync-in dans un container podman rootless sur le deuxième serveur RHEL 10

### Joindre le domaine

- Configuration réseau et préparation du système

```bash
hostnamectl set-hostname srv-lab-syncin
nmcli con show
nmcli con mod ens18 ipv4.method manual ipv4.addresses 192.168.10.240/24 ipv4.gateway 192.168.10.254 ipv4.dns 192.168.10.245 ipv4.dns-search home.lab
nmcli con down ens18
nmcli con up ens18
vim /etc/resolv.conf
```
```
nameserver 192.168.10.245
search home.lab
```
```bash
echo 'server 192.168.10.245 iburst' >> /etc/chrony.conf
systemctl restart chronyd
dnf install ipa-client -y
```

- Rejoindre le domaine

```bash
ipa-client-install --hostname=srv-lab-syncin.home.lab --mkhomedir
```
La sortie doit être semblable à celle-ci
```
This program will set up IPA client.
Version 4.12.2

Discovery was successful!
Do you want to configure chrony with NTP server or pool address? [no]: 
Client hostname: srv-lab-syncin.home.lab
Realm: HOME.LAB
DNS Domain: home.lab
IPA Server: srv-lab-ipa.home.lab
BaseDN: dc=home,dc=lab

Continue to configure the system with these values? [no]: yes
Synchronizing time
No SRV records of NTP servers found and no NTP server or pool address was provided.
Using default chrony configuration.
Attempting to sync time with chronyc.
Time synchronization was successful.
User authorized to enroll computers: admin
Password for admin@HOME.LAB: 
Successfully retrieved CA cert
    Subject:     CN=Certificate Authority,O=HOME.LAB
    Issuer:      CN=Certificate Authority,O=HOME.LAB
    Valid From:  2026-02-26 16:58:01+00:00
    Valid Until: 2046-02-26 16:58:01+00:00

Enrolled in IPA realm HOME.LAB
Created /etc/ipa/default.conf
Configured /etc/sssd/sssd.conf
Systemwide CA database updated.
Hostname (srv-lab-syncin.home.lab) does not have A/AAAA record.
Missing reverse record(s) for address(es): 192.168.10.240.
Adding SSH public key from /etc/ssh/ssh_host_ecdsa_key.pub
Adding SSH public key from /etc/ssh/ssh_host_ed25519_key.pub
Adding SSH public key from /etc/ssh/ssh_host_rsa_key.pub
SSSD enabled
Configured /etc/openldap/ldap.conf
Configured /etc/ssh/ssh_config
Configured /etc/ssh/sshd_config.d/04-ipa.conf
Configuring home.lab as NIS domain.
Configured /etc/krb5.conf for IPA realm HOME.LAB
Client configuration complete.
The ipa-client-install command was successful
```

- Tester la jointure

```bash
kinit admin
klist
```
Doit renvoyer
```
Ticket cache: KCM:0
Default principal: admin@HOME.LAB

Valid starting       Expires              Service principal
02/28/2026 16:46:24  03/01/2026 16:06:34  krbtgt/HOME.LAB@HOME.LAB
```

- Il est possible de vérifier que le serveur a bien été enrollé sur la WebUI de FreeIPA

![sync-in-enroll](./images/syncin-enroll.png)

### Installation du serveur Sync-in containerisé

- Ajouter le dépôt EPEL et installer les packets nécessaires
```bash
sudo -i
wget https://dl.fedoraproject.org/pub/epel/epel-release-latest-10.noarch.rpm
dnf install ./epel-release-latest-10.noarch.rpm -y
/usr/bin/crb enable
dnf install container-tools -y
dnf install podman-compose -y
```

- Ouvrir les ports utilisés par le service

```bash
firewall-cmd --add-port=8080/tcp --permanent
firewall-cmd --reload
```

- Créer l'utilisateur dédié au service et récupérer les sources du projet Sync-in

```bash
useradd syncin -s /bin/bash -m
passwd syncin
loginctl enable-linger syncin
su - syncin
curl -L -o sync-in-docker.tar.gz https://github.com/Sync-in/server/releases/latest/download/sync-in-docker.tar.gz && tar zxvf sync-in-docker.tar.gz
exit
```

- Gérer le contexte SELinux

```bash
dnf install policycoreutils-python-utils -y
semanage fcontext -a -t container_file_t '/home/syncin/sync-in-docker(/.*)?'
restorecon -Rv /home/syncin/sync-in-docker
```

#### Préparation du container

```bash
su - syncin
cd sync-in-docker
```

**A partir de ce point, si l'on souhaite pouvoir effectuer des connexions sécurisées via le protocole `ldaps` avec le serveur FreeIPA, il va falloir créer une image personnalisée de Sync-in afin qu'il fasse confiance au certificat auto-signé du serveur. Il semble qu'il n'existe aucune manière de définir le certificat auto-signé comme sûr via les variables d'environnement du container, ceci fera peut-être l'objet d'une évolution du projet à l'avenir mais à ce jour il faut procéder comme suit**

- Récupérer le certificat du serveur FreeIPA contenu dans le fichier `/etc/ipa/ca.crt` du serveur FreeIPA et de le copier dans un fichier localement. Soit avec la commande `scp` et un utilisateur local ou via un copier/coller du contenu du fichier

```bash
mkdir certs
scp fred@srv-lab-ipa.home.lab:/etc/ipa/ca.crt certs/freeipa-ca.crt
```
Il faut ensuite convertir ce fichier au format `pem`
```bash
openssl x509 -in certs/freeipa-ca.crt -outform PEM -out certs/freeipa-ca.pem
```

- Créer un dossier `ldapts` et y placer le fichier `auth-provider-ldap.service.js` personnalisé qui remplacera celui du container afin d'y ajouter le chemin vers le certificat. Ce fichier provient de l'image officielle Sync-in, les modifications interviennent entre les lignes 94 et 111

```bash
mkdir ldapts && cd ldapts
wget https://raw.githubusercontent.com/sysfredintech/Sync-in-avec-FreeIPA/refs/heads/main/js/auth-provider-ldap.service.js
```

_Il est possible d'adapter la ligne 108 de ce fichier en fonction du chemin vers le certificat_

- Création du `Dockerfile` et build de l'image personnalisée

```bash
vim Dockerfile
```
```
FROM syncin/server:2

RUN mkdir -p /app/certs

COPY certs/freeipa-ca.pem /app/certs/freeipa-ca.pem

COPY ldapts/auth-provider-ldap.service.js /app/server/authentication/providers/ldap/auth-provider-ldap.service.js
```
```bash
podman build -t sync-in-freeipa .
```
Choisir le dépôt `docker.io`

- Editer les fichiers `docker-compose.yaml` et `environment.yaml` afin de définir l'image personnalisée créée précédemment et l'utilisation de variables pour les informations sensibles. Dans un environnement SELinux, il faut impérativement placer l'option `Z` pour les volumes

_Cette configuration doit être adaptée selon les éléments de l'infrastructure en place_

```bash
vim docker-compose.yaml
```
```
#include:
#  - ./config/nginx/docker-compose.nginx.yaml
#  - ./config/onlyoffice/docker-compose.onlyoffice.yaml
#  - ./config/collabora/docker-compose.collabora.yaml
#  - ./config/sync-in-desktop-releases/docker-compose.sync-in-desktop-releases.yaml

name: sync-in
services:
  sync_in:
    image: localhost/sync-in-freeipa
    env_file:
      - .env
    container_name: sync-in
    restart: always
    environment:
      - INIT_ADMIN
      - INIT_ADMIN_PASSWORD
      - INIT_ADMIN_LOGIN
      - PUID=${PUID:-8888}
      - PGID=${PGID:-8888}
      - SYNCIN_MYSQL_URL
      - SYNCIN_AUTH_LDAP_SERVICEBINDPASSWORD
    ports:
      - "8080:8080"
    volumes:
      - ./environment.yaml:/app/environment/environment.yaml:Z
      - data:/app/data:Z
      - desktop_releases:/app/static/releases:ro
    depends_on:
      - mariadb
    logging:
      driver: json-file
      options:
        max-size: "25m"
        max-file: "5"
    networks:
      - sync_in_network

  mariadb:
    image: mariadb:11
    env_file:
      - .env
    container_name: mariadb
    restart: always
    command: --innodb_ft_cache_size=16000000 --max-allowed-packet=1G
    environment:
      MYSQL_ROOT_PASSWORD: ${MYSQL_ROOT_PASSWORD}
      MYSQL_DATABASE: ${MYSQL_DATABASE}
    volumes:
      - mariadb_data:/var/lib/mysql
    networks:
      - sync_in_network

networks:
  sync_in_network:
    driver: bridge

volumes:
  data:
  mariadb_data:
  desktop_releases:

```

- La configuration suivante met en place l'authentification via l'annuaire du serveur FreeIPA ainsi que les options nécessaires à l'automatisation de la création des éléments des comptes utilisateurs

L'intégralité des options utilisables sont listées sur [le site officiel de Sync-in](https://sync-in.com/fr/docs/setup-guide/server/#variables-denvironnement)

```bash
vim environment.yaml
```
```
auth:
  provider: ldap
  ldap:
    servers: [ldaps://srv-lab-ipa.home.lab:636]
    baseDN: cn=users,cn=accounts,dc=home,dc=lab
    serviceBindDN: uid=sync-in,cn=sysaccounts,cn=etc,dc=home,dc=lab
    attributes:
      login: uid
      email: mail
    options:
      autoCreatePermissions:
        - personal_space
        - spaces_access
        - shares_access
        - personal_groups_admin
        - desktop_app_access
        - desktop_app_sync
        - webdav_access
applications:
  files:
    dataPath: /app/data
    collabora:
      enabled: false
    onlyoffice:
      enabled: false
      secret: onlyOfficeSecret
```

- Afin de sécuriser la configuration, stocker les secrets dans un unique fichier `.env`

_Les mots de passe suivants doivent être modifiés par des chaînes de caractères complexes_

```bash
vim .env
```
```
SYNCIN_MYSQL_URL="mysql://root:Password9999@mariadb:3306/sync_in"
SYNCIN_AUTH_ENCRYPTIONKEY="changeEncryptionKeyWithStrongKey"
SYNCIN_AUTH_TOKEN_ACCESS_SECRET="changeAccessWithStrongSecret"
SYNCIN_AUTH_TOKEN_REFRESH_SECRET="changeAccessWithStrongSecret"
MYSQL_ROOT_PASSWORD="Password9999"
MYSQL_DATABASE="sync_in"
SYNCIN_AUTH_LDAP_SERVICEBINDPASSWORD="Password9999"
```
```bash
chmod 600 .env
```

- Lancer le container avec l'initialisation du compte admin, les identifiants devront être changés

```bash
INIT_ADMIN=true INIT_ADMIN_LOGIN='user' INIT_ADMIN_PASSWORD='password' podman compose up -d
```
Choisir le dépôt `docker.io` pour Mariadb

- Surveiller le bon déroulement de la création des containers

```bash
podman compose logs -f
```

Lorsque les containers sont prêts le message suivant apparaît dans les logs
```
6d45b57c51bd [2026-02-28 17:08:05] INFO (61): [NestApplication] Nest application successfully started
6d45b57c51bd [2026-02-28 17:08:05] INFO (61): [HTTP] Server listening at http://0.0.0.0:8080/
```

- Créer un service systemd pour le démarrage automatique du container, pour cela, il faut se connecter en ssh directement avec le compte de l'utilisateur `syncin` avec `ssh syncin@srv-lab-syncin.home.lab`

```bash
podman generate systemd --new --files --name sync-in
mkdir -p ~/.config/systemd/user/
mv container-sync-in.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable container-sync-in.service
```

**Il est bien sûr recommandé de sécuriser les connexions Sync-in avec un reverse proxy tel que Traefik et le protocole https**

---

## Connexion à Sync-in depuis le poste client Linux Mint

- Récupérer l'appimage du client Linux et la rendre disponible pour tous les utilisateurs du poste

Se connecter avec un compte local ou LDAP membre du groupe sudo puis télécharger l'appimage disponible sur [le site de Sync-in](https://sync-in.com/downloads)

```bash
sudo -i
mkdir -p /opt/applications/Sync-in
mv /home/fred/Downloads/Sync-in-Desktop-2.0.0-x86_64.AppImage /opt/applications/Sync-in/
chmod 755 /opt/applications/Sync-in/Sync-in-Desktop-2.0.0-x86_64.AppImage
mkdir /opt/applications/Sync-in/icons/
wget https://sync-in.com/img/logo-512.png -O /opt/applications/Sync-in/icons/sync-in.png
chmod 755 /opt/applications/Sync-in/icons/sync-in.png
mkdir /etc/skel/Desktop
nano /etc/skel/Desktop/sync-in.desktop
```
```
[Desktop Entry]
Version=2.0
Type=Application
Name=Sync-in
GenericName=Client Sync-in
Comment=Accès à la plateforme Sync-in
Exec=/opt/applications/Sync-in/Sync-in-Desktop-2.0.0-x86_64.AppImage
Icon=/opt/applications/Sync-in/icons/sync-in.png
Terminal=false
Categories=Network;FileTransfer;
Keywords=sync;cloud;webdav;
StartupWMClass=Sync-in
MimeType=x-scheme-handler/sync-in;
```
```bash
chmod 755 /etc/skel/Desktop/sync-in.desktop
```
_Adapter le chemin `/etc/skel/Desktop` selon la langue de l'OS peut être `/etc/skel/Bureau`_

_L'utilisateur de test ayant déjà effectué une première connexion sur le poste, l'icone de Sync-in ne sera pas copiée sur son bureau_

- Afin de tester correctement cette configuration, il est préférable de créer un second utilisateur sur le serveur IPA puis de se connecter au poste client avec ce nouvel utilisateur

![app-sync-in-1](./images/app-syncin-1.png)

Accéder au site depuis le navigateur `http://srv-lab-syncin.home.lab:8080`

![syncin-web-1](./images/syncin-web-1.png)

Se connecter avec l'utilisateur `user` et le mot de passe `password` afin d'accéder à l'interface d'administration et de créer un compte administrateur sécurisé

![syncin-web-1bis](./images/syncin-web-1-bis.png)

![syncin-web-2](./images/syncin-web-2.png)

Puis se connecter avec ce compte administrateur afin d'activer l'authentification à 2 facteurs et de supprimer le compte temporaire `user`

![syncin-web-2bis](./images/syncin-web-2bis.png)

![syncin-web-2ter](./images/syncin-web-2ter.png)

Se déconnecter puis tester une connexion via l'application client

![con-app-1](./images/con-appli-1.png)

Ajouter notre serveur Sync-in

![con-app-2](./images/con-appli-2.png)

Renseigner l'adresse du serveur et son port d'écoute

![con-app-3](./images/con-appli-3.png)

Entrer les identifiants d'un compte utilisateur de l'annuaire LDAP FreeIPA

![con-app-4](./images/con-appli-4.png)

La connexion s'est effectuée comme attendu et l'utilisateur de la base LDAP a été créé sur le serveur Sync-in

![con-app-5](./images/con-appli-5.png)

- Mise en place de la synchronisation du dossier utilisateur `Documents` entre le poste et le serveur Sync-in

Créer un dossier `Documents` dans l'espace personnel de l'utilisateur

![syncro-1](./images/syncro-1.png)

Mettre en place une synchronisation des deux dossiers à intervalles réguliers

![syncro-2](./images/syncro-2.png)

Définir le dossier local

![syncro-3](./images/syncro-3.png)

Définir le dossier distant dans `personal files`

![syncro-4](./images/syncro-4.png)

Choisir les options de synchronisation et d'intervalles souhaités

![syncro-5](./images/syncro-5.png)

Puis tester le bon déroulement de la synchronisation en créant des fichiers sur les deux emplacements

![syncro-6](./images/syncro-6.png)

L'intervalle d'une minute a permis de constater l'opération réalisée très rapidement

---

## Conclusion

- Dans un écosystème entièrement GNU/Linux, nous avons mis en place une plateforme collaborative avec synchronisation des données utilisateurs "poste local - serveur distant" via une authentification et une gestion des comptes utilisateurs centralisée

- La containerisation de l'application est réalisée avec Podman qui est l'outil natif du système Red Hat et qui permet un fonctionnement rootless

- Nous avons vu qu'il est possible d'établir des connexions avec le protocole LDAPS entre le serveur Sync-in et le serveur FreeIPA malgré l'absence de documentation officielle actuellement

- L'implémentation de l'application client Linux disponible exclusivement en appimage au niveau du système permet une expérience utilisateur simplifiée et une mise en place de synchronisation personnalisable

- Il est fortement recommandé de sécuriser les connexions vers Sync-in via un reverse proxy et le protocole https

- A partir de cette base, il sera possible de mettre en place l'intégration d'OnlyOffice ou Collabora mais également de simplifier la gestion et la sécurisation des accès avec OpenID Connect
