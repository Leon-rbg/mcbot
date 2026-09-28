const express = require("express");
const mineflayer = require("mineflayer");
const { pathfinder, Movements, goals } = require("mineflayer-pathfinder");
const { GoalNear } = goals;
const collectBlock = require("mineflayer-collectblock").plugin;
const pvp = require("mineflayer-pvp").plugin;

// ===== CONFIG - FEST EINGEBAUT =====
const HOST = process.env.MC_HOST || "serverplayer1235.aternos.me";
const PORT = Number(process.env.MC_PORT || 12490);
const VERSION = process.env.MC_VERSION || false; // auto-detect weil 26.1 nicht existiert
const AUTH = process.env.MC_AUTH || "offline";
const HTTP_PORT = Number(process.env.PORT || 10000);
const BOT_COUNT = Number(process.env.BOT_COUNT || 3);
const BASE_NAME = process.env.MC_USERNAME || "AutoBot";

console.log(`Team-Config: ${BOT_COUNT} Bots -> ${HOST}:${PORT} | Version: auto | Auth: ${AUTH}`);

// ===== SHARED STATE =====
let sharedStorage = null;
let storageLock = false;
const globalState = {
  wood: 0,
  stone: 0,
  food: 0,
  lastStorageScan: 0
};

const app = express();
const botsData = {};

app.get("/", (_, res) => {
  res.json({
    host: `${HOST}:${PORT}`,
    storage: sharedStorage,
    globalState,
    bots: Object.values(botsData).map(b => ({
      name: b.username,
      role: b.role,
      connected: b.connected,
      task: b.task,
      health: b.health,
      food: b.food,
      items: b.items
    }))
  });
});
app.get("/health", (_, res) => res.send("OK"));
app.listen(HTTP_PORT, "0.0.0.0", () => console.log(`HTTP auf :${HTTP_PORT}`));

const sleep = ms => new Promise(r => setTimeout(r, ms));

function createTeam() {
  const roles = ["lumberjack", "miner", "hunter"]; // Holz, Stein/Erz, Essen/Lager
  
  for (let i = 0; i < BOT_COUNT; i++) {
    const username = BOT_COUNT === 1 ? BASE_NAME : `${BASE_NAME}${i+1}`;
    const role = roles[i % roles.length];
    botsData[username] = { username, role, connected: false, task: "starting", health: null, food: null, items: 0 };
    setTimeout(() => spawnBot(username, role), i * 8000); // 8s Abstand damit Aternos nicht kickt
  }
}

