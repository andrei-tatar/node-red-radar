#include <Arduino.h>
#include <ArduinoJson.h>
#include <ArduinoOTA.h>
#include <DNSServer.h>
#include <LD2450.h>
#include <LittleFS.h>
#include <PsychicMqttClient.h>
#include <WebServer.h>
#include <WiFi.h>
#include <lwip/sockets.h>

static constexpr const char *CONFIG_PATH = "/config.json";

// Frames identical to the previous one are skipped, but the current state is
// re-sent at least this often, well inside Node-RED's 5 s target timeout.
static constexpr uint32_t HEARTBEAT_MS = 2000;
static constexpr uint32_t CONNECTION_CHECK_MS = 1000;
static constexpr uint32_t WIFI_RECONNECT_MS = 60000;

PsychicMqttClient mqtt;
LD2450 ld2450;

static String hostname, ssid, password;
static String mqttServer, mqttUser, mqttPassword, mqttLastWillTopic, mqttStateTopic;

static bool loadConfig() {
  auto configFile = LittleFS.open(CONFIG_PATH);
  if (!configFile) {
    return false;
  }
  JsonDocument config;
  auto error = deserializeJson(config, configFile);
  configFile.close();
  if (error) {
    return false;
  }

  hostname = config["hostname"] | "";
  ssid = config["wifi"]["ssid"] | "";
  password = config["wifi"]["password"] | "";
  mqttServer = config["mqtt"]["server"] | "";
  mqttUser = config["mqtt"]["username"] | "";
  mqttPassword = config["mqtt"]["password"] | "";

  return hostname.length() && ssid.length() && mqttServer.length();
}

// ---------------------------------------------------------------------------
// Setup portal: when there is no usable config, open an access point named
// "esp-radar-setup-XXXX" with a form that writes config.json and restarts.
// ---------------------------------------------------------------------------

