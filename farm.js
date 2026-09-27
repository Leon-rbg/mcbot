const { goals } = require('mineflayer-pathfinder');
const { hasSuitablePickaxe, manageStorage, mineNearbyOre } = require('./resources');

const MAX_SEARCH_DISTANCE = 24;
const MAX_GRASS_BLOCKS = 48;
const MAX_STARTER_PLOTS = 4;
const SCOUT_OFFSETS = [[24, 0], [0, 24], [-24, 0], [0, -24], [32, 32], [-32, 32], [-32, -32], [32, -32]];
const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const withTimeout = (promise, milliseconds) => Promise.race([
  promise,
  new Promise((_, reject) => setTimeout(() => reject(new Error('PatrolTimeout')), milliseconds)),
]);
const scoutStates = new WeakMap();
const skippedResourcePositions = new WeakMap();

function positionKey(position) {
  return `${position.x},${position.y},${position.z}`;
}

async function collectNearestBlock(bot, blockIds, maxDistance, resourceName) {
  let skipped = skippedResourcePositions.get(bot);
  if (!skipped) {
    skipped = new Set();
    skippedResourcePositions.set(bot, skipped);
  }

  const positions = bot.findBlocks({ matching: blockIds, maxDistance, count: 64 });
  for (const position of positions) {
    const key = positionKey(position);
    if (skipped.has(key)) continue;
    const block = bot.blockAt(position);
    if (!block) continue;

    try {
      await bot.collectBlock.collect(block);
      return block;
    } catch (error) {
      skipped.add(key);
      console.log(`${bot.username}: überspringe unerreichbaren ${resourceName} bei ${position}.`);
    }
  }
  return null;
}

function isMatureWheat(block) {
  return block?.name === 'wheat' && Number(block.getProperties().age) >= 7;
}

function laneForPosition(position) {
  return ((Math.floor(position.x) + Math.floor(position.z)) % 2 + 2) % 2;
}

function findAssignedWheat(bot, lane) {
  const wheatId = bot.registry.blocksByName.wheat?.id;
  if (wheatId === undefined) return [];

  return bot.findBlocks({
    matching: wheatId,
    useExtraInfo: isMatureWheat,
    maxDistance: 32,
    count: 64,
  }).filter((position) => laneForPosition(position) === lane);
}

function itemCount(bot, name) {
  const item = bot.registry.itemsByName[name];
  return item ? bot.inventory.count(item.id) : 0;
}

function totalPlanks(bot) {
  return bot.inventory.items()
    .filter((item) => item.name.endsWith('_planks'))
    .reduce((count, item) => count + item.count, 0);
}

async function moveToNextScoutPoint(bot) {
  const origin = bot.entity.position.floored();
  const directions = [
    [1, 0], [-1, 0], [0, 1], [0, -1],
    [2, 1], [-2, 1], [1, -2], [-1, -2],
    [3, 0], [-3, 0], [0, 3], [0, -3],
    [2, 2], [-2, 2], [2, -2], [-2, -2],
  ];

  const heading = Math.random() * Math.PI * 2;
  let realMove = false;

  for (const [offsetX, offsetZ] of directions) {
    const targetX = origin.x + offsetX;
    const targetZ = origin.z + offsetZ;
    const dx = targetX - origin.x;
    const dz = targetZ - origin.z;
    const yaw = Math.atan2(-dx, dz);

    console.log(`${bot.username}: starte Patrol zu ${targetX},${targetZ}.`);
    try {
      const startPosition = bot.entity.position.clone();
      await bot.look(yaw, 0, true);
      bot.setControlState('forward', true);
      await wait(1200);
      bot.setControlState('forward', false);
      const distanceMoved = bot.entity.position.distanceTo(startPosition);
      if (distanceMoved < 0.2) {
        console.log(`${bot.username}: Richtung ${targetX},${targetZ} blockiert.`);
        continue;
      }
      realMove = true;
      console.log(`${bot.username}: erkunde Richtung ${targetX},${targetZ}.`);
      return true;
    } catch (error) {
      bot.setControlState('forward', false);
      console.log(`${bot.username}: Richtung ${targetX},${targetZ} übersprungen (${error.name}).`);
    }
  }

  if (!realMove) {
    const startPosition = bot.entity.position.clone();
    await bot.look(heading, 0, true);
    bot.setControlState('forward', true);
    await wait(1500);
    bot.setControlState('forward', false);
    const distanceMoved = bot.entity.position.distanceTo(startPosition);
    console.log(`${bot.username}: kurzer freier Erkundungslauf abgeschlossen.`);
    realMove = distanceMoved >= 0.2;
  }

  return realMove;
}

