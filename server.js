const express = require("express");
const mqtt = require("mqtt");

const app = express();

app.use(express.json());

const PORT = process.env.PORT || 3000;

const MQTT_HOST =
  process.env.MQTT_HOST || "mqtt://195.35.23.135";

const MQTT_PORT =
  Number(process.env.MQTT_PORT) || 1883;

const MQTT_USER =
  process.env.MQTT_USER || "/ai-automation:mhs_kuliah";

const MQTT_PASSWORD =
  process.env.MQTT_PASSWORD || "";

const FEEDER_ID = "FEEDER-001";

const MQTT_COMMAND_TOPIC =
  `feeder/${FEEDER_ID}/command`;

const MQTT_STATUS_TOPIC =
  `feeder/${FEEDER_ID}/status`;


/* =====================================================
   STATUS FEEDER
===================================================== */

let feederStatus = {
  device: FEEDER_ID,
  status: "offline",
  motor: false,
  speed: 50,
  duration: 10,
  reason: ""
};


/* =====================================================
   MQTT CONNECTION
===================================================== */

const mqttClient = mqtt.connect(MQTT_HOST, {
  port: MQTT_PORT,

  username: MQTT_USER,

  password: MQTT_PASSWORD,

  clientId:
    `backend-${FEEDER_ID}-${Date.now()}`,

  reconnectPeriod: 5000
});


/* =====================================================
   MQTT CONNECTED
===================================================== */

mqttClient.on("connect", () => {

  console.log("MQTT TERHUBUNG");

  mqttClient.subscribe(
    MQTT_STATUS_TOPIC,
    { qos: 1 },
    (error) => {

      if (error) {

        console.error(
          "Gagal subscribe:",
          error.message
        );

      } else {

        console.log(
          "Subscribe:",
          MQTT_STATUS_TOPIC
        );

      }

    }
  );

});


/* =====================================================
   MQTT MESSAGE
===================================================== */

mqttClient.on(
  "message",
  (topic, message) => {

    if (
      topic !== MQTT_STATUS_TOPIC
    ) {
      return;
    }

    try {

      const data =
        JSON.parse(
          message.toString()
        );

      feederStatus = {
        ...feederStatus,
        ...data
      };

      console.log(
        "STATUS FEEDER:",
        feederStatus
      );

    } catch (error) {

      console.error(
        "Status MQTT bukan JSON:",
        message.toString()
      );

    }

  }
);


/* =====================================================
   MQTT ERROR
===================================================== */

mqttClient.on(
  "error",
  (error) => {

    console.error(
      "MQTT error:",
      error.message
    );

  }
);


/* =====================================================
   MQTT RECONNECT
===================================================== */

mqttClient.on(
  "reconnect",
  () => {

    console.log(
      "MQTT mencoba reconnect..."
    );

  }
);


/* =====================================================
   MQTT OFFLINE
===================================================== */

mqttClient.on(
  "offline",
  () => {

    console.log(
      "MQTT offline"
    );

  }
);


/* =====================================================
   KIRIM COMMAND MQTT
===================================================== */

function kirimCommand(command) {

  if (!mqttClient.connected) {

    console.log(
      "MQTT belum terhubung"
    );

    return false;

  }

  mqttClient.publish(
    MQTT_COMMAND_TOPIC,

    JSON.stringify(command),

    {
      qos: 1
    },

    (error) => {

      if (error) {

        console.error(
          "Gagal publish:",
          error.message
        );

      }

    }
  );

  console.log(
    "COMMAND:",
    JSON.stringify(command)
  );

  return true;
}


/* =====================================================
   API STATUS
===================================================== */

app.get(
  "/api/status",
  (req, res) => {

    res.json({

      success: true,

      mqttConnected:
        mqttClient.connected,

      feeder:
        feederStatus

    });

  }
);


/* =====================================================
   API FEED
===================================================== */

