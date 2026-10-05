const express = require("express");
const mqtt = require("mqtt");

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const MQTT_HOST = process.env.MQTT_HOST || "mqtt://195.35.23.135";
const MQTT_PORT = Number(process.env.MQTT_PORT || 1883);
const MQTT_USER = process.env.MQTT_USER || "/ai-automation:mhs_kuliah";
const MQTT_PASSWORD = process.env.MQTT_PASSWORD || "";

const FEEDER_ID = "FEEDER-001";
const COMMAND_TOPIC = `feeder/${FEEDER_ID}/command`;
const STATUS_TOPIC = `feeder/${FEEDER_ID}/status`;

let latestStatus = {
  device: FEEDER_ID,
  status: "offline",
  motor: false,
  speed: 0,
  duration: 0,
  reason: "backend_start",
  lastFeeding: null
};

let schedules = [
  {
    index: 0,
    aktif: false,
    time: "07:00",
    speed: 50,
    duration: 10
  },
  {
    index: 1,
    aktif: false,
    time: "12:00",
    speed: 50,
    duration: 10
  },
  {
    index: 2,
    aktif: false,
    time: "17:00",
    speed: 50,
    duration: 10
  }
];

let history = [];

const mqttClient = mqtt.connect(MQTT_HOST, {
  port: MQTT_PORT,
  username: MQTT_USER,
  password: MQTT_PASSWORD,
  reconnectPeriod: 5000
});

mqttClient.on("connect", () => {
  console.log("MQTT TERHUBUNG");

  mqttClient.subscribe(
    STATUS_TOPIC,
    { qos: 1 },
    (err) => {
      if (err) {
        console.error("Subscribe status gagal:", err.message);
      } else {
        console.log("Subscribe:", STATUS_TOPIC);
      }
    }
  );

  mqttClient.publish(
    COMMAND_TOPIC,
    JSON.stringify({
      action: "status",
      device: FEEDER_ID
    }),
    { qos: 1 }
  );

  mqttClient.publish(
    COMMAND_TOPIC,
    JSON.stringify({
      action: "schedule_get",
      device: FEEDER_ID
    }),
    { qos: 1 }
  );
});

mqttClient.on("reconnect", () => {
  console.log("MQTT mencoba reconnect...");
});

mqttClient.on("error", (err) => {
  console.error("MQTT error:", err.message);
});

