# PC Power Controller — Dossier de conception matérielle (PCB v1)

Contrôleur de bouton d'alimentation PC piloté par MQTT.
Passage du prototype (breadboard : D1 mini + PC817) à une PCB propre.

## Objectif de la carte

- **Piloter** le connecteur `PWR_SW` (bouton power) de la carte mère par isolation
  galvanique (appui court = allumage / arrêt soft, appui long ≈ 6 s = arrêt forcé).
- **Lire** l'état réel du PC via le header `Power LED` (2ᵉ optocoupleur) →
  feedback fiable, bien meilleur que l'ACK d'impulsion actuel.
- **Rester alimentée en permanence** via le 5V standby (5VSB) de la carte mère,
  pour pouvoir rallumer un PC éteint.

## Périmètre v1 (figé)

Carte support **D1 mini socketé** (headers femelles, flash inchangé, réparable)
+ 2× PC817 + alimentation 5VSB + réseau de protection. Pas de module ESP nu
soudé (réservé à une éventuelle v2 « produit fini »).

---

## Schéma bloc

```
        5VSB mobo ──[polyfuse 500mA]──[Schottky SS14]──┬──> D1 mini (pin 5V)
                                                        └──[10µF ∥ 100nF]── GND   (découplage)

  SORTIE (appuie sur le bouton power) :
  GPIO5 / D1 ──[R1 220Ω]──►|LED    (PC817 #1)    Tr├── C ─→ PWR_SW signal (mobo)
       │                                            └── E ─→ GND mobo
      [R3 10k pull-down → GND]      ◄── ANTI-GLITCH BOOT (critique, voir §1)

  ENTRÉE (lit la Power LED du PC) :
  PLED(+) mobo ──[R2 1k]──►|LED     (PC817 #2)   Tr├── C ─→ GPIO12 / D6  ──[R4 10k pull-up → 3V3]
  PLED(−) mobo ────────────|                        └── E ─→ GND
```

---

## §1 — Anti-glitch au boot (LE point critique)

Au reset de l'ESP8266, les GPIO flottent pendant quelques millisecondes. Si la
ligne de commande de l'opto part accidentellement à HIGH, l'opto ferme le
contact → **la carte mère interprète un appui sur power pendant le boot de
l'ESP**. Un simple reboot Wi-Fi pourrait alors éteindre/allumer le PC tout seul.

Mitigations retenues (matériel + logiciel) :

1. **GPIO5 (D1)** est utilisé pour la sortie : ce n'est **pas** une broche de
   bootstrap de l'ESP8266 (contrairement à GPIO0/2/15) → pas d'état imposé au boot.
2. **R3 = 10k pull-down** sur GPIO5 : tant que le firmware ne pilote pas
   activement la broche, l'entrée LED de l'opto est maintenue basse → opto OFF
   garanti. Rend le glitch physiquement impossible.
3. **Watchdog logiciel** actif (déjà présent dans le firmware) : si l'ESP se fige
   avec l'opto ON, la mobo verrait un appui maintenu → arrêt forcé ~4 s. Le
   pull-down + watchdog couvrent ce cas.

---

## §2 — Polarité (deux endroits sensibles)

Le PC817 est un **phototransistor polarisé** (collecteur/émetteur non
interchangeables). À câbler impérativement :

- **Sortie (PC817 #1)** : `Collecteur → PWR_SW signal (broche tenue haute par la
  mobo)`, `Émetteur → GND mobo`. Le contact simulé est unidirectionnel — vérifier
  la broche signal vs GND sur le header du bouton (souvent notée `PWRBTN#` + `GND`).
