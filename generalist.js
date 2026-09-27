const { goals } = require('mineflayer-pathfinder');
const { collectNearestBlock, moveToNextScoutPoint } = require('./farm');
const { manageStorage, mineNearbyOre } = require('./resources');

const RESOURCE_TARGETS = [
  { name: 'wheat_seeds', count: 8, blocks: ['short_grass', 'tall_grass'] },
  { name: 'logs', count: 8, suffix: '_log' },
  { name: 'cobblestone', count: 24, blocks: ['stone', 'cobblestone'] },
];
const MAX_GRASS_ATTEMPTS = 48;

const CRAFT_TARGETS = [
  ['crafting_table', 1], ['furnace', 1], ['chest', 1], ['torch', 16],
  ['wooden_pickaxe', 1], ['wooden_axe', 1], ['wooden_shovel', 1], ['wooden_hoe', 1], ['wooden_sword', 1],
  ['stone_pickaxe', 1], ['stone_axe', 1], ['stone_shovel', 1], ['stone_hoe', 1], ['stone_sword', 1],
  ['iron_pickaxe', 1], ['iron_axe', 1], ['iron_shovel', 1], ['iron_hoe', 1], ['iron_sword', 1],
  ['diamond_pickaxe', 1], ['diamond_axe', 1], ['diamond_shovel', 1], ['diamond_hoe', 1], ['diamond_sword', 1],
  ['shield', 1], ['bucket', 1], ['shears', 1], ['fishing_rod', 1], ['bow', 1],
  ['bread', 3], ['ladder', 8],
].map(([name, count]) => ({ name, count }));

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const resourceAttempts = new WeakMap();

function countItem(items, name) {
  return items.filter((item) => item.name === name).reduce((total, item) => total + item.count, 0);
}

function countResource(items, target) {
  return items.filter((item) => target.suffix
    ? item.name.endsWith(target.suffix)
    : item.name === target.name).reduce((total, item) => total + item.count, 0);
}

function missingCraftTargets(items, targets = CRAFT_TARGETS) {
  return targets.filter((target) => countItem(items, target.name) < target.count);
}

function missingResourceTargets(items, attempts = new Map()) {
  return RESOURCE_TARGETS.filter((target) => {
    if (countResource(items, target) >= target.count) return false;
    return target.name !== 'wheat_seeds' || (attempts.get(target.name) || 0) < MAX_GRASS_ATTEMPTS;
  });
}

function plankName(logName) {
  return `${logName.replace(/^stripped_/, '').replace(/_log$/, '')}_planks`;
}

async function craftToCount(bot, name, targetCount, table = null) {
  const item = bot.registry.itemsByName[name];
  if (!item) return false;

  let attempts = 0;
  while (bot.inventory.count(item.id) < targetCount && attempts < targetCount) {
    const recipe = bot.recipesFor(item.id, null, 1, table)[0];
    if (!recipe) return false;
    await bot.craft(recipe, 1, table);
    attempts += 1;
  }
  return bot.inventory.count(item.id) >= targetCount;
}

async function placeStation(bot, itemName, blockName, table = null) {
  const blockId = bot.registry.blocksByName[blockName]?.id;
  if (blockId === undefined) return null;

  const existing = bot.findBlock({ matching: blockId, maxDistance: 24 });
  if (existing) return existing;
  if (!await craftToCount(bot, itemName, 1, table)) return null;

  const item = bot.inventory.items().find((entry) => entry.name === itemName);
  const origin = bot.entity.position.floored();
  for (const [offsetX, offsetZ] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const target = origin.offset(offsetX, 0, offsetZ);
    const ground = bot.blockAt(target.offset(0, -1, 0));
    if (ground?.boundingBox !== 'block' || bot.blockAt(target)?.name !== 'air') continue;
    try {
      await bot.equip(item, 'hand');
      await bot.placeBlock(ground, target.minus(ground.position));
      await wait(300);
      const placed = bot.blockAt(target);
      if (placed?.name === blockName) return placed;
    } catch {
      continue;
    }
  }
  return null;
}

async function craftPlanksAndSticks(bot) {
  for (const log of bot.inventory.items().filter((item) => item.name.endsWith('_log'))) {
    const outputName = plankName(log.name);
    const output = bot.registry.itemsByName[outputName];
    if (!output) continue;
    await craftToCount(bot, outputName, Math.min(16, bot.inventory.count(output.id) + log.count * 4));
  }

  const sticks = bot.registry.itemsByName.stick;
  if (sticks && bot.inventory.count(sticks.id) < 16) await craftToCount(bot, 'stick', 16);
}

