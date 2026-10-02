const express = require('express');
const mqtt = require('mqtt');

const app = express();
const PORT = process.env.PORT || 3000;

const FEEDER_ID = 'FEEDER-001';
const MQTT_HOST = process.env.MQTT_HOST || 'mqtt://195.35.23.135';
const MQTT_PORT = Number(process.env.MQTT_PORT || 1883);
const MQTT_USER = process.env.MQTT_USER || '/ai-automation:mhs_kuliah';
const MQTT_PASSWORD = process.env.MQTT_PASSWORD || '';

const COMMAND_TOPIC = `feeder/${FEEDER_ID}/command`;
const STATUS_TOPIC = `feeder/${FEEDER_ID}/status`;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

let feederStatus = {
  device: FEEDER_ID,
  status: 'offline',
  motor: false,
  speed: 50,
  duration: 10,
  reason: 'server_start',
  lastUpdate: null
};

let schedules = [
  {
    index: 0,
    aktif: false,
    jam: 7,
    menit: 0,
    speed: 50,
    duration: 10
  },
  {
    index: 1,
    aktif: false,
    jam: 12,
    menit: 0,
    speed: 50,
    duration: 10
  },
  {
    index: 2,
    aktif: false,
    jam: 18,
    menit: 0,
    speed: 50,
    duration: 10
  }
];

const mqttClient = mqtt.connect(MQTT_HOST, {
  port: MQTT_PORT,
  username: MQTT_USER,
  password: MQTT_PASSWORD,

  clientId:
    `railway-${FEEDER_ID.toLowerCase()}-${Math.random()
      .toString(16)
      .slice(2, 10)}`,

  reconnectPeriod: 5000,
  connectTimeout: 10000,
  clean: true
});

mqttClient.on('connect', () => {

  console.log(
    'MQTT TERHUBUNG ke RabbitMQ'
  );

  mqttClient.subscribe(
    STATUS_TOPIC,
    { qos: 1 },
    (err) => {

      if (err) {

        console.error(
          'Gagal subscribe status:',
          err.message
        );

      } else {

        console.log(
          'Subscribe:',
          STATUS_TOPIC
        );

      }

    }
  );

  publishCommand({
    action: 'status',
    device: FEEDER_ID
  });

  publishCommand({
    action: 'schedule_get',
    device: FEEDER_ID
  });

});

mqttClient.on('reconnect', () => {

  console.log(
    'Mencoba reconnect MQTT...'
  );

});

mqttClient.on('close', () => {

  console.log(
    'MQTT terputus'
  );

});

mqttClient.on('error', (err) => {

  console.error(
    'MQTT error:',
    err.message
  );

});

mqttClient.on(
  'message',
  (topic, message) => {

    if (topic !== STATUS_TOPIC) {
      return;
    }

    const raw =
      message.toString();

    console.log(
      'STATUS ESP32:',
      raw
    );

    try {

      const data =
        JSON.parse(raw);

      feederStatus = {
        ...feederStatus,
        ...data,
        lastUpdate:
          new Date().toISOString()
      };

      if (
        data.status ===
          'schedule_state' &&
        Array.isArray(
          data.schedules
        )
      ) {

        schedules =
          data.schedules.map(
            normalizeSchedule
          );

      }

    } catch (err) {

      console.error(
        'Payload status bukan JSON valid:',
        err.message
      );

    }

  }
);

function publishCommand(payload) {

  if (!mqttClient.connected) {

    console.log(
      'MQTT belum terhubung. Command tidak dikirim:',
      payload
    );

    return false;
  }

  const message =
    JSON.stringify(payload);

  mqttClient.publish(
    COMMAND_TOPIC,
    message,
    { qos: 1 },
    (err) => {

      if (err) {

        console.error(
          'Gagal publish MQTT:',
          err.message
        );

      } else {

        console.log(
          'COMMAND MQTT:',
          message
        );

      }

    }
  );

  return true;
}

function normalizeSchedule(item) {

  return {

    index:
      Number(item.index),

    aktif:
      Boolean(
        Number(item.aktif)
      ),

    jam:
      clamp(
        Number(item.jam),
        0,
        23
      ),

    menit:
      clamp(
        Number(item.menit),
        0,
        59
      ),

    speed:
      clamp(
        Number(item.speed),
        10,
        100
      ),

    duration:
      clamp(
        Number(item.duration),
        1,
        3600
      )

  };

}

