/*
  OpenSvitloBot — ESP32 Firmware
  Sends periodic HTTPS pings to a Cloudflare Worker.
  On first boot, starts a WiFi captive portal for configuration.
  Settings are stored in NVS (Preferences).
*/

#include <WiFi.h>
#include <HTTPClient.h>
#include <WebServer.h>
#include <DNSServer.h>
#include <Preferences.h>

#define LED_PIN 2
#define PING_INTERVAL 15000      // 15 seconds
#define RETRY_COUNT 3
#define RETRY_DELAY 5000         // 5 seconds
#define CONNECT_TIMEOUT 180000   // 3 minutes
#define RECONNECT_INTERVAL 30000 // 30 seconds between retries in portal mode

const char* AP_SSID = "OpenSvitloBot-Setup";
const IPAddress AP_IP(192, 168, 4, 1);
const IPAddress AP_SUBNET(255, 255, 255, 0);

WebServer webServer(80);
DNSServer dnsServer;
Preferences prefs;

String wifiSSID, wifiPass, workerURL, apiKey;

// Forward declarations
bool tryConnect(unsigned long timeout);
void startPortal();
void stopPortal();
void handleRoot();
void handleSave();
bool sendPing();
void blinkLED(int interval);

unsigned long lastPing = 0;
unsigned long lastReconnect = 0;
bool portalActive = false;
bool configured = false;

