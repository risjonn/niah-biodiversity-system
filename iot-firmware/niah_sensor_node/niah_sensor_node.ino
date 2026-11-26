// ============================================================================
// NIAH NATIONAL PARK SMART IOT PLANT PROTECTION SYSTEM
// FOREST SENSOR NODE  v2.1  (100% offline LoRa transmitter - no Wi-Fi/Internet)
// + YOLO camera detector link (USB serial to the PC running niah_detector.py)
//
// SECURITY   : multi-sensor fusion, impact bursts, day/night curfew (with time
//              fallback), repetition + loitering escalation, 2-tier theft
//              (POSSIBLE_THEFT + LATCHED PLANT_STOLEN_MOVING with 5s live GPS),
//              GPS quality gating, GPS shield/jam detection, critical fall,
//              severity INFO/WARNING/CRITICAL, maintenance mode
// ENVIRONMENT: two-step fire (rate-of-change OR >40C), drought, waterlogging,
//              wet-leaf filter (WET_LEAF), soil checks, daily summary
// HEALTH     : sensor sanity (NaN/frozen/MPU re-init), health inside every packet,
//              watchdog + reset reason, capped flash log, boot self-test,
//              stealth LED, TX rate limit (5/min for non-critical)
// COMMS      : sequence numbers, HMAC signature, AES-128 encryption, ACK + 3 retries,
//              store-and-forward of un-ACKed CRITICAL alerts, remote commands
//              (MAINT_ON, MAINT_OFF, CLEAR_THEFT, CALIBRATE, SET)
//
// Libraries: LoRa (Sandeep Mistry), ArduinoJson v7, DHT sensor library,
//            TinyGPSPlus, Adafruit MPU6050
//
// secrets.h must define:
//   #define NODE_IDENTIFIER  "NODE-01"
//   #define LORA_SHARED_KEY  "long-random-text-identical-on-gateway"
//
// Serial protocol to the PC:  node -> PC: TRIGGER_CAM:<source>
//                             PC -> node: HUMAN_DETECTED / NO_HUMAN
// ============================================================================

#include <SPI.h>
#include <LoRa.h>
#include <ArduinoJson.h>
#include <Wire.h>
#include <math.h>
#include <FS.h>
#include <LittleFS.h>
#include <Preferences.h>
#include <esp_system.h>
#include <esp_task_wdt.h>
#include "mbedtls/md.h"
#include "mbedtls/aes.h"
#include <Adafruit_MPU6050.h>
#include <Adafruit_Sensor.h>
#include <TinyGPSPlus.h>
#include "DHT.h"
#include "secrets.h"

#ifndef LORA_SHARED_KEY
  #define LORA_SHARED_KEY "CHANGE-ME-niah-shared-key"
#endif
#define FW_VERSION "niah-2.1"

// ---------- Node Identification (Loaded from secrets.h) ----------
const char* NODE_ID = NODE_IDENTIFIER;

// ---------- LoRa Pin Mapping (Custom 30-Pin ESP32 Left/Right Split) ----------
#define LORA_SCK   26   // D26 (Left)
#define LORA_MISO  35   // D35 (Left - Input Only)
#define LORA_MOSI  25   // D25 (Left)
#define LORA_SS    27   // D27 / NSS (Left)
#define LORA_RST   22   // D22 (Right)
#define LORA_DIO0  23   // D23 (Right)

const long LORA_FREQ = 433E6;       // Must match Gateway
const byte LORA_SYNC_WORD = 0xF3;   // Must match Gateway

