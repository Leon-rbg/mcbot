const assert = require('node:assert/strict');
const test = require('node:test');
const { CRAFT_TARGETS, missingCraftTargets, missingResourceTargets } = require('./generalist');

test('generalist craft plan includes utility stations, tools, food, and exploration items', () => {
  const names = new Set(CRAFT_TARGETS.map((target) => target.name));
  for (const name of ['crafting_table', 'furnace', 'stone_pickaxe', 'iron_pickaxe', 'bread', 'torch', 'shield']) {
    assert.equal(names.has(name), true, `${name} should be in the craft plan`);
  }
});

test('craft plan skips items already at their target count', () => {
  const remaining = missingCraftTargets([
    { name: 'crafting_table', count: 1 },
    { name: 'torch', count: 16 },
  ]);
  assert.equal(remaining.some((target) => target.name === 'crafting_table'), false);
  assert.equal(remaining.some((target) => target.name === 'torch'), false);
  assert.equal(remaining.some((target) => target.name === 'iron_pickaxe'), true);
});

test('failed grass seed drops do not block wood and stone collection', () => {
  const targets = missingResourceTargets([], new Map([['wheat_seeds', 48]]));
  assert.equal(targets.some((target) => target.name === 'wheat_seeds'), false);
  assert.equal(targets.some((target) => target.name === 'logs'), true);
  assert.equal(targets.some((target) => target.name === 'cobblestone'), true);
});