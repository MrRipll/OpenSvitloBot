/*
  OpenSvitloBot — ESP32 Firmware
  Sends periodic HTTPS pings to a Cloudflare Worker.
  Configure WiFi, Worker URL, and Device Key via Serial on first boot.
  Settings are stored in NVS (Preferences).
*/

#include <WiFi.h>
#include <HTTPClient.h>
#include <Preferences.h>

#define LED_PIN 2             // Built-in LED on most ESP32 boards
#define PING_INTERVAL 60000   // 60 seconds
#define RETRY_COUNT 3
#define RETRY_DELAY 5000      // 5 seconds

Preferences prefs;
String wifiSSID;
String wifiPass;
String workerURL;
String deviceKey;
unsigned long lastPing = 0;

void setup() {
  Serial.begin(115200);
  pinMode(LED_PIN, OUTPUT);
  digitalWrite(LED_PIN, LOW);

  prefs.begin("osvitlobot", false);

  if (prefs.getBool("configured", false)) {
    wifiSSID = prefs.getString("ssid", "");
    wifiPass = prefs.getString("pass", "");
    workerURL = prefs.getString("url", "");
    deviceKey = prefs.getString("key", "");
    Serial.println("Loaded config from NVS");
  } else {
    Serial.println("No config found. Enter settings:");
    promptConfig();
  }

  connectWiFi();
}

void loop() {
  if (WiFi.status() != WL_CONNECTED) {
    blinkLED(200);
    connectWiFi();
    return;
  }

  unsigned long now = millis();
  if (now - lastPing >= PING_INTERVAL || lastPing == 0) {
    lastPing = now;
    bool success = sendPing();
    digitalWrite(LED_PIN, success ? HIGH : LOW);
  }

  delay(100);
}

bool sendPing() {
  String url = workerURL + "/ping?key=" + deviceKey;

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

void connectWiFi() {
  Serial.printf("Connecting to %s", wifiSSID.c_str());
  WiFi.mode(WIFI_STA);
  WiFi.begin(wifiSSID.c_str(), wifiPass.c_str());

  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED && attempts < 30) {
    delay(500);
    Serial.print(".");
    blinkLED(250);
    attempts++;
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.printf("\nConnected! IP: %s\n", WiFi.localIP().toString().c_str());
    digitalWrite(LED_PIN, HIGH);
  } else {
    Serial.println("\nWiFi connection failed. Retrying in 10s...");
    delay(10000);
  }
}

void promptConfig() {
  wifiSSID = promptSerial("WiFi SSID: ");
  wifiPass = promptSerial("WiFi Password: ");
  workerURL = promptSerial("Worker URL (e.g. https://opensvitlobot.workers.dev): ");
  deviceKey = promptSerial("Device Key: ");

  // Remove trailing slash from URL
  if (workerURL.endsWith("/")) {
    workerURL = workerURL.substring(0, workerURL.length() - 1);
  }

  prefs.putString("ssid", wifiSSID);
  prefs.putString("pass", wifiPass);
  prefs.putString("url", workerURL);
  prefs.putString("key", deviceKey);
  prefs.putBool("configured", true);

  Serial.println("Config saved to NVS!");
}

String promptSerial(const char* prompt) {
  Serial.print(prompt);
  while (!Serial.available()) delay(100);
  String input = Serial.readStringUntil('\n');
  input.trim();
  Serial.println(input);
  return input;
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
