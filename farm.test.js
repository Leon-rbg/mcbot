const assert = require('node:assert/strict');
const test = require('node:test');
const { collectNearestBlock, isMatureWheat, laneForPosition } = require('./farm');
const { Vec3 } = require('vec3');

test('mature wheat is recognized at age seven', () => {
  assert.equal(isMatureWheat({ name: 'wheat', getProperties: () => ({ age: 7 }) }), true);
  assert.equal(isMatureWheat({ name: 'wheat', getProperties: () => ({ age: 6 }) }), false);
  assert.equal(isMatureWheat({ name: 'carrots', getProperties: () => ({ age: 7 }) }), false);
});

test('checkerboard lanes split adjacent crop positions', () => {
  assert.equal(laneForPosition({ x: 0, z: 0 }), 0);
  assert.equal(laneForPosition({ x: 1, z: 0 }), 1);
  assert.equal(laneForPosition({ x: -1, z: 0 }), 1);
});

test('collection skips an unreachable block and tries the next candidate', async () => {
  const candidates = [new Vec3(0, 0, 0), new Vec3(1, 0, 0)];
  const collected = [];
  const bot = {
    username: 'test',
    findBlocks: () => candidates,
    blockAt: (position) => ({ name: 'oak_log', position }),
    collectBlock: {
      collect: async (block) => {
        if (block.position.x === 0) {
          const error = new Error('no path');
          error.name = 'NoPath';
          throw error;
        }
        collected.push(block);
      },
    },
  };

  const result = await collectNearestBlock(bot, [1], 16, 'Baumstamm');
  assert.equal(result.position.x, 1);
  assert.equal(collected.length, 1);
});