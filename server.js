#include <WiFi.h>
#include <WiFiManager.h>
#include <WebServer.h>
#include <Preferences.h>
#include <time.h>
#include <PubSubClient.h>

// =====================================================
// PIN LED
// =====================================================
#define LED_MERAH 25
#define LED_BIRU  26
#define LED_HIJAU 27

// =====================================================
// PIN BTS7960
// =====================================================
#define RPWM 33
#define LPWM 32
#define R_EN 22
#define L_EN 23

// =====================================================
// WEB SERVER
// =====================================================
WebServer server(80);

// =====================================================
// RABBITMQ / MQTT
// =====================================================
// RabbitMQ MQTT listener: 195.35.23.135:1883
// Pastikan plugin MQTT RabbitMQ aktif dan listener 1883 tersedia.
// Untuk produksi gunakan TLS/8883 dan kredensial khusus perangkat.
const char* MQTT_HOST = "195.35.23.135";
const uint16_t MQTT_PORT = 1883;
const char* MQTT_USER = "mhs_kuliah";
const char* MQTT_PASSWORD = "ISI_PASSWORD_RMQ_DI_SINI";
const char* FEEDER_ID = "FEEDER-001";

const char* MQTT_COMMAND_TOPIC = "feeder/FEEDER-001/command";
const char* MQTT_STATUS_TOPIC  = "feeder/FEEDER-001/status";

WiFiClient mqttWifiClient;
PubSubClient mqttClient(mqttWifiClient);
unsigned long mqttLastReconnectAttempt = 0;

// =====================================================
// PREFERENCES
// =====================================================
Preferences preferences;

// =====================================================
// PENGATURAN MANUAL
// =====================================================
int kecepatan = 50;
int durasi = 10; // total durasi dalam detik
int durasiJeda = 60; // jeda antar segmen dalam detik

// =====================================================
// STATUS MOTOR
// =====================================================
bool motorAktif = false;

// Motor bekerja maksimal 10 detik per segmen, kemudian jeda sesuai pengaturan.
const unsigned long BATAS_KERJA_MS = 10UL * 1000UL;
unsigned long waktuJedaMs() { return (unsigned long)durasiJeda * 1000UL; }
const int MAX_DURASI_DETIK = 60 * 60; // maksimal 60 menit

bool motorJeda = false;
unsigned long waktuMulai = 0;
unsigned long waktuMulaiJeda = 0;
unsigned long totalDurasiMotor = 0;
unsigned long waktuMotorBerjalan = 0;
int motorSpeedAktif = 50;

// =====================================================
// JADWAL
// =====================================================
#define JUMLAH_JADWAL 3

bool jadwalAktif[JUMLAH_JADWAL];

int jadwalJam[JUMLAH_JADWAL];
int jadwalMenit[JUMLAH_JADWAL];

int jadwalKecepatan[JUMLAH_JADWAL];
int jadwalDurasi[JUMLAH_JADWAL];

int jadwalTerakhirHari[JUMLAH_JADWAL] = {
  -1,
  -1,
  -1
};

// =====================================================
// HISTORI
// =====================================================
#define JUMLAH_HISTORI 10

String historiWaktu[JUMLAH_HISTORI];
String historiSumber[JUMLAH_HISTORI];
int historiKecepatan[JUMLAH_HISTORI];
int historiDurasi[JUMLAH_HISTORI];


// =====================================================
// FORMAT DURASI
// =====================================================
String formatDurasi(int totalDetik) {
  int menit = totalDetik / 60;
  int detik = totalDetik % 60;

  if (menit > 0 && detik > 0) return String(menit) + " menit " + String(detik) + " detik";
  if (menit > 0) return String(menit) + " menit";
  return String(detik) + " detik";
}

// =====================================================
// SIMPAN PENGATURAN MANUAL
// =====================================================
void simpanPengaturan() {

  preferences.begin("feeder", false);

  preferences.putInt(
    "speed",
    kecepatan
  );

  preferences.putInt(
    "duration",
    durasi
  );

  preferences.putInt(
    "pause",
    durasiJeda
  );

  preferences.end();

  Serial.println(
    "Pengaturan manual disimpan."
  );
}


// =====================================================
// BACA PENGATURAN MANUAL
// =====================================================
void bacaPengaturan() {

  preferences.begin(
    "feeder",
    true
  );

  kecepatan =
    preferences.getInt(
      "speed",
      50
    );

  durasi =
    preferences.getInt(
      "duration",
      10
    );

  durasiJeda =
    preferences.getInt(
      "pause",
      60
    );

  durasiJeda = constrain(durasiJeda, 0, 3600);

  preferences.end();

  kecepatan =
    constrain(
      kecepatan,
      10,
      100
    );

  durasi =
    constrain(
      durasi,
      1,
      MAX_DURASI_DETIK
    );

  Serial.println();
  Serial.println(
    "PENGATURAN TERSIMPAN"
  );

  Serial.print(
    "Kecepatan : "
  );

  Serial.print(
    kecepatan
  );

  Serial.println("%");

  Serial.print(
    "Durasi    : "
  );

  Serial.print(
    durasi
  );

  Serial.println(
    " detik"
  );
}


// =====================================================
// SIMPAN JADWAL
// =====================================================
void simpanJadwal() {

  preferences.begin(
    "jadwal",
    false
  );

  for (
    int i = 0;
    i < JUMLAH_JADWAL;
    i++
  ) {

    String nomor =
      String(i);

    preferences.putBool(
      ("aktif" + nomor).c_str(),
      jadwalAktif[i]
    );

    preferences.putInt(
      ("jam" + nomor).c_str(),
      jadwalJam[i]
    );

    preferences.putInt(
      ("menit" + nomor).c_str(),
      jadwalMenit[i]
    );

    preferences.putInt(
      ("speed" + nomor).c_str(),
      jadwalKecepatan[i]
    );

    preferences.putInt(
      ("duration" + nomor).c_str(),
      jadwalDurasi[i]
    );
  }

  preferences.end();

  Serial.println(
    "Jadwal berhasil disimpan."
  );
}


