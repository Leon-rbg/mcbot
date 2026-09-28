const express = require("express");
const mineflayer = require("mineflayer");
const { pathfinder, Movements, goals } = require("mineflayer-pathfinder");
const { GoalNear } = goals;
const collectBlock = require("mineflayer-collectblock").plugin;
const pvp = require("mineflayer-pvp").plugin;

const HOST = process.env.MC_HOST;
const PORT = Number(process.env.MC_PORT || 25565);
const USERNAME = process.env.MC_USERNAME || "AutoBot";
const MC_VERSION = process.env.MC_VERSION || false;
const HTTP_PORT = Number(process.env.PORT || 10000);

if (!HOST) {
  console.error("MC_HOST fehlt.");
  process.exit(1);
}

const app = express();
let bot = null;
let mcData = null;
let movements = null;
let storage = null;
let stopped = false;
let reconnectTimer = null;
let loopRunning = false;
let lastTask = "starting";
let lastError = null;

app.get("/", (_, res) => {
  res.json({
    bot: USERNAME,
    connected: !!(bot && bot.player),
    task: lastTask,
    health: bot?.health ?? null,
    food: bot?.food ?? null,
    storage: storage || null,
    error: lastError
  });
});
app.get("/health", (_, res) => res.status(200).send("OK"));

app.listen(HTTP_PORT, "0.0.0.0", () =>
  console.log(`HTTP health server on :${HTTP_PORT}`)
);

const sleep = ms => new Promise(r => setTimeout(r, ms));

function count(name) {
  return bot.inventory.items()
    .filter(i => i.name === name)
    .reduce((n, i) => n + i.count, 0);
}

function hasFood() {
  const foods = [
    "bread","apple","carrot","baked_potato",
    "cooked_beef","cooked_porkchop","cooked_chicken",
    "cooked_mutton","cooked_rabbit","cooked_cod","cooked_salmon"
  ];
  return bot.inventory.items().some(i => foods.includes(i.name));
}

function inventoryFull() {
  return bot.inventory.items().length >= 30;
}

async function goTo(x, y, z, radius = 2) {
  if (!bot?.entity) return false;
  bot.pathfinder.setGoal(new GoalNear(x, y, z, radius));
  const start = Date.now();

  while (Date.now() - start < 30000) {
    if (!bot?.entity) return false;
    const p = bot.entity.position;
    if (p.distanceTo({x, y, z}) <= radius + 0.5) return true;
    await sleep(250);
  }
  bot.pathfinder.setGoal(null);
  return false;
}

async function findStorage() {
  if (!bot?.entity) return null;
  const block = bot.findBlock({
    matching: b => b && (b.name === "chest" || b.name === "trapped_chest"),
    maxDistance: 64
  });
  if (block) {
    storage = {x: block.position.x, y: block.position.y, z: block.position.z};
    console.log("Lager:", storage);
  }
  return storage;
}

async function storeInventory() {
  if (!storage) await findStorage();
  if (!storage) return false;

  lastTask = "storing";
  if (!(await goTo(storage.x, storage.y, storage.z))) return false;

  const block = bot.blockAt(storage);
  if (!block) return false;

  const chest = await bot.openChest(block);
  try {
    for (const item of [...bot.inventory.items()]) {
      try {
        await chest.deposit(item.type, null, item.count);
        console.log(`eingelagert: ${item.name} x${item.count}`);
      } catch (_) {
        console.log(`kein Platz: ${item.name}`);
      }
    }
  } finally {
    chest.close();
  }
  return true;
}

async function eat() {
  const foods = [
    "bread","apple","carrot","baked_potato",
    "cooked_beef","cooked_porkchop","cooked_chicken",
    "cooked_mutton","cooked_rabbit","cooked_cod","cooked_salmon"
  ];
  const item = bot.inventory.items().find(i => foods.includes(i.name));
  if (!item) return false;

  try {
    await bot.equip(item, "hand");
    await bot.consume();
    return true;
  } catch (e) {
    lastError = e.message;
    return false;
  }
}

async function collectNames(names, countWanted, distance = 48) {
  const blocks = bot.findBlocks({
    matching: b => b && names.includes(b.name),
    maxDistance: distance,
    count: 8
  });
  if (!blocks.length) return false;

  for (const pos of blocks) {
    if (inventoryFull()) break;
    const block = bot.blockAt(pos);
    if (!block) continue;
    try {
      await bot.collectBlock.collect(block);
    } catch (_) {}
    if (countWanted && names.some(n => count(n) >= countWanted)) break;
  }
  return true;
}

async function craftFirstAvailable(itemNames) {
  const table = bot.findBlock({
    matching: b => b && b.name === "crafting_table",
    maxDistance: 32
  });

  for (const name of itemNames) {
    const item = mcData.itemsByName[name];
    if (!item) continue;
    const recipes = bot.recipesFor(item.id, null, 1, table || null);
    if (!recipes.length) continue;
    try {
      await bot.craft(recipes[0], 1, table || null);
      console.log("craft:", name);
      return true;
    } catch (_) {}
  }
  return false;
}