mqttClient.on("message", (topic, message) => {
  if (topic !== STATUS_TOPIC) return;

  try {
    const data = JSON.parse(message.toString());

    console.log("STATUS ESP32:", data);

    /*
     * ==========================================================
     * SINKRONISASI JADWAL DARI ESP32
     * ==========================================================
     */

    if (
      data.status === "schedule_state" &&
      Array.isArray(data.schedules)
    ) {
      schedules = data.schedules.map((s, i) => ({
        index: Number(s.index ?? i),

        aktif:
          Number(s.aktif) === 1 ||
          s.aktif === true,

        time:
          `${String(Number(s.jam) || 0).padStart(2, "0")}:` +
          `${String(Number(s.menit) || 0).padStart(2, "0")}`,

        speed: Number(s.speed) || 50,

        duration: Number(s.duration) || 10
      }));

      console.log("Jadwal tersinkronisasi:", schedules);

    } else {

      /*
       * ========================================================
       * UPDATE STATUS FEEDER
       * ========================================================
       */

      latestStatus = {
        ...latestStatus,
        ...data,
        lastUpdate: new Date().toISOString()
      };
    }

    /*
     * ==========================================================
     * PENCATATAN HISTORI PEMBERIAN PAKAN
     * ==========================================================
     *
     * Jangan langsung menggunakan data.duration dari MQTT
     * sebagai durasi histori.
     *
     * Untuk jadwal, backend mencocokkan waktu event dengan
     * jadwal aktif dan mengambil speed + duration dari konfigurasi
     * jadwal yang sudah tersimpan.
     */

    if (
      data.status === "feeding" ||
      data.status === "running"
    ) {

      const now = new Date();

      let eventSpeed = Number(data.speed) || 0;
      let eventDuration = Number(data.duration) || 0;

      let eventSource = "Manual";

      /*
       * ========================================================
       * AMBIL JAM WIB
       * ========================================================
       */

      const parts = new Intl.DateTimeFormat(
        "en-GB",
        {
          timeZone: "Asia/Jakarta",
          hour: "2-digit",
          minute: "2-digit",
          hour12: false
        }
      ).formatToParts(now);

      const currentHour = Number(
        parts.find(
          p => p.type === "hour"
        )?.value || 0
      );

      const currentMinute = Number(
        parts.find(
          p => p.type === "minute"
        )?.value || 0
      );

      const currentTotalMinutes =
        currentHour * 60 +
        currentMinute;

      /*
       * ========================================================
       * CARI JADWAL YANG SESUAI
       * ========================================================
       */

      let matchedSchedule = null;

      let smallestDifference = Infinity;

      for (const schedule of schedules) {

        if (!schedule.aktif) {
          continue;
        }

        const [sh, sm] =
          String(schedule.time || "00:00")
            .split(":")
            .map(Number);

        if (
          !Number.isFinite(sh) ||
          !Number.isFinite(sm)
        ) {
          continue;
        }

        const scheduleTotalMinutes =
          sh * 60 +
          sm;

        const difference =
          Math.abs(
            scheduleTotalMinutes -
            currentTotalMinutes
          );

        /*
         * Toleransi 1 menit.
         */

        if (
          difference <= 1 &&
          difference < smallestDifference
        ) {

          smallestDifference = difference;

          matchedSchedule = schedule;
        }
      }

      /*
       * ========================================================
       * JIKA EVENT BERASAL DARI JADWAL
       * ========================================================
       */

      if (matchedSchedule) {

        eventSpeed =
          Number(matchedSchedule.speed) ||
          eventSpeed;

        eventDuration =
          Number(matchedSchedule.duration) ||
          eventDuration;

        eventSource =
          `Jadwal ${Number(matchedSchedule.index) + 1}`;
      }

      /*
       * ========================================================
       * CEGAH HISTORI DUPLIKAT
       * ========================================================
       */

      const duplicate =
        history.some(h => {

          const historyTime =
            new Date(h.time).getTime();

          const currentTime =
            now.getTime();

          return (
            h.source === eventSource &&
            Math.abs(
              historyTime -
              currentTime
            ) < 10000
          );
        });

      /*
       * ========================================================
       * SIMPAN HISTORI
       * ========================================================
       */

      if (!duplicate) {

        history.unshift({

          time:
            now.toISOString(),

          speed:
            eventSpeed,

          duration:
            eventDuration,

          status:
            "Selesai/berjalan",

          source:
            eventSource
        });

        /*
         * Maksimal 50 histori.
         */

        history =
          history.slice(0, 50);
      }

      /*
       * ========================================================
       * SIMPAN PENYEBARAN TERAKHIR
       * ========================================================
       */

      latestStatus = {

        ...latestStatus,

        lastFeeding: {

          time:
            now.toISOString(),

          speed:
            eventSpeed,

          duration:
            eventDuration,

          source:
            eventSource
        }
      };
    }

  } catch (err) {

    console.error(
      "Payload MQTT bukan JSON valid:",
      err.message
    );
  }
});


/*
 * ============================================================
 * FUNGSI KIRIM COMMAND MQTT
 * ============================================================
 */

function publishCommand(payload) {

  return new Promise(
    (resolve, reject) => {

      if (!mqttClient.connected) {

        return reject(
          new Error(
            "MQTT belum terhubung"
          )
        );
      }

      mqttClient.publish(

        COMMAND_TOPIC,

        JSON.stringify({
          ...payload,
          device: FEEDER_ID
        }),

        {
          qos: 1
        },

        (err) => {

          if (err) {

            reject(err);

          } else {

            resolve();
          }
        }
      );
    }
  );
}


