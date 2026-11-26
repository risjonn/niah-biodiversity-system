// ============================================================================
// NIAH NATIONAL PARK SMART IOT PLANT PROTECTION SYSTEM
// GATEWAY NODE v2.1 (ESP8266 NodeMCU Port -> Decrypt, ACK, Monitor & Cloud)
//
// Pairs directly with ESP32 Forest Sensor Node v2.1:
// - Decrypts AES-128-CTR (0xA1) frames & verifies HMAC-SHA256 signatures
// - Detects spoofing attempts (3+ invalid HMAC packets within 60 seconds -> CRITICAL)
// - Sends encrypted/signed (0xA2) ACKs + piggybacked remote ranger commands
// - Prints full human-readable field names & health descriptions on Serial Monitor
// - Forwards compact short-key JSON to Supabase database + LittleFS offline queue
//
// Libraries required: "LoRa" (Sandeep Mistry), "ArduinoJson" (v7)
// Board: NodeMCU 1.0 (ESP-12E Module)
// ============================================================================

#include <SPI.h>
#include <LoRa.h>
#include <ArduinoJson.h>
#include <ESP8266WiFi.h>
#include <WiFiClientSecureBearSSL.h>
#include <ESP8266HTTPClient.h>
#include <FS.h>
#include <LittleFS.h>
#include <time.h>
#include <bearssl/bearssl_hash.h>
#include <bearssl/bearssl_hmac.h>
#include <bearssl/bearssl_block.h>
#include "config.h"

// ---------- ESP8266 NodeMCU LoRa Pins (Hardware SPI on D5/D6/D7) ----------
#define SS_PIN    15   // D8
#define RST_PIN   16   // D0
#define DIO0_PIN  5    // D1

const long LORA_FREQ = 433E6;          // Must match Forest Node (433 MHz)
const byte LORA_SYNC_WORD = 0xF3;      // Must match Forest Node (0xF3)
const int LED_PIN = LED_BUILTIN;       // Onboard ESP8266 LED (GPIO 2, active LOW)

// ---------- Monitoring, Spoofing Guard & Offline Watchdog ----------
const unsigned long NODE_OFFLINE_MS   = 180000UL;   // 3 mins without packet -> NODE_OFFLINE
const unsigned long HEARTBEAT_MS      = 30000UL;    // 30s status heartbeat in Serial
const int           SPOOF_THRESHOLD   = 3;          // 3 failed HMAC checks within 60s -> CRITICAL spoofing alert
const unsigned long SPOOF_WINDOW_MS   = 60000UL;
const unsigned long SPOOF_COOLDOWN_MS = 60000UL;
const String QUEUE_FILE = "/gateway_queue.jsonl";
const String STATE_FILE = "/gw_state.json";
const size_t MAX_QUEUE_BYTES = 150000;

// ---------- Node Registry & State ----------
struct NodeState {
  const char* id;
  uint32_t hash;
  unsigned long lastSeq;
  unsigned long lastSeenMs;
  unsigned long rxCount;
  unsigned long missedCount;
  int lastRssi;
  float lastSnr;
  bool online;
  bool offlineAlerted;
  String pendingCmd;
  String pendingKey;
  float pendingVal;
};

NodeState nodes[] = {
  { NODE_1_ID, 0, 0, 0, 0, 0, 0, 0.0, false, false, "", "", 0.0 }
};
const int NUM_NODES = sizeof(nodes) / sizeof(nodes[0]);

uint8_t aesKey[16];
uint32_t ackCounter = 1;
unsigned long lastHeartbeat = 0;
unsigned long lastQueueFlush = 0;

// Spoofing detection ring buffer (tracks timestamps of invalid HMAC signatures)
unsigned long badSigTimes[SPOOF_THRESHOLD] = {0};
int badSigIdx = 0;
unsigned long lastSpoofAlertMs = 0;

