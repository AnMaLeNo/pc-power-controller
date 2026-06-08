#include <Arduino.h>
#include <ESP8266WiFi.h>
#include <PubSubClient.h>

// Configuration
const char* ssid = WIFI_SSID;
const char* password = WIFI_PASS;
const char* mqtt_server = MQTT_SERVER;
const uint16_t mqtt_port = 1883;

// Topiques MQTT
const char* topic_command = "bureau/pc/power/set";
const char* topic_state   = "bureau/pc/power/log";

// Hardware
const int pinOpto = D1;
const int pinLed = LED_BUILTIN;

WiFiClient wifiNetworkClient;
PubSubClient mqttClient(wifiNetworkClient);

// Paramètres temporels de l'impulsion matérielle
bool pulseActive = false;
const uint32_t SHORT_PRESS_DURATION = 300;
const uint32_t LONG_PRESS_DURATION = 6000;
uint32_t pulseStartTime = 0;
uint32_t pulseDuration = 0;

// Définition des états de l'automate réseau (FSM)
enum NetworkState {
    NET_INIT,
    NET_WIFI_CONNECTING,
    NET_WIFI_WAIT,
    NET_MQTT_CONNECTING,
    NET_CONNECTED,
    NET_COOLDOWN
};

NetworkState netState = NET_INIT;
uint32_t lastNetworkAttempt = 0;
// Timeout d'association WiFi + DHCP : assez large pour les box lentes (sinon
// l'ESP abandonne avant la fin de la négociation et boucle indéfiniment).
const uint32_t WIFI_CONNECT_TIMEOUT = 20000;
// Délai de temporisation avant une nouvelle tentative après un échec.
const uint32_t COOLDOWN_DURATION = 5000;

char buffer[50];
const uint16_t MESSAGE_MAX_LENGTH = 20;

// Déclaration préalable des fonctions
void startPulse(uint32_t duration);
void handlePulse();
void processNetworkFSM();

void callback(char* topic, byte* payload, unsigned int length) {
    char message[MESSAGE_MAX_LENGTH + 1];
    if (length > MESSAGE_MAX_LENGTH) {
        snprintf(buffer, sizeof(buffer), "message trop grand, size: %d, max: %d", length, MESSAGE_MAX_LENGTH);
        mqttClient.publish(topic_state, buffer);
        Serial.println(buffer);
        return;
    }

    memcpy(message, payload, length);
    message[length] = '\0';
    Serial.printf("Message reçu [%s] %s\n", topic, message);

    if (strcmp(topic, topic_command) == 0) {
        if (strcmp(message, "SHORT_PRESS") == 0) {
            startPulse(SHORT_PRESS_DURATION);
        } else if (strcmp(message, "LONG_PRESS") == 0) {
            startPulse(LONG_PRESS_DURATION);
        } else {
            Serial.printf("Message [%s] inconnu\n", message);
        }
    }
}

void startPulse(uint32_t duration) {
    if (pulseActive) {
        mqttClient.publish(topic_state, "Pulse already active");
        Serial.print("Pulse already active\n");
        return;
    }
    pulseDuration = duration;
    digitalWrite(pinOpto, HIGH);
    digitalWrite(pinLed, LOW);
    
    snprintf(buffer, sizeof(buffer), "Start pulse at %lu", millis());
    mqttClient.publish(topic_state, buffer);
    
    pulseStartTime = millis();
    pulseActive = true;
    Serial.print("Start pulse\n");
}

void handlePulse() {
    if (pulseActive && (millis() - pulseStartTime >= pulseDuration)) {
        digitalWrite(pinOpto, LOW);
        digitalWrite(pinLed, HIGH);
        pulseActive = false;
        
        if (mqttClient.connected()) {
            snprintf(buffer, sizeof(buffer), "End pulse at %lu", millis());
            mqttClient.publish(topic_state, buffer);
        }
        Serial.print("End pulse\n");
    }
}

void processNetworkFSM() {
    uint32_t now = millis();

    switch (netState) {
        case NET_INIT:
            WiFi.mode(WIFI_STA);
            WiFi.setAutoConnect(false);     // Désactivation de la FSM interne d'Espressif (L2)
            WiFi.setAutoReconnect(false);   // Reprise du contrôle logiciel absolu de la couche liaison
            netState = NET_WIFI_CONNECTING;
            break;

        case NET_WIFI_CONNECTING:
            Serial.printf("Connexion au WiFi: %s\n", ssid);
            WiFi.begin(ssid, password);
            lastNetworkAttempt = now;
            netState = NET_WIFI_WAIT;
            break;

        case NET_WIFI_WAIT:
            if (WiFi.status() == WL_CONNECTED) {
                Serial.printf("\nWiFi connecté. IP: %s\n", WiFi.localIP().toString().c_str());
                netState = NET_MQTT_CONNECTING;
            } else if (now - lastNetworkAttempt >= WIFI_CONNECT_TIMEOUT) {
                Serial.println("\nTimeout WiFi. Bascule en Cooldown.");
                WiFi.disconnect();
                lastNetworkAttempt = now;
                netState = NET_COOLDOWN;
            }
            break;

        case NET_MQTT_CONNECTING:
            if (WiFi.status() != WL_CONNECTED) {
                netState = NET_WIFI_CONNECTING;
                break;
            }

            {
                String clientId = "ESP8266Client-" + WiFi.macAddress();
                clientId.replace(":", "");
                Serial.printf("Tentative MQTT %s:%u\n", mqtt_server, mqtt_port);
                
                // Appel synchrone encapsulé - Blocage borné par le timeout LwIP/PubSubClient
                if (mqttClient.connect(clientId.c_str())) {
                    Serial.println("Connecté au serveur MQTT !");
                    mqttClient.subscribe(topic_command);
                    netState = NET_CONNECTED;
                } else {
                    Serial.printf("Echec MQTT rc=%d. Bascule en Cooldown.\n", mqttClient.state());
                    lastNetworkAttempt = now;
                    netState = NET_COOLDOWN;
                }
            }
            break;

        case NET_CONNECTED:
            if (WiFi.status() != WL_CONNECTED || !mqttClient.connected()) {
                Serial.println("Perte de liaison (L2 ou L7).");
                netState = NET_COOLDOWN;
                lastNetworkAttempt = now;
            } else {
                mqttClient.loop(); // Traitement des buffers réseau entrants
            }
            break;

        case NET_COOLDOWN:
            // Interdiction stricte de toute opération réseau pendant la fenêtre de temporisation
            if (now - lastNetworkAttempt >= COOLDOWN_DURATION) {
                netState = (WiFi.status() == WL_CONNECTED) ? NET_MQTT_CONNECTING : NET_WIFI_CONNECTING;
            }
            break;
    }
}

void setup() {
    Serial.begin(115200);
    pinMode(pinOpto, OUTPUT);
    pinMode(pinLed, OUTPUT);
    
    // Initialisation de l'état nominal physique (Safe state)
    digitalWrite(pinOpto, LOW);
    digitalWrite(pinLed, HIGH);

    mqttClient.setServer(mqtt_server, mqtt_port);
    mqttClient.setCallback(callback);
}

void loop() {
    // Ordonnancement coopératif à complexité amortie O(1)
    handlePulse();         // Évaluation inconditionnelle du registre matériel
    processNetworkFSM();   // Traitement asynchrone non-bloquant du vecteur réseau
}