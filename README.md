# 🔌 PC Power Controller (IoT)

![C++](https://img.shields.io/badge/C++-00599C?style=for-the-badge&logo=c%2B%2B&logoColor=white)
![Node.js](https://img.shields.io/badge/Node.js-43853D?style=for-the-badge&logo=node.js&logoColor=white)
![Fastify](https://img.shields.io/badge/Fastify-000000?style=for-the-badge&logo=fastify&logoColor=white)
![React](https://img.shields.io/badge/React-20232A?style=for-the-badge&logo=react&logoColor=61DAFB)
![Vite](https://img.shields.io/badge/Vite-646CFF?style=for-the-badge&logo=vite&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white)
![MQTT](https://img.shields.io/badge/MQTT-660066?style=for-the-badge&logo=mqtt&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-2496ED?style=for-the-badge&logo=docker&logoColor=white)

Un système IoT complet permettant de contrôler à distance l'alimentation d'un PC fixe. Ce projet relie une interface de commande web/API à l'électronique physique de la carte mère du PC grâce à une architecture distribuée et conteneurisée.

## Description

Ce projet permet d'allumer, d'éteindre ou de forcer l'arrêt d'un ordinateur à distance en simulant une pression sur le bouton d'alimentation physique du boîtier. Il a été conçu avec une approche microservices pour garantir la fiabilité et la rapidité des commandes.

**Fonctionnalités principales :**
- **Contrôle physique sécurisé :** Utilisation d'un optocoupleur connecté à un ESP8266 pour isoler électriquement le circuit du microcontrôleur de celui de la carte mère.
- **Communication Temps Réel :** Utilisation d'un broker MQTT (Eclipse Mosquitto) pour transmettre les commandes de l'API vers le microcontrôleur presque instantanément.
- **API REST Robuste :** Développée avec Fastify pour des performances optimales, incluant la validation des schémas de requêtes.
- **Interface Web Typée :** Application React + TypeScript construite avec Vite, proposant un pupitre de commande adapté au contrôle physique du PC.
- **Déploiement Facilité :** Conteneurisation de la stack (Frontend + API) via Docker Compose. Le broker MQTT est une infrastructure partagée du Raspberry, hébergée dans son propre dépôt.

## Architecture du Système

Le projet est divisé en quatre composants majeurs :
1. **Frontend Web (React / TypeScript / Vite) :** Fournit une interface de commande responsive, servie par Nginx en production et reliée à l'API via un proxy `/api`.

2. **Backend API (Node.js / Fastify) :** Reçoit les requêtes HTTP (ex: `SHORT_PRESS` ou `LONG_PRESS`) et les publie sur le topic MQTT `bureau/pc/power/set`.
3. **Broker MQTT (Eclipse Mosquitto) :** Agit comme un intermédiaire léger pour distribuer les messages entre l'API et le hardware. C'est une infrastructure **partagée** entre tous les projets IoT du Raspberry (un seul broker par machine) : il vit dans le dépôt `~/mosquitto`, et ce projet s'y connecte en simple client via `host.docker.internal:1883` (surchargeable par `.env` : `MQTT_HOST`, `MQTT_PORT`).
4. **Firmware ESP8266 (C++ / Arduino) :** Connecté au réseau WiFi local, il s'abonne au topic MQTT. À la réception d'un message, il déclenche une impulsion (High/Low) d'une durée spécifique (300ms pour un appui court, 6000ms pour un appui long) sur la broche `D1` reliée à l'optocoupleur.

## Installation & Lancement

### 1. Configuration du Hardware (ESP8266)
Le code source se trouve dans le dossier `esp8266/`. Le projet est configuré avec **PlatformIO**.
- Copiez `config.ini.exemple` vers `config.ini` et ajoutez vos identifiants WiFi ainsi que l'IP de votre serveur MQTT.
- Compilez et téléversez le code C++ sur votre Wemos D1 Mini / ESP8266.

### 2. Prérequis : le broker MQTT partagé
Le broker Mosquitto n'est plus embarqué dans ce projet : c'est une infrastructure commune au Raspberry, gérée dans le dépôt `~/mosquitto`. Démarrez-le d'abord s'il ne tourne pas déjà :

```bash
cd ~/mosquitto
docker compose up -d
```

### 3. Lancement de la stack Docker
Assurez-vous d'avoir [Docker](https://www.docker.com/) et Docker Compose installés sur votre machine ou votre serveur cible (ex: Raspberry Pi).

```bash
# Clonez le dépôt
git clone https://github.com/AnMaLeNo/pc-power-controller.git
cd pc-power-controller

# Lancez les conteneurs en tâche de fond
docker compose up -d --build
```

L'interface web est disponible sur `http://localhost:18080`. En mode développement avec l'override Docker Compose, Vite est aussi exposé sur `http://localhost:5174`.