// ============================================================================
// Human-Readable Health Code Helper (Serial Monitor Only)
// ============================================================================
const char* healthDescription(const String &code) {
  if (code == "OK")       return "All sensors healthy";
  if (code == "DHT")      return "DHT11 sensor read failure";
  if (code == "MPU")      return "Accelerometer fault (retrying)";
  if (code == "FRZ")      return "Sensor reading frozen for 12 hours";
  if (code == "WET_LEAF") return "Wet leaf or debris stuck on rain sensor (> 4 hours)";
  if (code == "FIRE")     return "Fire or canopy breach heat/humidity anomaly";
  if (code == "HEAT")     return "High temperature heat stress (> 35 C)";
  if (code == "SOIL")     return "Soil moisture probe disconnected or maxed (> 1 hour)";
  if (code == "WLOG")     return "Soil waterlogged at 100% without rain (> 6 hours)";
  if (code == "DRY")      return "Low soil moisture drought warning (< 20%)";
  return "Unknown health status";
}

// ============================================================================
// Persistent State Helpers (Replaces ESP32 Preferences via LittleFS)
// ============================================================================
void loadGatewayState() {
  if (!LittleFS.exists(STATE_FILE)) return;
  File f = LittleFS.open(STATE_FILE, "r");
  if (!f) return;
  JsonDocument doc;
  if (!deserializeJson(doc, f)) {
    ackCounter = doc["actr"] | 1U;
    nodes[0].lastSeq = doc["seq0"] | 0UL;
  }
  f.close();
}

void saveGatewayState() {
  File f = LittleFS.open(STATE_FILE, "w");
  if (!f) return;
  JsonDocument doc;
  doc["actr"] = ackCounter;
  doc["seq0"] = nodes[0].lastSeq;
  serializeJson(doc, f);
  f.close();
}

// ============================================================================
// Crypto Helpers (BearSSL implementation matching ESP32 mbedTLS identically)
// ============================================================================
void initCrypto() {
  br_sha256_context ctx;
  uint8_t h[32];
  br_sha256_init(&ctx);
  br_sha256_update(&ctx, LORA_SHARED_KEY, strlen(LORA_SHARED_KEY));
  br_sha256_out(&ctx, h);
  memcpy(aesKey, h, 16);
}

uint32_t nodeHash(const char* id) {
  uint32_t h = 2166136261u;
  while (*id) {
    h ^= (uint8_t)*id++;
    h *= 16777619u;
  }
  return h;
}

void aesCtr(uint8_t dir, uint32_t ctr, uint32_t nh, const uint8_t* in, uint8_t* out, size_t len) {
  uint8_t iv[16] = {0};
  iv[0] = dir;
  iv[1] = ctr >> 24; iv[2] = ctr >> 16; iv[3] = ctr >> 8; iv[4] = ctr;
  iv[5] = nh >> 24;  iv[6] = nh >> 16;  iv[7] = nh >> 8;  iv[8] = nh;

  br_aes_ct_ctr_keys ctx;
  br_aes_ct_ctr_init(&ctx, aesKey, 16);
  memcpy(out, in, len);
  br_aes_ct_ctr_run(&ctx, iv, 0, out, len);
}

String hmacShort(const String &msg) {
  br_hmac_key_context kc;
  br_hmac_context ctx;
  uint8_t out[32];
  br_hmac_key_init(&kc, &br_sha256_vtable, LORA_SHARED_KEY, strlen(LORA_SHARED_KEY));
  br_hmac_init(&ctx, &kc, 0);
  br_hmac_update(&ctx, msg.c_str(), msg.length());
  br_hmac_out(&ctx, out);

  char hex[9];
  for (int i = 0; i < 4; i++) sprintf(hex + i * 2, "%02x", out[i]);
  return String(hex);
}

String addSig(String body) {
  String sig = hmacShort(body);
  body.remove(body.length() - 1);
  body += ",\"sig\":\"" + sig + "\"}";
  return body;
}

bool verifySig(const String &packet, String &bodyOut) {
  int idx = packet.lastIndexOf(",\"sig\":\"");
  if (idx < 0 || (int)packet.length() != idx + 8 + 8 + 2) return false;
  bodyOut = packet.substring(0, idx) + "}";
  return packet.substring(idx + 8, idx + 16) == hmacShort(bodyOut);
}

