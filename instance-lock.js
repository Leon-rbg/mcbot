const fs = require('node:fs');

function processIsAlive(processId) {
  try {
    process.kill(processId, 0);
    return true;
  } catch (error) {
    return error.code !== 'ESRCH';
  }
}

function acquireInstanceLock(lockPath, processId = process.pid, isAlive = processIsAlive) {
  while (true) {
    try {
      fs.writeFileSync(lockPath, `${processId}\n`, { flag: 'wx' });
      break;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const existingProcessId = Number(fs.readFileSync(lockPath, 'utf8').trim());
      if (Number.isInteger(existingProcessId) && isAlive(existingProcessId)) {
        throw new Error(`Ein Botprozess läuft bereits (PID ${existingProcessId}).`);
      }
      try {
        fs.unlinkSync(lockPath);
      } catch (unlinkError) {
        if (unlinkError.code !== 'ENOENT') throw unlinkError;
      }
    }
  }

  return () => {
    try {
      if (Number(fs.readFileSync(lockPath, 'utf8').trim()) === processId) {
        fs.unlinkSync(lockPath);
      }
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  };
}

module.exports = { acquireInstanceLock };