// ---------- Sensor Pin Mapping ----------
#define DHTPIN 19       // D19 (Right)
#define DHTTYPE DHT11
const int GPS_RX_PIN = 13;    // D14 (Left) -> connects to NEO-6M TX
const int GPS_TX_PIN = 14 `12222ww2222222222222222222222222q22;    // D13 (Left) -> connects to NEO-6M RX
// Node (Box) MPU6050 : SDA=D32, SCL=D33  -> Wire  (Left)
// Plant MPU6050      : SDA=D18, SCL=D5   -> Wire1 (Right)
const int PIR_PIN  = 17;      // TX2 / GPIO 17 (Right)
const int RAIN_PIN = 21;      // D21 (Right)
const int SOIL_PIN = 34;      // D34 (Left)
const int LED_PIN  = 2;       // Onboard LED

// ---------- Behavior Flags ----------
const bool STEALTH_MODE = false;              // true in the field: LED never lights (except Maintenance)
const bool SERIAL_CONTROL_ENABLED = true;     // false in the field: only camera replies are accepted

// ---------- Day/Night (Sarawak UTC+8) ----------
const int NIGHT_START_HOUR = 18;
const int NIGHT_END_HOUR   = 7;
const float CRITICAL_FALL_DEG = 75.0;

// ---------- Tunable thresholds (changeable by remote SET command, stored in flash) ----------
float tiltDayTrigger   = 25.0;      // key "td"  -> Node (box) day tilt
float tiltNightTrigger = 25.0;       // key "tn"  -> Node (box) night tilt
float plantTiltDayTrigger   = 25.0; // key "pd"  -> Plant day tilt
float plantTiltNightTrigger = 25.0;  // key "pn"  -> Plant night tilt
double geofenceRadiusM = 15.0;      // key "gr"
unsigned long loiterSec = 120;      // key "ls"

// ---------- Fixed thresholds ----------
const int    IMPACT_COUNT        = 3;
const float  IMPACT_DELTA_MS2    = 3.0;
const unsigned long IMPACT_WINDOW_MS = 10000;
const int    REPEAT_COUNT        = 3;
const unsigned long REPEAT_WINDOW_MS = 600000;   // 10 minutes
const unsigned long TILT_PERSIST_MS  = 1000;     // tilt must hold 1 s
const int    GPS_MIN_SATS        = 4;
const double GPS_MAX_HDOP        = 2.5;
const int    HOME_SAMPLES        = 30;           // average the home anchor over 30 good fixes
const int    AWAY_CONFIRM_COUNT  = 3;            // 3 consecutive good fixes beyond the radius
const unsigned long GPS_LOSS_CONFIRM_MS = 30000;
const unsigned long GPS_LOSS_LINK_MS    = 30000;
const int    SOIL_CHANGE_THRESHOLD = 10;
const int    DROUGHT_SOIL_LIMIT    = 20;
const float  HEAT_STRESS_LIMIT     = 35.0;
const float  FIRE_TEMP_JUMP        = 5.0;
const float  FIRE_HUM_DROP         = 15.0;
const float  FIRE_ABS_TEMP         = 40.0;   // absolute high-heat limit
const float  FIRE_ABS_HUM          = 55.0;   // extra guard: a sunny box is hot but not dry-air hot
const unsigned long WET_LEAF_MAX_MS   = 14400000UL;   // 4 h
const unsigned long SOIL_MAX_STUCK_MS = 3600000UL;    // 1 h
const unsigned long WATERLOG_MS       = 21600000UL;   // 6 h
const unsigned long FROZEN_MS         = 43200000UL;   // 12 h identical readings
const unsigned long STATE_DEBOUNCE_MS = 500;

// ---------- Timing ----------
const unsigned long PIR_WARMUP_MS         = 20000;
const unsigned long ENV_TRANSMIT_INTERVAL = 60000;   // 1 minute
const unsigned long NORMAL_TX_INTERVAL_MS = 60000;
const unsigned long QUIET_AFTER_MS        = 600000;
const unsigned long LIVE_TRACK_INTERVAL   = 5000;
const unsigned long BASELINE_REFRESH_MS   = 3600000UL;
const unsigned long MAINTENANCE_DURATION  = 900000;
const unsigned long HEALTH_INTERVAL_MS    = 300000;
const unsigned long DAILY_INTERVAL_MS     = 86400000UL;

// ---------- Camera (YOLO on PC over USB serial) ----------
const unsigned long CAM_COOLDOWN_MS = 15000;
const unsigned long HUMAN_HOLD_MS   = 30000;
unsigned long lastCamTrigger = 0;
unsigned long humanConfirmedAt = 0;
const char* camSource = "";

// ---------- Communications ----------
const unsigned long ACK_WAIT_MS = 800;
const int  CRITICAL_ATTEMPTS = 3;
const int  MAX_TX_PER_MIN    = 5;      // non-critical packets per minute (live GPS pursuit exempted)
const int  MAX_PLAINTEXT     = 246;    // 255 LoRa bytes - 9 header bytes
const int  WDT_TIMEOUT_S     = 15;

// ---------- Flash files ----------
const char* OFFLINE_LOG_FILE = "/forest_backup.jsonl";
const char* OFFLINE_LOG_OLD  = "/forest_backup.old";
const size_t MAX_LOG_BYTES   = 150000;
const char* PENDING_FILE     = "/pending.jsonl";
const int   MAX_PENDING      = 10;

// ---------- Objects ----------
DHT dht(DHTPIN, DHTTYPE);
TinyGPSPlus gps;
Adafruit_MPU6050 mpu;          // Node / Box accelerometer (Wire  D32/D33)
Adafruit_MPU6050 mpuPlant;     // Plant accelerometer      (Wire1 D18/D5)
Preferences prefs;
uint8_t aesKey[16];

// ---------- Node (Box) Tilt / motion state ----------
bool mpuReady = false, mpuFault = false;
int  mpuZeroCount = 0;
unsigned long lastMpuRetry = 0;
float basePitch = 0.0, baseRoll = 0.0;
float currentTiltAngle = 0.0;
float tiltBuf[5] = {0}; int tiltIdx = 0, tiltCount = 0;
unsigned long tiltAboveSince = 0;
bool isTilted = false;
bool criticalFallLocked = false;
float prevAccelMag = 0.0;
unsigned long lastImpactMs = 0;
unsigned long impactTimes[IMPACT_COUNT] = {0}; int impactIdx = 0;
bool prevImpactActive = false;

// ---------- Plant Tilt / shock state ----------
bool mpuPlantReady = false, mpuPlantFault = false;
int  mpuPlantZeroCount = 0;
unsigned long lastMpuPlantRetry = 0;
float plantBasePitch = 0.0, plantBaseRoll = 0.0;
float plantTiltAngle = 0.0;
float plantTiltBuf[5] = {0}; int plantTiltIdx = 0, plantTiltCount = 0;
unsigned long plantTiltAboveSince = 0;
bool plantIsTilted = false;
float plantPrevAccelMag = 0.0;
unsigned long plantLastImpactMs = 0;
unsigned long plantImpactTimes[IMPACT_COUNT] = {0}; int plantImpactIdx = 0;
bool plantImpactActive = false;
bool prevPlantImpactActive = false;

// ---------- Shared motion state ----------
unsigned long disturbTimes[REPEAT_COUNT] = {0}; int disturbIdx = 0;
unsigned long motionStartTime = 0;
int motionDurationSec = 0;
unsigned long lastMovementMs = 0;
unsigned long lastActivityMs = 0;
unsigned int pirHourly[24] = {0};

// ---------- Weather / soil ----------
int baselineSoilPct = -1;
int soilMoisturePct = 0;
int soilRaw = 0;
bool rawRainWet = false;
bool effectiveIsRaining = false;
bool rainSensorObstructed = false;
unsigned long rainStartTime = 0;
unsigned long soilMaxStart = 0, soilHighStart = 0;
bool soilStuckMax = false, waterlogged = false;
int  lastSoilSample = -1; unsigned long soilFrozenSince = 0;
float lastT = -999, lastH = -999; unsigned long thFrozenSince = 0;
bool sensorsFrozen = false;

// ---------- Climate / fire ----------
bool haveClimate = false;
float currentTemp = 0.0, currentHum = 0.0;
int dhtFailCount = 0;
const int HIST_N = 10;
float tHist[HIST_N], hHist[HIST_N]; int hIdx = 0, hCount = 0;
int fireRateCount = 0, fireAbsCount = 0;
bool fireAnomalyActive = false;

// ---------- GPS / theft ----------
bool homeLocationSet = false;
double homeLat = 0.0, homeLon = 0.0;
double homeSumLat = 0.0, homeSumLon = 0.0; int homeSamples = 0;
double distanceMovedMeters = 0.0;
int awayCount = 0;
bool possibleTheftActive = false;
bool theftLatched = false;
bool gpsShielded = false;
unsigned long lastFixMs = 0, fixBackSince = 0, lastGpsSample = 0;

// ---------- Time (GPS time with fallback) ----------
unsigned long timeBaseSec = 0, timeBaseMs = 0; bool timeKnown = false;
unsigned long storedSec = 0; bool storedSecValid = false; unsigned long lastTimeSave = 0;
unsigned long epochBase = 0, epochBaseMs = 0; bool epochKnown = false;

// ---------- Daily summary ----------
float dailyMinTemp = 999, dailyMaxTemp = -999, dailyMinHum = 999, dailyMaxHum = -999;
unsigned long dailyRainSec = 0; bool dailyHaveData = false; unsigned long lastDailySend = 0;

// ---------- Modes / timers ----------
unsigned long bootTime = 0, lastEnvTransmitTime = 0, lastScheduledTx = 0;
unsigned long lastLiveTrackTime = 0, lastBaselineRefresh = 0, lastHealthSend = 0;
bool maintenanceMode = false; unsigned long maintenanceStartTime = 0;
bool ledAlertOn = false;

// ---------- State machine ----------
String confirmedState = "NORMAL";
String pendingState = "NORMAL";
unsigned long pendingStateStart = 0;
String healthCode = "OK";            // short code: OK DHT MPU FRZ WET_LEAF FIRE HEAT SOIL WLOG DRY
String lastSentHealth = "";
bool needBootHealth = true;
String selfTest = "";

// ---------- Comms state ----------
unsigned long seqCounter = 0, txTotal = 0, txAcked = 0;
unsigned long txTimes[MAX_TX_PER_MIN] = {0}; int txIdx = 0;

// ============================================================================
// Small helpers
// ============================================================================
void ledWrite(bool on) {
  if (STEALTH_MODE && !maintenanceMode) on = false;
  digitalWrite(LED_PIN, on ? HIGH : LOW);
}
void setAlertLed(bool on) { ledAlertOn = on; ledWrite(on); }

void getAngles(float ax, float ay, float az, float &pitch, float &roll) {
  pitch = atan2(ax, sqrt(ay * ay + az * az)) * 180.0 / PI;
  roll  = atan2(ay, sqrt(ax * ax + az * az)) * 180.0 / PI;
}

const char* healthDescription(const String &code) {
  if (code == "OK")       return "All sensors healthy";
  if (code == "DHT")      return "DHT11 sensor read failure (3+ failed reads)";
  if (code == "MPU")      return "Accelerometer fault (retrying I2C init)";
  if (code == "FRZ")      return "Sensor reading frozen/identical for 12 hours";
  if (code == "WET_LEAF") return "Wet leaf or debris stuck on rain plate (> 4 hours)";
  if (code == "FIRE")     return "Fire or canopy breach heat/humidity anomaly";
  if (code == "HEAT")     return "High temperature heat stress (> 35 C)";
  if (code == "SOIL")     return "Soil moisture probe disconnected or maxed (> 1 hour)";
  if (code == "WLOG")     return "Soil waterlogged at 100% without rain (> 6 hours)";
  if (code == "DRY")      return "Low soil moisture drought warning (< 20%)";
  return "Unknown status";
}

const char* resetReasonStr() {
  switch (esp_reset_reason()) {
    case ESP_RST_POWERON:  return "POWERON";
    case ESP_RST_SW:       return "SOFTWARE";
    case ESP_RST_PANIC:    return "CRASH";
    case ESP_RST_INT_WDT:
    case ESP_RST_TASK_WDT:
    case ESP_RST_WDT:      return "WATCHDOG";
    case ESP_RST_BROWNOUT: return "BROWNOUT";
    case ESP_RST_DEEPSLEEP:return "DEEPSLEEP";
    default:               return "OTHER";
  }
}

// Severity: 0 = INFO, 1 = WARNING, 2 = CRITICAL
int severityOf(const String &s) {
  if (s == "CRITICAL_FALL" || s == "PLANT_STOLEN_MOVING" || s == "NIGHT_POACHING_RISK" ||
      s == "FIRE_OR_CANOPY_BREACH" || s == "GPS_SHIELDED_OR_JAMMED") return 2;
  if (s == "POSSIBLE_THEFT" || s == "POACHING_RISK" || s == "IMPACT_DETECTED" ||
      s == "LOITERING" || s == "REPEATED_DISTURBANCE") return 1;
  return 0;
}

// ============================================================================
// Time: GPS time with fallback so night mode still works without a fix
// ============================================================================
long daysFromCivil(int y, unsigned m, unsigned d) {
  y -= (m <= 2);
  long era = (y >= 0 ? y : y - 399) / 400;
  unsigned yoe = (unsigned)(y - era * 400);
  unsigned doy = (153 * (m + (m > 2 ? -3 : 9)) + 2) / 5 + d - 1;
  unsigned doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
  return era * 146097 + (long)doe - 719468;
}

void updateTimeSync(unsigned long nowMs) {
  if (gps.time.isValid() && gps.time.age() < 5000 && gps.date.isValid() && gps.date.year() > 2020) {
    unsigned long sod = gps.time.hour() * 3600UL + gps.time.minute() * 60UL + gps.time.second();
    timeBaseSec = sod; timeBaseMs = nowMs; timeKnown = true;
    epochBase = (unsigned long)daysFromCivil(gps.date.year(), gps.date.month(), gps.date.day()) * 86400UL + sod;
    epochBaseMs = nowMs; epochKnown = true;
    if (lastTimeSave == 0 || nowMs - lastTimeSave > 3600000UL) {   // remember in flash (hourly)
      prefs.putULong("tsec", sod);
      lastTimeSave = nowMs ? nowMs : 1;
    }
  }
}
bool timeAvailable() { return timeKnown || storedSecValid; }
unsigned long utcSecOfDay(unsigned long nowMs) {
  if (timeKnown) return (timeBaseSec + (nowMs - timeBaseMs) / 1000) % 86400UL;
  if (storedSecValid) return storedSec;      // approximate (power-off time unknown)
  return 0;
}
unsigned long utcEpochNow(unsigned long nowMs) {
  return epochKnown ? epochBase + (nowMs - epochBaseMs) / 1000 : 0;
}
int localHour(unsigned long nowMs) { return (int)((utcSecOfDay(nowMs) / 3600 + 8) % 24); }
bool isNighttimeSarawak(unsigned long nowMs) {
  if (!timeAvailable()) return false;
  int h = localHour(nowMs);
  return (h >= NIGHT_START_HOUR || h < NIGHT_END_HOUR);
}

// ============================================================================
// Crypto: HMAC signature (inside) + AES-128-CTR encryption (whole payload)
// Frame = [magic 0xA1][ctr 4B][node hash 4B][AES-CTR(signed JSON)]
// ============================================================================
void initCrypto() {
  uint8_t h[32];
  mbedtls_md(mbedtls_md_info_from_type(MBEDTLS_MD_SHA256),
             (const unsigned char*)LORA_SHARED_KEY, strlen(LORA_SHARED_KEY), h);
  memcpy(aesKey, h, 16);
}
uint32_t nodeHash(const char* id) {
  uint32_t h = 2166136261u;
  while (*id) { h ^= (uint8_t)*id++; h *= 16777619u; }
  return h;
}
void aesCtr(uint8_t dir, uint32_t ctr, uint32_t nh, const uint8_t* in, uint8_t* out, size_t len) {
  uint8_t iv[16] = {0};
  iv[0] = dir;
  iv[1] = ctr >> 24; iv[2] = ctr >> 16; iv[3] = ctr >> 8; iv[4] = ctr;
  iv[5] = nh >> 24;  iv[6] = nh >> 16;  iv[7] = nh >> 8;  iv[8] = nh;
  uint8_t sb[16]; size_t off = 0;
  mbedtls_aes_context ctx;
  mbedtls_aes_init(&ctx);
  mbedtls_aes_setkey_enc(&ctx, aesKey, 128);
  mbedtls_aes_crypt_ctr(&ctx, len, &off, iv, sb, in, out);
  mbedtls_aes_free(&ctx);
}
String hmacShort(const String &msg) {
  uint8_t out[32];
  mbedtls_md_hmac(mbedtls_md_info_from_type(MBEDTLS_MD_SHA256),
                  (const unsigned char*)LORA_SHARED_KEY, strlen(LORA_SHARED_KEY),
                  (const unsigned char*)msg.c_str(), msg.length(), out);
  char hex[9];
  for (int i = 0; i < 4; i++) sprintf(hex + i * 2, "%02x", out[i]);
  return String(hex);
}
String addSig(String body) {                         // body must end with '}'
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
size_t buildFrame(const String &plain, uint32_t ctr, uint8_t* frame) {
  uint32_t nh = nodeHash(NODE_ID);
  size_t n = plain.length();
  frame[0] = 0xA1;
  frame[1] = ctr >> 24; frame[2] = ctr >> 16; frame[3] = ctr >> 8; frame[4] = ctr;
  frame[5] = nh >> 24;  frame[6] = nh >> 16;  frame[7] = nh >> 8;  frame[8] = nh;
  aesCtr(0, ctr, nh, (const uint8_t*)plain.c_str(), frame + 9, n);
  return n + 9;
}

// ============================================================================
// Flash: backup log with rotation, pending (store-and-forward) queue
// ============================================================================
void initFlashStorage() {
  if (!LittleFS.begin(true)) Serial.println("[WARNING] LittleFS Flash mount failed!");
  else Serial.println("[OK] LittleFS Flash storage ready.");
}
void logLocalBackup(const String &line) {
  File f = LittleFS.open(OFFLINE_LOG_FILE, FILE_APPEND);
  if (!f) return;
  size_t sz = f.size();
  f.println(line);
  f.close();
  if (sz > MAX_LOG_BYTES) {                       // cap: keep current + one old file
    LittleFS.remove(OFFLINE_LOG_OLD);
    LittleFS.rename(OFFLINE_LOG_FILE, OFFLINE_LOG_OLD);
  }
}
int readPending(String lines[]) {
  int n = 0;
  File f = LittleFS.open(PENDING_FILE, FILE_READ);
  if (!f) return 0;
  while (f.available() && n < MAX_PENDING) {
    String l = f.readStringUntil('\n'); l.trim();
    if (l.length()) lines[n++] = l;
  }
  f.close();
  return n;
}
void writePending(String lines[], int from, int n) {
  File f = LittleFS.open(PENDING_FILE, FILE_WRITE);   // truncates
  if (!f) return;
  for (int i = from; i < n; i++) f.println(lines[i]);
  f.close();
}
void queuePending(const String &body) {            // body = unsigned JSON
  String lines[MAX_PENDING];
  int n = readPending(lines);
  if (n >= MAX_PENDING) { for (int i = 1; i < n; i++) lines[i - 1] = lines[i]; n = MAX_PENDING - 1; }
  lines[n++] = String(millis()) + "|" + body;
  writePending(lines, 0, n);
  Serial.printf("[STORE] Un-ACKed CRITICAL alert saved for later (%d queued)\n", n);
}

// ============================================================================
// Dual MPU6050 + calibration (Node = box, Plant = plant)
// Node  -> Wire  (SDA=D32, SCL=D33)
// Plant -> Wire1 (SDA=D18, SCL=D5)
// ============================================================================
bool mpuStart() {
  Wire.begin(32, 33);
  if (!mpu.begin(0x68, &Wire)) return false;
  mpu.setAccelerometerRange(MPU6050_RANGE_8_G);
  mpu.setFilterBandwidth(MPU6050_BAND_21_HZ);
  return true;
}
bool mpuPlantStart() {
  Wire1.begin(18, 5);
  if (!mpuPlant.begin(0x68, &Wire1)) return false;
  mpuPlant.setAccelerometerRange(MPU6050_RANGE_8_G);
  mpuPlant.setFilterBandwidth(MPU6050_BAND_21_HZ);
  return true;
}
bool calibrateBaseline() {
  if (!mpuReady) return false;
  sensors_event_t a, g, temp;
  mpu.getEvent(&a, &g, &temp);
  getAngles(a.acceleration.x, a.acceleration.y, a.acceleration.z, basePitch, baseRoll);
  prefs.putFloat("bp", basePitch);
  prefs.putFloat("br", baseRoll);
  tiltCount = 0; tiltAboveSince = 0; isTilted = false; criticalFallLocked = false;
  Serial.println("[OK] Node (box) tilt baseline calibrated and saved.");
  return true;
}
bool calibratePlantBaseline() {
  if (!mpuPlantReady) return false;
  sensors_event_t a, g, temp;
  mpuPlant.getEvent(&a, &g, &temp);
  getAngles(a.acceleration.x, a.acceleration.y, a.acceleration.z, plantBasePitch, plantBaseRoll);
  prefs.putFloat("pbp", plantBasePitch);
  prefs.putFloat("pbr", plantBaseRoll);
  plantTiltCount = 0; plantTiltAboveSince = 0; plantIsTilted = false;
  Serial.println("[OK] Plant tilt baseline calibrated and saved.");
  return true;
}
void initMPU() {
  // Node (box)
  if (!mpuStart()) {
    Serial.println("[WARNING] Node MPU6050 not detected on D32/D33!");
    mpuReady = false;
  } else {
    mpuReady = true;
    delay(150);
    if (prefs.isKey("bp")) {
      basePitch = prefs.getFloat("bp", 0);
      baseRoll  = prefs.getFloat("br", 0);
      Serial.println("[OK] Node MPU6050 ready (stored baseline loaded).");
    } else {
      calibrateBaseline();
    }
  }

  // Plant
  if (!mpuPlantStart()) {
    Serial.println("[WARNING] Plant MPU6050 not detected on D18/D5!");
    mpuPlantReady = false;
  } else {
    mpuPlantReady = true;
    delay(150);
    if (prefs.isKey("pbp")) {
      plantBasePitch = prefs.getFloat("pbp", 0);
      plantBaseRoll  = prefs.getFloat("pbr", 0);
      Serial.println("[OK] Plant MPU6050 ready (stored baseline loaded).");
    } else {
      calibratePlantBaseline();
    }
  }
}

// ============================================================================
// Watchdog (ESP32 Arduino core 2.x and 3.x)
// ============================================================================
void initWatchdog() {
#if defined(ESP_ARDUINO_VERSION_MAJOR) && (ESP_ARDUINO_VERSION_MAJOR >= 3)
  esp_task_wdt_config_t cfg;
  cfg.timeout_ms = WDT_TIMEOUT_S * 1000;
  cfg.idle_core_mask = 0;
  cfg.trigger_panic = true;
  esp_task_wdt_reconfigure(&cfg);
#else
  esp_task_wdt_init(WDT_TIMEOUT_S, true);
#endif
  esp_task_wdt_add(NULL);
}

// ============================================================================
// Latched alerts, settings, remote commands
// ============================================================================
void saveHome() {
  prefs.putBool("hset", homeLocationSet);
  prefs.putDouble("hlat", homeLat);
  prefs.putDouble("hlon", homeLon);
}
void clearTheft() {
  possibleTheftActive = false;
  theftLatched = false;
  gpsShielded = false;
  homeLocationSet = false; homeSamples = 0; homeSumLat = 0; homeSumLon = 0;   // new GPS home will be learned
  distanceMovedMeters = 0; awayCount = 0;
  fireRateCount = 0; fireAbsCount = 0; fireAnomalyActive = false;
  for (int i = 0; i < IMPACT_COUNT; i++) impactTimes[i] = 0;
  for (int i = 0; i < REPEAT_COUNT; i++) disturbTimes[i] = 0;
  prefs.putBool("latch", false);
  prefs.putBool("hset", false);
  Serial.println(">>> [CLEARED] Theft latch, possible theft, GPS shield and impact/repeat alerts reset. New GPS home will be learned.");
}
void setTheftLatch() {
  if (!theftLatched) { theftLatched = true; prefs.putBool("latch", true); }
}
bool applySetting(const char* key, float v) {
  if (strcmp(key, "td") == 0 && v >= 3 && v <= 45)        { tiltDayTrigger = v;        prefs.putFloat("td", v); }
  else if (strcmp(key, "tn") == 0 && v >= 3 && v <= 45)   { tiltNightTrigger = v;      prefs.putFloat("tn", v); }
  else if (strcmp(key, "pd") == 0 && v >= 3 && v <= 45)   { plantTiltDayTrigger = v;   prefs.putFloat("pd", v); }
  else if (strcmp(key, "pn") == 0 && v >= 3 && v <= 45)   { plantTiltNightTrigger = v; prefs.putFloat("pn", v); }
  else if (strcmp(key, "gr") == 0 && v >= 5 && v <= 200)  { geofenceRadiusM = v;       prefs.putFloat("gr", v); }
  else if (strcmp(key, "ls") == 0 && v >= 10 && v <= 900) { loiterSec = (unsigned long)v; prefs.putFloat("ls", v); }
  else { Serial.printf(">>> [SETTING] rejected %s=%.1f\n", key, v); return false; }
  Serial.printf(">>> [SETTING] %s = %.1f saved\n", key, v);
  return true;
}
void loadSettings() {
  tiltDayTrigger        = prefs.getFloat("td", tiltDayTrigger);
  tiltNightTrigger      = prefs.getFloat("tn", tiltNightTrigger);
  plantTiltDayTrigger   = prefs.getFloat("pd", plantTiltDayTrigger);
  plantTiltNightTrigger = prefs.getFloat("pn", plantTiltNightTrigger);
  geofenceRadiusM       = prefs.getFloat("gr", (float)geofenceRadiusM);
  loiterSec             = (unsigned long)prefs.getFloat("ls", (float)loiterSec);
  theftLatched          = prefs.getBool("latch", false);
  homeLocationSet       = prefs.getBool("hset", false);
  if (homeLocationSet) { homeLat = prefs.getDouble("hlat", 0); homeLon = prefs.getDouble("hlon", 0); }
  if (prefs.isKey("tsec")) { storedSec = prefs.getULong("tsec", 0); storedSecValid = true; }
}
void handleRemoteCommand(const char* cmd, const char* key, float val) {
  Serial.printf(">>> [REMOTE COMMAND] %s\n", cmd);
  if (strcmp(cmd, "MAINT_ON") == 0) {
    if (!maintenanceMode) { maintenanceMode = true; maintenanceStartTime = millis(); }
  } else if (strcmp(cmd, "MAINT_OFF") == 0) {
    maintenanceMode = false;
  } else if (strcmp(cmd, "CLEAR_THEFT") == 0) {
    clearTheft();
  } else if (strcmp(cmd, "CALIBRATE") == 0) {
    calibrateBaseline();
    calibratePlantBaseline();
  } else if (strcmp(cmd, "SET") == 0 && key && key[0]) {
    applySetting(key, val);
  }
}

// ============================================================================
// Camera trigger (asks the PC to wake the webcam)
// ============================================================================
void requestCamera(const char* source, unsigned long nowMs) {
  if (maintenanceMode) return;
  if (lastCamTrigger != 0 && nowMs - lastCamTrigger < CAM_COOLDOWN_MS) return;
  lastCamTrigger = nowMs;
  camSource = source;
  Serial.printf("TRIGGER_CAM:%s\n", source);
}

// ============================================================================
// Serial commands (maintenance + camera replies)
// ============================================================================
void checkSerialCommands(unsigned long nowMs) {
  if (!Serial.available()) return;
  String cmd = Serial.readStringUntil('\n');
  cmd.trim();
  String up = cmd; up.toUpperCase();

  if (up.startsWith("HUMAN_DETECTED")) {
    humanConfirmedAt = nowMs;
    Serial.printf(">>> [CAMERA] Human confirmed (trigger: %s)\n", camSource);
    return;
  }
  if (up == "NO_HUMAN") {
    Serial.printf(">>> [CAMERA] No human in frame (trigger: %s), likely wildlife/wind.\n", camSource);
    return;
  }
  if (!SERIAL_CONTROL_ENABLED) return;

  if (up == "MAINT") {
    maintenanceMode = !maintenanceMode;
    if (maintenanceMode) {
      maintenanceStartTime = nowMs;
      Serial.println(">>> [MAINTENANCE MODE ON] Alerts paused for 15 minutes.");
    } else {
      Serial.println(">>> [MAINTENANCE MODE OFF] Security alerts re-armed.");
    }
  } else if (up == "CLEAR" || up == "CLEAR_THEFT") {
    clearTheft();
  } else if (up == "CALIBRATE") {
    calibrateBaseline();
    calibratePlantBaseline();
  } else if (up.startsWith("SET ")) {           // e.g.  SET td 14
    char key[8]; float v = 0;
    if (sscanf(cmd.c_str() + 4, "%7s %f", key, &v) == 2) applySetting(key, v);
  }
}

// ============================================================================
// Radio: rate limit, transmit, wait for ACK, retries, store-and-forward
// ============================================================================
bool txAllowed(int sev, bool live) {
  if (sev >= 2 || live) return true;               // CRITICAL & live GPS pursuit bypass rate limit
  unsigned long now = millis();
  int c = 0;
  for (int i = 0; i < MAX_TX_PER_MIN; i++) if (txTimes[i] != 0 && now - txTimes[i] < 60000) c++;
  if (c >= MAX_TX_PER_MIN) return false;
  txTimes[txIdx] = now; txIdx = (txIdx + 1) % MAX_TX_PER_MIN;
  return true;
}
void rawTransmit(const uint8_t* frame, size_t len) {
  ledWrite(true);
  LoRa.beginPacket();
  LoRa.write(frame, len);
  LoRa.endPacket();                                 // blocks until the radio has finished sending
  ledWrite(ledAlertOn);
}
bool waitForAck(unsigned long seq, unsigned long timeoutMs) {
  uint32_t myHash = nodeHash(NODE_ID);
  unsigned long t0 = millis();
  while (millis() - t0 < timeoutMs) {
    esp_task_wdt_reset();
    while (Serial2.available()) gps.encode(Serial2.read());
    int sz = LoRa.parsePacket();
    if (sz > 12 && sz <= 255) {
      uint8_t buf[256]; int n = 0;
      while (LoRa.available() && n < 255) buf[n++] = LoRa.read();
      if (buf[0] == 0xA2) {
        uint32_t ctr = ((uint32_t)buf[1] << 24) | ((uint32_t)buf[2] << 16) | ((uint32_t)buf[3] << 8) | buf[4];
        uint32_t nh  = ((uint32_t)buf[5] << 24) | ((uint32_t)buf[6] << 16) | ((uint32_t)buf[7] << 8) | buf[8];
        if (nh == myHash) {
          uint8_t plain[256];
          aesCtr(1, ctr, nh, buf + 9, plain, n - 9);
          plain[n - 9] = 0;
          String body;
          if (verifySig(String((const char*)plain), body)) {
            JsonDocument d;
            if (!deserializeJson(d, body)) {
              const char* nid = d["n"] | "";
              unsigned long a = d["a"] | 0UL;
              if (strcmp(nid, NODE_ID) == 0 && a == seq) {
                const char* c = d["c"] | "";
                if (c[0]) handleRemoteCommand(c, d["k"] | "", d["v"] | 0.0f);
                return true;
              }
            }
          }
        }
      }
    }
    delay(2);
  }
  return false;
}
// Sign, back up, encrypt, transmit, wait for ACK. Returns true when the gateway ACKed.
bool sendSigned(const String &body, unsigned long seq, int attempts, const char* tag, bool queueIfFail) {
  String pkt = addSig(body);
  if ((int)pkt.length() > MAX_PLAINTEXT) Serial.println("[WARNING] Packet too long - it may be truncated!");
  logLocalBackup(pkt);
  txTotal++;

  uint8_t frame[256];
  size_t flen = buildFrame(pkt, seq, frame);
  bool acked = false;
  for (int i = 1; i <= attempts && !acked; i++) {
    rawTransmit(frame, flen);
    Serial.printf("[LORA TX | %s | seq %lu | try %d/%d] (%u bytes on air): %s\n",
                  tag, seq, i, attempts, (unsigned)flen, pkt.c_str());
    acked = waitForAck(seq, ACK_WAIT_MS);
    if (!acked) Serial.println("[LORA] no ACK from gateway");
  }
  if (acked) { txAcked++; Serial.printf("[LORA] ACK received for seq %lu\n", seq); }
  else if (queueIfFail) queuePending(body);
  return acked;
}
int ackPercent() { return txTotal ? (int)((txAcked * 100UL) / txTotal) : 100; }

// Re-send ONE stored CRITICAL alert (fresh sequence number, original timestamp + age)
void flushOnePending(unsigned long nowMs) {
  String lines[MAX_PENDING];
  int n = readPending(lines);
  if (n == 0) return;
  int bar = lines[0].indexOf('|');
  if (bar < 0) { writePending(lines, 1, n); return; }
  unsigned long savedMs = (unsigned long)lines[0].substring(0, bar).toInt();
  JsonDocument d;
  if (deserializeJson(d, lines[0].substring(bar + 1))) { writePending(lines, 1, n); return; }
  unsigned long seq = ++seqCounter;
  d["q"] = seq;
  d["ag"] = (nowMs >= savedMs) ? (nowMs - savedMs) / 1000 : 0;
  String nb; serializeJson(d, nb);
  if (sendSigned(nb, seq, 1, "BACKLOG", false)) writePending(lines, 1, n);
}

// ----- Reading / alert packet (type "r") -----
void sendReading(const char* tag, bool live = false, const char* statusOverride = nullptr) {
  unsigned long nowMs = millis();
  String status = statusOverride ? String(statusOverride) : confirmedState;
  int sev = severityOf(status);
  if (!txAllowed(sev, live)) { Serial.println("[RATE LIMIT] non-critical packet skipped"); return; }

  bool humanNow = (humanConfirmedAt != 0 && nowMs - humanConfirmedAt < HUMAN_HOLD_MS);
  unsigned long seq = ++seqCounter;

  // Full data only for scheduled / clear / live GPS pursuit
  bool fullData = (strcmp(tag, "SCHEDULED") == 0 || strcmp(tag, "STATUS_CLEAR") == 0 ||
                   strcmp(tag, "LIVE_GPS_PURSUIT") == 0 || live);

  JsonDocument doc;
  doc["n"]  = NODE_ID;
  doc["y"]  = "r";
  doc["q"]  = seq;
  doc["st"] = status;
  doc["sv"] = sev;

  if (fullData) {
    // ===== FULL SENSOR PACKET (every ~1 minute & live GPS tracking) =====
    bool tamperFlag = (status == "POACHING_RISK" || status == "NIGHT_POACHING_RISK" ||
                       status == "CRITICAL_FALL" || status == "PLANT_STOLEN_MOVING" ||
                       status == "POSSIBLE_THEFT" || status == "TILT_ONLY" ||
                       status == "IMPACT_DETECTED" || status == "REPEATED_DISTURBANCE" ||
                       status == "GPS_SHIELDED_OR_JAMMED");
    bool motionFlag = (status == "POACHING_RISK" || status == "NIGHT_POACHING_RISK" ||
                       status == "WEATHER_STORM" || status == "PLANT_STOLEN_MOVING" ||
                       status == "POSSIBLE_THEFT" || status == "MOTION_ONLY" ||
                       status == "LOITERING" || status == "REPEATED_DISTURBANCE");
    doc["tp"] = tamperFlag;
    doc["mo"] = motionFlag;
    doc["md"] = motionDurationSec;
    doc["ti"] = round(currentTiltAngle * 10.0) / 10.0;
    doc["pt"] = round(plantTiltAngle * 10.0) / 10.0;
    doc["sm"] = soilMoisturePct;
    doc["rn"] = effectiveIsRaining;
    doc["hd"] = humanNow;
    doc["hw"] = healthCode;
    if (haveClimate && !isnan(currentTemp) && !isnan(currentHum)) {
      doc["tc"] = round(currentTemp * 10.0) / 10.0;
      doc["hu"] = round(currentHum * 10.0) / 10.0;
    }
    unsigned long ep = utcEpochNow(nowMs);
    if (ep) doc["ts"] = ep;
    if (gps.location.isValid() && gps.location.age() < 60000) {
      doc["la"] = gps.location.lat();
      doc["lo"] = gps.location.lng();
    }
  } else {
    // ===== ALERT-ONLY PACKET (only sensors that matter for this alert) =====
    doc["tp"] = true;

    if (status == "CRITICAL_FALL" || status == "TILT_ONLY") {
      doc["ti"] = round(currentTiltAngle * 10.0) / 10.0;
      doc["pt"] = round(plantTiltAngle * 10.0) / 10.0;
    }
    else if (status == "MOTION_ONLY" || status == "LOITERING") {
      doc["mo"] = true;
      doc["md"] = motionDurationSec;
    }
    else if (status == "IMPACT_DETECTED") {
      doc["mo"] = true;
      doc["ti"] = round(currentTiltAngle * 10.0) / 10.0;
      doc["pt"] = round(plantTiltAngle * 10.0) / 10.0;
    }
    else if (status == "REPEATED_DISTURBANCE") {
      doc["mo"] = true;
      doc["md"] = motionDurationSec;
      doc["ti"] = round(currentTiltAngle * 10.0) / 10.0;
    }
    else if (status == "POACHING_RISK" || status == "NIGHT_POACHING_RISK") {
      doc["mo"] = true;
      doc["md"] = motionDurationSec;
      doc["ti"] = round(currentTiltAngle * 10.0) / 10.0;
      doc["pt"] = round(plantTiltAngle * 10.0) / 10.0;
      doc["hd"] = humanNow;
    }
    else if (status == "WEATHER_STORM") {
      doc["mo"] = true;
      doc["ti"] = round(currentTiltAngle * 10.0) / 10.0;
      doc["rn"] = effectiveIsRaining;
      doc["sm"] = soilMoisturePct;
    }
    else if (status == "FIRE_OR_CANOPY_BREACH") {
      if (haveClimate && !isnan(currentTemp) && !isnan(currentHum)) {
        doc["tc"] = round(currentTemp * 10.0) / 10.0;
        doc["hu"] = round(currentHum * 10.0) / 10.0;
      }
    }
    else if (status == "POSSIBLE_THEFT" || status == "PLANT_STOLEN_MOVING" || status == "GPS_SHIELDED_OR_JAMMED") {
      doc["mo"] = true;
      doc["ti"] = round(currentTiltAngle * 10.0) / 10.0;
      doc["pt"] = round(plantTiltAngle * 10.0) / 10.0;
      if (gps.location.isValid() && gps.location.age() < 60000) {
        doc["la"] = gps.location.lat();
        doc["lo"] = gps.location.lng();
      }
    }
    else if (status == "MAINTENANCE_MODE") {
      // status + severity only
    }
    else {
      doc["ti"] = round(currentTiltAngle * 10.0) / 10.0;
      doc["mo"] = true;
    }

    unsigned long ep = utcEpochNow(nowMs);
    if (ep) doc["ts"] = ep;
  }

  String body;
  serializeJson(doc, body);
  const char* dropOrder[] = {"hu", "tc", "md", "ts", "pt"};
  for (int i = 0; i < 5 && (int)body.length() + 17 > MAX_PLAINTEXT; i++) {
    doc.remove(dropOrder[i]);
    body = ""; serializeJson(doc, body);
  }

  int attempts = (sev >= 2 && !live) ? CRITICAL_ATTEMPTS : 1;
  bool queue = (sev >= 2 && !live);
  sendSigned(body, seq, attempts, tag, queue);
}

// ----- Health packet (type "h") -----
void sendHealth(const char* tag) {
  unsigned long seq = ++seqCounter;
  JsonDocument doc;
  doc["n"]  = NODE_ID;
  doc["y"]  = "h";
  doc["q"]  = seq;
  doc["hw"] = healthCode;
  doc["up"] = millis() / 1000;
  doc["rs"] = resetReasonStr();
  doc["ak"] = ackPercent();
  doc["fw"] = FW_VERSION;
  if (selfTest.length()) { doc["ss"] = selfTest; selfTest = ""; }     // boot self-test, first packet only
  String body; serializeJson(doc, body);
  sendSigned(body, seq, 1, tag, false);
  lastSentHealth = healthCode;
  lastHealthSend = millis();
}

// ----- Daily summary packet (type "d") -----
void sendDaily() {
  unsigned long seq = ++seqCounter;
  JsonDocument doc;
  doc["n"] = NODE_ID;
  doc["y"] = "d";
  doc["q"] = seq;
  if (dailyHaveData) {
    doc["tn"] = round(dailyMinTemp * 10.0) / 10.0;
    doc["tx"] = round(dailyMaxTemp * 10.0) / 10.0;
    doc["hn"] = round(dailyMinHum * 10.0) / 10.0;
    doc["hx"] = round(dailyMaxHum * 10.0) / 10.0;
  }
  doc["rm"] = dailyRainSec / 60;                       // rain minutes
  JsonArray wa = doc["wa"].to<JsonArray>();            // wildlife (PIR) activity per local hour
  for (int i = 0; i < 24; i++) wa.add(pirHourly[i]);
  String body; serializeJson(doc, body);
  sendSigned(body, seq, 1, "DAILY_SUMMARY", false);

  dailyMinTemp = 999; dailyMaxTemp = -999; dailyMinHum = 999; dailyMaxHum = -999;
  dailyRainSec = 0; dailyHaveData = false;
  for (int i = 0; i < 24; i++) pirHourly[i] = 0;
  lastDailySend = millis();
}

// ============================================================================
// GPS: quality gating, averaged home anchor, geofence (3 confirmations)
// ============================================================================
bool gpsFresh() { return gps.location.isValid() && gps.location.age() < 5000; }
bool gpsQualityOk() {
  return gpsFresh() && gps.satellites.isValid() && gps.satellites.value() >= GPS_MIN_SATS &&
         gps.hdop.isValid() && gps.hdop.hdop() <= GPS_MAX_HDOP;
}
void updateGPSGeofence(unsigned long nowMs) {
  if (gpsFresh()) lastFixMs = nowMs;
  if (nowMs - lastGpsSample < 1000) return;            // sample once per second
  lastGpsSample = nowMs;
  if (!gpsQualityOk()) return;

  double lat = gps.location.lat(), lon = gps.location.lng();
  if (!homeLocationSet) {                              // learn home by averaging good fixes
    homeSumLat += lat; homeSumLon += lon; homeSamples++;
    if (homeSamples >= HOME_SAMPLES) {
      homeLat = homeSumLat / homeSamples;
      homeLon = homeSumLon / homeSamples;
      homeLocationSet = true;
      saveHome();
      Serial.printf("[GPS] Home anchor locked (avg of %d fixes) at %.6f, %.6f\n", homeSamples, homeLat, homeLon);
    }
    return;
  }
  distanceMovedMeters = TinyGPSPlus::distanceBetween(homeLat, homeLon, lat, lon);
  awayCount = (distanceMovedMeters > geofenceRadiusM) ? awayCount + 1 : 0;
}

// ============================================================================
// Event ring buffers
// ============================================================================
void registerImpact(unsigned long nowMs) { impactTimes[impactIdx] = nowMs; impactIdx = (impactIdx + 1) % IMPACT_COUNT; }
bool impactBurst(unsigned long nowMs) {
  int c = 0;
  for (int i = 0; i < IMPACT_COUNT; i++) if (impactTimes[i] != 0 && nowMs - impactTimes[i] <= IMPACT_WINDOW_MS) c++;
  return c >= IMPACT_COUNT;
}
void registerDisturbance(unsigned long nowMs) { disturbTimes[disturbIdx] = nowMs; disturbIdx = (disturbIdx + 1) % REPEAT_COUNT; }
bool repeatedDisturbance(unsigned long nowMs) {
  int c = 0;
  for (int i = 0; i < REPEAT_COUNT; i++) if (disturbTimes[i] != 0 && nowMs - disturbTimes[i] <= REPEAT_WINDOW_MS) c++;
  return c >= REPEAT_COUNT;
}

// ============================================================================
// Multi-Sensor Fusion & Smart Logic Engine
// ============================================================================
void evaluateSensorFusion(unsigned long nowMs) {
  if (maintenanceMode && (nowMs - maintenanceStartTime >= MAINTENANCE_DURATION)) {
    maintenanceMode = false;
    for (int i = 0; i < REPEAT_COUNT; i++) disturbTimes[i] = 0;
    Serial.println(">>> [MAINTENANCE AUTO-EXPIRED] 15 mins elapsed. Security alerts re-armed.");
  }

  // 1. Node (Box) Tilt + impact
  bool isNight = isNighttimeSarawak(nowMs);
  float activeTiltTrigger = isNight ? tiltNightTrigger : tiltDayTrigger;
  float activeTiltClear   = activeTiltTrigger * 0.66;
  float activePlantTiltTrigger = isNight ? plantTiltNightTrigger : plantTiltDayTrigger;
  float activePlantTiltClear   = activePlantTiltTrigger * 0.66;

  if (!mpuReady) {
    if (nowMs - lastMpuRetry > 30000) { lastMpuRetry = nowMs; if (mpuStart()) { mpuReady = true; Serial.println("[OK] Node MPU recovered."); } }
  } else {
    sensors_event_t a, g, temp;
    mpu.getEvent(&a, &g, &temp);
    float ax = a.acceleration.x, ay = a.acceleration.y, az = a.acceleration.z;
    if (ax != 0 || ay != 0 || az != 0) {
      mpuZeroCount = 0; mpuFault = false;
      float pitch, roll;
      getAngles(ax, ay, az, pitch, roll);
      float raw = max(abs(pitch - basePitch), abs(roll - baseRoll));
      tiltBuf[tiltIdx] = raw; tiltIdx = (tiltIdx + 1) % 5; if (tiltCount < 5) tiltCount++;
      float sum = 0; for (int i = 0; i < tiltCount; i++) sum += tiltBuf[i];
      currentTiltAngle = sum / tiltCount;

      float mag = sqrt(ax * ax + ay * ay + az * az);
      if (prevAccelMag > 0 && fabs(mag - prevAccelMag) > IMPACT_DELTA_MS2 &&
          (nowMs - lastImpactMs) > 150 && !maintenanceMode) {
        lastImpactMs = nowMs;
        registerImpact(nowMs);
      }
      prevAccelMag = mag;
    } else if (++mpuZeroCount >= 100) {
      mpuFault = true; mpuZeroCount = 0; mpuReady = mpuStart();
    }
  }
  bool impactActive = impactBurst(nowMs);
  prevImpactActive = impactActive;

  // 1b. Plant Tilt + shock
  if (!mpuPlantReady) {
    if (nowMs - lastMpuPlantRetry > 30000) {
      lastMpuPlantRetry = nowMs;
      if (mpuPlantStart()) { mpuPlantReady = true; Serial.println("[OK] Plant MPU recovered."); }
    }
  } else {
    sensors_event_t a, g, temp;
    mpuPlant.getEvent(&a, &g, &temp);
    float ax = a.acceleration.x, ay = a.acceleration.y, az = a.acceleration.z;
    if (ax != 0 || ay != 0 || az != 0) {
      mpuPlantZeroCount = 0; mpuPlantFault = false;
      float pitch, roll;
      getAngles(ax, ay, az, pitch, roll);
      float raw = max(abs(pitch - plantBasePitch), abs(roll - plantBaseRoll));
      plantTiltBuf[plantTiltIdx] = raw; plantTiltIdx = (plantTiltIdx + 1) % 5;
      if (plantTiltCount < 5) plantTiltCount++;
      float sum = 0; for (int i = 0; i < plantTiltCount; i++) sum += plantTiltBuf[i];
      plantTiltAngle = sum / plantTiltCount;

      float mag = sqrt(ax * ax + ay * ay + az * az);
      if (plantPrevAccelMag > 0 && fabs(mag - plantPrevAccelMag) > IMPACT_DELTA_MS2 &&
          (nowMs - plantLastImpactMs) > 150 && !maintenanceMode) {
        plantLastImpactMs = nowMs;
        plantImpactTimes[plantImpactIdx] = nowMs;
        plantImpactIdx = (plantImpactIdx + 1) % IMPACT_COUNT;
      }
      plantPrevAccelMag = mag;
    } else if (++mpuPlantZeroCount >= 100) {
      mpuPlantFault = true; mpuPlantZeroCount = 0; mpuPlantReady = mpuPlantStart();
    }
  }
  // Plant impact burst check
  int plantImpactCount = 0;
  for (int i = 0; i < IMPACT_COUNT; i++) {
    if (plantImpactTimes[i] != 0 && nowMs - plantImpactTimes[i] <= IMPACT_WINDOW_MS) plantImpactCount++;
  }
  plantImpactActive = (plantImpactCount >= IMPACT_COUNT);
  prevPlantImpactActive = plantImpactActive;

  // Node (box) tilt state
  if (currentTiltAngle >= CRITICAL_FALL_DEG) criticalFallLocked = true;
  if (currentTiltAngle >= activeTiltTrigger) {
    if (tiltAboveSince == 0) tiltAboveSince = nowMs;
    if (!isTilted && nowMs - tiltAboveSince >= TILT_PERSIST_MS) {
      isTilted = true;
    }
  } else {
    tiltAboveSince = 0;
    if (currentTiltAngle <= activeTiltClear) { isTilted = false; criticalFallLocked = false; }
  }

  // Plant tilt state
  if (plantTiltAngle >= activePlantTiltTrigger) {
    if (plantTiltAboveSince == 0) plantTiltAboveSince = nowMs;
    if (!plantIsTilted && nowMs - plantTiltAboveSince >= TILT_PERSIST_MS) {
      plantIsTilted = true;
    }
  } else {
    plantTiltAboveSince = 0;
    if (plantTiltAngle <= activePlantTiltClear) plantIsTilted = false;
  }

  // 2. PIR motion (after 20s warmup) + loitering + wildlife index
  bool pirActive = false;
  if (nowMs - bootTime >= PIR_WARMUP_MS) {
    pirActive = (digitalRead(PIR_PIN) == HIGH);
    if (pirActive) {
      if (motionStartTime == 0) {
        motionStartTime = nowMs;
        if (timeAvailable()) pirHourly[localHour(nowMs)]++;
      }
      motionDurationSec = (nowMs - motionStartTime) / 1000;
    } else {
      motionStartTime = 0;
      motionDurationSec = 0;
    }
  }
  bool loitering = pirActive && ((unsigned long)motionDurationSec >= loiterSec);

// ===== CAMERA TRIGGER LOGIC (PIR + Specific Physical Cause) =====
  static bool prevPir = false, prevNodeTilt = false, prevPlantTilt = false, prevAnyPhysical = false;
  bool anyPhysical = isTilted || plantIsTilted || impactActive || plantImpactActive;

  if (!maintenanceMode) {
    if (pirActive && anyPhysical && (!prevPir || !prevAnyPhysical)) {
      // Build exact cause string so Detector.py and Serial Monitor show which sensor triggered
      String cause = "PIR";
      if (isTilted)          cause += "+NODE_TILT";
      if (plantIsTilted)     cause += "+PLANT_TILT";
      if (impactActive)      cause += "+NODE_SHOCK";
      if (plantImpactActive) cause += "+PLANT_SHOCK";

      // Debug breakdown in Serial Monitor to catch which flag is stuck true at rest
      Serial.printf("[CAM_DEBUG] nodeTilt=%d plantTilt=%d nodeShock=%d plantShock=%d\n",
                    isTilted, plantIsTilted, impactActive, plantImpactActive);

      requestCamera(cause.c_str(), nowMs);
    }

    if (pirActive && !prevPir) registerDisturbance(nowMs);
    if ((isTilted && !prevNodeTilt) || (plantIsTilted && !prevPlantTilt)) registerDisturbance(nowMs);
  }
  prevPir = pirActive;
  prevNodeTilt = isTilted;
  prevPlantTilt = plantIsTilted;
  prevAnyPhysical = anyPhysical;

  bool repeated = repeatedDisturbance(nowMs);
  if (isTilted || plantIsTilted || pirActive) lastMovementMs = nowMs;

  // 3. Rain sensor + wet-leaf obstruction filter
  rawRainWet = (digitalRead(RAIN_PIN) == LOW);
  if (rawRainWet) {
    if (rainStartTime == 0) rainStartTime = nowMs;
    if ((nowMs - rainStartTime >= WET_LEAF_MAX_MS) && haveClimate && (currentHum < 80.0)) {
      rainSensorObstructed = true; effectiveIsRaining = false;
    } else {
      rainSensorObstructed = false; effectiveIsRaining = true;
    }
  } else {
    rainStartTime = 0; rainSensorObstructed = false; effectiveIsRaining = false;
  }

  // 4. Soil moisture + sensor checks
  soilRaw = analogRead(SOIL_PIN);
  soilMoisturePct = constrain(map(soilRaw, 4095, 1200, 0, 100), 0, 100);
  if (baselineSoilPct == -1) baselineSoilPct = soilMoisturePct;
  bool soilChanged = (abs(soilMoisturePct - baselineSoilPct) >= SOIL_CHANGE_THRESHOLD);
  if (soilRaw >= 4090) { if (soilMaxStart == 0) soilMaxStart = nowMs; } else soilMaxStart = 0;
  soilStuckMax = (soilMaxStart != 0 && nowMs - soilMaxStart >= SOIL_MAX_STUCK_MS);
  // waterlogging: soil at 100% for 6 h WITHOUT rain
  if (soilMoisturePct >= 99 && !effectiveIsRaining) { if (soilHighStart == 0) soilHighStart = nowMs; } else soilHighStart = 0;
  waterlogged = (soilHighStart != 0 && nowMs - soilHighStart >= WATERLOG_MS);

  // 5. Camera verdict + GPS shield detection
  bool humanSeen = (humanConfirmedAt != 0 && nowMs - humanConfirmedAt < HUMAN_HOLD_MS);

  bool fixLost = homeLocationSet && lastFixMs != 0 && (nowMs - lastFixMs > GPS_LOSS_CONFIRM_MS);
  bool movedAroundLoss = (lastMovementMs != 0) && (lastMovementMs + GPS_LOSS_LINK_MS >= lastFixMs) &&
                         (nowMs - lastMovementMs < 180000);
  if (!maintenanceMode && fixLost && movedAroundLoss) gpsShielded = true;
  if (gpsFresh()) {
    if (fixBackSince == 0) fixBackSince = nowMs;
    if (gpsShielded && nowMs - fixBackSince >= 60000) gpsShielded = false;
  } else fixBackSince = 0;

  // 6. Two-Tier Theft Detection:
  //    Stage 1 (POSSIBLE_THEFT): GPS > 15 m (3 fixes) + (Box tilt OR Plant tilt)
  //    Stage 2 (PLANT_STOLEN_MOVING - LATCHED): GPS > 15 m (3 fixes) + (Box/Plant tilt OR PIR) + Camera humanSeen
  bool anyTilt = isTilted || plantIsTilted;
  bool anyShock = impactActive || plantImpactActive;

  possibleTheftActive = (!maintenanceMode && homeLocationSet && awayCount >= AWAY_CONFIRM_COUNT && anyTilt);

  if (!maintenanceMode && homeLocationSet && awayCount >= AWAY_CONFIRM_COUNT &&
      (anyTilt || pirActive) && humanSeen) {
    setTheftLatch();
  }

  // 7. Priority decision tree
  String detectedState = "NORMAL";
  if (maintenanceMode) {
    detectedState = "MAINTENANCE_MODE";
  } else if (theftLatched) {
    detectedState = "PLANT_STOLEN_MOVING";
  } else if (criticalFallLocked) {
    detectedState = "CRITICAL_FALL";
  } else if (gpsShielded) {
    detectedState = "GPS_SHIELDED_OR_JAMMED";
  } else if (fireAnomalyActive) {
    detectedState = "FIRE_OR_CANOPY_BREACH";
  } else if (possibleTheftActive) {
    detectedState = "POSSIBLE_THEFT";
  } else if (humanSeen) {
    detectedState = isNight ? "NIGHT_POACHING_RISK" : "POACHING_RISK";
  } else if (anyShock && !effectiveIsRaining) {
    detectedState = "IMPACT_DETECTED";
  } else if (anyTilt && pirActive && (effectiveIsRaining || soilChanged)) {
    detectedState = "WEATHER_STORM";
  } else if (anyTilt && pirActive && !effectiveIsRaining && !soilChanged) {
    detectedState = isNight ? "NIGHT_POACHING_RISK" : "POACHING_RISK";
  } else if (loitering) {
    detectedState = "LOITERING";
  } else if (repeated) {
    detectedState = "REPEATED_DISTURBANCE";
  } else if (anyTilt) {
    detectedState = "TILT_ONLY";
  } else if (pirActive) {
    detectedState = "MOTION_ONLY";
  }
  if (detectedState != "NORMAL") lastActivityMs = nowMs;

  // 8. Debounce & instant LoRa alert ONLY on state change
  if (detectedState != pendingState) {
    pendingState = detectedState;
    pendingStateStart = nowMs;
  }
  if ((nowMs - pendingStateStart >= STATE_DEBOUNCE_MS) && (pendingState != confirmedState)) {
    confirmedState = pendingState;
    Serial.println("****************************************");

    if (confirmedState == "MAINTENANCE_MODE") {
      setAlertLed(false);
      Serial.println(">>> [MAINTENANCE MODE] Ranger inspection active. Security alerts paused.");
      sendReading("MAINT_START");
    }
    else if (confirmedState == "PLANT_STOLEN_MOVING") {
      setAlertLed(true);
      Serial.printf(">>> [EMERGENCY: PLANT STOLEN - LATCHED] Camera + GPS confirmed! Moved %.1f m! Live 5s LoRa GPS tracking ACTIVE until CLEAR_THEFT.\n", distanceMovedMeters);
      sendReading("EMERGENCY_STOLEN");
    }
    else if (confirmedState == "POSSIBLE_THEFT") {
      setAlertLed(true);
      Serial.printf(">>> [WARNING: POSSIBLE THEFT] GPS outside geofence (%.1f m) + Tilt detected! Live 5s LoRa GPS tracking ACTIVE.\n", distanceMovedMeters);
      sendReading("ALERT_POSSIBLE_THEFT");
    }
    else if (confirmedState == "CRITICAL_FALL") {
      setAlertLed(true);
      Serial.printf(">>> [CRITICAL HARDWARE ALERT] Box tilted nearly 90 deg (%.1f deg)!\n", currentTiltAngle);
      Serial.println("    ACTION NEEDED: Return box upright immediately, or sensors/cables risk damage!");
      sendReading("EMERGENCY_FALL");
    }
    else if (confirmedState == "GPS_SHIELDED_OR_JAMMED") {
      setAlertLed(true);
      Serial.println(">>> [CRITICAL] GPS fix lost right after movement - box may be in a bag, metal container or vehicle!");
      sendReading("EMERGENCY_GPS_SHIELD");
    }
    else if (confirmedState == "FIRE_OR_CANOPY_BREACH") {
      setAlertLed(true);
      Serial.println(">>> [ENVIRONMENTAL EMERGENCY] Rapid heat spike (+5C) & humidity drop (-15%) or extreme heat, confirmed twice!");
      sendReading("EMERGENCY_FIRE");
    }
    else if (confirmedState == "IMPACT_DETECTED") {
      setAlertLed(true);
      Serial.println(">>> [IMPACT ALERT] Repeated knocks/vibration - chopping, digging or hitting the box!");
      sendReading("ALERT_IMPACT");
    }
    else if (confirmedState == "WEATHER_STORM") {
      setAlertLed(false);
      Serial.printf(">>> [WEATHER EVENT] Natural disturbance (Tilt: %.1f deg + Motion + Rain/Soil).\n", currentTiltAngle);
      sendReading("WEATHER_LOG");
    }
    else if (confirmedState == "NIGHT_POACHING_RISK") {
      setAlertLed(true);
      Serial.printf(">>> [HIGH-URGENCY NIGHT POACHING ALERT] After-hours tampering (%.1f deg, camera/PIR confirmed)!\n", currentTiltAngle);
      sendReading("EMERGENCY_NIGHT_POACH");
    }
    else if (confirmedState == "POACHING_RISK") {
      setAlertLed(true);
      Serial.printf(">>> [POACHING ALERT] Possible poachers detected (Tilt: %.1f deg, camera/PIR confirmed)!\n", currentTiltAngle);
      sendReading("ALERT_POACH");
    }
    else if (confirmedState == "LOITERING") {
      setAlertLed(true);
      Serial.printf(">>> [LOITERING] Continuous movement near plant for %d s - likely a person.\n", motionDurationSec);
      sendReading("ALERT_LOITER");
    }
    else if (confirmedState == "REPEATED_DISTURBANCE") {
      setAlertLed(true);
      Serial.println(">>> [REPEATED DISTURBANCE] Several motion/tilt events in 10 minutes - someone keeps returning.");
      sendReading("ALERT_REPEATED");
    }
    else if (confirmedState == "TILT_ONLY") {
      setAlertLed(true);
      Serial.printf(">>> [NOTICE] Plant/Box tilted (%.1f deg) without nearby PIR motion.\n", currentTiltAngle);
    }
    else if (confirmedState == "MOTION_ONLY") {
      setAlertLed(true);
      Serial.println(">>> [NOTICE] PIR motion detected near plant (no physical tilt - likely wildlife).");
    }
    else if (confirmedState == "NORMAL") {
      setAlertLed(false);
      baselineSoilPct = soilMoisturePct;
      Serial.printf(">>> [STATUS NORMAL] All sensors settled and upright (Angle: %.1f deg).\n", currentTiltAngle);
      sendReading("STATUS_CLEAR");
    }
    Serial.println("****************************************");
  }

  // 9. Hourly silent soil baseline refresh (only when NORMAL)
  if (confirmedState == "NORMAL" && (nowMs - lastBaselineRefresh >= BASELINE_REFRESH_MS)) {
    lastBaselineRefresh = nowMs;
    baselineSoilPct = soilMoisturePct;
  }
}

// ============================================================================
// Scheduled 1-minute report: climate, two-step fire logic, health, daily, TX
// ============================================================================
unsigned long currentTxInterval(unsigned long nowMs) {
  return NORMAL_TX_INTERVAL_MS;
}

void evaluateHealth(unsigned long nowMs) {
  if (dhtFailCount >= 3)                                   healthCode = "DHT";
  else if (!mpuReady || mpuFault)                          healthCode = "MPU";
  else if (sensorsFrozen)                                  healthCode = "FRZ";
  else if (rainSensorObstructed)                           healthCode = "WET_LEAF";
  else if (fireAnomalyActive)                              healthCode = "FIRE";
  else if (haveClimate && currentTemp > HEAT_STRESS_LIMIT) healthCode = "HEAT";
  else if (soilStuckMax)                                   healthCode = "SOIL";
  else if (waterlogged)                                    healthCode = "WLOG";
  else if (soilMoisturePct < DROUGHT_SOIL_LIMIT && !effectiveIsRaining) healthCode = "DRY";
  else                                                     healthCode = "OK";
}

void readAndTransmitScheduled(unsigned long nowMs) {
  float h = dht.readHumidity();
  float t = dht.readTemperature();

  if (!isnan(h) && !isnan(t)) {
    currentTemp = t; currentHum = h; haveClimate = true; dhtFailCount = 0;

    // daily statistics
    dailyHaveData = true;
    if (t < dailyMinTemp) dailyMinTemp = t;
    if (t > dailyMaxTemp) dailyMaxTemp = t;
    if (h < dailyMinHum) dailyMinHum = h;
    if (h > dailyMaxHum) dailyMaxHum = h;

    // frozen-sensor check (identical temp+humidity for 12 h)
    if (t == lastT && h == lastH) { if (thFrozenSince == 0) thFrozenSince = nowMs; }
    else { thFrozenSince = 0; lastT = t; lastH = h; }

    // Fire logic #1: +5C and -15% versus 10 samples ago, dry, confirmed on 2 reads in a row
    if (hCount >= HIST_N) {
      float oldT = tHist[hIdx], oldH = hHist[hIdx];
      bool rate = (!effectiveIsRaining && (t - oldT) >= FIRE_TEMP_JUMP && (oldH - h) >= FIRE_HUM_DROP);
      fireRateCount = rate ? fireRateCount + 1 : 0;
    }
    tHist[hIdx] = t; hHist[hIdx] = h; hIdx = (hIdx + 1) % HIST_N; if (hCount < HIST_N) hCount++;
    // Fire logic #2: absolute heat (> 40 C, dry air), also confirmed on 2 reads in a row
    bool absHot = (t > FIRE_ABS_TEMP && h <= FIRE_ABS_HUM && !effectiveIsRaining);
    fireAbsCount = absHot ? fireAbsCount + 1 : 0;
    fireAnomalyActive = (fireRateCount >= 2) || (fireAbsCount >= 2);
  } else {
    dhtFailCount++;
    haveClimate = false;
    Serial.println("[WARNING] DHT11 read failed on D19 (will omit temp/hum from LoRa packet)");
  }
  if (effectiveIsRaining) dailyRainSec += ENV_TRANSMIT_INTERVAL / 1000;

  // soil frozen check (same raw value every 1 min for 12 h, excluding the "maximum" case)
  if (soilRaw == lastSoilSample && soilRaw < 4090) { if (soilFrozenSince == 0) soilFrozenSince = nowMs; }
  else { soilFrozenSince = 0; lastSoilSample = soilRaw; }
  sensorsFrozen = (thFrozenSince != 0 && nowMs - thFrozenSince >= FROZEN_MS) ||
                  (soilFrozenSince != 0 && nowMs - soilFrozenSince >= FROZEN_MS);

  evaluateHealth(nowMs);

  Serial.println("========================================");
  Serial.printf("[1min SCHEDULED REPORT | %s MODE%s]\n", isNighttimeSarawak(nowMs) ? "NIGHT" : "DAY",
                (timeKnown ? "" : (storedSecValid ? ", time approx" : ", no time")));
  Serial.printf("Temperature: %.1f C | Humidity: %.1f%% | Soil Moisture: %d%% | Raining: %s\n",
                currentTemp, currentHum, soilMoisturePct, effectiveIsRaining ? "YES" : "NO");
  Serial.printf("Security State: %s (Severity %d) | Box Tilt: %.1f deg | Plant Tilt: %.1f deg\n",
                confirmedState.c_str(), severityOf(confirmedState),
                currentTiltAngle, plantTiltAngle);
  Serial.printf("System Health: %s (%s)\n", healthCode.c_str(), healthDescription(healthCode));
  Serial.printf("GPS Fix: %s (Satellites: %d | HDOP: %.1f | Drift: %.1f m | Home: %s) | Gateway ACK Rate: %d%%\n",
                gps.location.isValid() ? "YES" : "NO", gps.satellites.value(),
                gps.hdop.isValid() ? gps.hdop.hdop() : 99.9, distanceMovedMeters,
                homeLocationSet ? "SET" : "LEARNING", ackPercent());
  bool humanNow = (humanConfirmedAt != 0 && nowMs - humanConfirmedAt < HUMAN_HOLD_MS);
  Serial.printf("Camera Human Detected: %s\n", humanNow ? "YES" : "NO");

  if (nowMs - bootTime >= PIR_WARMUP_MS) {
    bool sentOk = false;
    if (nowMs - lastScheduledTx + 2000 >= currentTxInterval(nowMs)) {
      lastScheduledTx = nowMs;
      sendReading("SCHEDULED");
      sentOk = true;
    }
    if (needBootHealth || healthCode != lastSentHealth || (nowMs - lastHealthSend >= HEALTH_INTERVAL_MS)) {
      needBootHealth = false;
      sendHealth("HEALTH");
    }
    if (nowMs - lastDailySend >= DAILY_INTERVAL_MS) sendDaily();
    // link is up (we just got ACKs)? then forward one stored CRITICAL alert
    if (sentOk && ackPercent() > 0) flushOnePending(nowMs);
  }
  Serial.println("========================================");
}

// ============================================================================
// Main Setup & Loop
// ============================================================================
void setup() {
  Serial.begin(115200);
  delay(1000);

  pinMode(PIR_PIN, INPUT);
  pinMode(RAIN_PIN, INPUT);
  pinMode(LED_PIN, OUTPUT);
  setAlertLed(false);

  Serial.println("\n****************************************");
  Serial.println("  FOREST NODE " FW_VERSION);
  Serial.printf("  Reset reason: %s\n", resetReasonStr());
  Serial.println("****************************************");

  // Flash settings + boot counter (sequence numbers keep increasing across reboots)
  prefs.begin("niah", false);
  uint32_t bootCount = (prefs.getUInt("boot", 0) + 1) & 0xFFF;
  prefs.putUInt("boot", bootCount);
  seqCounter = ((unsigned long)bootCount) << 20;
  loadSettings();
  initCrypto();
  if (theftLatched) Serial.println("[!] Theft latch restored from flash - plant is still flagged STOLEN until CLEAR_THEFT.");

  initFlashStorage();
  dht.begin();
  initMPU();
  Serial2.begin(9600, SERIAL_8N1, GPS_RX_PIN, GPS_TX_PIN);

  // Initialize LoRa Radio (433 MHz)
  SPI.begin(LORA_SCK, LORA_MISO, LORA_MOSI, LORA_SS);
  LoRa.setPins(LORA_SS, LORA_RST, LORA_DIO0);
  if (!LoRa.begin(LORA_FREQ)) {
    Serial.println("[ERROR] Starting LoRa Forest Node failed! Check SPI wiring (SCK=26, MISO=35, MOSI=25, SS=27, RST=22, DIO0=23).");
    while (1);
  }
  LoRa.setSyncWord(LORA_SYNC_WORD);
  LoRa.enableCrc();
  Serial.printf("[OK] LoRa Forest Node (%s) initialized at 433 MHz! Boot #%u\n", NODE_ID, bootCount);

  // Boot self-test summary (sent once inside the first health packet)
  float tt = dht.readTemperature();
  selfTest = String(mpuReady ? "MPU " : "!MPU ") + String(!isnan(tt) ? "DHT " : "!DHT ") + "LORA FS";

  bootTime = millis();
  lastBaselineRefresh = bootTime;
  lastDailySend = bootTime;
  lastHealthSend = bootTime;
  Serial.println("PIR warming up for 20s... Type 'MAINT' for 15-min Maintenance Mode, 'CLEAR' to reset a latched theft alert, 'CALIBRATE' to re-zero tilt.");

  initWatchdog();
}

void loop() {
  esp_task_wdt_reset();
  unsigned long nowMs = millis();

  while (Serial2.available()) gps.encode(Serial2.read());
  updateTimeSync(nowMs);
  checkSerialCommands(nowMs);
  updateGPSGeofence(nowMs);

  // 1. Multi-sensor fusion & instant LoRa alerts on state change
  evaluateSensorFusion(nowMs);

  // 2. Live 5-second GPS pursuit (active for BOTH POSSIBLE_THEFT and PLANT_STOLEN_MOVING)
  if ((confirmedState == "PLANT_STOLEN_MOVING" || confirmedState == "POSSIBLE_THEFT") &&
      (nowMs - lastLiveTrackTime >= LIVE_TRACK_INTERVAL)) {
    lastLiveTrackTime = nowMs;
    sendReading("LIVE_GPS_PURSUIT", true);
  }

  // 3. Scheduled 1-minute environmental report & adaptive LoRa transmission
  if (nowMs - lastEnvTransmitTime >= ENV_TRANSMIT_INTERVAL) {
    lastEnvTransmitTime = nowMs;
    readAndTransmitScheduled(nowMs);
  }

  delay(50);
}