static const char SETUP_FORM[] PROGMEM = R"HTML(<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>esp-radar setup</title>
<style>
body{font-family:system-ui,sans-serif;margin:0;background:#f4f5f7;color:#1c1e21}
form{max-width:420px;margin:24px auto;background:#fff;padding:20px 24px;border-radius:12px;box-shadow:0 2px 12px #0001}
h1{font-size:20px;margin:0 0 4px}p{color:#666;margin:0 0 16px;font-size:14px}
fieldset{border:0;padding:0;margin:0 0 16px}legend{font-weight:600;margin-bottom:8px}
label{display:block;font-size:13px;color:#444;margin:8px 0 4px}
input{width:100%;box-sizing:border-box;padding:9px 10px;border:1px solid #ccd;border-radius:8px;font-size:15px}
button{width:100%;padding:11px;border:0;border-radius:8px;background:#2563eb;color:#fff;font-size:15px;font-weight:600}
</style></head><body>
<form method="post" action="/save">
<h1>esp-radar setup</h1><p>No valid configuration was found on this device.</p>
<fieldset><legend>Device</legend>
<label>Hostname (letters, digits, dashes)</label><input name="hostname" required pattern="[A-Za-z0-9-]{1,32}" value="esp-radar"></fieldset>
<fieldset><legend>Wi-Fi</legend>
<label>SSID</label><input name="ssid" required>
<label>Password</label><input name="password" type="password"></fieldset>
<fieldset><legend>MQTT</legend>
<label>Server URL</label><input name="mqtt_server" required placeholder="mqtt://broker.lan:1883">
<label>Username</label><input name="mqtt_username">
<label>Password</label><input name="mqtt_password" type="password"></fieldset>
<button type="submit">Save and restart</button>
</form></body></html>)HTML";

static bool isValidHostname(const String &name) {
  if (name.isEmpty() || name.length() > 32) {
    return false;
  }
  for (auto c : name) {
    if (!isalnum(c) && c != '-') {
      return false;
    }
  }
  return true;
}

[[noreturn]] static void runSetupPortal() {
  char apName[32];
  snprintf(apName, sizeof(apName), "esp-radar-setup-%04X", (uint16_t)(ESP.getEfuseMac() >> 32));

  WiFi.mode(WIFI_AP);
  WiFi.softAP(apName);

  DNSServer dns;
  dns.start(53, "*", WiFi.softAPIP()); // send every hostname to the portal

  WebServer server(80);
  server.on("/", HTTP_GET, [&] { server.send_P(200, "text/html", SETUP_FORM); });
  server.on("/save", HTTP_POST, [&] {
    auto newHostname = server.arg("hostname");
    if (!isValidHostname(newHostname) || server.arg("ssid").isEmpty() || server.arg("mqtt_server").isEmpty()) {
      server.send(400, "text/plain", "Hostname, SSID and MQTT server are required.");
      return;
    }

    JsonDocument config;
    config["hostname"] = newHostname;
    config["wifi"]["ssid"] = server.arg("ssid");
    config["wifi"]["password"] = server.arg("password");
    config["mqtt"]["server"] = server.arg("mqtt_server");
    config["mqtt"]["username"] = server.arg("mqtt_username");
    config["mqtt"]["password"] = server.arg("mqtt_password");

    auto file = LittleFS.open(CONFIG_PATH, "w");
    if (!file || serializeJson(config, file) == 0) {
      server.send(500, "text/plain", "Could not write the configuration.");
      return;
    }
    file.close();

    server.send(200, "text/plain", "Saved. The device is restarting and will join your Wi-Fi.");
    delay(1000);
    ESP.restart();
  });
  server.onNotFound([&] {
    server.sendHeader("Location", "http://" + WiFi.softAPIP().toString() + "/");
    server.send(302, "text/plain", "");
  });
  server.begin();

  while (true) {
    dns.processNextRequest();
    server.handleClient();
    delay(2);
  }
}

// ---------------------------------------------------------------------------

// lwIP enables Nagle by default: a small publish then waits until the
// previous one is ACKed. Turn it off on every connected TCP socket (the MQTT
// connection, plus an OTA upload if one happens to be running).
static void disableNagle() {
  for (int fd = LWIP_SOCKET_OFFSET; fd < LWIP_SOCKET_OFFSET + CONFIG_LWIP_MAX_SOCKETS; fd++) {
    int type;
    socklen_t len = sizeof(type);
    if (getsockopt(fd, SOL_SOCKET, SO_TYPE, &type, &len) != 0 || type != SOCK_STREAM) {
      continue;
    }
    sockaddr_storage peer;
    socklen_t peerLen = sizeof(peer);
    if (getpeername(fd, (sockaddr *)&peer, &peerLen) != 0) {
      continue; // not connected, e.g. a listening socket
    }
    int one = 1;
    setsockopt(fd, IPPROTO_TCP, TCP_NODELAY, &one, sizeof(one));
  }
}

void setup() {
  // 80 MHz is plenty for parsing one UART stream and publishing MQTT, and
  // keeps the case cooler. Wi-Fi modem sleep stays off for latency (see below).
  setCpuFrequencyMhz(80);

  // format on first boot so the setup portal can write config.json
  LittleFS.begin(true);
  if (!loadConfig()) {
    runSetupPortal();
  }

  mqttLastWillTopic = "esp-radar/" + hostname + "/online";
  mqttStateTopic = "esp-radar/" + hostname + "/state";

  WiFi.setHostname(hostname.c_str());
  WiFi.mode(WIFI_STA);
  // Modem sleep only listens at DTIM beacons (100-300 ms), which delays the
  // TCP ACKs the next publish waits for.
  WiFi.setSleep(false);
  WiFi.begin(ssid.c_str(), password.c_str());

  mqtt.setServer(mqttServer.c_str())
      .setCredentials(mqttUser.c_str(), mqttPassword.c_str())
      .setClientId(hostname.c_str())
      .setWill(mqttLastWillTopic.c_str(), 0, true, "false")
      .onConnect([](bool sessionPresent) {
        disableNagle();
        mqtt.publish(mqttLastWillTopic.c_str(), 0, true, "true");
      });

  ArduinoOTA
      .setHostname(hostname.c_str())
      .setMdnsEnabled(false)
      .begin();

  Serial1.begin(256000, SERIAL_8N1, 7, 9);
  ld2450.begin(Serial1);
}

// Runs from loop(), not from a timer callback: WiFi and MQTT calls are too
// heavy for the small esp_timer task stack.
static void checkConnection() {
  static uint32_t lastCheck = 0, disconnectedSince = 0;
  auto now = millis();
  if (now - lastCheck < CONNECTION_CHECK_MS) {
    return;
  }
  lastCheck = now;

  if (WiFi.isConnected()) {
    disconnectedSince = 0;
    if (!mqtt.connected()) {
      mqtt.connect();
    }
    return;
  }

  if (!disconnectedSince) {
    disconnectedSince = now;
  } else if (now - disconnectedSince >= WIFI_RECONNECT_MS) {
    disconnectedSince = now;
    WiFi.disconnect();
    WiFi.begin(ssid.c_str(), password.c_str());
  }
}

static void publishTargets(uint8_t count) {
  JsonDocument state;
  auto targetsArray = state["targets"].to<JsonArray>();

  for (uint8_t i = 0; i < count; i++) {
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

  static char lastState[512];
  static uint32_t lastPublish = 0;
  char newState[sizeof(lastState)];
  auto jsonSize = serializeJson(state, newState, sizeof(newState));

  auto now = millis();
  auto changed = strcmp(newState, lastState) != 0;
  if (!changed && now - lastPublish < HEARTBEAT_MS) {
    return;
  }
  if (!mqtt.connected()) {
    return;
  }

  mqtt.publish(mqttStateTopic.c_str(), 0, false, newState, jsonSize, false);
  memcpy(lastState, newState, jsonSize + 1);
  lastPublish = now;
}

void loop() {
  ArduinoOTA.handle();
  checkConnection();

  // The driver parses one frame per read(). If loop() was held up (e.g. by a
  // publish), several frames are buffered: drain them and only publish the
  // newest, instead of working through stale ones one loop at a time.
  int latestTargets = 0;
  for (int refreshed; (refreshed = ld2450.read()) > 0;) {
    latestTargets = refreshed;
  }
  if (latestTargets > 0) {
    publishTargets(latestTargets);
  }
}