/*
 * ============================================================
 * API STATUS
 * ============================================================
 */

app.get(
  "/api/status",
  (req, res) => {

    res.json(
      latestStatus
    );
  }
);


/*
 * ============================================================
 * API MANUAL FEED
 * ============================================================
 */

app.post(
  "/api/feed",
  async (req, res) => {

    try {

      const speed =
        Math.max(
          10,
          Math.min(
            100,
            Number(
              req.body.speed
            ) || 50
          )
        );

      const duration =
        Math.max(
          1,
          Math.min(
            3600,
            Number(
              req.body.duration
            ) || 10
          )
        );

      await publishCommand({

        action:
          "feed",

        speed:
          speed,

        duration:
          duration
      });

      res.json({

        success:
          true,

        message:
          "Perintah pemberian pakan dikirim",

        speed:
          speed,

        duration:
          duration
      });

    } catch (err) {

      res.status(500).json({

        success:
          false,

        message:
          err.message
      });
    }
  }
);


/*
 * ============================================================
 * API STOP
 * ============================================================
 */

app.post(
  "/api/stop",
  async (req, res) => {

    try {

      await publishCommand({
        action: "stop"
      });

      res.json({

        success:
          true,

        message:
          "Perintah stop dikirim"
      });

    } catch (err) {

      res.status(500).json({

        success:
          false,

        message:
          err.message
      });
    }
  }
);


/*
 * ============================================================
 * API GET SCHEDULE
 * ============================================================
 */

app.get(
  "/api/schedules",
  (req, res) => {

    res.json(
      schedules
    );
  }
);


/*
 * ============================================================
 * API SAVE SCHEDULE
 * ============================================================
 */

