import serial
import serial.tools.list_ports
import time
import cv2
from ultralytics import YOLO

# None = find the ESP32 automatically. Or set a fixed port, e.g. "COM3".
ESP32_PORT = None
USB_HINTS = ("cp210", "ch340", "ch910", "usb serial", "silicon labs", "usb-serial")

CAM_WINDOW_S = 10   # keep below CAM_COOLDOWN_MS (15s) in the sketch
CONF = 0.45

print("Loading YOLO...")
brain = YOLO("yolo11s.pt")


def find_port():
    ports = serial.tools.list_ports.comports()
    if ESP32_PORT:
        return ESP32_PORT if any(p.device == ESP32_PORT for p in ports) else None
    for p in ports:
        text = f"{p.description} {p.manufacturer}".lower()
        if any(h in text for h in USB_HINTS):
            return p.device
    return None


def connect():
    print("Waiting for ESP32 to be plugged in...")
    while True:
        port = find_port()
        if port:
            try:
                s = serial.Serial(port, 115200, timeout=1)
                time.sleep(2)               # opening the port resets the ESP32
                s.reset_input_buffer()
                print(f"Connected to ESP32 on {port}. (PIR needs ~20s warmup)")
                return s
            except serial.SerialException:
                pass                        # port busy, e.g. Arduino Serial Monitor is open
        time.sleep(2)


def run_camera(source):
    camera = cv2.VideoCapture(0)
    if not camera.isOpened():
        print("!!! Camera failed to open")
        return

    start = time.time()
    human_confirmed = False
    try:
        while time.time() - start < CAM_WINDOW_S:
            ok, frame = camera.read()
            if not ok:
                break

            results = brain(frame, classes=[0], conf=CONF, verbose=False)

            if len(results[0].boxes) > 0 and not human_confirmed:
                human_confirmed = True
                print(f">>> HUMAN CONFIRMED (trigger: {source})")
                esp32.write(f"HUMAN_DETECTED:{source}\n".encode())

            count = len(results[0].boxes)
            shown = results[0].plot()
            label = f"HUMAN: YES ({count})" if count > 0 else "HUMAN: NO"
            color = (0, 0, 255) if count > 0 else (0, 200, 0)
            cv2.putText(shown, label, (10, 35), cv2.FONT_HERSHEY_SIMPLEX, 1.0, color, 2)
            cv2.imshow(f"Jungle Cam (trigger: {source})", shown)
            if cv2.waitKey(1) & 0xFF == ord('q'):
                break
    finally:
        camera.release()
        cv2.destroyAllWindows()

    print(f">>> RESULT: human = {'YES' if human_confirmed else 'NO'} (trigger: {source})")
    if not human_confirmed:
        esp32.write(b"NO_HUMAN\n")

    # Drop anything that queued while the camera loop was blocking,
    # otherwise stale triggers re-wake the camera immediately.
    esp32.reset_input_buffer()


esp32 = None
while True:
    if esp32 is None:
        esp32 = connect()

    try:
        line = esp32.readline().decode("utf-8", errors="ignore").strip()
        if not line:
            continue
        print(f"[ESP32]: {line}")

        if line.startswith("TRIGGER_CAM"):
            source = line.split(":", 1)[1] if ":" in line else "UNKNOWN"
            print(f">>> Waking camera ({source})...")
            run_camera(source)
            print("Camera sleeping again.")

    except (serial.SerialException, OSError):
        print("ESP32 unplugged. Waiting for it to come back...")
        try:
            esp32.close()
        except Exception:
            pass
        esp32 = None