function clamp(
  value,
  min,
  max
) {

  if (
    !Number.isFinite(value)
  ) {

    return min;

  }

  return Math.min(
    max,
    Math.max(min, value)
  );

}

function validIndex(index) {

  return (
    Number.isInteger(index) &&
    index >= 0 &&
    index < 3
  );

}

function page() {

  const scheduleCards =
    schedules
      .map(
        (s) => `

    <div class="card schedule-card">

      <div class="schedule-head">

        <div>

          <div class="eyebrow">
            Jadwal ${s.index + 1}
          </div>

          <h3>
            Waktu Pemberian Pakan
          </h3>

        </div>

        <label class="switch">

          <input
            id="aktif${s.index}"
            type="checkbox"
            ${s.aktif ? 'checked' : ''}
          >

          <span class="slider"></span>

        </label>

      </div>

      <label>

        Waktu Pemberian Pakan

        <input
          id="time${s.index}"
          type="time"
          value="${String(s.jam).padStart(2, '0')}:${String(s.menit).padStart(2, '0')}"
        >

      </label>

      <label>

        Kecepatan Motor

        <strong id="jspeedValue${s.index}">
          ${s.speed}%
        </strong>

        <input
          id="speed${s.index}"
          type="range"
          min="10"
          max="100"
          value="${s.speed}"
          oninput="
            updateScheduleSpeed(
              ${s.index},
              this.value
            )
          "
        >

      </label>

      <label>

        Durasi Motor (detik)

        <input
          id="duration${s.index}"
          type="number"
          min="1"
          max="3600"
          value="${s.duration}"
        >

      </label>

      <button
        class="primary"
        onclick="
          simpanJadwal(
            ${s.index}
          )
        "
      >
        Simpan Jadwal ${s.index + 1}
      </button>

      <div
        id="scheduleMsg${s.index}"
        class="msg"
      ></div>

    </div>

  `
      )
      .join('');

  const statusText =
    feederStatus.status ||
    'offline';

  const online =
    statusText !== 'offline';

  return `<!doctype html>

<html lang="id">

<head>

<meta charset="UTF-8">

<meta
  name="viewport"
  content="width=device-width,initial-scale=1"
>

<title>
  Feeder Ikan IoT
</title>

<style>

* {
  box-sizing: border-box;
}

body {

  margin: 0;

  font-family:
    Inter,
    Arial,
    sans-serif;

  background: #f4f7fb;

  color: #172033;

}

.top {

  background: #fff;

  border-bottom:
    1px solid #e5eaf2;

  position: sticky;

  top: 0;

  z-index: 5;

}

.nav {

  max-width: 1100px;

  margin: auto;

  padding: 18px 20px;

  display: flex;

  align-items: center;

  justify-content:
    space-between;

  gap: 15px;

}

.brand {

  font-size: 22px;

  font-weight: 800;

}

.device {

  font-size: 13px;

  color: #64748b;

}

.wrap {

  max-width: 1100px;

  margin: 28px auto;

  padding: 0 20px;

}

.status {

  display: flex;

  align-items: center;

  gap: 8px;

  font-weight: 700;

}

.dot {

  width: 10px;

  height: 10px;

  border-radius: 50%;

  background: #94a3b8;

}

.dot.on {

  background: #22c55e;

}

.tabs {

  display: flex;

  gap: 8px;

  margin: 20px 0;

  flex-wrap: wrap;

}

.tab {

  border: 0;

  background: #e8edf5;

  padding: 11px 18px;

  border-radius: 10px;

  cursor: pointer;

  font-weight: 700;

}

.tab.active {

  background: #172033;

  color: white;

}

.panel {

  display: none;

}

.panel.active {

  display: block;

}

.card {

  background: #fff;

  border:
    1px solid #e5eaf2;

  border-radius: 18px;

  padding: 22px;

  margin-bottom: 18px;

  box-shadow:
    0 8px 25px
    rgba(15,23,42,.05);

}

h2,
h3 {

  margin-top: 0;

}

.grid2 {

  display: grid;

  grid-template-columns:
    1fr 1fr;

  gap: 14px;

}

label {

  display: block;

  font-size: 14px;

  font-weight: 700;

  color: #475569;

  margin: 14px 0;

}

input[type=number],
input[type=time] {

  width: 100%;

  padding: 12px;

  border:
    1px solid #d7dee9;

  border-radius: 10px;

  font-size: 16px;

  margin-top: 7px;

}

input[type=range] {

  width: 100%;

  margin-top: 10px;

}

.primary,
.danger {

  border: 0;

  padding: 12px 18px;

  border-radius: 10px;

  color: white;

  font-weight: 800;

  cursor: pointer;

}

.primary {

  background: #2563eb;

}

.danger {

  background: #dc2626;

}

.actions {

  display: flex;

  gap: 10px;

  flex-wrap: wrap;

}

.big-status {

  font-size: 25px;

  font-weight: 800;

  margin:
    8px 0 18px;

}

.eyebrow {

  font-size: 12px;

  color: #64748b;

  text-transform: uppercase;

  letter-spacing: .08em;

}

.schedule-head {

  display: flex;

  justify-content:
    space-between;

  align-items: center;

}

.switch {

  position: relative;

  display: inline-block;

  width: 48px;

  height: 28px;

  margin: 0;

}

.switch input {

  display: none;

}

.slider {

  position: absolute;

  inset: 0;

  background: #cbd5e1;

  border-radius: 30px;

  cursor: pointer;

}

.slider:before {

  content: "";

  position: absolute;

  width: 22px;

  height: 22px;

  left: 3px;

  top: 3px;

  background: #fff;

  border-radius: 50%;

  transition: .2s;

}

.switch input:checked
+ .slider {

  background: #2563eb;

}

.switch input:checked
+ .slider:before {

  transform:
    translateX(20px);

}

.msg {

  font-size: 13px;

  margin-top: 10px;

  color: #64748b;

}

.info {

  display: grid;

  grid-template-columns:
    repeat(3, 1fr);

  gap: 12px;

}

.stat {

  background: #f8fafc;

  border-radius: 12px;

  padding: 15px;

}

.stat b {

  display: block;

  font-size: 20px;

  margin-top: 5px;

}

.footer {

  color: #94a3b8;

  text-align: center;

  font-size: 12px;

  margin: 25px 0;

}

@media(max-width:650px) {

  .grid2,
  .info {

    grid-template-columns:
      1fr;

  }

  .nav {

    align-items:
      flex-start;

    flex-direction:
      column;

  }

}

</style>

</head>

<body>

<div class="top">

  <div class="nav">

    <div>

      <div class="brand">
        Feeder Ikan IoT
      </div>

      <div class="device">
        ${FEEDER_ID}
      </div>

    </div>

    <div class="status">

      <span
        class="
          dot
          ${online ? 'on' : ''}
        "
      ></span>

      <span id="connectionText">

        ${
          online
            ? 'Terhubung'
            : 'Offline'
        }

      </span>

    </div>

  </div>

</div>

<div class="wrap">

  <div class="tabs">

    <button
      class="tab active"
      onclick="
        showTab(
          'kontrol',
          this
        )
      "
    >
      Kontrol
    </button>

    <button
      class="tab"
      onclick="
        showTab(
          'jadwal',
          this
        )
      "
    >
      Jadwal
    </button>

    <button
      class="tab"
      onclick="
        showTab(
          'histori',
          this
        )
      "
    >
      Histori
    </button>

  </div>

  <section
    id="kontrol"
    class="panel active"
  >

    <div class="card">

      <div class="eyebrow">
        Status perangkat
      </div>

      <div
        id="motorStatus"
        class="big-status"
      >

        ${
          feederStatus.motor
            ? 'Motor sedang berjalan'
            : 'Motor berhenti'
        }

      </div>

      <div class="info">

        <div class="stat">

          Status

          <b id="statusValue">
            ${statusText}
          </b>

        </div>

        <div class="stat">

          Kecepatan

          <b id="speedStatus">
            ${feederStatus.speed ?? 50}%
          </b>

        </div>

        <div class="stat">

          Durasi

          <b id="durationStatus">
            ${feederStatus.duration ?? 10}
            detik
          </b>

        </div>

      </div>

    </div>

    <div class="card">

      <h2>
        Kontrol Manual
      </h2>

      <label>

        Kecepatan Motor

        <strong id="speedValue">
          50%
        </strong>

        <input
          id="speed"
          type="range"
          min="10"
          max="100"
          value="50"
          oninput="
            updateSpeed(
              this.value
            )
          "
        >

      </label>

      <div class="grid2">

        <label>

          Menit

          <input
            id="durationMin"
            type="number"
            min="0"
            max="60"
            value="0"
            oninput="
              updateDuration()
            "
          >

        </label>

        <label>

          Detik

          <input
            id="durationSec"
            type="number"
            min="0"
            max="59"
            value="10"
            oninput="
              updateDuration()
            "
          >

        </label>

      </div>

      <div
        id="durationValue"
        class="msg"
      >
        0 menit 10 detik
      </div>

      <div
        class="actions"
        style="margin-top:15px"
      >

        <button
          class="primary"
          onclick="
            feedNow()
          "
        >
          Beri Pakan Sekarang
        </button>

        <button
          class="danger"
          onclick="
            stopNow()
          "
        >
          STOP
        </button>

      </div>

      <div
        id="controlMsg"
        class="msg"
      ></div>

    </div>

  </section>

  <section
    id="jadwal"
    class="panel"
  >

    <div class="card">

      <h2>
        Jadwal Pemberian Pakan
      </h2>

      <p class="msg">

        Pengaturan di bawah dikirim
        ke ESP32 melalui RabbitMQ MQTT.
        ESP32 tetap menjadi perangkat
        yang menjalankan jadwal.

      </p>

    </div>

    ${scheduleCards}

  </section>

  <section
    id="histori"
    class="panel"
  >

    <div class="card">

      <h2>
        Histori
      </h2>

      <p class="msg">

        Histori pada tahap ini mengikuti
        data yang tersedia dari
        perangkat/backend.

      </p>

      <div
        id="historyBox"
        class="msg"
      >

        Belum ada histori yang dikirim
        oleh ESP32.

      </div>

    </div>

  </section>

  <div class="footer">

    Feeder Ikan IoT • ${FEEDER_ID}

  </div>

</div>

<script>

function showTab(
  id,
  btn
) {

  document
    .querySelectorAll('.panel')
    .forEach(
      x =>
        x.classList
          .remove('active')
    );

  document
    .querySelectorAll('.tab')
    .forEach(
      x =>
        x.classList
          .remove('active')
    );

  document
    .getElementById(id)
    .classList
    .add('active');

  btn.classList
    .add('active');

  if (
    id === 'jadwal'
  ) {

    getSchedules();

  }

}

function updateSpeed(v) {

  document
    .getElementById(
      'speedValue'
    )
    .textContent =
      v + '%';

}

function updateDuration() {

  let m =
    Math.max(
      0,
      Math.min(
        60,
        parseInt(
          document
            .getElementById(
              'durationMin'
            )
            .value
        ) || 0
      )
    );

  let s =
    Math.max(
      0,
      Math.min(
        59,
        parseInt(
          document
            .getElementById(
              'durationSec'
            )
            .value
        ) || 0
      )
    );

  if (
    m === 60
  ) {

    s = 0;

  }

  document
    .getElementById(
      'durationMin'
    )
    .value = m;

  document
    .getElementById(
      'durationSec'
    )
    .value = s;

  document
    .getElementById(
      'durationValue'
    )
    .textContent =
      m +
      ' menit ' +
      s +
      ' detik';

}

function updateScheduleSpeed(
  i,
  v
) {

  document
    .getElementById(
      'jspeedValue' + i
    )
    .textContent =
      v + '%';

}

async function feedNow() {

  const m =
    parseInt(
      document
        .getElementById(
          'durationMin'
        )
        .value
    ) || 0;

  const s =
    parseInt(
      document
        .getElementById(
          'durationSec'
        )
        .value
    ) || 0;

  const duration =
    (m * 60) + s;

  const speed =
    parseInt(
      document
        .getElementById(
          'speed'
        )
        .value
    );

  if (
    duration < 1 ||
    duration > 3600
  ) {

    alert(
      'Durasi harus 1 detik sampai 60 menit.'
    );

    return;

  }

  const r =
    await fetch(
      '/api/feed',
      {
        method: 'POST',

        headers: {
          'Content-Type':
            'application/json'
        },

        body:
          JSON.stringify({
            speed,
            duration
          })

      }
    );

  const d =
    await r.json();

  document
    .getElementById(
      'controlMsg'
    )
    .textContent =
      d.message ||
      d.error ||
      'Selesai';

  refreshStatus();

}

async function stopNow() {

  const r =
    await fetch(
      '/api/stop',
      {
        method: 'POST'
      }
    );

  const d =
    await r.json();

  document
    .getElementById(
      'controlMsg'
    )
    .textContent =
      d.message ||
      d.error ||
      'Selesai';

  refreshStatus();

}

async function simpanJadwal(i) {

  const payload = {

    index: i,

    aktif:
      document
        .getElementById(
          'aktif' + i
        )
        .checked
        ? 1
        : 0,

    time:
      document
        .getElementById(
          'time' + i
        )
        .value,

    speed:
      parseInt(
        document
          .getElementById(
            'speed' + i
          )
          .value
      ) || 50,

    duration:
      parseInt(
        document
          .getElementById(
            'duration' + i
          )
          .value
      ) || 1

  };

  const box =
    document
      .getElementById(
        'scheduleMsg' + i
      );

  box.textContent =
    'Menyimpan...';

  try {

    const r =
      await fetch(
        '/api/schedule',
        {
          method: 'POST',

          headers: {
            'Content-Type':
              'application/json'
          },

          body:
            JSON.stringify(
              payload
            )

        }
      );

    const d =
      await r.json();

    box.textContent =
      d.message ||
      d.error ||
      'Selesai';

    if (r.ok) {

      getSchedules();

    }

  } catch (e) {

    box.textContent =
      'Gagal menghubungi server';

  }

}

async function getSchedules() {

  try {

    const r =
      await fetch(
        '/api/schedules'
      );

    const d =
      await r.json();

    if (
      Array.isArray(
        d.schedules
      )
    ) {

      d.schedules.forEach(
        s => {

          const i =
            s.index;

          if (
            document
              .getElementById(
                'aktif' + i
              )
          ) {

            document
              .getElementById(
                'aktif' + i
              )
              .checked =
                !!s.aktif;

            document
              .getElementById(
                'time' + i
              )
              .value =
                String(
                  s.jam
                )
                  .padStart(
                    2,
                    '0'
                  ) +
                ':' +
                String(
                  s.menit
                )
                  .padStart(
                    2,
                    '0'
                  );

            document
              .getElementById(
                'speed' + i
              )
              .value =
                s.speed;

            document
              .getElementById(
                'jspeedValue' + i
              )
              .textContent =
                s.speed + '%';

            document
              .getElementById(
                'duration' + i
              )
              .value =
                s.duration;

          }

        }
      );

    }

  } catch (e) {

    console.log(e);

  }

}

async function refreshStatus() {

  try {

    const r =
      await fetch(
        '/api/status'
      );

    const d =
      await r.json();

    document
      .getElementById(
        'statusValue'
      )
      .textContent =
        d.status ||
        'offline';

    document
      .getElementById(
        'speedStatus'
      )
      .textContent =
        (d.speed ?? 50) +
        '%';

    document
      .getElementById(
        'durationStatus'
      )
      .textContent =
        (d.duration ?? 10) +
        ' detik';

    document
      .getElementById(
        'motorStatus'
      )
      .textContent =
        d.motor
          ? 'Motor sedang berjalan'
          : 'Motor berhenti';

    const online =
      d.status &&
      d.status !==
        'offline';

    document
      .querySelector(
        '.dot'
      )
      .classList
      .toggle(
        'on',
        online
      );

    document
      .getElementById(
        'connectionText'
      )
      .textContent =
        online
          ? 'Terhubung'
          : 'Offline';

  } catch (e) {}

}

setInterval(
  refreshStatus,
  3000
);

refreshStatus();

</script>

</body>

</html>`;

}

