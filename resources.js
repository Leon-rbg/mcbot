const { Vec3 } = require('vec3');
const { goals } = require('mineflayer-pathfinder');

const SEARCH_DISTANCE = 24;
const ORE_SCAN_INTERVAL = 45000;
const CONTAINER_NAMES = new Set(['chest', 'trapped_chest', 'barrel', 'ender_chest']);
const RESERVED_TOOLS = /_(pickaxe|axe|shovel|hoe|sword|helmet|chestplate|leggings|boots)$/;
const FOOD_NAMES = new Set([
  'apple', 'baked_potato', 'bread', 'carrot', 'cooked_beef', 'cooked_chicken',
  'cooked_cod', 'cooked_mutton', 'cooked_porkchop', 'cooked_rabbit',
  'cooked_salmon', 'golden_carrot',
]);
const NEIGHBORS = [
  [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1],
];
let warnedMissingStorage = false;

function parseStoragePosition(value) {
  if (!value) return null;
  const coordinates = value.split(',').map((coordinate) => Number(coordinate.trim()));
  if (coordinates.length !== 3 || !coordinates.every(Number.isInteger)) return null;
  return new Vec3(...coordinates);
}

function isOreName(name) {
  return typeof name === 'string' && name.endsWith('_ore');
}

function hasSuitablePickaxe(bot, block) {
  const harvestTools = bot.registry.blocksByName[block.name]?.harvestTools;
  if (!harvestTools || Object.keys(harvestTools).length === 0) return true;
  const allowedTools = new Set(Object.keys(harvestTools).map(Number));
  return bot.inventory.items().some((item) => allowedTools.has(item.type));
}

function laneForPosition(position) {
  return ((Math.floor(position.x) + Math.floor(position.z)) % 2 + 2) % 2;
}

function oreBelongsToLane(position, lane) {
  return lane === null || lane === undefined || laneForPosition(position) === lane;
}

function isExposedAndSafe(bot, position) {
  let exposed = false;
  for (const [offsetX, offsetY, offsetZ] of NEIGHBORS) {
    const neighbor = bot.blockAt(position.offset(offsetX, offsetY, offsetZ));
    if (neighbor?.name === 'lava' || neighbor?.name === 'flowing_lava') return false;
    if (['air', 'cave_air', 'void_air'].includes(neighbor?.name)) exposed = true;
  }
  return exposed;
}

async function mineNearbyOre(bot, lane) {
  const oreIds = bot.registry.blocksArray.filter((block) => isOreName(block.name)).map((block) => block.id);
  if (oreIds.length === 0) return false;

  const positions = bot.findBlocks({ matching: oreIds, maxDistance: SEARCH_DISTANCE, count: 96 })
    .filter((position) => oreBelongsToLane(position, lane))
    .sort((first, second) => first.distanceTo(bot.entity.position) - second.distanceTo(bot.entity.position));

  for (const position of positions) {
    const block = bot.blockAt(position);
    if (!block || !isExposedAndSafe(bot, position) || !hasSuitablePickaxe(bot, block)) continue;

    await bot.collectBlock.collect(block);
    console.log(`${bot.username}: Erz gesammelt (${block.name}) bei ${position}.`);
    return true;
  }

  return false;
}

function countNamedItems(bot, predicate) {
  return bot.inventory.items()
    .filter((item) => predicate(item.name))
    .reduce((total, item) => total + item.count, 0);
}

function supplyTarget(bot, name) {
  if (name === 'wheat_seeds') return Math.max(0, 8 - countNamedItems(bot, (itemName) => itemName === name));
  if (name.endsWith('_log')) return Math.max(0, 3 - countNamedItems(bot, (itemName) => itemName.endsWith('_log')));
  if (name.endsWith('_planks')) return Math.max(0, 12 - countNamedItems(bot, (itemName) => itemName.endsWith('_planks')));
  if (name.endsWith('_pickaxe')) return countNamedItems(bot, (itemName) => itemName.endsWith('_pickaxe')) === 0 ? 1 : 0;
  if (FOOD_NAMES.has(name)) return Math.max(0, 8 - countNamedItems(bot, (itemName) => FOOD_NAMES.has(itemName)));
  return 0;
}

function keepBudget(name) {
  if (name === 'wheat_seeds') return ['wheat_seeds', 8];
  if (name.endsWith('_log')) return ['logs', 3];
  if (name.endsWith('_planks')) return ['planks', 12];
  if (name === 'crafting_table') return ['crafting_table', 1];
  if (FOOD_NAMES.has(name)) return ['food', 8];
  return null;
}

function isContainer(block) {
  return CONTAINER_NAMES.has(block.name) || block.name.endsWith('_shulker_box');
}

async function manageStorage(bot) {
  const position = parseStoragePosition(process.env.STORAGE_CHEST);
  if (!position) {
    if (!warnedMissingStorage) {
      console.log('STORAGE_CHEST nicht gesetzt; Truhenlogistik bleibt deaktiviert.');
      warnedMissingStorage = true;
    }
    return false;
  }

  await bot.pathfinder.goto(new goals.GoalNear(position.x, position.y, position.z, 2));
  const block = bot.blockAt(position);
  if (!block || !isContainer(block)) {
    console.log(`Keine unterstützte Lagerkiste bei ${position}.`);
    return false;
  }

  const window = await bot.openContainer(block);
  try {
    for (const item of window.containerItems()) {
      const count = Math.min(item.count, supplyTarget(bot, item.name));
      if (count > 0) await window.withdraw(item.type, item.metadata, count, item.nbt);
    }

    const budgets = new Map([
      ['wheat_seeds', 8], ['logs', 3], ['planks', 12], ['crafting_table', 1], ['food', 8],
    ]);
    for (const item of [...bot.inventory.items()]) {
      if (RESERVED_TOOLS.test(item.name)) continue;
      const budget = keepBudget(item.name);
      if (!budget) {
        await window.deposit(item.type, item.metadata, item.count, item.nbt);
        continue;
      }

      const remaining = budgets.get(budget[0]) || 0;
      const kept = Math.min(item.count, remaining);
      budgets.set(budget[0], remaining - kept);
      const surplus = item.count - kept;
      if (surplus > 0) await window.deposit(item.type, item.metadata, surplus, item.nbt);
    }

    console.log(`${bot.username}: Lagerkiste bei ${position} sortiert.`);
    return true;
  } finally {
    await window.close();
  }
}

module.exports = {
  hasSuitablePickaxe,
  isOreName,
  manageStorage,
  mineNearbyOre,
  oreBelongsToLane,
  parseStoragePosition,
};