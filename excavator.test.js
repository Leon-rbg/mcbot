const assert = require('node:assert/strict');
const test = require('node:test');
const { Vec3 } = require('vec3');
const { chunkBounds, excavateChunk, toolTypeForBlock } = require('./excavator');

test('chunk bounds cover 16 blocks and floor negative coordinates correctly', () => {
  assert.deepEqual(chunkBounds({ x: -1, y: 64, z: 16 }, 16), {
    minX: -16,
    maxX: -1,
    minZ: 16,
    maxZ: 31,
    minY: 48,
    maxY: 63,
  });
});

test('excavator selects shovel for loose blocks and pickaxe otherwise', () => {
  assert.equal(toolTypeForBlock('dirt'), 'shovel');
  assert.equal(toolTypeForBlock('red_sand'), 'shovel');
  assert.equal(toolTypeForBlock('deepslate'), 'pickaxe');
});

test('excavation depth is bounded to a valid number of layers', () => {
  assert.throws(() => chunkBounds({ x: 0, y: 64, z: 0 }, 0), /zwischen 1 und 64/);
  assert.throws(() => chunkBounds({ x: 0, y: 64, z: 0 }, 65), /zwischen 1 und 64/);
});

test('unloaded chunk positions do not count as a completed excavation', async () => {
  const bot = {
    username: 'test',
    entity: { position: new Vec3(0, 64, 0) },
    inventory: { items: () => [{ name: 'iron_shovel' }, { name: 'iron_pickaxe' }] },
    blockAt: () => null,
  };

  assert.equal(await excavateChunk(bot, () => true, 1), false);
});