const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { acquireInstanceLock } = require('./instance-lock');

function temporaryLockPath() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-lock-'));
  return { directory, lockPath: path.join(directory, 'instance.pid') };
}

test('instance lock rejects a second active process', () => {
  const { directory, lockPath } = temporaryLockPath();
  try {
    const release = acquireInstanceLock(lockPath, 101, (processId) => processId === 101);
    assert.throws(
      () => acquireInstanceLock(lockPath, 202, (processId) => processId === 101),
      /PID 101/,
    );
    release();
    assert.equal(fs.existsSync(lockPath), false);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('instance lock replaces a stale process id', () => {
  const { directory, lockPath } = temporaryLockPath();
  try {
    fs.writeFileSync(lockPath, '101\n');
    const release = acquireInstanceLock(lockPath, 202, () => false);
    assert.equal(fs.readFileSync(lockPath, 'utf8').trim(), '202');
    release();
    assert.equal(fs.existsSync(lockPath), false);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});