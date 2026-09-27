const { goals } = require('mineflayer-pathfinder');
const { Vec3 } = require('vec3');

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const TOOL_TIER = ['netherite', 'diamond', 'iron', 'stone', 'golden', 'wooden'];
const IGNORED_BLOCKS = new Set([
  'air', 'cave_air', 'void_air', 'water', 'bubble_column', 'lava', 'bedrock', 'barrier',
]);

function chunkBounds(position, depth = 16) {
  if (!Number.isInteger(depth) || depth < 1 || depth > 64) {
    throw new Error('MINER_DEPTH muss eine ganze Zahl zwischen 1 und 64 sein.');
  }
  const chunkX = Math.floor(position.x / 16);
  const chunkZ = Math.floor(position.z / 16);
  const startY = Math.floor(position.y) - 1;

  return {
    minX: chunkX * 16,
    maxX: chunkX * 16 + 15,
    minZ: chunkZ * 16,
    maxZ: chunkZ * 16 + 15,
    minY: startY - depth + 1,
    maxY: startY,
  };
}

function toolTypeForBlock(blockName) {
  return /dirt|grass|sand|gravel|clay|snow|mud|podzol|mycelium|rooted_dirt|farmland|soul_sand|soul_soil|moss/.test(blockName)
    ? 'shovel'
    : 'pickaxe';
}

function bestTool(bot, toolType) {
  const tools = bot.inventory.items().filter((item) => item.name.endsWith(`_${toolType}`));
  return tools.sort((first, second) => {
    const firstTier = TOOL_TIER.findIndex((tier) => first.name.startsWith(`${tier}_`));
    const secondTier = TOOL_TIER.findIndex((tier) => second.name.startsWith(`${tier}_`));
    return firstTier - secondTier;
  })[0] || null;
}

async function excavateChunk(bot, isEnabled, depth = 16, origin = bot.entity.position) {
  const tools = bot.inventory.items();
  if (!tools.some((item) => item.name.endsWith('_shovel')) || !tools.some((item) => item.name.endsWith('_pickaxe'))) {
    console.log(`${bot.username}: warte auf Schaufel und Spitzhacke im Inventar.`);
    return false;
  }

  const bounds = chunkBounds(origin, depth);
  console.log(
    `${bot.username}: gräbt Chunk x=${bounds.minX}..${bounds.maxX}, z=${bounds.minZ}..${bounds.maxZ}, y=${bounds.minY}..${bounds.maxY}.`,
  );

  let mined = 0;
  let skipped = 0;
  let unloaded = 0;
  let activeToolName = null;
  for (let y = bounds.maxY; y >= bounds.minY; y -= 1) {
    for (let z = bounds.minZ; z <= bounds.maxZ; z += 1) {
      for (let x = bounds.minX; x <= bounds.maxX; x += 1) {
        if (!isEnabled()) return false;
        const block = bot.blockAt(new Vec3(x, y, z));
        if (!block) {
          unloaded += 1;
          continue;
        }
        if (IGNORED_BLOCKS.has(block.name) || block.boundingBox !== 'block') continue;

        try {
          if (bot.entity.position.distanceTo(block.position) > 4) {
            await bot.pathfinder.goto(new goals.GoalNear(x, y, z, 3));
          }
          if (bot.entity.position.distanceTo(block.position) > 4.5 || !bot.canDigBlock(block)) {
            skipped += 1;
            continue;
          }

          const tool = bestTool(bot, toolTypeForBlock(block.name));
          if (!tool) {
            console.log(`${bot.username}: Werkzeug fehlt für ${block.name}; Abbau pausiert.`);
            return false;
          }
          if (bot.heldItem?.name !== tool.name) {
            await bot.equip(tool, 'hand');
          }
          if (activeToolName !== tool.name) {
            console.log(`${bot.username}: nutzt ${tool.name} für ${block.name}.`);
            activeToolName = tool.name;
          }
          await bot.dig(block);
          mined += 1;
          if (mined % 32 === 0) {
            console.log(`${bot.username}: ${mined} Blöcke abgebaut, zuletzt bei ${x},${y},${z}.`);
          }
          await wait(80);
        } catch (error) {
          skipped += 1;
          if (skipped % 32 === 1) {
            console.log(`${bot.username}: Block ${x},${y},${z} übersprungen (${error.name}).`);
          }
        }
      }
    }
  }

  if (unloaded > 0) {
    console.log(`${bot.username}: ${unloaded} Chunk-Positionen sind nicht geladen; Abbau wird später erneut versucht.`);
    return false;
  }
  console.log(`${bot.username}: Chunk-Arbeit beendet; ${mined} Blöcke abgebaut, ${skipped} übersprungen.`);
  return true;
}

async function excavatorLoop(bot, isEnabled) {
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
    complete = await excavateChunk(bot, isEnabled, Number(process.env.MINER_DEPTH || 16), origin);
    if (!complete) await wait(5000);
  }
}

module.exports = { chunkBounds, excavateChunk, excavatorLoop, toolTypeForBlock };