// =====================================================
// BACA JADWAL
// =====================================================
void bacaJadwal() {

  preferences.begin(
    "jadwal",
    true
  );

  for (
    int i = 0;
    i < JUMLAH_JADWAL;
    i++
  ) {

    String nomor =
      String(i);

    jadwalAktif[i] =
      preferences.getBool(
        ("aktif" + nomor).c_str(),
        false
      );

    jadwalJam[i] =
      preferences.getInt(
        ("jam" + nomor).c_str(),
        7
      );

    jadwalMenit[i] =
      preferences.getInt(
        ("menit" + nomor).c_str(),
        0
      );

    jadwalKecepatan[i] =
      preferences.getInt(
        ("speed" + nomor).c_str(),
        50
      );

    jadwalDurasi[i] =
      preferences.getInt(
        ("duration" + nomor).c_str(),
        5
      );
  }

  preferences.end();
}


// =====================================================
// SIMPAN HISTORI
// =====================================================
void simpanHistori() {

  preferences.begin(
    "history",
    false
  );

  for (
    int i = 0;
    i < JUMLAH_HISTORI;
    i++
  ) {

    String nomor =
      String(i);

    preferences.putString(
      ("waktu" + nomor).c_str(),
      historiWaktu[i]
    );

    preferences.putString(
      ("sumber" + nomor).c_str(),
      historiSumber[i]
    );

    preferences.putInt(
      ("speed" + nomor).c_str(),
      historiKecepatan[i]
    );

    preferences.putInt(
      ("duration" + nomor).c_str(),
      historiDurasi[i]
    );
  }

  preferences.end();
}


// =====================================================
// BACA HISTORI
// =====================================================
void bacaHistori() {

  preferences.begin(
    "history",
    true
  );

  for (
    int i = 0;
    i < JUMLAH_HISTORI;
    i++
  ) {

    String nomor =
      String(i);

    historiWaktu[i] =
      preferences.getString(
        ("waktu" + nomor).c_str(),
        ""
      );

    historiSumber[i] =
      preferences.getString(
        ("sumber" + nomor).c_str(),
        ""
      );

    historiKecepatan[i] =
      preferences.getInt(
        ("speed" + nomor).c_str(),
        0
      );

    historiDurasi[i] =
      preferences.getInt(
        ("duration" + nomor).c_str(),
        0
      );
  }

  preferences.end();
}


// =====================================================
// TAMBAH HISTORI
// =====================================================
void tambahHistori(
  String sumber,
  int speed,
  int waktu
) {

  String waktuSekarang =
    "Waktu tidak tersedia";

  struct tm waktuLokal;

  if (
    getLocalTime(
      &waktuLokal
    )
  ) {

    char buffer[30];

    strftime(
      buffer,
      sizeof(buffer),
      "%d-%m-%Y %H:%M:%S",
      &waktuLokal
    );

    waktuSekarang =
      String(buffer);
  }


  // Geser histori lama
  // Histori terbaru berada di index 0

  for (
    int i = JUMLAH_HISTORI - 1;
    i > 0;
    i--
  ) {

    historiWaktu[i] =
      historiWaktu[i - 1];

    historiSumber[i] =
      historiSumber[i - 1];

    historiKecepatan[i] =
      historiKecepatan[i - 1];

    historiDurasi[i] =
      historiDurasi[i - 1];
  }


  // Masukkan histori baru
  historiWaktu[0] =
    waktuSekarang;

  historiSumber[0] =
    sumber;

  historiKecepatan[0] =
    speed;

  historiDurasi[0] =
    waktu;


  // Simpan ke ESP32
  simpanHistori();


  Serial.println();
  Serial.println(
    "HISTORI PEMBERIAN PAKAN"
  );

  Serial.print(
    "Waktu       : "
  );

  Serial.println(
    waktuSekarang
  );

  Serial.print(
    "Sumber      : "
  );

  Serial.println(
    sumber
  );

  Serial.print(
    "Kecepatan   : "
  );

  Serial.print(
    speed
  );

  Serial.println("%");

  Serial.print(
    "Durasi      : "
  );

  Serial.print(
    waktu
  );

  Serial.println(
    " detik"
  );
}


// =====================================================
// HAPUS HISTORI
// =====================================================
void hapusHistori() {

  for (
    int i = 0;
    i < JUMLAH_HISTORI;
    i++
  ) {

    historiWaktu[i] = "";
    historiSumber[i] = "";

    historiKecepatan[i] = 0;
    historiDurasi[i] = 0;
  }

  simpanHistori();

  Serial.println(
    "Semua histori dihapus."
  );
}


// =====================================================
// JALANKAN MOTOR
// =====================================================
void jalankanMotor(
  int speed,
  int waktu,
  String sumber
) {
  speed = constrain(speed, 10, 100);
  waktu = constrain(waktu, 1, MAX_DURASI_DETIK);

  motorSpeedAktif = speed;
  totalDurasiMotor = (unsigned long)waktu * 1000UL;
  waktuMotorBerjalan = 0;
  waktuMulai = millis();
  waktuMulaiJeda = 0;
  motorJeda = false;

  int pwm = map(speed, 0, 100, 0, 255);
  analogWrite(LPWM, 0);
  analogWrite(RPWM, pwm);
  motorAktif = true;
  digitalWrite(LED_HIJAU, HIGH);

  tambahHistori(sumber, speed, waktu);

  Serial.println();
  Serial.println("==============================");
  Serial.println("MOTOR BEKERJA");
  Serial.println("==============================");
  Serial.print("Sumber     : "); Serial.println(sumber);
  Serial.print("Kecepatan  : "); Serial.print(speed); Serial.println("%");
  Serial.print("Durasi     : "); Serial.println(formatDurasi(waktu));
  Serial.print("Pola       : maksimal 10 detik kerja / "); Serial.print(durasiJeda); Serial.println(" detik jeda");
  Serial.println("==============================");
}


// =====================================================
// HENTIKAN MOTOR
// =====================================================
void hentikanMotor() {

  analogWrite(
    RPWM,
    0
  );

  analogWrite(
    LPWM,
    0
  );

  motorAktif = false;
  motorJeda = false;
  totalDurasiMotor = 0;
  waktuMotorBerjalan = 0;

  digitalWrite(
    LED_HIJAU,
    LOW
  );


  Serial.println(
    "Motor berhenti."
  );
}


