const assert = require('node:assert/strict');
const test = require('node:test');
const { hasSuitablePickaxe, isOreName, oreBelongsToLane, parseStoragePosition } = require('./resources');

test('storage coordinate parser accepts only three integer coordinates', () => {
  assert.deepEqual(parseStoragePosition('12, 64, -8').toArray(), [12, 64, -8]);
  assert.equal(parseStoragePosition('12,64'), null);
  assert.equal(parseStoragePosition('12,64,nope'), null);
  assert.equal(parseStoragePosition(''), null);
});

test('only ore blocks are selected for the ore task', () => {
  assert.equal(isOreName('diamond_ore'), true);
  assert.equal(isOreName('deepslate_iron_ore'), true);
  assert.equal(isOreName('ancient_debris'), false);
  assert.equal(isOreName('stone'), false);
});

test('generalist ore lane includes positions from both farm lanes', () => {
  assert.equal(oreBelongsToLane({ x: 0, z: 0 }, null), true);
  assert.equal(oreBelongsToLane({ x: 1, z: 0 }, null), true);
  assert.equal(oreBelongsToLane({ x: 1, z: 0 }, 0), false);
  assert.equal(oreBelongsToLane({ x: 0, z: 0 }, 0), true);
});

test('ore is collected only when an allowed pickaxe is in inventory', () => {
  const bot = {
    registry: { blocksByName: { iron_ore: { harvestTools: { 12: true, 13: true } } } },
    inventory: { items: () => [{ type: 12 }] },
  };
  assert.equal(hasSuitablePickaxe(bot, { name: 'iron_ore' }), true);
  bot.inventory.items = () => [{ type: 11 }];
  assert.equal(hasSuitablePickaxe(bot, { name: 'iron_ore' }), false);
});