// ============================================================================
// Wi-Fi & NTP Clock
// ============================================================================
void connectWiFi() {
  if (!CLOUD_ENABLED) return;
  Serial.print("Connecting Gateway to Wi-Fi: ");
  Serial.println(WIFI_SSID);
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  while (WiFi.status() != WL_CONNECTED) {
    ESP.wdtFeed();
    delay(500);
    Serial.print(".");
  }
  Serial.print("\nGateway Wi-Fi Connected! IP: ");
  Serial.println(WiFi.localIP());
}

void syncClock() {
  if (!CLOUD_ENABLED) return;
  configTime(0, 0, "pool.ntp.org", "time.google.com");
  Serial.print("Syncing NTP clock");
  time_t now = time(nullptr);
  int tries = 0;
  while (now < 1700000000 && tries < 20) {
    ESP.wdtFeed();
    delay(500);
    Serial.print(".");
    now = time(nullptr);
    tries++;
  }
  Serial.println(now >= 1700000000 ? " Done!" : " Skipped (will rely on node GPS timestamp)");
}

String isoFromEpoch(unsigned long ep) {
  time_t t_ep = (time_t)ep;
  struct tm t;
  gmtime_r(&t_ep, &t);
  char buf[30];
  strftime(buf, sizeof(buf), "%Y-%m-%dT%H:%M:%SZ", &t);
  return String(buf);
}

String currentIsoTimestamp() {
  time_t now = time(nullptr);
  if (now < 1700000000) return "";
  return isoFromEpoch((unsigned long)now);
}

// ============================================================================
// Encrypted & Signed ACK Sender (0xA2 Frame) + Piggybacked Ranger Commands
// ============================================================================
void sendEncryptedAck(NodeState &node, unsigned long rxSeq) {
  JsonDocument ackDoc;
  ackDoc["n"] = node.id;
  ackDoc["a"] = rxSeq;

  bool hasCmd = (node.pendingCmd.length() > 0);
  if (hasCmd) {
    ackDoc["c"] = node.pendingCmd;
    if (node.pendingKey.length() > 0) {
      ackDoc["k"] = node.pendingKey;
      ackDoc["v"] = node.pendingVal;
    }
  }

  String body;
  serializeJson(ackDoc, body);
  String signedAck = addSig(body);

  uint32_t ctr = ++ackCounter;
  saveGatewayState();

  uint8_t frame[256];
  size_t len = signedAck.length();
  frame[0] = 0xA2;
  frame[1] = ctr >> 24; frame[2] = ctr >> 16; frame[3] = ctr >> 8; frame[4] = ctr;
  frame[5] = node.hash >> 24; frame[6] = node.hash >> 16;
  frame[7] = node.hash >> 8;  frame[8] = node.hash;

  aesCtr(1, ctr, node.hash, (const uint8_t*)signedAck.c_str(), frame + 9, len);

  // Brief pause so Forest Node finishes switching from TX to RX mode
  delay(25);
  LoRa.beginPacket();
  LoRa.write(frame, len + 9);
  LoRa.endPacket();

  if (hasCmd) {
    Serial.printf("[ACK + CMD] Sent command '%s' to %s\n", node.pendingCmd.c_str(), node.id);
    node.pendingCmd = "";
    node.pendingKey = "";
    node.pendingVal = 0.0;
  }
}