const char CONFIG_PAGE[] = R"rawliteral(
<!DOCTYPE html><html><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>OpenSvitloBot Setup</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,sans-serif;background:#0f172a;color:#e2e8f0;padding:1rem;min-height:100vh;display:flex;align-items:center;justify-content:center}
.c{background:#1e293b;border:1px solid #334155;border-radius:12px;padding:1.5rem;max-width:400px;width:100%}
h1{font-size:1.25rem;margin-bottom:.25rem}
.s{color:#94a3b8;font-size:.85rem;margin-bottom:1.25rem}
label{display:block;font-size:.85rem;color:#94a3b8;margin-bottom:.25rem;margin-top:1rem}
input{width:100%;padding:.75rem;background:#0f172a;border:1px solid #334155;border-radius:8px;color:#e2e8f0;font-size:16px;-webkit-appearance:none}
input:focus{outline:none;border-color:#3b82f6}
button{width:100%;margin-top:1.5rem;padding:.875rem;background:#3b82f6;color:#fff;border:none;border-radius:8px;font-size:1rem;font-weight:600;cursor:pointer;-webkit-appearance:none}
button:active{background:#2563eb}
</style></head><body>
<div class="c"><h1>OpenSvitloBot Setup</h1>
<p class="s">Connect this device to your WiFi network.</p>
<form action="/save" method="POST" autocomplete="off">
<label>WiFi Network (SSID)</label><input name="ssid" required autocorrect="off" autocapitalize="off">
<label>WiFi Password</label><input name="pass" type="password">
<label>Worker URL</label><input name="url" placeholder="https://opensvitlobot.workers.dev" required autocorrect="off" autocapitalize="off" inputmode="url">
<label>API Key</label><input name="key" required autocorrect="off" autocapitalize="off">
<button type="submit">Save &amp; Connect</button>
</form></div></body></html>
)rawliteral";

const char SAVED_PAGE[] = R"rawliteral(
<!DOCTYPE html><html><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Saved</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:sans-serif;background:#0f172a;color:#e2e8f0;padding:1rem;min-height:100vh;display:flex;align-items:center;justify-content:center}
.c{background:#1e293b;border:2px solid #22c55e;border-radius:12px;padding:2rem;max-width:400px;width:100%;text-align:center}
h1{color:#22c55e;margin-bottom:.5rem}
p{color:#94a3b8;font-size:.9rem}
</style></head><body>
<div class="c"><h1>Saved!</h1><p>Device will restart and connect to your WiFi.</p></div>
</body></html>
)rawliteral";

void setup() {
  Serial.begin(115200);
  pinMode(LED_PIN, OUTPUT);
  digitalWrite(LED_PIN, LOW);

  prefs.begin("osvitlobot", false);
  configured = prefs.getBool("configured", false);

  if (configured) {
    wifiSSID = prefs.getString("ssid", "");
    wifiPass = prefs.getString("pass", "");
    workerURL = prefs.getString("url", "");
    apiKey = prefs.getString("key", "");
    Serial.println("Config loaded. Connecting...");

    if (tryConnect(CONNECT_TIMEOUT)) {
      Serial.printf("Connected! IP: %s\n", WiFi.localIP().toString().c_str());
      digitalWrite(LED_PIN, LOW); // LED off — all good
      return;
    }
    Serial.println("Connection failed. Starting setup portal...");
  } else {
    Serial.println("No config. Starting setup portal...");
  }

  startPortal();
}

void loop() {
  if (portalActive) {
    dnsServer.processNextRequest();
    webServer.handleClient();

    // If we have saved config, keep retrying in the background
    if (configured && millis() - lastReconnect >= RECONNECT_INTERVAL) {
      lastReconnect = millis();
      if (WiFi.status() == WL_CONNECTED) {
        stopPortal();
        Serial.printf("Connected! IP: %s\n", WiFi.localIP().toString().c_str());
        return;
      }
      WiFi.begin(wifiSSID.c_str(), wifiPass.c_str());
    }

    blinkLED(1000); // Slow blink — waiting for config
    return;
  }

  // Normal operation
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("WiFi lost. Reconnecting...");
    if (!tryConnect(CONNECT_TIMEOUT)) {
      Serial.println("Reconnection failed. Starting portal...");
      startPortal();
      return;
    }
    digitalWrite(LED_PIN, LOW); // LED off after reconnect
  }

  unsigned long now = millis();
  if (now - lastPing >= PING_INTERVAL || lastPing == 0) {
    lastPing = now;
    sendPing();
    digitalWrite(LED_PIN, LOW); // LED off — all good
  }

  delay(100);
}

bool tryConnect(unsigned long timeout) {
  WiFi.mode(WIFI_STA);
  WiFi.begin(wifiSSID.c_str(), wifiPass.c_str());
  Serial.printf("Connecting to %s", wifiSSID.c_str());

  unsigned long start = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - start < timeout) {
    delay(500);
    Serial.print(".");
    blinkLED(150); // Fast blink — connecting
  }
  Serial.println();

  return WiFi.status() == WL_CONNECTED;
}

void startPortal() {
  portalActive = true;
  WiFi.mode(WIFI_AP_STA);
  WiFi.softAPConfig(AP_IP, AP_IP, AP_SUBNET);
  WiFi.softAP(AP_SSID);

  if (configured) {
    WiFi.begin(wifiSSID.c_str(), wifiPass.c_str());
  }

  dnsServer.start(53, "*", AP_IP);

  webServer.on("/", HTTP_GET, handleRoot);
  webServer.on("/save", HTTP_POST, handleSave);
  webServer.onNotFound(handleRoot);
  webServer.begin();

  lastReconnect = millis();
  Serial.printf("Portal active: connect to '%s', open http://%s\n",
                AP_SSID, AP_IP.toString().c_str());
}

void stopPortal() {
  portalActive = false;
  dnsServer.stop();
  webServer.stop();
  WiFi.softAPdisconnect(true);
  WiFi.mode(WIFI_STA);
  digitalWrite(LED_PIN, LOW); // LED off — connected
}

void handleRoot() {
  webServer.send(200, "text/html", CONFIG_PAGE);
}

void handleSave() {
  wifiSSID = webServer.arg("ssid");
  wifiPass = webServer.arg("pass");
  workerURL = webServer.arg("url");
  apiKey = webServer.arg("key");

  if (workerURL.endsWith("/")) {
    workerURL = workerURL.substring(0, workerURL.length() - 1);
  }

  prefs.putString("ssid", wifiSSID);
  prefs.putString("pass", wifiPass);
  prefs.putString("url", workerURL);
  prefs.putString("key", apiKey);
  prefs.putBool("configured", true);

  configured = true;
  Serial.println("Config saved!");

  webServer.send(200, "text/html", SAVED_PAGE);
  delay(2000);
  ESP.restart();
}

bool sendPing() {
  String url = workerURL + "/ping?key=" + apiKey;

  for (int attempt = 0; attempt < RETRY_COUNT; attempt++) {
    HTTPClient http;
    http.begin(url);
    int code = http.GET();
    http.end();

    if (code == 200) {
      Serial.println("Ping OK");
      return true;
    }
    Serial.printf("Ping failed: HTTP %d (attempt %d)\n", code, attempt + 1);

    if (attempt < RETRY_COUNT - 1) delay(RETRY_DELAY);
  }

  return false;
}

void blinkLED(int interval) {
  static unsigned long lastBlink = 0;
  static bool state = false;
  unsigned long now = millis();
  if (now - lastBlink >= (unsigned long)interval) {
    lastBlink = now;
    state = !state;
    digitalWrite(LED_PIN, state ? HIGH : LOW);
  }
}
