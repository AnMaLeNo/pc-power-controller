#include <Arduino.h>
#include <ESP8266WiFi.h>
#include <PubSubClient.h>

// Configue
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

// startPulse/handlePulse non-bloquante
bool pulseActive = false;
const uint32_t SHORT_PRESS_DURATION = 300;
const uint32_t LONG_PRESS_DURATION = 6000;
uint32_t pulseStartTime;
uint32_t pulseDuration;

char buffer[50];
uint16_t MESSAGE_MAX_LENGHT = 20;

void connectWiFi() {
    delay(10);
    Serial.println();
    Serial.print("Connexion au WiFi: ");
    Serial.println(ssid);

    WiFi.mode(WIFI_STA);
    WiFi.begin(ssid, password);

    while (WiFi.status() != WL_CONNECTED) {
        delay(500);
        Serial.print(".");
    }

    Serial.println("");
    Serial.println("WiFi connecté");
    Serial.println("IP address: ");
    Serial.println(WiFi.localIP());
}

void startPulse(uint32_t duration) {
    if (pulseActive) {
        mqttClient.publish(topic_state, "Pluse already active");
        Serial.print("Pluse already active\n");
        return ;
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
        snprintf(buffer, sizeof(buffer), "End pulse at %lu", millis());
        mqttClient.publish(topic_state, buffer);
        Serial.print("End pulse\n");
    }
}

void callback(char* topic, byte* payload, unsigned int length) {
    char message[MESSAGE_MAX_LENGHT + 1];
    if (length > MESSAGE_MAX_LENGHT) {
        snprintf(buffer, sizeof(buffer), "message trop grand, size : %d, max size: %d", length, MESSAGE_MAX_LENGHT);
        mqttClient.publish(topic_state, buffer);
        Serial.println(buffer);
        return ;
    }

    memcpy(message, payload, length);
    message[length] = '\0';

    Serial.printf("Message reçu [%s] %s\n", topic, message);

    if (String(topic) == topic_command) {
        if (strcmp(message, "SHORT_PRESS") == 0) {
            startPulse(SHORT_PRESS_DURATION);
        } else if (strcmp(message, "LONG_PRESS") == 0) {
            startPulse(LONG_PRESS_DURATION);
        } else {
            Serial.printf("Message [%s] inconue\n", message);
        }
    }
}

void connectMQTT() {
    while (!mqttClient.connected()) {
        if (WiFi.status() != WL_CONNECTED) {
            connectWiFi();
        }

        Serial.printf("Tentative de connexion au serveur MQTT %s:%u\n", mqtt_server, mqtt_port);
        String clientId = "ESP8266Client-";
        clientId += WiFi.macAddress();
        clientId.replace(":", "");

        if (mqttClient.connect(clientId.c_str())) {
            Serial.printf("Connecté au serveur MQTT !\n");
            mqttClient.subscribe(topic_command);
        } else {
            Serial.printf("Echec, rc=%d nouvelle tentative dans 5s\n", mqttClient.state());
            delay(5000);
        }
    }
}

void setup() {
    Serial.begin(115200);
    pinMode(pinOpto, OUTPUT);
    pinMode(pinLed, OUTPUT);
    digitalWrite(pinOpto, LOW);
    digitalWrite(pinLed, HIGH);

    connectWiFi();
    mqttClient.setServer(mqtt_server, mqtt_port);
    mqttClient.setCallback(callback);
    connectMQTT();
}

void loop() {
    if (!mqttClient.connected()) {
        connectMQTT();
    }
    mqttClient.loop();
    handlePulse();
}