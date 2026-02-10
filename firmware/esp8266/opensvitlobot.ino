/*
  OpenSvitloBot — ESP8266 Firmware
  Sends periodic HTTPS pings to a Cloudflare Worker.
  Configure WiFi, Worker URL, and API key via Serial on first boot.
  Settings are stored in EEPROM.
*/

#include <ESP8266WiFi.h>
#include <ESP8266HTTPClient.h>
#include <WiFiClientSecureBearSSL.h>
#include <EEPROM.h>

#define LED_PIN LED_BUILTIN
#define EEPROM_SIZE 512
#define PING_INTERVAL 60000   // 60 seconds
#define RETRY_COUNT 3
#define RETRY_DELAY 5000      // 5 seconds

// EEPROM layout: [magic(2)] [ssid(64)] [pass(64)] [url(256)] [key(64)]
#define MAGIC_ADDR 0
#define SSID_ADDR 2
#define PASS_ADDR 66
#define URL_ADDR 130
#define KEY_ADDR 386
#define MAGIC_VALUE 0xAB42

String wifiSSID;
String wifiPass;
String workerURL;
String apiKey;
unsigned long lastPing = 0;

void setup() {
  Serial.begin(115200);
  pinMode(LED_PIN, OUTPUT);
  digitalWrite(LED_PIN, HIGH); // LED off (active low)

  EEPROM.begin(EEPROM_SIZE);

  if (readMagic() == MAGIC_VALUE) {
    wifiSSID = readString(SSID_ADDR, 64);
    wifiPass = readString(PASS_ADDR, 64);
    workerURL = readString(URL_ADDR, 256);
    apiKey = readString(KEY_ADDR, 64);
    Serial.println("Loaded config from EEPROM");
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
    digitalWrite(LED_PIN, success ? LOW : HIGH); // LED on = connected
  }

  delay(100);
}

bool sendPing() {
  String url = workerURL + "/ping?key=" + apiKey;

  for (int attempt = 0; attempt < RETRY_COUNT; attempt++) {
    std::unique_ptr<BearSSL::WiFiClientSecure> client(new BearSSL::WiFiClientSecure);
    client->setInsecure(); // Skip cert verification for simplicity

    HTTPClient http;
    if (http.begin(*client, url)) {
      int code = http.GET();
      http.end();

      if (code == 200) {
        Serial.println("Ping OK");
        return true;
      }
      Serial.printf("Ping failed: HTTP %d (attempt %d)\n", code, attempt + 1);
    } else {
      Serial.printf("Connection failed (attempt %d)\n", attempt + 1);
    }

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
    digitalWrite(LED_PIN, LOW); // LED on
  } else {
    Serial.println("\nWiFi connection failed. Retrying in 10s...");
    delay(10000);
  }
}

void promptConfig() {
  wifiSSID = promptSerial("WiFi SSID: ");
  wifiPass = promptSerial("WiFi Password: ");
  workerURL = promptSerial("Worker URL (e.g. https://opensvitlobot.workers.dev): ");
  apiKey = promptSerial("API Key: ");

  // Remove trailing slash from URL
  if (workerURL.endsWith("/")) {
    workerURL = workerURL.substring(0, workerURL.length() - 1);
  }

  writeMagic(MAGIC_VALUE);
  writeString(SSID_ADDR, 64, wifiSSID);
  writeString(PASS_ADDR, 64, wifiPass);
  writeString(URL_ADDR, 256, workerURL);
  writeString(KEY_ADDR, 64, apiKey);
  EEPROM.commit();

  Serial.println("Config saved to EEPROM!");
}

String promptSerial(const char* prompt) {
  Serial.print(prompt);
  while (!Serial.available()) delay(100);
  String input = Serial.readStringUntil('\n');
  input.trim();
  Serial.println(input);
  return input;
}

// EEPROM helpers
uint16_t readMagic() {
  return EEPROM.read(MAGIC_ADDR) | (EEPROM.read(MAGIC_ADDR + 1) << 8);
}

void writeMagic(uint16_t val) {
  EEPROM.write(MAGIC_ADDR, val & 0xFF);
  EEPROM.write(MAGIC_ADDR + 1, (val >> 8) & 0xFF);
}

String readString(int addr, int maxLen) {
  String result;
  for (int i = 0; i < maxLen; i++) {
    char c = EEPROM.read(addr + i);
    if (c == 0) break;
    result += c;
  }
  return result;
}

void writeString(int addr, int maxLen, const String& val) {
  int len = min((int)val.length(), maxLen - 1);
  for (int i = 0; i < len; i++) {
    EEPROM.write(addr + i, val[i]);
  }
  EEPROM.write(addr + len, 0);
}

void blinkLED(int interval) {
  static unsigned long lastBlink = 0;
  static bool state = false;
  unsigned long now = millis();
  if (now - lastBlink >= (unsigned long)interval) {
    lastBlink = now;
    state = !state;
    digitalWrite(LED_PIN, state ? LOW : HIGH);
  }
}