// ============================================================================
// Compact Cloud Payload Formatter & Store/Forward Queue
// (Keeps short keys for database storage while Serial Monitor shows full names)
// ============================================================================
String buildCloudJson(JsonDocument &inDoc) {
  JsonDocument outDoc;
  outDoc["node_identifier"] = inDoc["n"] | "NODE-01";

  if (!inDoc["tc"].isNull() && !isnan(inDoc["tc"].as<float>())) outDoc["temperature"] = inDoc["tc"].as<float>();
  if (!inDoc["hu"].isNull() && !isnan(inDoc["hu"].as<float>())) outDoc["humidity"] = inDoc["hu"].as<float>();
  if (!inDoc["mo"].isNull()) outDoc["motion_detected"] = inDoc["mo"].as<bool>();
  if (!inDoc["md"].isNull()) outDoc["motion_duration_seconds"] = inDoc["md"].as<int>();
  if (!inDoc["la"].isNull() && !isnan(inDoc["la"].as<double>())) outDoc["latitude"] = inDoc["la"].as<double>();
  if (!inDoc["lo"].isNull() && !isnan(inDoc["lo"].as<double>())) outDoc["longitude"] = inDoc["lo"].as<double>();

  if (!inDoc["ts"].isNull() && inDoc["ts"].as<unsigned long>() > 1700000000UL) {
    outDoc["recorded_at"] = isoFromEpoch(inDoc["ts"].as<unsigned long>());
  } else {
    String ntpTs = currentIsoTimestamp();
    if (ntpTs.length() > 0) outDoc["recorded_at"] = ntpTs;
  }

  if (SEND_EXTRA_FIELDS) {
    if (!inDoc["tp"].isNull()) outDoc["tamper_detected"] = inDoc["tp"].as<bool>();
    if (!inDoc["ti"].isNull()) outDoc["tilt_angle"] = inDoc["ti"].as<float>();
    if (!inDoc["pt"].isNull()) outDoc["plant_tilt_angle"] = inDoc["pt"].as<float>();
    if (!inDoc["sm"].isNull()) outDoc["soil_moisture"] = inDoc["sm"].as<int>();
    if (!inDoc["rn"].isNull()) outDoc["is_raining"] = inDoc["rn"].as<bool>();
    if (!inDoc["hd"].isNull()) outDoc["human_detected"] = inDoc["hd"].as<bool>();
    if (!inDoc["st"].isNull()) outDoc["alert_status"] = inDoc["st"].as<const char*>();
    if (!inDoc["sv"].isNull()) outDoc["severity"] = inDoc["sv"].as<int>();
    if (!inDoc["hw"].isNull()) outDoc["health_status"] = inDoc["hw"].as<const char*>();
  }

  String result;
  serializeJson(outDoc, result);
  return result;
}
void enqueueFlash(const String &payload) {
  File f = LittleFS.open(QUEUE_FILE, "a");
  if (!f) return;
  if (f.size() < MAX_QUEUE_BYTES) {
    f.println(payload);
    Serial.println("[FLASH] Queued reading offline for later cloud sync.");
  }
  f.close();
}

bool postToSupabase(const String &cloudJson, bool fromQueue = false) {
  if (!CLOUD_ENABLED) return true;
  if (WiFi.status() != WL_CONNECTED) {
    if (!fromQueue) enqueueFlash(cloudJson);
    return false;
  }

  BearSSL::WiFiClientSecure client;
  client.setInsecure();

  HTTPClient http;
  http.setTimeout(10000);
  if (!http.begin(client, INGEST_URL)) {
    if (!fromQueue) enqueueFlash(cloudJson);
    return false;
  }
  http.addHeader("Content-Type", "application/json");
  http.addHeader("x-device-key", DEVICE_KEY);

  Serial.println("[CLOUD POST] " + cloudJson);
  int code = http.POST(cloudJson);
  String reply = http.getString();
  http.end();

  if (code == 201) {
    Serial.println("[201 SAVED] Stored in Supabase!");
    return true;
  } else if (code == 400 || code == 401 || code == 404) {
    Serial.printf("[CLOUD REJECTED %d] %s\n", code, reply.c_str());
    return true;
  } else {
    Serial.printf("[CLOUD ERROR %d] %s\n", code, reply.c_str());
    if (!fromQueue) enqueueFlash(cloudJson);
    return false;
  }
}