app.get(
  '/',
  (req, res) =>
    res.send(page())
);

app.get(
  '/api/status',
  (req, res) => {

    res.json({
      ...feederStatus,

      mqttConnected:
        mqttClient.connected
    });

  }
);

app.get(
  '/api/schedules',
  (req, res) => {

    res.json({

      device:
        FEEDER_ID,

      schedules

    });

  }
);

app.post(
  '/api/feed',
  (req, res) => {

    const speed =
      clamp(
        Number(
          req.body.speed
        ),
        10,
        100
      );

    const duration =
      clamp(
        Number(
          req.body.duration
        ),
        1,
        3600
      );

    const ok =
      publishCommand({

        action:
          'feed',

        device:
          FEEDER_ID,

        speed,

        duration

      });

    if (!ok) {

      return res
        .status(503)
        .json({
          error:
            'MQTT belum terhubung ke RabbitMQ.'
        });

    }

    res.json({

      success: true,

      message:
        'Perintah pemberian pakan dikirim ke ESP32.'

    });

  }
);

app.post(
  '/api/stop',
  (req, res) => {

    const ok =
      publishCommand({

        action:
          'stop',

        device:
          FEEDER_ID

      });

    if (!ok) {

      return res
        .status(503)
        .json({
          error:
            'MQTT belum terhubung ke RabbitMQ.'
        });

    }

    res.json({

      success: true,

      message:
        'Perintah STOP dikirim ke ESP32.'

    });

  }
);