async function ensureTools() {
  lastTask = "tools";
  const hasPick = bot.inventory.items().some(i => i.name.endsWith("_pickaxe"));
  const hasAxe = bot.inventory.items().some(i => i.name.endsWith("_axe"));
  const hasSword = bot.inventory.items().some(i => i.name.endsWith("_sword"));

  if (!hasPick || !hasAxe || !hasSword) {
    await craftFirstAvailable([
      "stone_pickaxe","wooden_pickaxe",
      "stone_axe","wooden_axe",
      "stone_sword","wooden_sword"
    ]);
  }
}

async function collectWood() {
  lastTask = "wood";
  return collectNames([
    "oak_log","birch_log","spruce_log","jungle_log",
    "acacia_log","dark_oak_log","mangrove_log","cherry_log"
  ], 16);
}

async function collectStone() {
  lastTask = "stone";
  return collectNames(["stone","cobblestone","deepslate"], 32, 32);
}

async function collectOres() {
  lastTask = "ores";
  return collectNames([
    "coal_ore","deepslate_coal_ore",
    "iron_ore","deepslate_iron_ore",
    "copper_ore","deepslate_copper_ore"
  ], null, 24);
}

async function huntFood() {
  lastTask = "food";
  const animals = ["cow","pig","chicken","sheep","rabbit"];
  const entity = bot.nearestEntity(e =>
    e && e.position && animals.includes(e.name) &&
    e.position.distanceTo(bot.entity.position) < 32
  );
  if (!entity) return false;

  try {
    await goTo(entity.position.x, entity.position.y, entity.position.z);
    bot.pvp.attack(entity);
    await sleep(1800);
    bot.pvp.stop();
    return true;
  } catch (_) {
    bot.pvp.stop();
    return false;
  }
}

async function explore() {
  lastTask = "explore";
  const p = bot.entity.position;
  const x = Math.floor(p.x) + Math.floor(Math.random()*25) - 12;
  const z = Math.floor(p.z) + Math.floor(Math.random()*25) - 12;
  await goTo(x, Math.floor(p.y), z, 3);
}

async function autonomousCycle() {
  if (loopRunning || stopped) return;
  loopRunning = true;

  while (bot?.player && !stopped) {
    try {
      if (bot.health <= 5 && storage) {
        lastTask = "retreat";
        await goTo(storage.x, storage.y, storage.z, 3);
      } else if (bot.food <= 12 && hasFood()) {
        lastTask = "eat";
        await eat();
      } else if (!hasFood()) {
        await huntFood();
      } else if (!storage) {
        lastTask = "find_storage";
        await findStorage();
      } else if (inventoryFull()) {
        await storeInventory();
      } else if (count("oak_log") + count("birch_log") + count("spruce_log") +
                 count("jungle_log") + count("acacia_log") +
                 count("dark_oak_log") + count("mangrove_log") + count("cherry_log") < 16) {
        await collectWood();
      } else if (count("cobblestone") + count("stone") < 32) {
        await collectStone();
      } else {
        await ensureTools();
        await collectOres();
        await explore();
      }
      await sleep(2000);
    } catch (e) {
      lastError = e.message;
      console.error("Task error:", e.message);
      await sleep(3000);
    }
  }
  loopRunning = false;
}

function createBot() {
  console.log(`Verbinde mit ${HOST}:${PORT}`);

  bot = mineflayer.createBot({
    host: HOST,
    port: PORT,
    username: USERNAME,
    version: MC_VERSION || false
  });

  bot.loadPlugin(pathfinder);
  bot.loadPlugin(collectBlock);
  bot.loadPlugin(pvp);

  bot.once("spawn", async () => {
    mcData = require("minecraft-data")(bot.version);
    movements = new Movements(bot, mcData);
    movements.canDig = true;
    movements.allow1by1towers = false;
    bot.pathfinder.setMovements(movements);

    console.log("Bot online:", bot.username, bot.version);
    await sleep(2000);
    await findStorage();
    autonomousCycle();
  });

  bot.on("chat", async (username, message) => {
    if (username === bot.username) return;
    const c = message.trim().toLowerCase();

    if (c === "!status") {
      bot.chat(`task=${lastTask} hp=${Math.round(bot.health)} food=${Math.round(bot.food)} items=${bot.inventory.items().length}`);
    } else if (c === "!stop") {
      stopped = true;
      bot.pathfinder.setGoal(null);
      bot.pvp.stop();
      bot.chat("Autonomie pausiert.");
    } else if (c === "!start" || c === "!resume") {
      stopped = false;
      bot.chat("Autonomie gestartet.");
      autonomousCycle();
    } else if (c === "!lager") {
      await findStorage();
      bot.chat(storage ? `Lager ${storage.x} ${storage.y} ${storage.z}` : "Keine Kiste gefunden.");
    } else if (c === "!lagern") {
      await storeInventory();
    }
  });

  bot.on("health", () => {
    if (bot.food <= 12) eat().catch(() => {});
  });

  bot.on("error", e => {
    lastError = e.message;
    console.error("Minecraft error:", e.message);
  });

  bot.on("kicked", reason => console.log("Kicked:", reason));

  bot.on("end", () => {
    console.log("Verbindung beendet.");
    clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(() => createBot(), 10000);
  });
}

createBot();

process.on("uncaughtException", e => {
  console.error("Uncaught:", e);
});
process.on("unhandledRejection", e => {
  console.error("Unhandled:", e);
});
