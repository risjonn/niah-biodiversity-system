================================================================================
NIAH NATIONAL PARK SMART IOT PLANT PROTECTION SYSTEM
LOGIC + SERIAL OUTPUT GUIDE (Forest Node + Gateway)
================================================================================
Updated: dual MPU, camera rules, 1-minute data, immediate alerts, impact detail

================================================================================

1. # FOREST NODE (Sensor Node in the forest)

The Forest Node runs 100% offline. It reads sensors, runs security logic,
and sends encrypted packets over LoRa (433 MHz) to the Gateway.

## A. Sensors – Who owns what

• Node (Box) MPU6050 SDA=D21, SCL=D22 → Box tilt / fall / shock
• Plant MPU6050 SDA=D32, SCL=D33 → Plant tilt / shock only
• GPS (NEO-6M) → Belongs to the NODE (box) only
Used for home location, movement, theft tracking
• PIR, Rain, Soil, DHT → Shared environmental / security sensors

## B. Separate tilt thresholds

Node (box) day tilt = 15° (remote key "td")
Node (box) night tilt = 8° (remote key "tn")
Plant day tilt = 12° (remote key "pd")
Plant night tilt = 6° (remote key "pn")
Critical fall (box) ≥ 75°

## C. Impact / Shock detection (both accelerometers)

Sensor source : Node (box) MPU and Plant MPU
What is measured : Sudden change in total acceleration
Threshold : IMPACT_DELTA_MS2 = 3.0
Burst rule : 3 strong impacts within 10 seconds
Resulting state : IMPACT_DETECTED (WARNING)
Rain behaviour : Impact alert is NOT raised while it is raining
Camera : Impact (box or plant) counts as "physical" evidence
and can help turn the camera ON when combined with PIR

Example serial message:

> > > [IMPACT ALERT] Repeated knocks/vibration - chopping, digging or hitting the box!

## D. Camera trigger rules (latest)

Camera turns ON only when:

1. PIR = true AND (Node tilt OR Plant tilt OR any shock/impact) = true
2. Node (box) tilt rising edge

Camera stays OFF when:

• Only plant tilt + no rain + soil moisture normal
• Pure PIR only (no physical movement)

## E. Priority decision tree (highest → lowest)

1. MAINTENANCE_MODE
2. PLANT_STOLEN_MOVING CRITICAL (GPS of the BOX moved >15 m + box tilt or PIR)
3. CRITICAL_FALL CRITICAL (Box tilt ≥ 75°)
4. GPS_SHIELDED_OR_JAMMED CRITICAL (GPS lost right after box movement)
5. FIRE_OR_CANOPY_BREACH CRITICAL
6. TAMPER_LID_OPENED CRITICAL
7. Human detected by camera POACHING_RISK / NIGHT_POACHING_RISK
8. Impact / Shock (box or plant) IMPACT_DETECTED (WARNING)
9. Tilt + PIR + Rain/Soil WEATHER_STORM (INFO)
10. Tilt + PIR (dry) POACHING_RISK / NIGHT_POACHING_RISK
11. Continuous PIR > 120 s LOITERING (WARNING)
12. 3 disturbances in 10 min REPEATED_DISTURBANCE (WARNING)
13. Only tilt TILT_ONLY (INFO)
14. Only PIR MOTION_ONLY (INFO)
15. Nothing NORMAL

## F. When does the Forest Node send a packet?

• Normal sensor data → every 1 minute only
• Any security alert → IMMEDIATELY (on state change)
• Plant stolen (live GPS) → every 5 seconds
• Health packet → every 5 minutes or on health change
• Daily summary → once per day

## G. Example Forest Node Serial Output

# Normal 1-minute data:

[30s SCHEDULED REPORT | DAY MODE]
Temp: 23.2 C | Hum: 63.0% | Soil: 45% | Rain: NO
Security: NORMAL (sev 0) | NodeTilt: 2.5 | PlantTilt: 1.8 | Health: OK
GPS Fix: YES (Sats: 7 | HDOP: 1.2 | Drift: 1.5 m | home set) | Gateway ACK rate: 100%
Camera: human = NO
========================================

Impact alert:

---

> > > [IMPACT ALERT] Repeated knocks/vibration - chopping, digging or hitting the box!

---

Human confirmed:

---

> > > [POACHING ALERT] Possible poachers detected (Tilt: 4.2 deg, camera/PIR confirmed)!

---

Box almost fallen:

---

> > > [CRITICAL HARDWARE ALERT] Box tilted nearly 90 deg (82.3 deg)!

    ACTION NEEDED: Return box upright immediately...

---

Plant stolen (GPS of the box):

---

> > > [EMERGENCY: PLANT STOLEN - LATCHED] Moved 18.4 m! Live 5s LoRa GPS tracking ACTIVE until CLEAR_THEFT.

---

# ================================================================================ 2. GATEWAY NODE (Park HQ Receiver)