// =====================================================
// HEADER WEB
// =====================================================
String headerWeb(
  String halaman
) {

  String html = R"rawliteral(
<!DOCTYPE html>

<html>

<head>

<meta charset="UTF-8">

<meta
name="viewport"
content="width=device-width, initial-scale=1.0"
>

<title>Feeder Ikan IoT</title>

<style>

* {
  box-sizing: border-box;
}

body {

  margin: 0;

  padding: 18px 14px 40px;

  font-family:
    Arial,
    Helvetica,
    sans-serif;

  background:
    linear-gradient(
      135deg,
      #e0f2fe,
      #f8fafc
    );

  color: #1e293b;
}

.container {

  width: 100%;

  max-width: 520px;

  margin: auto;
}

.header {

  background:
    linear-gradient(
      135deg,
      #2563eb,
      #1d4ed8
    );

  color: white;

  border-radius: 22px;

  padding: 24px 20px;

  margin-bottom: 14px;

  box-shadow:
    0 8px 25px
    rgba(37,99,235,.25);
}

.header-title {

  font-size: 27px;

  font-weight: 800;
}

.header-subtitle {

  font-size: 13px;

  opacity: .85;

  margin-top: 6px;
}

.menu {

  display: flex;

  gap: 8px;

  margin-bottom: 14px;
}

.menu a {

  flex: 1;

  text-align: center;

  text-decoration: none;

  padding: 12px 5px;

  border-radius: 12px;

  background: white;

  color: #475569;

  font-size: 13px;

  font-weight: bold;

  box-shadow:
    0 3px 10px
    rgba(15,23,42,.08);
}

.menu a.active {

  background: #2563eb;

  color: white;
}

.card {

  background: white;

  border-radius: 20px;

  padding: 20px;

  margin-bottom: 14px;

  box-shadow:
    0 5px 18px
    rgba(15,23,42,.08);
}

.card-title {

  font-size: 20px;

  font-weight: 800;

  margin-bottom: 6px;
}

.card-description {

  color: #64748b;

  font-size: 13px;

  margin-bottom: 20px;
}

.status {

  display: flex;

  align-items: center;

  gap: 10px;

  padding: 14px;

  border-radius: 14px;

  font-size: 17px;

  font-weight: bold;
}

.status-idle {

  background: #f1f5f9;

  color: #475569;
}

.status-working {

  background: #dcfce7;

  color: #15803d;
}

.dot {

  width: 12px;

  height: 12px;

  border-radius: 50%;

  display: inline-block;
}

.dot-green {

  background: #22c55e;

  box-shadow:
    0 0 8px
    rgba(34,197,94,.7);
}

.dot-gray {

  background: #94a3b8;
}

.label {

  display: flex;

  justify-content: space-between;

  margin-bottom: 10px;

  font-weight: bold;

  font-size: 15px;
}

.value {

  color: #2563eb;

  font-weight: 800;

  font-size: 17px;
}

input[type="range"] {

  width: 100%;

  height: 7px;

  appearance: none;

  background: #e2e8f0;

  border-radius: 10px;
}

input[type="range"]::-webkit-slider-thumb {

  appearance: none;

  width: 22px;

  height: 22px;

  border-radius: 50%;

  background: #2563eb;
}

input[type="time"],
input[type="number"] {

  width: 100%;

  padding: 12px;

  border:
    1px solid #cbd5e1;

  border-radius: 12px;

  font-size: 16px;

  background: #f8fafc;

  margin-bottom: 14px;
}

button {

  width: 100%;

  padding: 14px;

  margin-top: 9px;

  border: none;

  border-radius: 13px;

  font-size: 15px;

  font-weight: 800;

  color: white;
}

.btn-blue {

  background: #2563eb;
}

.btn-green {

  background: #16a34a;
}

.btn-red {

  background: #dc2626;
}

.schedule {

  border:
    1px solid #e2e8f0;

  background: #f8fafc;

  border-radius: 16px;

  padding: 16px;

  margin-top: 14px;
}

.schedule-header {

  display: flex;

  justify-content: space-between;

  align-items: center;

  margin-bottom: 15px;
}

.schedule-title {

  font-size: 17px;

  font-weight: 800;
}

.switch {

  position: relative;

  display: inline-block;

  width: 48px;

  height: 26px;
}

.switch input {

  opacity: 0;

  width: 0;

  height: 0;
}

.slider {

  position: absolute;

  inset: 0;

  background: #cbd5e1;

  border-radius: 30px;
}

.slider:before {

  content: "";

  position: absolute;

  height: 20px;

  width: 20px;

  left: 3px;

  bottom: 3px;

  background: white;

  border-radius: 50%;

  transition: .2s;
}

.switch input:checked + .slider {

  background: #16a34a;
}

.switch input:checked + .slider:before {

  transform:
    translateX(22px);
}

.history {

  border:
    1px solid #e2e8f0;

  border-radius: 15px;

  padding: 15px;

  margin-bottom: 12px;

  background: #f8fafc;
}

.history-time {

  font-size: 17px;

  font-weight: 800;

  color: #1e293b;

  margin-bottom: 5px;
}

.history-source {

  color: #2563eb;

  font-weight: bold;

  margin-bottom: 12px;
}

.history-info {

  display: flex;

  justify-content: space-between;

  padding: 6px 0;

  font-size: 14px;

  border-bottom:
    1px solid #e2e8f0;
}

.history-info:last-child {

  border-bottom: none;
}

.empty {

  text-align: center;

  color: #94a3b8;

  padding: 30px 10px;
}

.system-row {

  display: flex;

  justify-content: space-between;

  padding: 12px 0;

  border-bottom:
    1px solid #e2e8f0;
}

.system-row:last-child {

  border-bottom: none;
}

.online {

  color: #16a34a;

  font-weight: bold;
}

.footer {

  text-align: center;

  color: #94a3b8;

  font-size: 12px;

  margin-top: 20px;
}

</style>

<script>

function updateSpeed(value) {

  document.getElementById(
    "speedValue"
  ).innerHTML =
    value + "%";
}

function updateDuration() {
  let menit = parseInt(document.getElementById("durationMin").value) || 0;
  let detik = parseInt(document.getElementById("durationSec").value) || 0;
  if (menit < 0) menit = 0;
  if (menit > 60) menit = 60;
  if (detik < 0) detik = 0;
  if (detik > 59) detik = 59;
  if (menit == 60) { detik = 0; document.getElementById("durationSec").value = 0; }
  document.getElementById("durationValue").innerHTML = menit + " menit " + detik + " detik";
}

function updateScheduleSpeed(
  index,
  value
) {

  document.getElementById(
    "jspeedValue" + index
  ).innerHTML =
    value + "%";
}

function simpanPengaturan() {

  let speed =
    document.getElementById(
      "speed"
    ).value;

  let menit = parseInt(document.getElementById("durationMin").value) || 0;
  let detik = parseInt(document.getElementById("durationSec").value) || 0;
  let duration = (menit * 60) + detik;
  if (duration < 1 || duration > 3600) { alert("Durasi harus 1 detik sampai 60 menit."); return; }

  let pause = parseInt(document.getElementById("pauseDuration").value) || 0;
  pause = Math.max(0, Math.min(3600, pause));

  fetch(
    "/save?speed=" +
    speed +
    "&duration=" +
    duration +
    "&pause=" +
    pause
  )
  .then(
    () => {
      alert(
        "Pengaturan berhasil disimpan."
      );

      location.reload();
    }
  );
}

function mulaiMotor() {

  let speed =
    document.getElementById(
      "speed"
    ).value;

  let menit = parseInt(document.getElementById("durationMin").value) || 0;
  let detik = parseInt(document.getElementById("durationSec").value) || 0;
  let duration = (menit * 60) + detik;
  if (duration < 1 || duration > 3600) { alert("Durasi harus 1 detik sampai 60 menit."); return; }

  fetch(
    "/motor/on?speed=" +
    speed +
    "&duration=" +
    duration
  )
  .then(
    () => {
      location.reload();
    }
  );
}

function berhentiMotor() {

  fetch(
    "/motor/off"
  )
  .then(
    () => {
      location.reload();
    }
  );
}

function updatePause() {
  let pause = parseInt(document.getElementById("pauseDuration").value) || 0;
  pause = Math.max(0, Math.min(3600, pause));
  document.getElementById("pauseValue").textContent = pause + " detik";
}

function updateScheduleDuration() {
  // Durasi jadwal dihitung saat tombol simpan ditekan.
}

function simpanJadwal(index) {

  let aktif =
    document.getElementById(
      "aktif" + index
    ).checked;

  let waktu =
    document.getElementById(
      "waktu" + index
    ).value;

  let speed =
    document.getElementById(
      "jspeed" + index
    ).value;

  let menitDurasi = parseInt(document.getElementById("jdurationMin" + index).value) || 0;
  let detikDurasi = parseInt(document.getElementById("jdurationSec" + index).value) || 0;
  let duration = (menitDurasi * 60) + detikDurasi;
  if (duration < 1 || duration > 3600) { alert("Durasi jadwal harus 1 detik sampai 60 menit."); return; }

  if (waktu === "") {

    alert(
      "Silakan pilih waktu."
    );

    return;
  }

  let bagian =
    waktu.split(":");

  let jam =
    bagian[0];

  let menit =
    bagian[1];

  fetch(
    "/saveSchedule" +
    "?index=" + index +
    "&aktif=" +
    (aktif ? 1 : 0) +
    "&jam=" + jam +
    "&menit=" + menit +
    "&speed=" + speed +
    "&duration=" + duration
  )
  .then(
    () => {

      alert(
        "Jadwal berhasil disimpan."
      );

      location.reload();

    }
  );
}

function hapusHistori() {

  if (
    confirm(
      "Hapus semua histori pemberian pakan?"
    )
  ) {

    fetch(
      "/clearHistory"
    )
    .then(
      () => {
        location.reload();
      }
    );
  }
}

</script>

</head>

<body>

<div class="container">

<div class="header">

  <div class="header-title">
    FEEDER IKAN IoT
  </div>

  <div class="header-subtitle">
    Sistem Pemberi & Penyebar Pakan Otomatis
  </div>

</div>

<div class="menu">

  <a
    href="/"
    class=")rawliteral";

  if (halaman == "kontrol") {
    html += "active";
  }

  html += R"rawliteral("
  >
    Kontrol
  </a>

  <a
    href="/#jadwal"
  >
    Jadwal
  </a>

  <a
    href="/history"
    class=")rawliteral";

  if (halaman == "histori") {
    html += "active";
  }

  html += R"rawliteral("
  >
    Histori
  </a>

</div>

)rawliteral";

  return html;
}


