const { goals } = require('mineflayer-pathfinder');
const { Vec3 } = require('vec3');

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const NEIGHBORS = [
  new Vec3(1, 0, 0), new Vec3(-1, 0, 0), new Vec3(0, 1, 0),
  new Vec3(0, -1, 0), new Vec3(0, 0, 1), new Vec3(0, 0, -1),
];
const creativeSlots = new WeakMap();

function houseBlueprint(position) {
  const minX = Math.floor(position.x) - 4;
  const minZ = Math.floor(position.z) - 4;
  const baseY = Math.floor(position.y) - 1;
  const maxX = minX + 8;
  const maxZ = minZ + 8;
  const blocks = [];

  for (const y of [baseY + 1, baseY + 2]) {
    for (let x = minX; x <= maxX; x += 1) {
      for (let z = minZ; z <= maxZ; z += 1) {
        if (x !== minX && x !== maxX && z !== minZ && z !== maxZ) continue;
        if (z === minZ && x === minX + 4) continue;

        const isWindow = y === baseY + 2
          && ((x === minX || x === maxX) && [minZ + 3, minZ + 5].includes(z));
        blocks.push({ x, y, z, itemName: isWindow ? 'glass' : 'oak_planks' });
      }
    }
  }

  const roof = [];
  for (let x = minX; x <= maxX; x += 1) {
    for (let z = minZ; z <= maxZ; z += 1) {
      const edgeDistance = Math.min(x - minX, maxX - x, z - minZ, maxZ - z);
      roof.push({ x, y: baseY + 3, z, itemName: 'oak_planks', edgeDistance });
    }
  }
  roof.sort((first, second) => first.edgeDistance - second.edgeDistance);

  return [...blocks, ...roof];
}

async function equipCreativeBlock(bot, itemName) {
  let slots = creativeSlots.get(bot);
  if (!slots) {
    slots = new Map();
    creativeSlots.set(bot, slots);
  }

  let inventoryItem = bot.inventory.items().find((item) => item.name === itemName);
  if (!inventoryItem) {
    const itemData = bot.registry.itemsByName[itemName];
    if (!itemData || !bot.creative) return false;
    let slot = slots.get(itemName);
    if (slot === undefined) {
      const usedSlots = new Set(slots.values());
      slot = Array.from({ length: 9 }, (_, index) => index + 36).find((candidate) => !usedSlots.has(candidate));
      if (slot === undefined) return false;
      slots.set(itemName, slot);
    }
    const Item = require('prismarine-item')(bot.registry);
    await bot.creative.setInventorySlot(slot, new Item(itemData.id, 64, 0));
    inventoryItem = bot.inventory.slots[slot];
  }

  if (!inventoryItem) return false;
  await bot.equip(inventoryItem, 'hand');
  return true;
}

function findPlacementReference(bot, target) {
  const position = new Vec3(target.x, target.y, target.z);
  for (const offset of NEIGHBORS) {
    const referencePosition = position.plus(offset);
    const reference = bot.blockAt(referencePosition);
    if (reference?.boundingBox === 'block') {
      return { reference, face: position.minus(referencePosition) };
    }
  }
  return null;
}

async function buildHouse(bot, isEnabled, origin = bot.entity.position) {
  if (bot.game.gameMode !== 'creative') {
    console.log(`${bot.username}: wartet auf Creative-Modus (Server muss ihn freischalten).`);
    return false;
  }

  const blueprint = houseBlueprint(origin);
  let placed = 0;
  let skipped = 0;
  let unloaded = 0;
  for (const target of blueprint) {
    if (!isEnabled()) return false;
    const current = bot.blockAt(new Vec3(target.x, target.y, target.z));
    if (!current) {
      unloaded += 1;
      continue;
    }
    if (current.name === target.itemName) continue;
    if (!['air', 'cave_air', 'void_air'].includes(current.name)) {
      skipped += 1;
      continue;
    }

    const placement = findPlacementReference(bot, target);
    if (!placement) {
      skipped += 1;
      continue;
    }

    try {
      if (bot.entity.position.distanceTo(placement.reference.position) > 4) {
        await bot.pathfinder.goto(new goals.GoalNear(
          placement.reference.position.x,
          placement.reference.position.y,
          placement.reference.position.z,
          3,
        ));
      }
      if (!await equipCreativeBlock(bot, target.itemName)) {
        console.log(`${bot.username}: Creative-Block fehlt oder nicht verfügbar: ${target.itemName}.`);
        return false;
      }
      await bot.placeBlock(placement.reference, placement.face);
      placed += 1;
      if (placed % 25 === 0) console.log(`${bot.username}: ${placed} Hausblöcke gesetzt.`);
      await wait(100);
    } catch (error) {
      skipped += 1;
      if (skipped % 16 === 1) {
        console.log(`${bot.username}: Bauposition ${target.x},${target.y},${target.z} übersprungen (${error.name}).`);
      }
    }
  }

  if (unloaded > 0) {
    console.log(`${bot.username}: ${unloaded} Baupositionen sind nicht geladen; der Hausbau wird später erneut versucht.`);
    return false;
  }
  console.log(`${bot.username}: Hausbau beendet; ${placed} Blöcke gesetzt, ${skipped} Positionen ausgelassen.`);
  return true;
}

async function builderLoop(bot, isEnabled) {
  let running = true;
  let complete = false;
  let origin = null;
  bot.once('end', () => { running = false; });

  while (running && !complete) {
    if (!isEnabled() || !bot.entity) {
      await wait(1000);
      continue;
    }
    try {
      await bot.waitForChunksToLoad();
    } catch (error) {
      console.log(`${bot.username}: warte auf Chunk-Daten (${error.message}).`);
      await wait(5000);
      continue;
    }
    if (!origin) origin = bot.entity.position.clone();
    complete = await buildHouse(bot, isEnabled, origin);
    if (!complete) await wait(5000);
  }
}

module.exports = { buildHouse, builderLoop, equipCreativeBlock, houseBlueprint };