async function craftUsefulItems(bot) {
  await craftPlanksAndSticks(bot);
  let table = await placeStation(bot, 'crafting_table', 'crafting_table');
  await placeStation(bot, 'furnace', 'furnace', table);

  const crafted = [];
  for (const target of missingCraftTargets(bot.inventory.items())) {
    const stationId = bot.registry.blocksByName.crafting_table?.id;
    table = stationId === undefined
      ? null
      : bot.findBlock({ matching: stationId, maxDistance: 24 });
    if (await craftToCount(bot, target.name, target.count, table)) {
      crafted.push(target.name);
    }
  }
  if (crafted.length > 0) console.log(`${bot.username}: hergestellt: ${crafted.join(', ')}.`);
  return crafted;
}

function resourceBlockIds(bot, target) {
  if (target.blocks) {
    return target.blocks.map((name) => bot.registry.blocksByName[name]?.id)
      .filter((id) => id !== undefined);
  }
  return bot.registry.blocksArray.filter((block) => block.name.endsWith(target.suffix))
    .map((block) => block.id);
}

async function collectMissingResource(bot) {
  let attempts = resourceAttempts.get(bot);
  if (!attempts) {
    attempts = new Map();
    resourceAttempts.set(bot, attempts);
  }

  for (const target of missingResourceTargets(bot.inventory.items(), attempts)) {
    const ids = resourceBlockIds(bot, target);
    if (ids.length === 0) continue;
    const before = countResource(bot.inventory.items(), target);
    const block = await collectNearestBlock(bot, ids, 24, target.name);
    if (block) {
      attempts.set(target.name, (attempts.get(target.name) || 0) + 1);
      const after = countResource(bot.inventory.items(), target);
      if (after > before) {
        console.log(`${bot.username}: sammle ${target.name} (${after}/${target.count}).`);
        return true;
      }
    }
  }
  return false;
}

async function smeltRawMetals(bot) {
  const furnaceId = bot.registry.blocksByName.furnace?.id;
  if (furnaceId === undefined) return false;
  const block = bot.findBlock({ matching: furnaceId, maxDistance: 24 });
  if (!block) return false;

  const furnace = await bot.openFurnace(block);
  try {
    if (furnace.outputItem()) await furnace.takeOutput();
    if (!furnace.inputItem()) {
      const raw = ['raw_iron', 'raw_copper', 'raw_gold']
        .map((name) => bot.inventory.items().find((item) => item.name === name))
        .find(Boolean);
      if (raw) await furnace.putInput(raw.type, raw.metadata, Math.min(raw.count, 8));
    }
    if (!furnace.fuelItem()) {
      const fuel = bot.inventory.items().find((item) => ['coal', 'charcoal'].includes(item.name))
        || bot.inventory.items().find((item) => item.name.endsWith('_planks'));
      if (fuel) await furnace.putFuel(fuel.type, fuel.metadata, 1);
    }
    return true;
  } finally {
    await furnace.close();
  }
}

async function generalistLoop(bot, isEnabled) {
  let running = true;
  let nextCraft = 0;
  let nextOre = 0;
  let nextStorage = 0;
  let nextSmelt = 0;
  let scoutWhenEmpty = true;
  bot.once('end', () => { running = false; });

  while (running) {
    if (!isEnabled() || !bot.entity) {
      await wait(1000);
      continue;
    }

    const now = Date.now();
    try {
      if (now >= nextCraft) {
        nextCraft = now + 30000;
        await craftUsefulItems(bot);
      }
      if (now >= nextSmelt) {
        nextSmelt = now + 30000;
        await smeltRawMetals(bot);
      }
      if (now >= nextOre) {
        nextOre = now + 45000;
        await mineNearbyOre(bot, null);
      }
      if (now >= nextStorage) {
        nextStorage = now + 90000;
        await manageStorage(bot);
      }

      const collected = await collectMissingResource(bot);
      if (!collected && scoutWhenEmpty) {
        scoutWhenEmpty = await moveToNextScoutPoint(bot);
      }
    } catch (error) {
      console.error(`${bot.username}: Generalisten-Aktion fehlgeschlagen:`, error.message);
      await wait(2000);
    }

    await wait(2500);
  }
}

module.exports = {
  CRAFT_TARGETS,
  craftUsefulItems,
  generalistLoop,
  missingCraftTargets,
  missingResourceTargets,
};