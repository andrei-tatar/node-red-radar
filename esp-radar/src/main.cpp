#include <Arduino.h>
#include <ArduinoJson.h>
#include <ArduinoOTA.h>
#include <LD2450.h>
#include <LittleFS.h>
#include <PsychicMqttClient.h>
#include <Ticker.h>
#include <WiFi.h>

PsychicMqttClient mqtt;
Ticker checkWiFi;
uint8_t reconnectWifiSkips = 0;
LD2450 ld2450;

static String hostname, ssid, password;
static String mqttServer, mqttUser, mqttPassword, mqttClientId, mqttLastWillTopic, mqttStateTopic;

void setup() {
  setCpuFrequencyMhz(80);

  LittleFS.begin();
  auto configFile = LittleFS.open("/config.json");
  JsonDocument config;
  auto error = deserializeJson(config, configFile);
  configFile.close();

  if (error != DeserializationError::Code::Ok) {
    while (true) {
      esp_deep_sleep_start();
    }
  }

  hostname = config["hostname"].as<String>();
  ssid = config["wifi"]["ssid"].as<String>();
  password = config["wifi"]["password"].as<String>();

  mqttServer = config["mqtt"]["server"].as<String>();
  mqttUser = config["mqtt"]["username"].as<String>();
  mqttPassword = config["mqtt"]["password"].as<String>();
  mqttLastWillTopic = "esp-radar/" + hostname + "/online";
  mqttStateTopic = "esp-radar/" + hostname + "/state";

  WiFi.setHostname(hostname.c_str());
  WiFi.mode(WIFI_STA);
  WiFi.setSleep(true);
  WiFi.begin(ssid.c_str(), password.c_str());

  checkWiFi.attach(1, [] {
    if (WiFi.isConnected()) {
      reconnectWifiSkips = 0;
      if (!mqtt.connected()) {
        mqtt.connect();
      }
    } else {
      reconnectWifiSkips++;
      if (reconnectWifiSkips == 60) {
        reconnectWifiSkips = 0;
        WiFi.mode(WIFI_STA);
        WiFi.disconnect();
        WiFi.begin();
      }
    }
  });

  mqtt.setServer(mqttServer.c_str())
      .setCredentials(mqttUser.c_str(), mqttPassword.c_str())
      .setClientId(hostname.c_str())
      .setWill(mqttLastWillTopic.c_str(), 0, true, "false")
      .onConnect([](bool sessionPresent) { mqtt.publish(mqttLastWillTopic.c_str(), 0, true, "true"); });

  ArduinoOTA
      .setMdnsEnabled(false)
      .begin();

  Serial1.begin(256000, SERIAL_8N1, 7, 9);
  ld2450.begin(Serial1);
}

void loop() {
  ArduinoOTA.handle();

  auto refreshedTargets = ld2450.read();
  if (refreshedTargets) {
    JsonDocument state;
    auto targetsArray = state["targets"].to<JsonArray>();

    for (uint8_t i = 0; i < refreshedTargets; i++) {
      auto target = ld2450.getTarget(i);
      if (!target->valid) {
        continue;
      }

      auto jsonTarget = targetsArray.add<JsonObject>();
      jsonTarget["id"] = target->id;
      jsonTarget["x"] = target->x;
      jsonTarget["y"] = target->y;
      jsonTarget["speed"] = target->speed;
    }

    static char newState[512];
    auto jsonSize = serializeJson(state, newState, sizeof(newState));
    mqtt.publish(mqttStateTopic.c_str(), 0, false, newState, jsonSize, false);
  }
}