async function craftOne(bot, itemName, craftingTable = null) {
  const item = bot.registry.itemsByName[itemName];
  if (!item) return false;

  const recipe = bot.recipesFor(item.id, null, 1, craftingTable)[0];
  if (!recipe) return false;
  await bot.craft(recipe, 1, craftingTable);
  return true;
}

async function ensureCraftingSticks(bot, count) {
  let collectedLogs = 0;
  while (itemCount(bot, 'stick') < count) {
    if (totalPlanks(bot) < 2) {
      const logItem = bot.inventory.items().find((item) => item.name.endsWith('_log'));
      if (logItem) {
        if (!await craftOne(bot, plankNameForLog(logItem.name))) return false;
      } else if (collectedLogs < 1) {
        const logs = bot.registry.blocksArray.filter((block) => block.name.endsWith('_log'));
          const log = await collectNearestBlock(bot, logs.map((block) => block.id), MAX_SEARCH_DISTANCE, 'Baumstamm');
          if (!log) {
            if (!await moveToNextScoutPoint(bot)) return false;
            continue;
          }
          const logName = log.name;
        collectedLogs += 1;
        if (!await craftOne(bot, plankNameForLog(logName))) return false;
      } else {
        return false;
      }
    }
    if (!await craftOne(bot, 'stick')) return false;
  }
  return true;
}

async function ensureWoodenPickaxe(bot, table) {
  if (bot.inventory.items().some((item) => item.name.endsWith('_pickaxe'))) return true;
  if (!await ensureCraftingSticks(bot, 2)) return false;
  return craftOne(bot, 'wooden_pickaxe', table);
}

async function collectGrassSeeds(bot, targetCount) {
  const seedId = bot.registry.itemsByName.wheat_seeds?.id;
  const grassIds = ['short_grass', 'tall_grass']
    .map((name) => bot.registry.blocksByName[name]?.id)
    .filter((id) => id !== undefined);
  if (seedId === undefined || grassIds.length === 0) return 0;

  let broken = 0;
  while (bot.inventory.count(seedId) < targetCount && broken < MAX_GRASS_BLOCKS) {
    const grass = await collectNearestBlock(bot, grassIds, MAX_SEARCH_DISTANCE, 'Gras');
    if (!grass) {
      if (!await moveToNextScoutPoint(bot)) break;
      continue;
    }
    broken += 1;
  }

  return bot.inventory.count(seedId);
}

function plankNameForLog(logName) {
  return `${logName.replace(/^stripped_/, '').replace(/_log$/, '')}_planks`;
}

async function placeCraftingTable(bot) {
  const tableId = bot.registry.blocksByName.crafting_table?.id;
  if (tableId === undefined) return null;

  const existingTable = bot.findBlock({ matching: tableId, maxDistance: MAX_SEARCH_DISTANCE });
  if (existingTable) return existingTable;

  const tableItem = bot.inventory.items().find((item) => item.name === 'crafting_table');
  if (!tableItem) return null;

  const origin = bot.entity.position.floored();
  const offsets = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  for (const [offsetX, offsetZ] of offsets) {
    const placePosition = origin.offset(offsetX, 0, offsetZ);
    const ground = bot.blockAt(placePosition.offset(0, -1, 0));
    if (ground?.boundingBox !== 'block' || bot.blockAt(placePosition)?.name !== 'air') continue;

    try {
      await bot.equip(tableItem, 'hand');
      await bot.placeBlock(ground, placePosition.minus(ground.position));
      await wait(300);
      const placedTable = bot.blockAt(placePosition);
      if (placedTable?.name === 'crafting_table') return placedTable;
    } catch {
      continue;
    }
  }
  return null;
}

async function ensureWoodenHoe(bot) {
  const existingHoe = bot.inventory.items().find((item) => item.name === 'wooden_hoe');
  const logBlocks = bot.registry.blocksArray.filter((block) => block.name.endsWith('_log'));
  const logIds = logBlocks.map((block) => block.id);

  for (const logs of bot.inventory.items().filter((item) => item.name.endsWith('_log'))) {
    const planks = plankNameForLog(logs.name);
    while (bot.inventory.items().some((item) => item.name === logs.name) && totalPlanks(bot) < 11) {
      if (!await craftOne(bot, planks)) break;
    }
  }

  let collectedLogs = 0;
  while (totalPlanks(bot) < 11 && collectedLogs < 3 && logIds.length > 0) {
    const log = await collectNearestBlock(bot, logIds, MAX_SEARCH_DISTANCE, 'Baumstamm');
    if (!log) {
      if (!await moveToNextScoutPoint(bot)) break;
      continue;
    }
    const logName = log.name;
    collectedLogs += 1;
    await craftOne(bot, plankNameForLog(logName));
  }

  const tableId = bot.registry.blocksByName.crafting_table?.id;
  const nearbyTable = tableId === undefined
    ? null
    : bot.findBlock({ matching: tableId, maxDistance: MAX_SEARCH_DISTANCE });
  if (existingHoe && nearbyTable) {
    await ensureWoodenPickaxe(bot, nearbyTable);
    return nearbyTable;
  }
  if (totalPlanks(bot) < 8) return null;

  if (!nearbyTable && !await craftOne(bot, 'crafting_table')) return null;
  const table = await placeCraftingTable(bot);
  if (!table) return null;

  if (!existingHoe) {
    if (!await ensureCraftingSticks(bot, 2) || !await craftOne(bot, 'wooden_hoe', table)) return null;
  }
  await ensureWoodenPickaxe(bot, table);
  return table;
}