void flushCloudQueue() {
  if (!CLOUD_ENABLED || WiFi.status() != WL_CONNECTED || !LittleFS.exists(QUEUE_FILE)) return;
  File f = LittleFS.open(QUEUE_FILE, "r");
  if (!f || f.size() == 0) {
    if (f) f.close();
    return;
  }

  String remaining = "";
  int sent = 0;
  while (f.available()) {
    ESP.wdtFeed();
    String line = f.readStringUntil('\n');
    line.trim();
    if (!line.length()) continue;
    if (sent < 3 && postToSupabase(line, true)) {
      sent++;
      continue;
    }
    remaining += line + "\n";
  }
  f.close();

  if (remaining.length() == 0) LittleFS.remove(QUEUE_FILE);
  else {
    File out = LittleFS.open(QUEUE_FILE, "w");
    if (out) {
      out.print(remaining);
      out.close();
    }
  }
}

// ============================================================================
// Spoofing Attempt Tracker (3+ invalid HMAC signatures within 60 seconds)
// ============================================================================
void recordBadSignature(const char* nodeId, int rssi, float snr) {
  unsigned long nowMs = millis();
  badSigTimes[badSigIdx] = nowMs;
  badSigIdx = (badSigIdx + 1) % SPOOF_THRESHOLD;

  int countInWindow = 0;
  for (int i = 0; i < SPOOF_THRESHOLD; i++) {
    if (badSigTimes[i] != 0 && (nowMs - badSigTimes[i] <= SPOOF_WINDOW_MS)) {
      countInWindow++;
    }
  }

  if (countInWindow >= SPOOF_THRESHOLD && (lastSpoofAlertMs == 0 || nowMs - lastSpoofAlertMs >= SPOOF_COOLDOWN_MS)) {
    lastSpoofAlertMs = nowMs;
    Serial.println();
    Serial.println("!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!");
    Serial.println("!!!!  CRITICAL SPOOFING ALERT (sv=2) !!!");
    Serial.println("!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!");
    Serial.printf("  Target Node : %s\n", nodeId);
    Serial.printf("  Reason      : %d invalid HMAC signatures within 60 seconds!\n", countInWindow);
    Serial.printf("  RSSI / SNR  : %d dBm / %.1f dB\n", rssi, snr);
    Serial.println("!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!");
    Serial.println();

    JsonDocument spoofDoc;
    spoofDoc["node_identifier"] = nodeId;
    spoofDoc["alert_status"] = "SPOOFING_ATTEMPT_DETECTED";
    spoofDoc["severity"] = 2;
    spoofDoc["tamper_detected"] = true;
    String ntpTs = currentIsoTimestamp();
    if (ntpTs.length() > 0) spoofDoc["recorded_at"] = ntpTs;
    String spoofJson;
    serializeJson(spoofDoc, spoofJson);
    postToSupabase(spoofJson, false);
  } else {
    Serial.printf("[RADIO CORRUPTION] Invalid HMAC signature dropped (%d/%d in 60s window | RSSI %d dBm)\n",
                  countInWindow, SPOOF_THRESHOLD, rssi);
  }
}

// ============================================================================
// Serial Commands (Queue Remote Ranger Commands for Forest Node)
// ============================================================================
void checkSerialCommands() {
  if (!Serial.available()) return;
  String cmd = Serial.readStringUntil('\n');
  cmd.trim();
  String up = cmd;
  up.toUpperCase();

  if (up == "MAINT_ON" || up == "MAINT_OFF" || up == "CLEAR_THEFT" || up == "CALIBRATE") {
    nodes[0].pendingCmd = up;
    nodes[0].pendingKey = "";
    Serial.printf(">>> [QUEUED FOR %s] Command '%s' will be sent on next ACK!\n", nodes[0].id, up.c_str());
  }
  else if (up.startsWith("SET ")) {
    char key[8];
    float val = 0;
    if (sscanf(cmd.c_str() + 4, "%7s %f", key, &val) == 2) {
      nodes[0].pendingCmd = "SET";
      nodes[0].pendingKey = String(key);
      nodes[0].pendingVal = val;
      Serial.printf(">>> [QUEUED FOR %s] SET %s = %.1f will be sent on next ACK!\n", nodes[0].id, key, val);
    }
  }
  else if (up == "STATUS") {
    Serial.printf("--- GATEWAY STATUS | Node: %s | Online: %s | RX: %lu | Missed: %lu | Last RSSI: %d dBm ---\n",
                  nodes[0].id, nodes[0].online ? "YES" : "NO",
                  nodes[0].rxCount, nodes[0].missedCount, nodes[0].lastRssi);
  }
}