The Gateway decrypts LoRa packets, verifies signature, sends ACK,
and shows clean human-readable output.

## A. Clean Gateway Serial Output

Idle:
waiting......
waiting......

# Normal reading (every ~1 minute):

## RECEIVE | NODE-01 | seq 42 | RSSI -47 dBm

{
"node": "NODE-01",
"status": "NORMAL",
"severity": "INFO",
"health": "OK",
"temperature": 23.2,
"humidity": 63,
"soil": 45,
"rain": false,
"tilt_deg": 2.5,
"motion": false,
"motion_sec": 0,
"human": false
}
========================================

WARNING alert (example IMPACT or POACHING):

---

\***\*\*\*\*\*** WARNING ALERT \***\*\*\*\*\***

---

Node : NODE-01
Alert : IMPACT_DETECTED
Tilt : 3.7 deg
Motion : YES
Human : NO

---

CRITICAL alert:
!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
!!!!!!!!!! CRITICAL ALERT !!!!!!!!!!
!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
Node : NODE-01
Alert : CRITICAL_FALL
Tilt : 82.3 deg
Motion : YES
Human : NO
GPS : 1.234567, 110.123456
RSSI/SNR : -47 dBm / 9.5 dB
!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!

Node offline (only after true 3 minutes of silence, printed once):
!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
NODE_OFFLINE : NODE-01
Silent for 185 seconds (threshold = 180 s)
!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!

## B. Offline behaviour

• While packets arrive → only shows "waiting......"
• After a full 3 minutes with no packet → prints NODE_OFFLINE once
• Does not keep repeating the offline message
• When node returns → prints "NODE ONLINE again" once

# ================================================================================ 3. ALERT SUMMARY – What is sent IMMEDIATELY

CRITICAL (send to admin / ranger as soon as possible)
• PLANT_STOLEN_MOVING (GPS of the BOX)
• CRITICAL_FALL (box ≥ 75°)
• GPS_SHIELDED_OR_JAMMED
• FIRE_OR_CANOPY_BREACH
• TAMPER_LID_OPENED
• NIGHT_POACHING_RISK

WARNING
• POACHING_RISK (daytime)
• IMPACT_DETECTED (3 strong knocks in 10 s on box or plant)
• LOITERING
• REPEATED_DISTURBANCE

INFO (not urgent – goes with normal 1-minute data)
• WEATHER_STORM
• TILT_ONLY
• MOTION_ONLY
• NORMAL

# ================================================================================ 4. IMPORTANT DISTINCTIONS

GPS / Theft
→ Uses only the NODE (box) GPS + box tilt + PIR
→ Plant accelerometer is NEVER used for theft or geofence

Plant accelerometer
→ Only for plant tilt / shock
→ Helps decide whether to turn the camera on
→ Does not control GPS or theft latch

Impact / Shock
→ Detected on BOTH Node MPU and Plant MPU
→ 3 strong impacts within 10 seconds → IMPACT_DETECTED
→ Not raised as alert while raining

Normal data vs Alert
→ Normal environmental data = every 1 minute
→ Any alert state change = immediate packet
→ Stolen = live GPS every 5 seconds

# ================================================================================ 5. COMMON QUESTIONS & ANSWERS

Q: Why does only PIR not turn the camera on?
A: New rule requires PIR + physical evidence (tilt or shock) from node or plant.

Q: When does pure plant movement turn the camera on?
A: Only if it is raining or soil moisture is abnormal.
Under dry + normal soil, pure plant movement is ignored.

Q: How does impact detection work?
A: Both accelerometers watch for sudden acceleration spikes.
If 3 strong impacts occur within 10 seconds → IMPACT_DETECTED (WARNING).
Impact is ignored while it is raining.

Q: Is GPS for the plant?
A: No. GPS belongs to the NODE (box) only.

Q: How often is normal data sent?
A: Every 1 minute.

Q: How fast are alerts sent?
A: Immediately when the state changes.

Q: How do I calibrate both accelerometers?
A: On Forest Node serial type: CALIBRATE
(Box and plant must both be in normal upright position)

Q: How do I change tilt sensitivity?
A: From Gateway (or later remote):
SET td 12 → Node day tilt
SET tn 7 → Node night tilt
SET pd 10 → Plant day tilt
SET pn 5 → Plant night tilt

Q: Cloud / database not uploading?
A: Correct. CLOUD_ENABLED is currently false while testing LoRa + logic.

# ================================================================================ 6. QUICK SERIAL COMMANDS

Forest Node (USB):
MAINT → toggle 15-min maintenance mode
CLEAR → clear theft latch
CALIBRATE → re-zero both accelerometers
HUMAN_DETECTED / NO_HUMAN → from PC camera program

Gateway (USB):
MAINT_ON / MAINT_OFF
CLEAR_THEFT
CALIBRATE
SET td 12 / SET pd 10 / ...
STATUS

================================================================================
END OF GUIDE
================================================================================