// =====================================================
// FOOTER
// =====================================================
String footerWeb() {

  return R"rawliteral(

<div class="footer">

  Feeder Ikan IoT | ESP32

</div>

</div>

</body>

</html>

)rawliteral";
}


// =====================================================
// HALAMAN UTAMA
// =====================================================
String halamanKontrol() {

  String html =
    headerWeb("kontrol");


  // ===================================================
  // STATUS MOTOR
  // ===================================================

  html += R"rawliteral(

<div class="card">

  <div class="card-title">
    Status Motor
  </div>

)rawliteral";


  if (motorAktif) {

    html += R"rawliteral(

  <div class="status status-working">

    <span class="dot dot-green"></span>

    MOTOR SEDANG BEKERJA

  </div>

)rawliteral";

  } else {

    html += R"rawliteral(

  <div class="status status-idle">

    <span class="dot dot-gray"></span>

    MOTOR SIAGA

  </div>

)rawliteral";
  }


  html += R"rawliteral(

</div>


<!-- =================================================
     PENGATURAN MANUAL
     ================================================= -->

<div class="card">

  <div class="card-title">
    Pengaturan Pakan - FEEDER-001
  </div>

  <div class="card-description">
    Pengaturan ini digunakan untuk pemberian pakan manual.
  </div>


  <div class="label">

    <span>
      Kecepatan Motor
    </span>

    <span
      class="value"
      id="speedValue"
    >
)rawliteral";

  html +=
    kecepatan;

  html += R"rawliteral(
      %
    </span>

  </div>


  <input
    type="range"
    id="speed"
    min="10"
    max="100"
    value=")rawliteral";

  html +=
    kecepatan;

  html += R"rawliteral("
    oninput="updateSpeed(this.value)"
  >


  <br><br>


  <div class="label">
    <span>Durasi Pemberian Pakan</span>
    <span class="value" id="durationValue">
)rawliteral";
  html += formatDurasi(durasi);
  html += R"rawliteral(
    </span>
  </div>

  <div style="display:flex; gap:10px; flex-wrap:wrap;">
    <div style="flex:1; min-width:120px;">
      <label>Menit</label>
      <input type="number" id="durationMin" min="0" max="60" value=")rawliteral";
  html += durasi / 60;
  html += R"rawliteral(" oninput="updateDuration()">
    </div>
    <div style="flex:1; min-width:120px;">
      <label>Detik</label>
      <input type="number" id="durationSec" min="0" max="59" value=")rawliteral";
  html += durasi % 60;
  html += R"rawliteral(" oninput="updateDuration()">
    </div>
  </div>
  <small>Maksimal 60 menit. Contoh: 5 menit 30 detik.</small>

  <div class="label" style="margin-top:15px;">
    <span>Jeda Motor Setelah 5 Menit</span>
    <span class="value" id="pauseValue">)rawliteral";
  html += durasiJeda;
  html += R"rawliteral( detik</span>
  </div>

  <input
    type="number"
    id="pauseDuration"
    min="0"
    max="3600"
    value=")rawliteral";
  html += durasiJeda;
  html += R"rawliteral("
    oninput="updatePause()"
  >
  <small>Atur jeda dalam detik. 0 = tanpa jeda. Maksimal 3600 detik.</small>


  <button
    class="btn-blue"
    onclick="simpanPengaturan()"
  >
    SIMPAN PENGATURAN
  </button>


  <button
    class="btn-green"
    onclick="mulaiMotor()"
  >
    MULAI PAKAN
  </button>


  <button
    class="btn-red"
    onclick="berhentiMotor()"
  >
    BERHENTI
  </button>

