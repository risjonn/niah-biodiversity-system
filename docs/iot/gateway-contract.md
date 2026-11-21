================================================================================
NIAH – GATEWAY → DATABASE CONTRACT
Answers for UI / Database team
================================================================================
Gateway name : GATEWAY-1 (one gateway can handle multiple nodes)
Forest Node : NODE-01 (only one node for now)

================================================================================

1. # EXAMPLE JSON THE GATEWAY WILL POST TO ingest-reading

## A. Normal reading (no alert)

{
"node_identifier": "NODE-01",
"temperature": 23.2,
"humidity": 63,
"motion_detected": false,
"motion_duration_seconds": 0,
"recorded_at": "2026-11-20T14:05:12Z"
}

## B. Reading that has an alert (when SEND_EXTRA_FIELDS = true)

{
"node_identifier": "NODE-01",
"temperature": 23.2,
"humidity": 63,
"motion_detected": true,
"motion_duration_seconds": 12,
"latitude": 3.812345,
"longitude": 113.776543,
"recorded_at": "2026-11-20T14:05:12Z",
"tamper_detected": false,
"tilt_angle": 4.2,
"soil_moisture": 45,
"is_raining": false,
"alert_status": "POACHING_RISK"
}

## Example with IMPACT alert:

{
"node_identifier": "NODE-01",
"temperature": 23.2,
"humidity": 63,
"motion_detected": true,
"motion_duration_seconds": 0,
"recorded_at": "2026-11-20T14:05:12Z",
"tamper_detected": false,
"tilt_angle": 2.1,
"soil_moisture": 45,
"is_raining": false,
"alert_status": "IMPACT_DETECTED"
}

Current status:
• SEND_EXTRA_FIELDS is still false → only basic fields are sent.
• When database is ready, we flip SEND_EXTRA_FIELDS = true and the extra
fields (tilt_angle, soil_moisture, is_raining, alert_status, etc.) will start.

# ================================================================================ 2. FULL LIST OF ALERT CODES

Alert Code Meaning (one line) Severity

---

NORMAL Everything settled, no issue INFO
MOTION_ONLY Only PIR triggered (likely wildlife) INFO
TILT_ONLY Only box/plant tilted, no PIR INFO
WEATHER_STORM Tilt + PIR + rain or soil change (natural) INFO
MAINTENANCE_MODE Ranger maintenance active INFO
POACHING_RISK Suspicious activity (tilt+PIR dry, or human daytime) WARNING
IMPACT_DETECTED 3 strong knocks/vibration in 10 s on box or plant WARNING
LOITERING Continuous PIR for ≥ 120 seconds WARNING
REPEATED_DISTURBANCE Several motion/tilt events in 10 minutes WARNING
NIGHT_POACHING_RISK Same as poaching but at night (more serious) CRITICAL
CRITICAL_FALL Box tilted ≥ 75° (almost fallen) CRITICAL
PLANT_STOLEN_MOVING GPS of the BOX moved > 15 m + box tilt or PIR CRITICAL
GPS_SHIELDED_OR_JAMMED GPS lost right after movement (bag/vehicle) CRITICAL
FIRE_OR_CANOPY_BREACH Rapid heat rise + humidity drop, or extreme heat CRITICAL
TAMPER_LID_OPENED Enclosure lid opened CRITICAL
POWER_LOSS Battery critically low (last-gasp) CRITICAL

# ================================================================================ 3. BATTERY

Will not be implemented.
battery_level is not sent by the node or gateway.

# ================================================================================ 4. UNITS + human_detected + IMPACT LOGIC

## Units

• tilt_angle → degrees (°)
• plant_tilt_angle → degrees (°) (when we start sending it)
• rssi → dBm (Gateway radio, not yet in cloud JSON)
• temperature → °C
• humidity → %
• soil_moisture → % (0–100)

## human_detected – how it works

The field is based on the real YOLO camera on the PC connected to the Forest Node.

Camera turn-on logic (Forest Node):
Camera turns ON only when: 1. PIR = true AND (Node tilt OR Plant tilt OR any shock/impact) = true 2. OR Node (box) tilt rising edge

Camera stays OFF when:
• Only plant tilt + no rain + soil moisture normal
• Pure PIR only (no physical movement)

After the camera is triggered:
• PC runs YOLO and replies HUMAN_DETECTED or NO_HUMAN over USB serial.
• If HUMAN_DETECTED → Forest Node sets human flag and can raise
POACHING_RISK / NIGHT_POACHING_RISK.
• The compact LoRa field is "hd" (true/false).
• When SEND_EXTRA_FIELDS is enabled, Gateway can expand it to
"human_detected": true/false in the JSON posted to the database.

So human_detected is REAL (from camera), not planned/fake.

## IMPACT_DETECTED – how it works

• Detected on BOTH accelerometers (Node box MPU and Plant MPU).
• Measures sudden change in total acceleration (threshold = 3.0).
• Rule: 3 strong impacts within 10 seconds → state = IMPACT_DETECTED.
• Severity: WARNING.
• While raining, impact alert is not raised.
• Impact counts as "physical" evidence and can help turn the camera ON
when combined with PIR.
• alert_status value sent to database: "IMPACT_DETECTED"

# ================================================================================ 5. NODE & GATEWAY NAMES TO REGISTER

Forest Node → register as: NODE-01
Gateway → register as: GATEWAY-1

(One gateway can handle multiple nodes later. For now only NODE-01 is used.)

# ================================================================================ 6. NOTES FOR DATABASE TEAM

• is_online and last_seen_at → you will derive from the time of the last packet.
No need for us to send these fields.

• alert_status string values are exactly the codes listed in section 2
(e.g. "POACHING_RISK", "CRITICAL_FALL", "IMPACT_DETECTED", "NORMAL").

• When you are ready for the extra fields, tell us and we will set
SEND_EXTRA_FIELDS = true on the Gateway.

================================================================================
END
================================================================================