app.post(
  "/api/feed",
  (req, res) => {

    const speed =
      Number(req.body.speed) || 50;

    const duration =
      Number(req.body.duration) || 10;


    if (
      speed < 10 ||
      speed > 100
    ) {

      return res.status(400).json({

        success: false,

        message:
          "Speed harus 10-100%"

      });

    }


    if (
      duration < 1 ||
      duration > 3600
    ) {

      return res.status(400).json({

        success: false,

        message:
          "Durasi harus 1-3600 detik"

      });

    }


    const command = {

      action: "feed",

      device: FEEDER_ID,

      speed: speed,

      duration: duration

    };


    const sent =
      kirimCommand(command);


    if (!sent) {

      return res.status(503).json({

        success: false,

        message:
          "Backend belum terhubung ke MQTT"

      });

    }


    res.json({

      success: true,

      message:
        "Perintah Feed dikirim",

      command:
        command

    });

  }
);


/* =====================================================
   API STOP
===================================================== */

app.post(
  "/api/stop",
  (req, res) => {

    const command = {

      action: "stop",

      device: FEEDER_ID

    };


    const sent =
      kirimCommand(command);


    if (!sent) {

      return res.status(503).json({

        success: false,

        message:
          "Backend belum terhubung ke MQTT"

      });

    }


    res.json({

      success: true,

      message:
        "Perintah Stop dikirim"

    });

  }
);


/* =====================================================
   WEB SUPERB
===================================================== */