app.post(
  "/api/schedule",
  async (req, res) => {

    try {

      const index =
        Number(
          req.body.index
        );

      if (
        ![0, 1, 2].includes(index)
      ) {

        return res.status(400).json({

          success:
            false,

          message:
            "Index jadwal tidak valid"
        });
      }

      const aktif =
        req.body.aktif === true ||
        req.body.aktif === 1 ||
        req.body.aktif === "1";

      const time =
        String(
          req.body.time || ""
        );

      const match =
        /^([01]\d|2[0-3]):([0-5]\d)$/
          .exec(time);

      if (!match) {

        return res.status(400).json({

          success:
            false,

          message:
            "Format waktu harus HH:MM"
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

      const speed =
        Math.max(
          10,
          Math.min(
            100,
            Number(
              req.body.speed
            ) || 50
          )
        );

      const duration =
        Math.max(
          1,
          Math.min(
            3600,
            Number(
              req.body.duration
            ) || 10
          )
        );

      /*
       * Kirim konfigurasi jadwal ke ESP32.
       */

      await publishCommand({

        action:
          "schedule_save",

        index:
          index,

        aktif:
          aktif ? 1 : 0,

        jam:
          jam,

        menit:
          menit,

        speed:
          speed,

        duration:
          duration
      });

      /*
       * Simpan juga di backend.
       */

      schedules[index] = {

        index:
          index,

        aktif:
          aktif,

        time:
          time,

        speed:
          speed,

        duration:
          duration
      };

      res.json({

        success:
          true,

        message:
          `Jadwal ${index + 1} berhasil disimpan`,

        schedule:
          schedules[index]
      });

    } catch (err) {

      res.status(500).json({

        success:
          false,

        message:
          err.message
      });
    }
  }
);


/*
 * ============================================================
 * API REQUEST SCHEDULE GET
 * ============================================================
 */

app.get(
  "/api/schedules/get",
  async (req, res) => {

    try {

      await publishCommand({

        action:
          "schedule_get"
      });

      res.json({

        success:
          true,

        message:
          "Permintaan jadwal dikirim",

        schedules:
          schedules
      });

    } catch (err) {

      res.status(500).json({

        success:
          false,

        message:
          err.message
      });
    }
  }
);


/*
 * ============================================================
 * API HISTORY
 * ============================================================
 */

app.get(
  "/api/history",
  (req, res) => {

    res.json(
      history
    );
  }
);


/*
 * ============================================================
 * WEB INTERFACE
 * ============================================================
 */

app.get(
  "/",
  (req, res) => {

    res.send(`<!DOCTYPE html>

<html lang="id">

<head>

<meta charset="UTF-8">

<meta
  name="viewport"
  content="width=device-width, initial-scale=1.0"
>

<title>Feeder Ikan IoT</title>

<style>

*{
  box-sizing:border-box
}

body{
  margin:0;
  font-family:Arial,sans-serif;
  background:#f4f7fb;
  color:#172033
}

header{
  background:#1565c0;
  color:white;
  padding:18px 20px
}

header h1{
  margin:0;
  font-size:22px
}

.container{
  max-width:900px;
  margin:auto;
  padding:18px
}

.tabs{
  display:flex;
  gap:8px;
  margin-bottom:18px;
  flex-wrap:wrap
}

.tab{
  border:0;
  padding:11px 18px;
  border-radius:10px;
  background:#dfe8f5;
  cursor:pointer;
  font-weight:bold
}

.tab.active{
  background:#1565c0;
  color:white
}

.page{
  display:none
}

.page.active{
  display:block
}

.card{
  background:white;
  border-radius:16px;
  padding:18px;
  margin-bottom:16px;
  box-shadow:
    0 3px 14px rgba(0,0,0,.07)
}

.row{
  display:flex;
  gap:12px;
  align-items:center;
  flex-wrap:wrap
}

label{
  font-weight:bold;
  display:block;
  margin:10px 0 6px
}

input,
button{
  font:inherit
}

input[type=number],
input[type=time]{
  width:100%;
  padding:11px;
  border:
    1px solid #ccd5e2;
  border-radius:9px
}

input[type=range]{
  width:100%
}

button.action{
  border:0;
  border-radius:10px;
  padding:12px 18px;
  cursor:pointer;
  font-weight:bold
}

.start{
  background:#2e7d32;
  color:white
}

.stop{
  background:#c62828;
  color:white
}

.save{
  background:#1565c0;
  color:white
}

.status{
  padding:10px 12px;
  border-radius:10px;
  background:#eef3f9;
  margin-top:12px
}

.schedule{
  border:
    1px solid #e1e7ef;
  border-radius:14px;
  padding:15px;
  margin-bottom:14px
}

.schedule h3{
  margin-top:0
}

.switch{
  display:flex;
  align-items:center;
  gap:8px;
  margin-bottom:10px
}

.history-item{
  border-bottom:
    1px solid #e7ebf0;
  padding:10px 0
}

.small{
  font-size:13px;
  color:#667085
}

</style>

</head>

<body>

<header>

<h1>
🐟 Feeder Ikan IoT
</h1>

</header>

<div class="container">

<div class="tabs">

<button
  class="tab active"
  onclick="showPage('kontrol',this)"
>
Kontrol
</button>

<button
  class="tab"
  onclick="showPage('jadwal',this)"
>
Jadwal
</button>

<button
  class="tab"
  onclick="showPage('histori',this)"
>
Histori
</button>

</div>


<!-- ========================================================
     KONTROL
========================================================= -->

<section
  id="kontrol"
  class="page active"
>

<div class="card">

<h2>
Status Feeder
</h2>

<div
  id="status"
  class="status"
>
Memuat...
</div>

</div>


<div class="card">

<h2>
Kontrol Manual
</h2>

<label>
Kecepatan Motor:
<span id="speedValue">
50
</span>%
</label>

<input
  id="speed"
  type="range"
  min="10"
  max="100"
  value="50"
  oninput="speedValue.textContent=this.value"
>

<label>
Durasi Motor (detik)
</label>

<input
  id="duration"
  type="number"
  min="1"
  max="3600"
  value="10"
>

<div
  class="row"
  style="margin-top:16px"
>

<button
  class="action start"
  onclick="feed()"
>
▶ Mulai Pakan
</button>

<button
  class="action stop"
  onclick="stopMotor()"
>
■ Stop
</button>

</div>

</div>

</section>


<!-- ========================================================
     JADWAL
========================================================= -->

<section
  id="jadwal"
  class="page"
>

<div class="card">

<h2>
Jadwal Pemberian Pakan
</h2>

<div
  id="scheduleList"
>
Memuat jadwal...
</div>

</div>

</section>


<!-- ========================================================
     HISTORI
========================================================= -->

<section
  id="histori"
  class="page"
>

<div class="card">

<h2>
Histori
</h2>

<div
  id="historyList"
>
Belum ada histori.
</div>

</div>

</section>

</div>


<script>

/*
 * ==========================================================
 * NAVIGASI HALAMAN
 * ==========================================================
 */

function showPage(id, btn){

  document
    .querySelectorAll('.page')
    .forEach(
      p => p.classList.remove('active')
    );

  document
    .querySelectorAll('.tab')
    .forEach(
      t => t.classList.remove('active')
    );

  document
    .getElementById(id)
    .classList.add('active');

  btn.classList.add('active');

  if(id === 'jadwal'){
    loadSchedules();
  }

  if(id === 'histori'){
    loadHistory();
  }

  if(id === 'kontrol'){
    loadStatus();
  }
}


/*
 * ==========================================================
 * MANUAL FEED
 * ==========================================================
 */

async function feed(){

  const speed =
    Number(
      document
        .getElementById('speed')
        .value
    );

  const duration =
    Number(
      document
        .getElementById('duration')
        .value
    );

  const r =
    await fetch(
      '/api/feed',
      {
        method:'POST',

        headers:{
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

  alert(
    d.message ||
    'Perintah dikirim'
  );

  loadStatus();
}


/*
 * ==========================================================
 * STOP MOTOR
 * ==========================================================
 */

async function stopMotor(){

  const r =
    await fetch(
      '/api/stop',
      {
        method:'POST'
      }
    );

  const d =
    await r.json();

  alert(
    d.message ||
    'Stop dikirim'
  );

  loadStatus();
}


/*
 * ==========================================================
 * STATUS FEEDER
 * ==========================================================
 */

async function loadStatus(){

  try{

    const r =
      await fetch(
        '/api/status'
      );

    const d =
      await r.json();

    const online =
      d.status !== 'offline';


    /*
     * Penyebaran terakhir
     */

    let lastFeedingHtml =
      '<div ' +
      'style="' +
      'margin-top:14px;' +
      'padding-top:14px;' +
      'border-top:1px solid #e7ebf0' +
      '">';

    lastFeedingHtml +=
      '<b>Penyebaran Pakan Terakhir</b>';


    if(
      d.lastFeeding &&
      d.lastFeeding.time
    ){

      const lastTime =
        new Date(
          d.lastFeeding.time
        ).toLocaleString(
          'id-ID'
        );

      lastFeedingHtml +=
        '<br>' +
        '<span class="small">' +
        lastTime +
        '</span>';

      lastFeedingHtml +=
        '<br>Kecepatan: ' +
        (d.lastFeeding.speed || 0) +
        '%';

      lastFeedingHtml +=
        '<br>Durasi: ' +
        (d.lastFeeding.duration || 0) +
        ' detik';

    }else{

      lastFeedingHtml +=
        '<br>' +
        '<span class="small">' +
        'Belum ada penyebaran pakan' +
        '</span>';
    }

    lastFeedingHtml +=
      '</div>';


    /*
     * Status utama
     */

    document
      .getElementById('status')
      .innerHTML =

      '<b>Device:</b> ' +
      (
        d.device ||
        'FEEDER-001'
      ) +

      '<br><b>Status:</b> ' +
      (
        online
          ? 'Online'
          : 'Offline'
      ) +

      '<br><b>Motor:</b> ' +
      (
        d.motor
          ? 'Berjalan'
          : 'Berhenti'
      ) +

      lastFeedingHtml;


  }catch(e){

    document
      .getElementById('status')
      .textContent =
      'Gagal mengambil status';
  }
}


/*
 * ==========================================================
 * LOAD JADWAL
 * ==========================================================
 */

async function loadSchedules(){

  const r =
    await fetch(
      '/api/schedules'
    );

  const data =
    await r.json();


  document
    .getElementById(
      'scheduleList'
    )
    .innerHTML =

    data.map(
      (s,i) => `

      <div class="schedule">

        <h3>
          Jadwal ${i+1}
        </h3>

        <div class="switch">

          <input
            id="aktif${i}"
            type="checkbox"
            ${s.aktif ? 'checked' : ''}
          >

          <span>
            Aktif
          </span>

        </div>


        <label>
          Waktu
        </label>

        <input
          id="time${i}"
          type="time"
          value="${s.time}"
        >


        <label>
          Kecepatan Motor (%)
        </label>

        <input
          id="speed${i}"
          type="number"
          min="10"
          max="100"
          value="${s.speed}"
        >


        <label>
          Durasi Motor (detik)
        </label>

        <input
          id="duration${i}"
          type="number"
          min="1"
          max="3600"
          value="${s.duration}"
        >


        <button
          class="action save"
          style="margin-top:14px"
          onclick="simpanJadwal(${i})"
        >
          Simpan Jadwal
        </button>

      </div>

      `
    )
    .join('');
}


/*
 * ==========================================================
 * SIMPAN JADWAL
 * ==========================================================
 */

async function simpanJadwal(i){

  const payload = {

    index:
      i,

    aktif:
      document
        .getElementById(
          'aktif' + i
        )
        .checked,

    time:
      document
        .getElementById(
          'time' + i
        )
        .value,

    speed:
      Number(
        document
          .getElementById(
            'speed' + i
          )
          .value
      ),

    duration:
      Number(
        document
          .getElementById(
            'duration' + i
          )
          .value
      )
  };


  const r =
    await fetch(
      '/api/schedule',
      {
        method:'POST',

        headers:{
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


  alert(
    d.message ||
    'Jadwal disimpan'
  );


  if(d.success){

    loadSchedules();
  }
}


/*
 * ==========================================================
 * LOAD HISTORY
 * ==========================================================
 */

async function loadHistory(){

  try{

    const r =
      await fetch(
        '/api/history'
      );

    const data =
      await r.json();


    document
      .getElementById(
        'historyList'
      )
      .innerHTML =

      data.length

        ? data.map(
            h => `

            <div class="history-item">

              <b>
                ${
                  new Date(
                    h.time
                  ).toLocaleString(
                    'id-ID'
                  )
                }
              </b>

              <br>

              Kecepatan:
              ${h.speed}%

              <br>

              Durasi:
              ${h.duration} detik

              <br>

              <span class="small">

                ${
                  h.source
                    ? h.source + ' • '
                    : ''
                }

                ${
                  h.status || ''
                }

              </span>

            </div>

            `
          ).join('')

        : 'Belum ada histori.';


  }catch(e){

    document
      .getElementById(
        'historyList'
      )
      .textContent =
      'Belum ada histori.';
  }
}


/*
 * ==========================================================
 * LOAD STATUS PERTAMA KALI
 * ==========================================================
 */

loadStatus();


/*
 * Update status setiap 5 detik.
 */

setInterval(
  loadStatus,
  5000
);

</script>

</body>

</html>`);
});


/*
 * ============================================================
 * START SERVER
 * ============================================================
 */

app.listen(
  PORT,
  "0.0.0.0",
  () => {

    console.log(
      `Server berjalan di port ${PORT}`
    );
  }
);
