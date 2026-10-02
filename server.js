const express = require("express");
const mqtt = require("mqtt");

const app = express();

app.use(express.json());

const PORT = process.env.PORT || 8080;

const MQTT_HOST = process.env.MQTT_HOST;
const MQTT_PORT = Number(process.env.MQTT_PORT || 1883);
const MQTT_USER = process.env.MQTT_USER;
const MQTT_PASSWORD = process.env.MQTT_PASSWORD;

const FEEDER_ID = "FEEDER-001";

const MQTT_COMMAND_TOPIC =
  `feeder/${FEEDER_ID}/command`;

const MQTT_STATUS_TOPIC =
  `feeder/${FEEDER_ID}/status`;

let feederStatus = {
  device: FEEDER_ID,
  status: "unknown",
  motor: false,
  speed: 50,
  duration: 10
};

const mqttClient = mqtt.connect(MQTT_HOST, {
  port: MQTT_PORT,
  username: MQTT_USER,
  password: MQTT_PASSWORD,
  reconnectPeriod: 5000
});

mqttClient.on("connect", () => {
  console.log("MQTT TERHUBUNG");

  mqttClient.subscribe(
    MQTT_STATUS_TOPIC,
    { qos: 1 },
    (err) => {
      if (err) {
        console.error("Gagal subscribe:", err.message);
      } else {
        console.log(
          "Subscribe:",
          MQTT_STATUS_TOPIC
        );
      }
    }
  );
});

mqttClient.on("message", (topic, message) => {
  try {
    const data = JSON.parse(message.toString());

    console.log("STATUS ESP32:", data);

    feederStatus = {
      ...feederStatus,
      ...data
    };
  } catch (error) {
    console.error(
      "Payload MQTT tidak valid:",
      error.message
    );
  }
});

mqttClient.on("error", (error) => {
  console.error(
    "MQTT ERROR:",
    error.message
  );
});

mqttClient.on("offline", () => {
  console.log("MQTT OFFLINE");
});


// ===============================
// DASHBOARD
// ===============================