// ============================================================================
// Main Packet Processor
// ============================================================================
void handleIncomingPacket(int packetSize) {
  if (packetSize <= 9 || packetSize > 255) return;

  uint8_t buf[256];
  int n = 0;
  while (LoRa.available() && n < 255) buf[n++] = LoRa.read();

  int rssi = LoRa.packetRssi();
  float snr = LoRa.packetSnr();

  if (buf[0] != 0xA1) {
    Serial.printf("[IGNORE] Unknown LoRa frame header 0x%02X (%d bytes)\n", buf[0], n);
    return;
  }

  uint32_t ctr = ((uint32_t)buf[1] << 24) | ((uint32_t)buf[2] << 16) | ((uint32_t)buf[3] << 8) | buf[4];
  uint32_t nh  = ((uint32_t)buf[5] << 24) | ((uint32_t)buf[6] << 16) | ((uint32_t)buf[7] << 8) | buf[8];

  NodeState* node = nullptr;
  for (int i = 0; i < NUM_NODES; i++) {
    if (nodes[i].hash == nh) {
      node = &nodes[i];
      break;
    }
  }
  if (!node) {
    Serial.printf("[SECURITY] Rejected packet from unknown node hash 0x%08X\n", nh);
    return;
  }

  uint8_t plain[256];
  aesCtr(0, ctr, nh, buf + 9, plain, n - 9);
  plain[n - 9] = 0;
  String decrypted = String((const char*)plain);

  String unsignedBody;
  if (!verifySig(decrypted, unsignedBody)) {
    recordBadSignature(node->id, rssi, snr);
    return;
  }

  // Only update online status & timestamps after HMAC signature is verified authentic
  node->lastSeenMs = millis();
  node->lastRssi = rssi;
  node->lastSnr = snr;

  if (!node->online || node->offlineAlerted) {
    bool wasOffline = node->offlineAlerted;
    node->online = true;
    node->offlineAlerted = false;
    if (wasOffline) {
      Serial.println();
      Serial.printf(">>> NODE ONLINE again: %s\n", node->id);
      Serial.println();
    }
  }

  JsonDocument doc;
  if (deserializeJson(doc, unsignedBody)) {
    Serial.println("[ERROR] JSON parse failed after decryption.");
    return;
  }

  unsigned long rxSeq = doc["q"] | 0UL;
  const char* pktType = doc["y"] | "r";

  sendEncryptedAck(*node, rxSeq);

  if (node->lastSeq != 0 && rxSeq <= node->lastSeq) {
    return;
  }
  if (node->lastSeq != 0 && rxSeq > node->lastSeq + 1) {
    unsigned long gap = (rxSeq - node->lastSeq) - 1;
    node->missedCount += gap;
    Serial.printf("[LINK WARNING] Missed %lu packet(s) before seq %lu!\n", gap, rxSeq);
  }

  node->lastSeq = rxSeq;
  saveGatewayState();
  node->rxCount++;

  if (strcmp(pktType, "r") == 0) {
    int sev = doc["sv"] | 0;
    const char* st = doc["st"] | "NORMAL";
    const char* hw = doc["hw"] | "OK";
    float boxTilt = doc["ti"] | 0.0f;
    float plantTilt = doc["pt"] | 0.0f;
    bool motion = doc["mo"] | false;
    int motionSec = doc["md"] | 0;
    bool human = doc["hd"] | false;
    bool rain = doc["rn"] | false;
    float temp = doc["tc"] | -99.0f;
    float hum  = doc["hu"] | -99.0f;
    int soil   = doc["sm"] | 0;

    if (sev == 2) {
      Serial.println();
      Serial.println("!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!");
      Serial.println("!!!!!!!!!!   CRITICAL ALERT   !!!!!!!!!!");
      Serial.println("!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!");
      Serial.printf("  Node ID        : %s\n", node->id);
      Serial.printf("  Alert Status   : %s\n", st);
      Serial.printf("  Box Tilt       : %.1f deg\n", boxTilt);
      Serial.printf("  Plant Tilt     : %.1f deg\n", plantTilt);
      Serial.printf("  Motion         : %s (%d s)\n", motion ? "YES" : "NO", motionSec);
      Serial.printf("  Human Detected : %s\n", human ? "YES (YOLO)" : "NO");
      if (!doc["la"].isNull()) {
        Serial.printf("  GPS Location   : %.6f, %.6f\n", doc["la"].as<double>(), doc["lo"].as<double>());
      }
      Serial.printf("  Signal RSSI/SNR: %d dBm / %.1f dB\n", rssi, snr);
      Serial.println("!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!");
      Serial.println();
    }
    else if (sev == 1) {
      Serial.println();
      Serial.println("****************************************");
      Serial.println("**********    WARNING ALERT   **********");
      Serial.println("****************************************");
      Serial.printf("  Node ID        : %s\n", node->id);
      Serial.printf("  Alert Status   : %s\n", st);
      Serial.printf("  Box Tilt       : %.1f deg\n", boxTilt);
      Serial.printf("  Plant Tilt     : %.1f deg\n", plantTilt);
      Serial.printf("  Motion         : %s (%d s)\n", motion ? "YES" : "NO", motionSec);
      Serial.printf("  Human Detected : %s\n", human ? "YES (YOLO)" : "NO");
      if (!doc["la"].isNull()) {
        Serial.printf("  GPS Location   : %.6f, %.6f\n", doc["la"].as<double>(), doc["lo"].as<double>());
      }
      Serial.println("****************************************");
      Serial.println();
    }

    // Full human-readable printout on Gateway Serial Monitor
    Serial.println("========================================");
    Serial.printf("RECEIVE  |  %s  |  seq %lu  |  RSSI %d dBm\n", node->id, rxSeq, rssi);
    Serial.println("----------------------------------------");

    JsonDocument out;
    out["node_identifier"]         = node->id;
    out["alert_status"]            = st;
    out["severity"]                = (sev == 2) ? "CRITICAL" : (sev == 1 ? "WARNING" : "INFO");
    out["system_health"]           = String(hw) + " (" + String(healthDescription(hw)) + ")";
    if (temp > -90.0f) out["temperature_c"] = temp;
    if (hum  > -90.0f) out["humidity_pct"]  = hum;
    out["soil_moisture_pct"]       = soil;
    out["is_raining"]              = rain;
    out["box_tilt_deg"]            = boxTilt;
    out["plant_tilt_deg"]          = plantTilt;
    out["motion_detected"]         = motion;
    out["motion_duration_seconds"] = motionSec;
    out["human_detected"]          = human;
    if (!doc["la"].isNull()) {
      out["latitude"]              = doc["la"].as<double>();
      out["longitude"]             = doc["lo"].as<double>();
    }

    String pretty;
    serializeJsonPretty(out, pretty);
    Serial.println(pretty);
    Serial.println("========================================");
    Serial.println();

    // Forward compact short-key JSON to Supabase database
    String cloudJson = buildCloudJson(doc);
    postToSupabase(cloudJson, false);
  }
  else if (strcmp(pktType, "h") == 0) {
    const char* hw = doc["hw"] | "OK";
    Serial.println("========================================");
    Serial.printf("HEALTH REPORT  |  %s\n", node->id);
    Serial.printf("  Health Status : %s (%s)\n", hw, healthDescription(hw));
    Serial.printf("  Uptime        : %lu s\n", doc["up"] | 0UL);
    Serial.printf("  Reset Reason  : %s\n", doc["rs"] | "?");
    Serial.printf("  ACK Rate      : %d%%\n", doc["ak"] | 100);
    Serial.printf("  Firmware      : %s\n", doc["fw"] | "?");
    if (!doc["ss"].isNull()) Serial.printf("  Boot Self-Test: %s\n", doc["ss"].as<const char*>());
    Serial.println("========================================");
    Serial.println();
  }
  else if (strcmp(pktType, "d") == 0) {
    Serial.println("========================================");
    Serial.printf("DAILY SUMMARY  |  %s\n", node->id);
    Serial.printf("  Temperature Range : %.1f .. %.1f C\n", doc["tn"] | 0.0f, doc["tx"] | 0.0f);
    Serial.printf("  Humidity Range    : %.1f .. %.1f %%\n", doc["hn"] | 0.0f, doc["hx"] | 0.0f);
    Serial.printf("  Total Rain        : %lu mins\n", doc["rm"] | 0UL);
    Serial.println("========================================");
    Serial.println();
  }
}