app.get(
  "/",
  (req, res) => {

    res.send(`

<!DOCTYPE html>

<html lang="id">

<head>

  <meta charset="UTF-8">

  <meta
    name="viewport"
    content="width=device-width, initial-scale=1.0"
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
        Arial,
        Helvetica,
        sans-serif;

      background: #f4f7fb;

      color: #1f2937;

    }


    .container {

      max-width: 900px;

      margin: auto;

      padding: 20px;

    }


    .header {

      background: white;

      padding: 20px;

      border-radius: 16px;

      margin-bottom: 20px;

      box-shadow:
        0 4px 15px
        rgba(0,0,0,0.06);

    }


    .header h1 {

      margin:
        0 0 8px 0;

    }


    .device {

      color: #6b7280;

      font-size: 14px;

    }


    .status {

      margin-top: 15px;

      padding: 12px;

      border-radius: 10px;

      background: #f3f4f6;

      line-height: 1.8;

    }


    .card {

      background: white;

      padding: 20px;

      border-radius: 16px;

      margin-bottom: 20px;

      box-shadow:
        0 4px 15px
        rgba(0,0,0,0.06);

    }


    .card h2 {

      margin-top: 0;

    }


    label {

      display: block;

      margin-top: 15px;

      margin-bottom: 6px;

      font-weight: bold;

    }


    input[type="range"] {

      width: 100%;

    }


    .value {

      font-weight: bold;

      margin-top: 5px;

    }


    button {

      border: none;

      padding: 13px 20px;

      border-radius: 10px;

      font-size: 16px;

      cursor: pointer;

      margin-top: 20px;

      margin-right: 8px;

    }


    .feed {

      background: #16a34a;

      color: white;

    }


    .stop {

      background: #dc2626;

      color: white;

    }


    button:hover {

      opacity: 0.9;

    }

  </style>

</head>


<body>


<div class="container">


  <div class="header">

    <h1>
      🐟 Feeder Ikan IoT
    </h1>


    <div class="device">

      Device:

      <strong>
        ${FEEDER_ID}
      </strong>

    </div>


    <div
      class="status"
      id="status"
    >

      Memuat status...

    </div>

  </div>



  <div class="card">

    <h2>
      🎛️ Kontrol Pakan
    </h2>


    <label>
      Kecepatan Motor
    </label>


    <input
      type="range"
      id="speed"
      min="10"
      max="100"
      value="50"
      oninput="updateSpeed()"
    >


    <div class="value">

      <span id="speedValue">
        50
      </span>%

    </div>



    <label>
      Durasi Motor
    </label>


    <input
      type="range"
      id="duration"
      min="1"
      max="60"
      value="10"
      oninput="updateDuration()"
    >


    <div class="value">

      <span id="durationValue">
        10
      </span>
      detik

    </div>



    <button
      class="feed"
      onclick="feed()"
    >

      ▶ Beri Pakan

    </button>



    <button
      class="stop"
      onclick="stopMotor()"
    >

      ■ Stop

    </button>

  </div>


</div>



<script>


/* =====================================================
   UPDATE SPEED
===================================================== */

function updateSpeed() {

  const value =
    document.getElementById(
      "speed"
    ).value;


  document.getElementById(
    "speedValue"
  ).textContent =
    value;

}


/* =====================================================
   UPDATE DURATION
===================================================== */

function updateDuration() {

  const value =
    document.getElementById(
      "duration"
    ).value;


  document.getElementById(
    "durationValue"
  ).textContent =
    value;

}


/* =====================================================
   FEED
===================================================== */

async function feed() {

  const speed =
    Number(
      document.getElementById(
        "speed"
      ).value
    );


  const duration =
    Number(
      document.getElementById(
        "duration"
      ).value
    );


  try {

    const response =
      await fetch(
        "/api/feed",
        {

          method: "POST",

          headers: {

            "Content-Type":
              "application/json"

          },

          body:
            JSON.stringify({

              speed:
                speed,

              duration:
                duration

            })

        }
      );


    const data =
      await response.json();


    alert(
      data.message
    );


    loadStatus();


  } catch (error) {

    console.error(
      error
    );


    alert(
      "Gagal mengirim perintah"
    );

  }

}


/* =====================================================
   STOP
===================================================== */

async function stopMotor() {

  try {

    const response =
      await fetch(
        "/api/stop",
        {

          method: "POST"

        }
      );


    const data =
      await response.json();


    alert(
      data.message
    );


    loadStatus();


  } catch (error) {

    console.error(
      error
    );


    alert(
      "Gagal mengirim perintah Stop"
    );

  }

}


/* =====================================================
   LOAD STATUS
===================================================== */

async function loadStatus() {

  try {

    const response =
      await fetch(
        "/api/status"
      );


    const data =
      await response.json();


    const feeder =
      data.feeder;


    const statusElement =
      document.getElementById(
        "status"
      );


    const mqttText =
      data.mqttConnected
        ? "MQTT Backend: ONLINE"
        : "MQTT Backend: OFFLINE";


    const feederText =
      feeder.status ||
      "unknown";


    statusElement.innerHTML =

      "<strong>" +
      mqttText +
      "</strong>" +

      "<br>" +

      "Feeder: " +
      feederText +

      "<br>" +

      "Motor: " +

      (
        feeder.motor
          ? "MENYALA"
          : "MATI"
      ) +

      "<br>" +

      "Speed: " +

      (
        feeder.speed || 0
      ) +

      "%" +

      "<br>" +

      "Durasi: " +

      (
        feeder.duration || 0
      ) +

      " detik";


    if (feeder.speed) {

      document.getElementById(
        "speed"
      ).value =
        feeder.speed;


      updateSpeed();

    }


  } catch (error) {

    console.error(
      error
    );


    document.getElementById(
      "status"
    ).textContent =
      "Gagal mengambil status";

  }

}


/* =====================================================
   LOAD AWAL
===================================================== */

loadStatus();


/* =====================================================
   UPDATE STATUS SETIAP 3 DETIK
===================================================== */

setInterval(
  loadStatus,
  3000
);


</script>


</body>

</html>

    `);

  }
);


/* =====================================================
   START SERVER
===================================================== */

app.listen(
  PORT,
  "0.0.0.0",
  () => {

    console.log(
      `Backend berjalan pada port ${PORT}`
    );

  }
);