</div>


<!-- =================================================
     JADWAL
     ================================================= -->

<div
  class="card"
  id="jadwal"
>

  <div class="card-title">
    Jadwal Otomatis
  </div>

  <div class="card-description">
    Jadwal akan berjalan otomatis dan berulang setiap hari.
  </div>

)rawliteral";


  for (
    int i = 0;
    i < JUMLAH_JADWAL;
    i++
  ) {

    String waktu;

    if (
      jadwalJam[i] < 10
    ) {
      waktu += "0";
    }

    waktu +=
      String(
        jadwalJam[i]
      );

    waktu += ":";

    if (
      jadwalMenit[i] < 10
    ) {
      waktu += "0";
    }

    waktu +=
      String(
        jadwalMenit[i]
      );


    html += R"rawliteral(

<div class="schedule">

  <div class="schedule-header">

    <div class="schedule-title">
      Jadwal )rawliteral";

    html +=
      String(i + 1);

    html += R"rawliteral(
    </div>

    <label class="switch">

      <input
        type="checkbox"
        id="aktif)rawliteral";

    html +=
      String(i);

    html += "\"";

    if (
      jadwalAktif[i]
    ) {

      html +=
        " checked";
    }

    html += R"rawliteral(
      >

      <span class="slider"></span>

    </label>

  </div>


  <div class="label">

    <span>
      Waktu Pemberian
    </span>

  </div>


  <input
    type="time"
    id="waktu)rawliteral";

    html +=
      String(i);

    html += "\" value=\"";

    html +=
      waktu;

    html += R"rawliteral("
  >


  <div class="label">

    <span>
      Kecepatan Motor
    </span>

    <span
      class="value"
      id="jspeedValue)rawliteral";

    html +=
      String(i);

    html += "\">";

    html +=
      String(
        jadwalKecepatan[i]
      );

    html += R"rawliteral(
      %
    </span>

  </div>


  <input
    type="range"
    id="jspeed)rawliteral";

    html +=
      String(i);

    html += "\" min=\"10\" max=\"100\" value=\"";

    html +=
      String(
        jadwalKecepatan[i]
      );

    html += "\" oninput=\"updateScheduleSpeed(";

    html +=
      String(i);

    html += R"rawliteral(, this.value)"
  >


  <br><br>


  <div class="label">

    <div class="label">
      <span>Durasi</span>
      <span class="value">
)rawliteral";
    html += formatDurasi(jadwalDurasi[i]);
    html += R"rawliteral(
      </span>
    </div>

    <div style="display:flex; gap:10px; flex-wrap:wrap;">
      <div style="flex:1; min-width:120px;">
        <label>Menit</label>
        <input type="number" id="jdurationMin)rawliteral";
    html += String(i);
    html += "\" min=\"0\" max=\"60\" value=\"";
    html += String(jadwalDurasi[i] / 60);
    html += R"rawliteral(" oninput="updateScheduleDuration()">
      </div>
      <div style="flex:1; min-width:120px;">
        <label>Detik</label>
        <input type="number" id="jdurationSec)rawliteral";
    html += String(i);
    html += "\" min=\"0\" max=\"59\" value=\"";
    html += String(jadwalDurasi[i] % 60);
    html += R"rawliteral(" oninput="updateScheduleDuration()">
      </div>
    </div>
    <small>Maksimal 60 menit.</small>


  <button
    class="btn-blue"
    onclick="simpanJadwal()"
  >
    SIMPAN JADWAL
  </button>

</div>

)rawliteral";


    // Ganti onclick berdasarkan index
    html.replace(
      "onclick=\"simpanJadwal()\"",
      "onclick=\"simpanJadwal(" +
      String(i) +
      ")\""
    );
  }


  html += R"rawliteral(

</div>


<!-- =================================================
     STATUS SISTEM
     ================================================= -->

<div class="card">

  <div class="card-title">
    Status Sistem
  </div>

  <div class="system-row">

    <span>
      Daya
    </span>

    <span class="online">
      AKTIF
    </span>

  </div>

  <div class="system-row">

    <span>
      WiFi
    </span>

)rawliteral";


  if (
    WiFi.status() ==
    WL_CONNECTED
  ) {

    html += R"rawliteral(

    <span class="online">
      TERHUBUNG
    </span>

)rawliteral";

  } else {

    html += R"rawliteral(

    <span>
      TERPUTUS
    </span>

)rawliteral";
  }


  html += R"rawliteral(

  </div>

  <div class="system-row">

    <span>
      Motor
    </span>

)rawliteral";


  if (
    motorAktif
  ) {

    html += R"rawliteral(

    <span class="online">
      BEKERJA
    </span>

)rawliteral";

  } else {

    html += R"rawliteral(

    <span>
      SIAGA
    </span>

)rawliteral";
  }


  html += R"rawliteral(

  </div>

</div>

)rawliteral";


  html +=
    footerWeb();


  return html;
}