async function ensureStonePickaxe(bot, table) {
  if (hasSuitablePickaxe(bot, { name: 'iron_ore' })) return true;
  if (!bot.inventory.items().some((item) => item.name.endsWith('_pickaxe'))) {
    if (!await ensureWoodenPickaxe(bot, table)) return false;
  }

  const cobblestoneId = bot.registry.itemsByName.cobblestone?.id;
  const stoneIds = ['stone', 'cobblestone']
    .map((name) => bot.registry.blocksByName[name]?.id)
    .filter((id) => id !== undefined);
  if (cobblestoneId === undefined || stoneIds.length === 0) return false;

  let collectedBlocks = 0;
  while (bot.inventory.count(cobblestoneId) < 3 && collectedBlocks < 3) {
    const stone = await collectNearestBlock(bot, stoneIds, MAX_SEARCH_DISTANCE, 'Stein');
    if (!stone) break;
    collectedBlocks += 1;
  }
  if (bot.inventory.count(cobblestoneId) < 3 || !await ensureCraftingSticks(bot, 2)) return false;
  const crafted = await craftOne(bot, 'stone_pickaxe', table);
  if (crafted) console.log(`${bot.username}: Steinspitzhacke gecraftet.`);
  return crafted;
}

function findIrrigatedPlots(bot) {
  const waterId = bot.registry.blocksByName.water?.id;
  const soilIds = ['dirt', 'grass_block', 'farmland']
    .map((name) => bot.registry.blocksByName[name]?.id)
    .filter((id) => id !== undefined);
  if (waterId === undefined || soilIds.length === 0) return [];

  const water = bot.findBlocks({ matching: waterId, maxDistance: MAX_SEARCH_DISTANCE, count: 24 });
  const soil = bot.findBlocks({ matching: soilIds, maxDistance: MAX_SEARCH_DISTANCE, count: 256 });
  return soil.filter((position) => {
    const block = bot.blockAt(position);
    const above = bot.blockAt(position.offset(0, 1, 0));
    if (!block || above?.name !== 'air') return false;
    return water.some((source) => {
      const horizontalDistance = Math.abs(source.x - position.x) + Math.abs(source.z - position.z);
      return horizontalDistance <= 4 && Math.abs(source.y - position.y) <= 1;
    });
  }).sort((a, b) => a.distanceTo(bot.entity.position) - b.distanceTo(bot.entity.position));
}

async function findIrrigatedPlotsWithScout(bot) {
  let plots = findIrrigatedPlots(bot);
  while (plots.length === 0 && await moveToNextScoutPoint(bot)) {
    plots = findIrrigatedPlots(bot);
  }
  return plots;
}