// ============================================================================
// Setup & Loop
// ============================================================================
void setup() {
  delay(1500);
  Serial.begin(115200);
  delay(500);

  pinMode(LED_PIN, OUTPUT);
  digitalWrite(LED_PIN, HIGH); // ESP8266 LED_BUILTIN is active-LOW (HIGH = OFF)

  LittleFS.begin();
  for (int i = 0; i < NUM_NODES; i++) {
    nodes[i].hash = nodeHash(nodes[i].id);
  }
  loadGatewayState();
  initCrypto();

  SPI.begin();
  LoRa.setPins(SS_PIN, RST_PIN, DIO0_PIN);
  if (!LoRa.begin(LORA_FREQ)) {
    Serial.println("[ERROR] Starting LoRa Gateway failed! Check wiring (D5,D6,D7,D8,D0,D1) & 3V.");
    while (1) {
      ESP.wdtFeed();
      delay(100);
    }
  }
  LoRa.setSyncWord(LORA_SYNC_WORD);
  LoRa.enableCrc();

  Serial.println();
  Serial.println("****************************************");
  Serial.println("  NIAH LORA GATEWAY v2.1 READY (433 MHz - ESP8266)");
  Serial.println("  Commands: MAINT_ON | MAINT_OFF | CLEAR_THEFT | CALIBRATE | SET td 12 | STATUS");
  Serial.printf("  Cloud Upload: %s\n", CLOUD_ENABLED ? "ENABLED" : "PAUSED (Local LoRa Testing)");
  Serial.println("****************************************");
  Serial.println();

  if (CLOUD_ENABLED) {
    connectWiFi();
    syncClock();
  }

  ESP.wdtEnable(8000);
  Serial.println("waiting......");
}