async function spawnBot(username, role) {
  console.log(`[${username}] Verbinde als ${role}...`);
  const bot = mineflayer.createBot({
    host: HOST,
    port: PORT,
    username,
    version: VERSION || undefined,
    auth: AUTH,
    hideErrors: false,
    checkTimeoutInterval: 60*1000
  });

  bot.loadPlugin(pathfinder);
  bot.loadPlugin(collectBlock);
  bot.loadPlugin(pvp);

  let mcData = null;
  let movements = null;
  let taskRunning = false;
  let stopped = false;

  function updateStatus(task) {
    botsData[username] = {
      ...botsData[username],
      connected: !!(bot && bot.player),
      task,
      health: bot?.health ? Math.round(bot.health) : null,
      food: bot?.food ? Math.round(bot.food) : null,
      items: bot?.inventory?.items().length || 0,
      role
    };
  }

  function count(name) {
    if (!bot.inventory) return 0;
    return bot.inventory.items().filter(i => i.name === name).reduce((n, i) => n + i.count, 0);
  }
  function hasFood() {
    const foods = ["bread","apple","carrot","baked_potato","cooked_beef","cooked_porkchop","cooked_chicken"];
    return bot.inventory.items().some(i => foods.includes(i.name));
  }
  function invFull() { return bot.inventory.items().length >= 30; }

  async function goTo(x, y, z, radius=2) {
    if (!bot?.entity) return false;
    bot.pathfinder.setGoal(new GoalNear(x, y, z, radius));
    const start = Date.now();
    while (Date.now() - start < 25000) {
      if (!bot?.entity) return false;
      if (bot.entity.position.distanceTo({x,y,z}) <= radius+0.5) return true;
      await sleep(250);
    }
    bot.pathfinder.setGoal(null);
    return false;
  }

  async function findStorage() {
    if (Date.now() - globalState.lastStorageScan < 15000 && sharedStorage) return sharedStorage;
    const block = bot.findBlock({ matching: b => b && (b.name === "chest" || b.name === "trapped_chest"), maxDistance: 64 });
    if (block) {
      sharedStorage = {x: block.position.x, y: block.position.y, z: block.position.z};
      globalState.lastStorageScan = Date.now();
      console.log(`[${username}] Lager gefunden:`, sharedStorage);
    }
    return sharedStorage;
  }

  async function storeInventory() {
    if (storageLock) return false;
    const storage = await findStorage();
    if (!storage) return false;
    if (!(await goTo(storage.x, storage.y, storage.z))) return false;
    const block = bot.blockAt(storage);
    if (!block) return false;
    storageLock = true;
    try {
      const chest = await bot.openChest(block);
      try {
        for (const item of [...bot.inventory.items()]) {
          // Behält 1 Tool + 3 Essen
          if (item.name.endsWith("_pickaxe") && count(item.name) === 1) continue;
          if (item.name.endsWith("_axe") && count(item.name) === 1) continue;
          if (["cooked_beef","bread"].includes(item.name) && count(item.name) <= 3) continue;
          try {
            await chest.deposit(item.type, null, item.count);
          } catch {}
        }
        console.log(`[${username}] eingelagert`);
      } finally { chest.close(); }
    } catch (e) {
      console.log(`[${username}] Lager fehlgeschlagen: ${e.message}`);
    } finally {
      storageLock = false;
    }
    return true;
  }

  async function collectNames(names, wanted=null, dist=48) {
    const blocks = bot.findBlocks({ matching: b => b && names.includes(b.name), maxDistance: dist, count: 6 });
    if (!blocks.length) return false;
    for (const pos of blocks) {
      if (invFull()) break;
      const b = bot.blockAt(pos);
      if (!b) continue;
      try { await bot.collectBlock.collect(b); } catch {}
      if (wanted && names.some(n => count(n) >= wanted)) break;
    }
    return true;
  }

  async function ensureFood() {
    if (bot.food <= 14 && hasFood()) {
      const foods = ["bread","cooked_beef","cooked_porkchop","baked_potato","cooked_chicken"];
      const item = bot.inventory.items().find(i => foods.includes(i.name));
      if (item) {
        try { await bot.equip(item, "hand"); await bot.consume(); } catch {}
      }
    }
  }

  async function doLumberjack() {
    updateStatus("wood");
    // Brauchen wir noch Holz im Team?
    const needWood = globalState.wood < 64;
    if (!needWood && role !== "lumberjack") return false;
    return collectNames(["oak_log","birch_log","spruce_log","jungle_log","acacia_log","dark_oak_log"], 24);
  }

  async function doMiner() {
    updateStatus("stone/ores");
    const needStone = globalState.stone < 64;
    if (needStone) {
      const ok = await collectNames(["stone","cobblestone","deepslate"], 24, 32);
      if (ok) return true;
    }
    return collectNames(["coal_ore","iron_ore","copper_ore","deepslate_coal_ore","deepslate_iron_ore"], null, 24);
  }

  async function doHunter() {
    updateStatus("food");
    if (globalState.food > 30 && role !== "hunter") return false;
    const animals = ["cow","pig","chicken","sheep","rabbit"];
    const e = bot.nearestEntity(ent => ent && ent.position && animals.includes(ent.name) && ent.position.distanceTo(bot.entity.position) < 32);
    if (!e) return false;
    try {
      await goTo(e.position.x, e.position.y, e.position.z);
      bot.pvp.attack(e);
      await sleep(1500);
      bot.pvp.stop();
      return true;
    } catch { bot.pvp.stop(); return false; }
  }

  async function explore() {
    updateStatus("explore");
    const p = bot.entity.position;
    const x = Math.floor(p.x) + Math.floor(Math.random()*30) - 15;
    const z = Math.floor(p.z) + Math.floor(Math.random()*30) - 15;
    await goTo(x, Math.floor(p.y), z, 3);
  }

  async function teamLoop() {
    if (taskRunning) return;
    taskRunning = true;
    while (bot?.player && !stopped) {
      try {
        // Global State aktualisieren
        globalState.wood = count("oak_log")+count("birch_log")+count("spruce_log")+count("jungle_log");
        globalState.stone = count("cobblestone")+count("stone");
        globalState.food = bot.inventory.items().filter(i => ["cooked_beef","bread","cooked_porkchop"].includes(i.name)).reduce((a,b)=>a+b.count,0);

        if (bot.health <= 6 && sharedStorage) {
          updateStatus("retreat");
          await goTo(sharedStorage.x, sharedStorage.y, sharedStorage.z, 3);
        } else if (bot.food <= 12) {
          await ensureFood();
          if (!hasFood()) await doHunter();
        } else if (invFull()) {
          updateStatus("storing");
          await storeInventory();
        } else if (!sharedStorage) {
          updateStatus("find_storage");
          await findStorage();
        } else {
          // Rollenbasierte Aufgabenverteilung
          let did = false;
          if (role === "lumberjack") {
            did = await doLumberjack() || await doMiner() || await doHunter();
          } else if (role === "miner") {
            did = await doMiner() || await doLumberjack() || await doHunter();
          } else { // hunter = auch Lager-Manager
            did = await doHunter() || await storeInventory() || await doLumberjack();
          }
          if (!did) await explore();
        }
        await sleep(1500 + Math.random()*1000);
      } catch (e) {
        console.log(`[${username}] Loop Error: ${e.message}`);
        await sleep(3000);
      }
    }
    taskRunning = false;
  }

  bot.once("spawn", async () => {
    mcData = require("minecraft-data")(bot.version);
    movements = new Movements(bot, mcData);
    movements.canDig = true;
    bot.pathfinder.setMovements(movements);
    console.log(`[${username}] Online als ${role} | Version ${bot.version}`);
    updateStatus("online");
    await sleep(2000);
    await findStorage();
    teamLoop();
  });

  bot.on("chat", (user, msg) => {
    if (user === bot.username) return;
    console.log(`[${username}] <${user}> ${msg}`);
  });

  bot.on("kicked", reason => {
    let txt = reason; try { txt = JSON.stringify(reason); } catch {}
    console.log(`[${username}] KICKED: ${txt}`);
    botsData[username].task = "kicked";
  });

  bot.on("error", e => console.log(`[${username}] Error: ${e.message}`));

  bot.on("end", (reason) => {
    let txt = reason || "kein Grund"; try { if(typeof reason==='object') txt = JSON.stringify(reason); } catch {}
    console.log(`[${username}] Verbindung beendet: ${txt} - Reconnect in 15s`);
    botsData[username].connected = false;
    botsData[username].task = "reconnecting";
    setTimeout(() => spawnBot(username, role), 15000);
  });
}

createTeam();

process.on("uncaughtException", e => console.error("Uncaught:", e));
process.on("unhandledRejection", e => console.error("Unhandled:", e));