// =====================================================
// HALAMAN HISTORI
// =====================================================
String halamanHistori() {

  String html =
    headerWeb("histori");


  html += R"rawliteral(

<div class="card">

  <div class="card-title">
    Histori Pemberian Pakan
  </div>

  <div class="card-description">
    Menampilkan 10 pemberian pakan terakhir.
  </div>

)rawliteral";


  bool adaHistori =
    false;


  for (
    int i = 0;
    i < JUMLAH_HISTORI;
    i++
  ) {

    if (
      historiWaktu[i] == ""
    ) {

      continue;
    }


    adaHistori =
      true;


    html += R"rawliteral(

<div class="history">

  <div class="history-time">
)rawliteral";

    html +=
      historiWaktu[i];

    html += R"rawliteral(
  </div>

  <div class="history-source">
)rawliteral";

    html +=
      historiSumber[i];

    html += R"rawliteral(
  </div>

  <div class="history-info">

    <span>
      Kecepatan
    </span>

    <strong>
)rawliteral";

    html +=
      String(
        historiKecepatan[i]
      );

    html += R"rawliteral(
      %
    </strong>

  </div>

  <div class="history-info">

    <span>
      Durasi
    </span>

    <strong>
)rawliteral";

    html += formatDurasi(historiDurasi[i]);

    html += R"rawliteral(
      detik
    </strong>

  </div>

</div>

)rawliteral";
  }


  if (!adaHistori) {

    html += R"rawliteral(

<div class="empty">

  Belum ada histori pemberian pakan.

</div>

)rawliteral";
  }


  html += R"rawliteral(

<button
  class="btn-red"
  onclick="hapusHistori()"
>
  HAPUS SEMUA HISTORI
</button>

</div>

)rawliteral";


  html +=
    footerWeb();


  return html;
}


// =====================================================
// SIMPAN PENGATURAN DARI WEB
// =====================================================
void handleSave() {

  if (
    server.hasArg("speed")
  ) {

    kecepatan =
      server.arg(
        "speed"
      ).toInt();
  }


  if (
    server.hasArg("duration")
  ) {

    durasi =
      server.arg(
        "duration"
      ).toInt();
  }

  if (
    server.hasArg("pause")
  ) {

    durasiJeda =
      server.arg(
        "pause"
      ).toInt();
  }


  kecepatan =
    constrain(
      kecepatan,
      10,
      100
    );

  durasi =
    constrain(
      durasi,
      1,
      MAX_DURASI_DETIK
    );

  durasiJeda =
    constrain(
      durasiJeda,
      0,
      3600
    );


  simpanPengaturan();


  server.send(
    200,
    "text/plain",
    "Pengaturan tersimpan"
  );
}


// =====================================================
// MOTOR ON
// =====================================================
void handleMotorOn() {

  int speed =
    kecepatan;

  int waktu =
    durasi;


  if (
    server.hasArg("speed")
  ) {

    speed =
      server.arg(
        "speed"
      ).toInt();
  }


  if (
    server.hasArg("duration")
  ) {

    waktu =
      server.arg(
        "duration"
      ).toInt();
  }


  speed =
    constrain(
      speed,
      10,
      100
    );

  waktu =
    constrain(
      waktu,
      1,
      MAX_DURASI_DETIK
    );


  kecepatan =
    speed;

  durasi =
    waktu;


  simpanPengaturan();


  jalankanMotor(
    speed,
    waktu,
    "Manual"
  );

  publishStatus("feeding", "web_manual");

  server.send(
    200,
    "text/plain",
    "Motor ON"
  );
}


// =====================================================
// MOTOR OFF
// =====================================================
void handleMotorOff() {

  hentikanMotor();
  publishStatus("stopped", "web_manual");

  server.send(
    200,
    "text/plain",
    "Motor OFF"
  );
}


// =====================================================
// SIMPAN JADWAL
// =====================================================
void handleSaveSchedule() {

  if (
    !server.hasArg("index")
  ) {

    server.send(
      400,
      "text/plain",
      "Index salah"
    );

    return;
  }


  int index =
    server.arg(
      "index"
    ).toInt();


  if (
    index < 0 ||
    index >= JUMLAH_JADWAL
  ) {

    server.send(
      400,
      "text/plain",
      "Index salah"
    );

    return;
  }


  jadwalAktif[index] =
    server.arg(
      "aktif"
    ).toInt() == 1;


  jadwalJam[index] =
    server.arg(
      "jam"
    ).toInt();


  jadwalMenit[index] =
    server.arg(
      "menit"
    ).toInt();


  jadwalKecepatan[index] =
    server.arg(
      "speed"
    ).toInt();


  jadwalDurasi[index] =
    server.arg(
      "duration"
    ).toInt();


  jadwalJam[index] =
    constrain(
      jadwalJam[index],
      0,
      23
    );


  jadwalMenit[index] =
    constrain(
      jadwalMenit[index],
      0,
      59
    );


  jadwalKecepatan[index] =
    constrain(
      jadwalKecepatan[index],
      10,
      100
    );


  jadwalDurasi[index] =
    constrain(
      jadwalDurasi[index],
      1,
      MAX_DURASI_DETIK
    );


  simpanJadwal();


  jadwalTerakhirHari[index] =
    -1;


  server.send(
    200,
    "text/plain",
    "Jadwal tersimpan"
  );
}


// =====================================================
// HAPUS HISTORI DARI WEB
// =====================================================
void handleClearHistory() {

  hapusHistori();


  server.send(
    200,
    "text/plain",
    "Histori dihapus"
  );
}


// =====================================================
// CEK JADWAL
// =====================================================
void cekJadwal() {

  struct tm waktuSekarang;


  if (
    !getLocalTime(
      &waktuSekarang
    )
  ) {

    return;
  }


  int jamSekarang =
    waktuSekarang.tm_hour;

  int menitSekarang =
    waktuSekarang.tm_min;

  int hariSekarang =
    waktuSekarang.tm_yday;


  for (
    int i = 0;
    i < JUMLAH_JADWAL;
    i++
  ) {

    if (
      !jadwalAktif[i]
    ) {

      continue;
    }


    if (
      jamSekarang ==
        jadwalJam[i]

      &&

      menitSekarang ==
        jadwalMenit[i]

      &&

      jadwalTerakhirHari[i] !=
        hariSekarang
    ) {


      if (!motorAktif) {

        String sumber =
          "Jadwal " +
          String(i + 1);


        jalankanMotor(
          jadwalKecepatan[i],
          jadwalDurasi[i],
          sumber
        );

        publishStatus("feeding", "schedule");

        jadwalTerakhirHari[i] =
          hariSekarang;
      }
    }
  }
}