void loop() {
  ESP.wdtFeed();
  unsigned long nowMs = millis();

  checkSerialCommands();

  int packetSize = LoRa.parsePacket();
  if (packetSize) {
    digitalWrite(LED_PIN, LOW);  // LED ON
    handleIncomingPacket(packetSize);
    digitalWrite(LED_PIN, HIGH); // LED OFF
    lastHeartbeat = millis();
  }

  for (int i = 0; i < NUM_NODES; i++) {
    if (nodes[i].lastSeenMs == 0) continue;

    unsigned long silentMs = nowMs - nodes[i].lastSeenMs;
    if (silentMs > 86400000UL) continue;

    if (!nodes[i].offlineAlerted && silentMs > NODE_OFFLINE_MS) {
      nodes[i].offlineAlerted = true;
      nodes[i].online = false;
      Serial.println();
      Serial.println("!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!");
      Serial.printf("  NODE_OFFLINE : %s\n", nodes[i].id);
      Serial.printf("  Silent for %lu seconds (threshold = 180 s)\n", silentMs / 1000);
      Serial.println("!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!");
      Serial.println();
    }
  }

  if (nowMs - lastHeartbeat >= HEARTBEAT_MS) {
    lastHeartbeat = nowMs;
    Serial.println("waiting......");
  }

  if (CLOUD_ENABLED && (nowMs - lastQueueFlush >= 15000)) {
    lastQueueFlush = nowMs;
    flushCloudQueue();
  }

  delay(5);
}