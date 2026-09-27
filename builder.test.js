const assert = require('node:assert/strict');
const test = require('node:test');
const { Vec3 } = require('vec3');
const { buildHouse, houseBlueprint } = require('./builder');

test('house blueprint is 9 by 9 with a doorway, glass windows, and a roof', () => {
  const blueprint = houseBlueprint({ x: 20, y: 64, z: -10 });
  const roof = blueprint.filter((block) => block.y === 66);
  const walls = blueprint.filter((block) => block.y === 64 || block.y === 65);

  assert.equal(roof.length, 81);
  assert.equal(Math.min(...roof.map((block) => block.x)), 16);
  assert.equal(Math.max(...roof.map((block) => block.x)), 24);
  assert.equal(Math.min(...roof.map((block) => block.z)), -14);
  assert.equal(Math.max(...roof.map((block) => block.z)), -6);
  assert.equal(walls.some((block) => block.z === -14 && block.x === 20), false);
  assert.equal(walls.some((block) => block.itemName === 'glass'), true);
});

test('unloaded building positions do not count as a completed house', async () => {
  const bot = {
    username: 'test',
    entity: { position: new Vec3(0, 64, 0) },
    game: { gameMode: 'creative' },
    blockAt: () => null,
  };

  assert.equal(await buildHouse(bot, () => true), false);
});