// =====================================================
// MQTT - CARI NILAI JSON SEDERHANA
// =====================================================
String ambilJsonString(const String& payload, const String& key) {
  String pola = "\"" + key + "\"";
  int posisi = payload.indexOf(pola);
  if (posisi < 0) return "";

  posisi = payload.indexOf(':', posisi + pola.length());
  if (posisi < 0) return "";
  posisi++;

  while (posisi < (int)payload.length() && (payload[posisi] == ' ' || payload[posisi] == '\"')) posisi++;

  int akhir = posisi;
  while (akhir < (int)payload.length() && payload[akhir] != ',' && payload[akhir] != '}' && payload[akhir] != '\"') akhir++;

  String nilai = payload.substring(posisi, akhir);
  nilai.trim();
  return nilai;
}

int ambilJsonInt(const String& payload, const String& key, int nilaiDefault) {
  String nilai = ambilJsonString(payload, key);
  if (nilai.length() == 0) return nilaiDefault;
  return nilai.toInt();
}

void publishStatus(const char* status, const char* reason = "") {
  if (!mqttClient.connected()) return;

  String payload = "{\"device\":\"";
  payload += FEEDER_ID;
  payload += "\",\"status\":\"";
  payload += status;
  payload += "\",\"motor\":";
  payload += (motorAktif ? "true" : "false");
  payload += ",\"speed\":";
  payload += motorSpeedAktif;
  payload += ",\"duration\":";
  payload += durasi;
  if (reason && strlen(reason) > 0) {
    payload += ",\"reason\":\"";
    payload += reason;
    payload += "\"";
  }
  payload += "}";

  mqttClient.publish(MQTT_STATUS_TOPIC, payload.c_str(), true);
}

void mqttCallback(char* topic, byte* payload, unsigned int length) {
  String pesan;
  for (unsigned int i = 0; i < length; i++) pesan += (char)payload[i];
  pesan.trim();

  Serial.println();
  Serial.println("========== MQTT COMMAND ==========");
  Serial.print("Topic   : "); Serial.println(topic);
  Serial.print("Payload : "); Serial.println(pesan);

  if (String(topic) != MQTT_COMMAND_TOPIC) return;

  String action = ambilJsonString(pesan, "action");
  action.toLowerCase();

  if (action == "stop" || action == "off") {
    hentikanMotor();
    publishStatus("stopped", "mqtt_command");
    return;
  }

  if (action == "feed" || action == "start" || action == "on") {
    // Jika WiFi tidak tersambung, jangan izinkan motor hidup dari MQTT.
    if (WiFi.status() != WL_CONNECTED) {
      hentikanMotor();
      Serial.println("MQTT feed ditolak: WiFi tidak terhubung.");
      publishStatus("rejected", "wifi_disconnected");
      return;
    }

    int speed = ambilJsonInt(pesan, "speed", kecepatan);
    int waktu = ambilJsonInt(pesan, "duration", durasi);

    speed = constrain(speed, 10, 100);
    waktu = constrain(waktu, 1, MAX_DURASI_DETIK);

    kecepatan = speed;
    durasi = waktu;
    simpanPengaturan();

    // Jangan menjalankan perintah MQTT baru jika motor masih aktif.
    // Kirim STOP dulu jika ingin membatalkan proses sebelumnya.
    if (motorAktif) {
      Serial.println("Perintah feed diabaikan: motor masih berjalan.");
      publishStatus("busy", "motor_running");
      return;
    }

    jalankanMotor(speed, waktu, "MQTT/RMQ");
    publishStatus("feeding", "mqtt_command");
    return;
  }

  if (action == "status") {
    publishStatus(motorAktif ? "feeding" : "idle", "mqtt_status_request");
    return;
  }

  Serial.println("Action MQTT tidak dikenal.");
  publishStatus("rejected", "unknown_action");
}

bool mqttConnect() {
  if (WiFi.status() != WL_CONNECTED) return false;
  if (mqttClient.connected()) return true;

  String clientId = String("FEEDER-001-") + String((uint32_t)ESP.getEfuseMac(), HEX);

  Serial.println();
  Serial.println("Mencoba koneksi RabbitMQ MQTT...");

  bool berhasil = mqttClient.connect(
    clientId.c_str(),
    MQTT_USER,
    MQTT_PASSWORD,
    MQTT_STATUS_TOPIC,
    1,
    true,
    "{\"device\":\"FEEDER-001\",\"status\":\"offline\"}"
  );

  if (berhasil) {
    Serial.println("RabbitMQ MQTT TERHUBUNG!");
    mqttClient.subscribe(MQTT_COMMAND_TOPIC, 1);
    publishStatus("online", "mqtt_connected");
    return true;
  }

  Serial.print("MQTT gagal, state=");
  Serial.println(mqttClient.state());
  return false;
}

void prosesMQTT() {
  if (WiFi.status() != WL_CONNECTED) {
    if (mqttClient.connected()) mqttClient.disconnect();
    return;
  }

  if (!mqttClient.connected()) {
    unsigned long sekarang = millis();
    if (sekarang - mqttLastReconnectAttempt >= 5000UL) {
      mqttLastReconnectAttempt = sekarang;
      mqttConnect();
    }
  } else {
    mqttClient.loop();
  }
}