app.post(
  '/api/schedule',
  (req, res) => {

    const index =
      Number(
        req.body.index
      );

    if (
      !validIndex(index)
    ) {

      return res
        .status(400)
        .json({
          error:
            'Index jadwal harus 0, 1, atau 2.'
        });

    }

    /*
      Format waktu dari halaman:
      HH:MM

      Contoh:
      07:30
      12:00
      18:45
    */

    const time =
      String(
        req.body.time || ''
      ).trim();

    const match =
      /^(\d{2}):(\d{2})$/
        .exec(time);

    if (!match) {

      return res
        .status(400)
        .json({
          error:
            'Format waktu harus HH:MM.'
        });

    }

    const jam =
      Number(
        match[1]
      );

    const menit =
      Number(
        match[2]
      );

    if (
      jam < 0 ||
      jam > 23 ||
      menit < 0 ||
      menit > 59
    ) {

      return res
        .status(400)
        .json({
          error:
            'Waktu tidak valid.'
        });

    }

    const schedule =
      normalizeSchedule({

        index,

        aktif:
          req.body.aktif,

        jam,

        menit,

        speed:
          req.body.speed,

        duration:
          req.body.duration

      });

    const ok =
      publishCommand({

        action:
          'schedule_save',

        device:
          FEEDER_ID,

        index:
          schedule.index,

        aktif:
          schedule.aktif
            ? 1
            : 0,

        jam:
          schedule.jam,

        menit:
          schedule.menit,

        speed:
          schedule.speed,

        duration:
          schedule.duration

      });

    if (!ok) {

      return res
        .status(503)
        .json({
          error:
            'MQTT belum terhubung ke RabbitMQ.'
        });

    }

    schedules[index] =
      schedule;

    res.json({

      success: true,

      message:
        `Jadwal ${index + 1} dikirim ke ESP32.`,

      schedule

    });

  }
);

app.post(
  '/api/schedules/get',
  (req, res) => {

    const ok =
      publishCommand({

        action:
          'schedule_get',

        device:
          FEEDER_ID

      });

    if (!ok) {

      return res
        .status(503)
        .json({
          error:
            'MQTT belum terhubung ke RabbitMQ.'
        });

    }

    res.json({

      success: true,

      message:
        'Permintaan jadwal dikirim ke ESP32.'

    });

  }
);

app.listen(
  PORT,
  () => {

    console.log(
      `Web Superb berjalan di port ${PORT}`
    );

    console.log(
      `Feeder: ${FEEDER_ID}`
    );

    console.log(
      `MQTT: ${MQTT_HOST}:${MQTT_PORT}`
    );

    console.log(
      `Command topic: ${COMMAND_TOPIC}`
    );

    console.log(
      `Status topic: ${STATUS_TOPIC}`
    );

  }
);