app.get("/", (req, res) => {
  res.send(`
<!DOCTYPE html>
<html lang="id">

<head>
<meta charset="UTF-8">
<meta name="viewport"
content="width=device-width, initial-scale=1.0">

<title>Feeder Ikan IoT</title>

<style>

* {
  box-sizing: border-box;
}

body {
  margin: 0;
  font-family: Arial, sans-serif;
  background: #eef6ff;
  color: #1e293b;
}

.container {
  max-width: 500px;
  margin: auto;
  padding: 18px;
}

.header {
  background: #2563eb;
  color: white;
  padding: 22px;
  border-radius: 20px;
  margin-bottom: 15px;
}

.header h1 {
  margin: 0;
  font-size: 25px;
}

.header p {
  margin: 7px 0 0;
  opacity: .85;
}

.card {
  background: white;
  padding: 20px;
  border-radius: 18px;
  margin-bottom: 15px;
  box-shadow: 0 5px 15px rgba(0,0,0,.08);
}

.title {
  font-size: 19px;
  font-weight: bold;
  margin-bottom: 15px;
}

.status {
  padding: 14px;
  border-radius: 12px;
  background: #f1f5f9;
  margin-bottom: 18px;
}

.status.online {
  background: #dcfce7;
  color: #15803d;
}

label {
  display: block;
  font-weight: bold;
  margin-bottom: 8px;
}

input[type="range"] {
  width: 100%;
}

.value {
  text-align: center;
  font-size: 20px;
  font-weight: bold;
  color: #2563eb;
  margin: 8px 0 18px;
}

button {
  width: 100%;
  border: 0;
  padding: 15px;
  border-radius: 12px;
  color: white;
  font-size: 16px;
  font-weight: bold;
  margin-top: 10px;
  cursor: pointer;
}

.feed {
  background: #16a34a;
}

.stop {
  background: #dc2626;
}

.info {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}

.info div {
  background: #f8fafc;
  padding: 12px;
  border-radius: 10px;
  text-align: center;
}

.small {
  font-size: 12px;
  color: #64748b;
}

</style>
</head>

<body>

<div class="container">

<div class="header">
  <h1>🐟 Feeder Ikan IoT</h1>
  <p>Remote Control • FEEDER-001</p>
</div>

<div class="card">

<div id="status"
class="status">
  ● Memeriksa koneksi...
</div>

<div class="info">

<div>
  <div class="small">Motor</div>
  <strong id="motor">-</strong>
</div>

<div>
  <div class="small">Status</div>
  <strong id="feedStatus">-</strong>
</div>

</div>

</div>

<div class="card">

<div class="title">
  🎛️ Kontrol Pakan
</div>

<label>
  Kecepatan
</label>

<input
  id="speed"
  type="range"
  min="10"
  max="100"
  value="50"
  oninput="updateValue()"
>

<div
class="value"
id="speedValue">
50%
</div>

<label>
  Durasi
</label>

<input
  id="duration"
  type="range"
  min="1"
  max="60"
  value="10"
  oninput="updateValue()"
>

<div
class="value"
id="durationValue">
10 detik
</div>

<button
class="feed"
onclick="feed()">
🐟 KASIH PAKAN
</button>

<button
class="stop"
onclick="stopMotor()">
⛔ STOP
</button>

</div>

</div>

<script>

function updateValue() {

  const speed =
    document.getElementById("speed").value;

  const duration =
    document.getElementById("duration").value;

  document.getElementById("speedValue")
    .innerText = speed + "%";

  document.getElementById("durationValue")
    .innerText = duration + " detik";
}


async function feed() {

  const speed =
    Number(document.getElementById("speed").value);

  const duration =
    Number(document.getElementById("duration").value);

  const response =
    await fetch("/api/feed", {

      method: "POST",

      headers: {
        "Content-Type":
        "application/json"
      },

      body: JSON.stringify({
        speed,
        duration
      })

    });

  const data =
    await response.json();

  alert(data.message || data.error);
}


async function stopMotor() {

  const response =
    await fetch("/api/stop", {
      method: "POST"
    });

  const data =
    await response.json();

  alert(data.message || data.error);
}


async function updateStatus() {

  try {

    const response =
      await fetch("/api/status");

    const data =
      await response.json();

    const status =
      document.getElementById("status");

    if (
      data.status === "online" ||
      data.status === "idle" ||
      data.status === "feeding"
    ) {

      status.className =
        "status online";

      status.innerText =
        "● Online";

    } else {

      status.className =
        "status";

      status.innerText =
        "● " + data.status;

    }

    document.getElementById("motor")
      .innerText =
      data.motor ? "BEKERJA" : "STOP";

    document.getElementById("feedStatus")
      .innerText =
      data.status || "-";

  } catch (error) {

    document.getElementById("status")
      .innerText =
      "● Backend tidak dapat dihubungi";

  }

}


updateValue();
updateStatus();

setInterval(
  updateStatus,
  3000
);

</script>

</body>
</html>
  `);
});


// ===============================
// API STATUS
// ===============================

app.get("/api/status", (req, res) => {

  res.json(feederStatus);

});


// ===============================
// API FEED
// ===============================

app.post("/api/feed", (req, res) => {

  const speed =
    Math.min(
      100,
      Math.max(
        10,
        Number(req.body.speed || 50)
      )
    );

  const duration =
    Math.min(
      3600,
      Math.max(
        1,
        Number(req.body.duration || 10)
      )
    );

  const payload =
    JSON.stringify({
      action: "feed",
      speed,
      duration
    });

  mqttClient.publish(
    MQTT_COMMAND_TOPIC,
    payload,
    { qos: 1 },
    (error) => {

      if (error) {

        console.error(
          "Gagal kirim feed:",
          error.message
        );

        return res.status(500).json({
          error:
            "Gagal mengirim perintah ke feeder."
        });
      }

      console.log(
        "COMMAND FEED:",
        payload
      );

      res.json({
        success: true,
        message:
          "Perintah pemberian pakan dikirim."
      });

    }
  );

});


// ===============================
// API STOP
// ===============================

app.post("/api/stop", (req, res) => {

  const payload =
    JSON.stringify({
      action: "stop"
    });

  mqttClient.publish(
    MQTT_COMMAND_TOPIC,
    payload,
    { qos: 1 },
    (error) => {

      if (error) {

        return res.status(500).json({
          error:
            "Gagal mengirim perintah STOP."
        });

      }

      console.log(
        "COMMAND STOP"
      );

      res.json({
        success: true,
        message:
          "Perintah STOP dikirim."
      });

    }
  );

});


// ===============================
// START SERVER
// ===============================

app.listen(PORT, () => {

  console.log(
    `Backend berjalan pada port ${PORT}`
  );

});