- **Entrée (PC817 #2)** : la LED interne se câble sur la sortie **Power LED** de la
  mobo (`PLED+` via R2, `PLED-` à la masse). Côté phototransistor,
  `Collecteur → GPIO12`, `Émetteur → GND`.

> Alternative « contact sec » sans souci de polarité : remplacer le PC817 #1 par
> un **opto-MOSFET** (AQY212 / TLP172) = vrai contact bidirectionnel type relais.
> Plus cher ; PC817 conservé par défaut pour la v1 (déjà en stock).

---

## §3 — Alimentation 5VSB

Le 5V standby reste alimenté PC éteint → le contrôleur est toujours vivant, prêt
à rallumer la machine.

Deux prises possibles :

- **Header USB interne** de la carte mère (5V, souvent maintenu en standby selon
  réglage BIOS/ErP). Le plus simple et le moins intrusif.
- **Fil violet 5VSB** du connecteur ATX 24 broches (canonique, toujours en
  standby, mais prise plus intrusive).

Protection sur la ligne d'entrée (assurance à ~0,30 € sur une ligne issue du PSU) :
- **Polyfuse 500 mA** (PTC réarmable) : limite le courant en cas de court-circuit.
- **Diode Schottky SS14** en série : protège contre l'inversion de polarité.
- **Découplage** 10 µF (tantale/céram) ∥ 100 nF au plus près du D1 mini.

Budget courant : D1 mini ≈ 70–80 mA en Wi-Fi actif, pics ~200 mA. Les LED des
optos ≈ 10–15 mA chacune. Polyfuse 500 mA confortable.

---

## §4 — Nomenclature (BOM v1, indicatif)

| Réf | Composant | Valeur / modèle | Qté | Notes |
|-----|-----------|-----------------|-----|-------|
| U1 | Module Wi-Fi | WeMos **D1 mini** (ESP8266) | 1 | socketé sur barrettes |
| — | Barrette femelle | 1×8, 2.54 mm | 2 | support D1 mini |
| U2, U3 | Optocoupleur | **PC817** | 2 | sortie + lecture d'état |
| R1 | Résistance | 220 Ω | 1 | limitation LED opto sortie (GPIO5) |
| R2 | Résistance | 1 kΩ | 1 | limitation LED opto entrée (PLED) |
| R3 | Résistance | 10 kΩ | 1 | **pull-down anti-glitch** GPIO5 |
| R4 | Résistance | 10 kΩ | 1 | pull-up GPIO12 (lecture état) |
| F1 | Polyfuse PTC | 500 mA | 1 | protection 5VSB |
| D1 | Diode Schottky | SS14 | 1 | anti-inversion 5VSB |
| C1 | Condensateur | 10 µF | 1 | découplage |
| C2 | Condensateur | 100 nF | 1 | découplage HF |
| J1 | Connecteur | 2 broches 2.54 | 1 | → PWR_SW mobo |
| J2 | Connecteur | 2 broches 2.54 | 1 | → PLED mobo |
| J3 | Connecteur | 2 broches 2.54 | 1 | → 5VSB + GND |
| LED1 | LED témoin (option) | 3 mm + R 1k | 1 | état carte |

Fabrication : **JLCPCB** (~5–10 € les 5 cartes, 2 couches). Empreintes traversantes
(THT) → soudure facile, pas de CMS fin.

---

## §5 — Table de câblage (netlist résumée)

| De | Vers | Via |
|----|------|-----|
| 5VSB mobo | F1 | — |
| F1 | D1 | — |
| D1 (cathode) | D1 mini `5V` + C1/C2 | — |
| GND commun | D1 mini `GND`, émetteurs optos, C1/C2, R3 | plan de masse |
| D1 mini `GPIO5/D1` | anode LED U2 | R1 220 Ω |
| D1 mini `GPIO5/D1` | GND | R3 10k (pull-down) |
| U2 collecteur | J1.1 (PWR_SW signal) | — |
| U2 émetteur | J1.2 (GND mobo) | — |
| J2.1 (PLED+) | anode LED U3 | R2 1k |
| J2.2 (PLED-) | cathode LED U3 | — |
| U3 collecteur | D1 mini `GPIO12/D6` | — |
| U3 collecteur | D1 mini `3V3` | R4 10k (pull-up) |
| U3 émetteur | GND | — |

---

## §6 — Implications firmware (future PR)

Pour exploiter la lecture d'état (GPIO12) :

1. `pinMode(D6, INPUT)` ; lecture périodique. **Logique inversée** : opto conduit
   ⇒ GPIO12 tiré à LOW ⇒ Power LED allumée ⇒ **PC allumé**.
2. Publier le **vrai état** du PC en MQTT (nouveau topic ou champ, ex.
   `{"event":"pc_state","state":"on|off"}`) → alimente directement le panneau
   « Retours du PC » de l'UI, en plus des ACK d'impulsion.
3. Débounce logiciel (la Power LED peut clignoter en veille S3 sur certaines
   cartes → distinguer « allumé » / « veille » / « éteint » si besoin).

À traiter en PR firmware + évolution API/UI séparée, une fois la PCB validée.

---

## §7 — Étapes de réalisation

1. [ ] Valider ce schéma bloc (revue).
2. [ ] Saisie schéma KiCad (`eeschema`) → `pc-power-controller.kicad_sch`.
3. [ ] Association empreintes THT → netlist.
4. [ ] Routage 2 couches (`pcbnew`), plan de masse, pistes 5VSB élargies.
5. [ ] DRC + revue 3D.
6. [ ] Export Gerbers → commande JLCPCB.
7. [ ] Assemblage + test hors carte mère (continuité, pas de court 5V/GND).
8. [ ] Test sur mobo (d'abord PWR_SW seul, puis lecture PLED).
9. [ ] PR firmware pour la lecture d'état.

> KiCad n'est pas installé sur le Pi (dispo `apt install kicad` en 6.0.11 arm64,
> mais l'édition schéma/routage se fait mieux sur une machine avec écran).
> Ce dossier est autosuffisant pour saisir le projet dans KiCad ou pour une revue.