// =====================================================
// SETUP
// =====================================================
void setup() {

  Serial.begin(
    115200
  );


  // ===================================================
  // LED
  // ===================================================

  pinMode(
    LED_MERAH,
    OUTPUT
  );

  pinMode(
    LED_BIRU,
    OUTPUT
  );

  pinMode(
    LED_HIJAU,
    OUTPUT
  );


  digitalWrite(
    LED_MERAH,
    HIGH
  );

  digitalWrite(
    LED_BIRU,
    LOW
  );

  digitalWrite(
    LED_HIJAU,
    LOW
  );


  // ===================================================
  // BTS7960
  // ===================================================

  pinMode(
    RPWM,
    OUTPUT
  );

  pinMode(
    LPWM,
    OUTPUT
  );

  pinMode(
    R_EN,
    OUTPUT
  );

  pinMode(
    L_EN,
    OUTPUT
  );


  digitalWrite(
    R_EN,
    HIGH
  );

  digitalWrite(
    L_EN,
    HIGH
  );


  analogWrite(
    RPWM,
    0
  );

  analogWrite(
    LPWM,
    0
  );


  // ===================================================
  // BACA DATA
  // ===================================================

  bacaPengaturan();

  bacaJadwal();

  bacaHistori();


  // ===================================================
  // WIFI
  // ===================================================

  IPAddress local_IP(192, 168, 1, 50);
  IPAddress gateway(192, 168, 1, 1);
  IPAddress subnet(255, 255, 255, 0);
  IPAddress dns1(192, 168, 1, 1);

  WiFiManager wm;
  wm.setSTAStaticIPConfig(local_IP, gateway, subnet, dns1);


  Serial.println();
  Serial.println(
    "================================"
  );

  Serial.println(
    "       FEEDER IKAN IoT"
  );

  Serial.print("ID FEEDER: ");
  Serial.println(FEEDER_ID);

  Serial.println(
    "================================"
  );

  Serial.println(
    "Memulai WiFi Config..."
  );


  bool result =
    wm.autoConnect(
      "FEEDER-IOT"
    );


  if (!result) {

    Serial.println(
      "Gagal terhubung WiFi."
    );

    delay(3000);

    ESP.restart();
  }


  digitalWrite(
    LED_BIRU,
    HIGH
  );


  Serial.println();
  Serial.println(
    "WiFi TERHUBUNG!"
  );


  Serial.print(
    "SSID: "
  );

  Serial.println(
    WiFi.SSID()
  );


  Serial.print(
    "IP ESP32: "
  );

  Serial.println(
    WiFi.localIP()
  );


  // ===================================================
  // RABBITMQ MQTT
  // ===================================================

  mqttClient.setServer(MQTT_HOST, MQTT_PORT);
  mqttClient.setCallback(mqttCallback);
  mqttClient.setBufferSize(512);

  // Coba koneksi pertama. Jika gagal, loop akan mencoba lagi tiap 5 detik.
  mqttConnect();


  // ===================================================
  // WAKTU WIB
  // ===================================================

  configTime(
    7 * 3600,
    0,
    "pool.ntp.org",
    "time.nist.gov"
  );


  Serial.println();
  Serial.println(
    "Sinkronisasi waktu WIB..."
  );


  struct tm waktu;

  int percobaan =
    0;


  while (
    !getLocalTime(
      &waktu
    )
    &&
    percobaan < 20
  ) {

    delay(500);

    Serial.print(
      "."
    );

    percobaan++;
  }


  Serial.println();


  if (
    getLocalTime(
      &waktu
    )
  ) {

    Serial.println(
      "Waktu berhasil disinkronkan."
    );

    Serial.printf(
      "Waktu: %02d:%02d:%02d\n",
      waktu.tm_hour,
      waktu.tm_min,
      waktu.tm_sec
    );

  } else {

    Serial.println(
      "Waktu belum tersedia."
    );
  }


  // ===================================================
  // ROUTE WEB
  // ===================================================

  server.on(
    "/",
    []() {

      server.send(
        200,
        "text/html; charset=UTF-8",
        halamanKontrol()
      );
    }
  );


  server.on(
    "/history",
    []() {

      server.send(
        200,
        "text/html; charset=UTF-8",
        halamanHistori()
      );
    }
  );


  server.on(
    "/save",
    handleSave
  );


  server.on(
    "/motor/on",
    handleMotorOn
  );


  server.on(
    "/motor/off",
    handleMotorOff
  );


  server.on(
    "/saveSchedule",
    handleSaveSchedule
  );


  server.on(
    "/clearHistory",
    handleClearHistory
  );


  // ===================================================
  // START SERVER
  // ===================================================

  server.begin();


  Serial.println();
  Serial.println(
    "================================"
  );

  Serial.println(
    "       WEB SERVER AKTIF"
  );

  Serial.println(
    "================================"
  );

  Serial.print(
    "Buka di HP: http://"
  );

  Serial.println(
    WiFi.localIP()
  );

  Serial.println();
}


// =====================================================
// LOOP
// =====================================================
void loop() {

  server.handleClient();
  prosesMQTT();


  // ===================================================
  // LED MERAH = DAYA
  // ===================================================

  digitalWrite(
    LED_MERAH,
    HIGH
  );


  // ===================================================
  // LED BIRU = WIFI
  // ===================================================

  if (
    WiFi.status() ==
    WL_CONNECTED
  ) {

    digitalWrite(
      LED_BIRU,
      HIGH
    );

  } else {

    digitalWrite(
      LED_BIRU,
      LOW
    );
  }


  // ===================================================
  // FAIL-SAFE WIFI
  // Jika WiFi terputus saat motor berjalan, motor langsung STOP.
  // Saat WiFi tersambung kembali, motor tetap STOP dan tidak lanjut otomatis.
  // ===================================================

  if (motorAktif && WiFi.status() != WL_CONNECTED) {
    Serial.println("WiFi terputus! Motor dihentikan demi keamanan.");
    hentikanMotor();
    if (mqttClient.connected()) publishStatus("stopped", "wifi_disconnected");
  }


  // ===================================================
  // KONTROL MOTOR + JEDA OTOMATIS
  // ===================================================

  if (motorAktif) {
    unsigned long sekarang = millis();

    if (motorJeda) {
      if (sekarang - waktuMulaiJeda >= waktuJedaMs()) {
        unsigned long sisa = totalDurasiMotor - waktuMotorBerjalan;
        unsigned long segmen = (sisa > BATAS_KERJA_MS) ? BATAS_KERJA_MS : sisa;
        int pwm = map(motorSpeedAktif, 0, 100, 0, 255);
        analogWrite(LPWM, 0);
        analogWrite(RPWM, pwm);
        motorJeda = false;
        waktuMulai = sekarang;
        digitalWrite(LED_HIJAU, HIGH);
        Serial.println("Jeda selesai. Motor bekerja kembali.");
      }
    } else {
      unsigned long lamaKerja = sekarang - waktuMulai;
      unsigned long sisa = totalDurasiMotor - waktuMotorBerjalan;
      unsigned long segmen = (sisa > BATAS_KERJA_MS) ? BATAS_KERJA_MS : sisa;

      if (lamaKerja >= segmen) {
        waktuMotorBerjalan += segmen;
        analogWrite(RPWM, 0);
        analogWrite(LPWM, 0);

        if (waktuMotorBerjalan >= totalDurasiMotor) {
          hentikanMotor();
          Serial.println("Pemberian pakan selesai.");
          publishStatus("idle", "feeding_complete");
        } else {
          motorJeda = true;
          waktuMulaiJeda = sekarang;
          digitalWrite(LED_HIJAU, LOW);
          Serial.print("Motor jeda "); Serial.print(durasiJeda); Serial.println(" detik untuk pendinginan.");
        }
      }
    }
  }


  // ===================================================
  // CEK JADWAL
  // ===================================================

  cekJadwal();


  delay(100);
}
