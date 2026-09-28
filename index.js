const mineflayer = require("mineflayer");
const http = require("http");

const CONFIG = {
  host: "serverplayer1235.aternos.me",
  port: 12490,
  username: "DEIN_BOT_NAME",
  auth: "offline",
  reconnectDelay: 10000
};

let bot = null;
let reconnectTimer = null;

function log(message) {
  console.log(`[BOT] ${message}`);
}

function createBot() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  log(`Verbinde mit ${CONFIG.host}:${CONFIG.port}...`);

  bot = mineflayer.createBot({
    host: CONFIG.host,
    port: CONFIG.port,
    username: CONFIG.username,
    auth: CONFIG.auth,
    version: false
  });

  bot.once("login", () => {
    log("================================");
    log("LOGIN ERFOLGREICH");
    log(`Name: ${bot.username}`);
    log(`Version: ${bot.version}`);
    log(`Server: ${CONFIG.host}:${CONFIG.port}`);
    log("================================");
  });

  bot.once("spawn", () => {
    log("SPAWN ERREICHT");
    log(`Position: ${bot.entity.position}`);

    try {
      bot.chat("Bot online!");
    } catch (err) {
      log(`Chat konnte nicht gesendet werden: ${err.message}`);
    }
  });

  bot.on("physicsTick", () => {
    // Hier kann später autonome Bot-Logik laufen.
  });

  bot.on("chat", (username, message) => {
    if (username === bot.username) return;

    log(`CHAT <${username}> ${message}`);

    if (message === "!status") {
      bot.chat(`Online | HP: ${bot.health} | Hunger: ${bot.food}`);
    }

    if (message === "!pos") {
      const p = bot.entity.position;
      bot.chat(
        `Position: ${Math.floor(p.x)} ${Math.floor(p.y)} ${Math.floor(p.z)}`
      );
    }
  });

  bot.on("kicked", (reason) => {
    log(`KICK: ${reason}`);
  });

  bot.on("error", (err) => {
    log(`FEHLER: ${err.message}`);
  });

  bot.on("end", (reason) => {
    log(`VERBINDUNG BEENDET: ${reason || "unbekannt"}`);
    scheduleReconnect();
  });

  bot.on("death", () => {
    log("BOT IST GESTORBEN");
  });

  bot.on("health", () => {
    log(`HP: ${bot.health} | Hunger: ${bot.food}`);
  });
}

function scheduleReconnect() {
  if (reconnectTimer) return;

  log(`Reconnect in ${CONFIG.reconnectDelay / 1000} Sekunden...`);

  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    createBot();
  }, CONFIG.reconnectDelay);
}

const server = http.createServer((req, res) => {
  res.writeHead(200, {
    "Content-Type": "text/plain; charset=utf-8"
  });

  res.end(
    JSON.stringify({
      status: "online",
      bot: bot ? bot.username : null,
      connected: !!(bot && bot.entity),
      server: `${CONFIG.host}:${CONFIG.port}`,
      time: new Date().toISOString()
    })
  );
});

const PORT = process.env.PORT || 10000;

server.listen(PORT, "0.0.0.0", () => {
  log(`HTTP Health Server auf Port ${PORT}`);
});

createBot();

process.on("uncaughtException", (err) => {
  log(`UNCAUGHT EXCEPTION: ${err.message}`);
});

process.on("unhandledRejection", (err) => {
  log(`UNHANDLED REJECTION: ${err}`);
});