async function bootstrapFarm(bot) {
  if (findAssignedWheat(bot, 0).length || findAssignedWheat(bot, 1).length) return true;

  console.log(`${bot.username}: sammle Samen und Material für ein kleines Weizenfeld.`);
  const seeds = await collectGrassSeeds(bot, MAX_STARTER_PLOTS);
  if (seeds === 0) {
    console.log(`${bot.username}: keine Grassamen im Umkreis gefunden.`);
    return false;
  }

  const table = await ensureWoodenHoe(bot);
  const hoe = bot.inventory.items().find((item) => item.name === 'wooden_hoe');
  if (!table || !hoe) {
    console.log(`${bot.username}: Holz für Werkbank/Hacke fehlt im Umkreis.`);
    return false;
  }

  const plots = await findIrrigatedPlotsWithScout(bot);
  if (plots.length === 0) {
    console.log(`${bot.username}: kein freier Erdblock nahe Wasser gefunden.`);
    return false;
  }

  let planted = 0;
  for (const position of plots.slice(0, MAX_STARTER_PLOTS)) {
    if (itemCount(bot, 'wheat_seeds') === 0) break;
    try {
      await bot.pathfinder.goto(new goals.GoalNear(position.x, position.y, position.z, 1));
      let soil = bot.blockAt(position);
      if (soil?.name !== 'farmland') {
        await bot.equip(hoe, 'hand');
        await bot.activateBlock(soil);
        await wait(400);
        soil = bot.blockAt(position);
      }
      if (soil?.name !== 'farmland' || bot.blockAt(position.offset(0, 1, 0))?.name !== 'air') continue;

      const seed = bot.inventory.items().find((item) => item.name === 'wheat_seeds');
      await bot.equip(seed, 'hand');
      await bot.placeBlock(soil, position.offset(0, 1, 0).minus(soil.position));
      planted += 1;
      console.log(`${bot.username}: Saatplatz ${planted}/${MAX_STARTER_PLOTS} bepflanzt.`);
    } catch (error) {
      console.error(`${bot.username}: Saatplatz übersprungen:`, error.message);
    }
  }

  return planted > 0;
}

async function harvestAndReplant(bot, position) {
  await bot.pathfinder.goto(new goals.GoalNear(position.x, position.y, position.z, 1));
  const crop = bot.blockAt(position);
  if (!isMatureWheat(crop) || !bot.canDigBlock(crop)) return;

  console.log(`${bot.username} erntet Weizen bei ${position}.`);
  await bot.dig(crop);
  await wait(900);

  const soil = bot.blockAt(position.offset(0, -1, 0));
  const emptyBlock = bot.blockAt(position);
  const seed = bot.inventory.items().find((item) => item.name === 'wheat_seeds');
  if (emptyBlock?.name !== 'air' || soil?.name !== 'farmland' || !seed) return;

  await bot.equip(seed, 'hand');
  await bot.placeBlock(soil, position.minus(soil.position));
}

async function farmLoop(bot, lane, isEnabled) {
  let running = true;
  let setupComplete = false;
  let nextSetupAttempt = 0;
  let nextStorageCheck = 0;
  let nextOreCheck = 0;
  let nextToolCheck = 0;
  let nextPatrol = 0;
  bot.once('end', () => { running = false; });

  while (running) {
    if (!isEnabled() || !bot.entity) {
      await wait(1000);
      continue;
    }

    const now = Date.now();
    if (now >= nextPatrol) {
      nextPatrol = now + 15000;
      try {
        await moveToNextScoutPoint(bot);
      } catch (error) {
        console.error(`${bot.username}: Patrol fehlgeschlagen:`, error.message);
      }
      continue;
    }

    if (lane === 0 && now >= nextStorageCheck) {
      nextStorageCheck = now + 60000;
      try {
        await manageStorage(bot);
      } catch (error) {
        console.error(`${bot.username}: Lagerzugriff fehlgeschlagen:`, error.message);
      }
    }
    if (now >= nextToolCheck && !hasSuitablePickaxe(bot, { name: 'iron_ore' })) {
      nextToolCheck = now + 120000;
      try {
        const table = await ensureWoodenHoe(bot);
        if (table) await ensureStonePickaxe(bot, table);
      } catch (error) {
        console.error(`${bot.username}: Spitzhacken-Crafting fehlgeschlagen:`, error.message);
      }
    }
    if (now >= nextOreCheck) {
      nextOreCheck = now + 45000;
      try {
        await mineNearbyOre(bot, lane);
      } catch (error) {
        console.error(`${bot.username}: Erzsuche fehlgeschlagen:`, error.message);
      }
    }

    const [position] = findAssignedWheat(bot, lane);
    if (!position) {
      if (lane === 0 && !setupComplete && Date.now() >= nextSetupAttempt) {
        nextSetupAttempt = Date.now() + 60000;
        try {
          setupComplete = await bootstrapFarm(bot);
        } catch (error) {
          console.error(`${bot.username}: Farmstart fehlgeschlagen:`, error.message);
        }
      }
      try {
        await moveToNextScoutPoint(bot);
      } catch (error) {
        console.error(`${bot.username}: Erkundung fehlgeschlagen:`, error.message);
      }
      await wait(1500);
      continue;
    }

    try {
      await harvestAndReplant(bot, position);
      await wait(400);
    } catch (error) {
      if (!['GoalChanged', 'PathStopped'].includes(error.name)) {
        console.error(`${bot.username}: Farmfehler:`, error.message);
      }
      await wait(1500);
    }
  }
}

module.exports = {
  collectNearestBlock,
  farmLoop,
  isMatureWheat,
  laneForPosition,
  moveToNextScoutPoint,
};