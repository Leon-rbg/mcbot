const mineflayer = require('mineflayer');
const path = require('node:path');
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder');
const collectBlock = require('mineflayer-collectblock').plugin;
const autoEat = require('mineflayer-auto-eat').loader;
const { farmLoop } = require('./farm');
const { generalistLoop } = require('./generalist');
const { excavatorLoop } = require('./excavator');
const { builderLoop } = require('./builder');
const { acquireInstanceLock } = require('./instance-lock');

const host = process.env.MC_HOST || 'serverplayer1235.aternos.me';
const port = Number(process.env.MC_PORT || 12490);
const owner = process.env.BOT_OWNER?.toLowerCase();
const botConfigs = [
  { username: process.env.BOT_USERNAME || 'MCBot', lane: 0 },
  { username: process.env.BOT2_USERNAME || 'MCBot2', lane: 1 },
  { username: process.env.BOT3_USERNAME || 'MCBot3', role: 'generalist' },
  { username: process.env.BOT4_USERNAME || 'xxPowerBoyxx', role: 'excavator' },
  { username: process.env.BOT5_USERNAME || 'CreativGamer_yt', role: 'builder' },
];
let farmingEnabled = true;

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('MC_PORT muss eine Portnummer zwischen 1 und 65535 sein.');
}

const releaseInstanceLock = acquireInstanceLock(path.join(__dirname, '.mcbot.pid'));
process.on('exit', releaseInstanceLock);
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => process.exit(0));
}

function connectBot(config) {
  const bot = mineflayer.createBot({
    host,
    port,
    username: config.username,
    auth: process.env.MC_AUTH || 'offline',
    version: process.env.MC_VERSION || false,
  });
  let lastLoggedBlockPosition = null;

  bot.loadPlugin(pathfinder);
  bot.loadPlugin(collectBlock);
  bot.once('login', () => {
    console.log(`Eingeloggt als ${bot.username}; Serverversion: ${bot.version}`);
  });
  bot.once('spawn', () => {
    bot.loadPlugin(autoEat);
    bot.autoEat.setOpts({ minHunger: 16, minHealth: 8, strictErrors: false });
    bot.autoEat.enableAuto();

    const movements = new Movements(bot);
    movements.canDig = true;
    bot.pathfinder.setMovements(movements);
    console.log(`${bot.username} startet ${config.role || `Farmfeld ${config.lane + 1}`} auf ${host}:${port}`);
    let work;
    if (config.role === 'generalist') work = generalistLoop(bot, () => farmingEnabled);
    else if (config.role === 'excavator') work = excavatorLoop(bot, () => farmingEnabled);
    else if (config.role === 'builder') work = builderLoop(bot, () => farmingEnabled);
    else work = farmLoop(bot, config.lane, () => farmingEnabled);
    work.catch((error) => {
      console.error(`${bot.username}: Arbeitsroutine beendet:`, error.message);
    });
  });
  bot.on('move', () => {
    if (!bot.entity) return;
    const position = bot.entity.position;
    const blockPosition = `${Math.floor(position.x)},${Math.floor(position.y)},${Math.floor(position.z)}`;
    if (blockPosition === lastLoggedBlockPosition) return;
    lastLoggedBlockPosition = blockPosition;
    console.log(`${bot.username}: Bewegung erkannt bei ${blockPosition}.`);
  });
  bot.on('kicked', (reason) => console.error(`${bot.username} wurde entfernt:`, reason));
  bot.on('error', (error) => console.error(`${bot.username}:`, error.message));
  bot.on('end', () => console.log(`${bot.username}: Verbindung beendet.`));
  return bot;
}

const bots = [connectBot(botConfigs[0])];
const [leader] = bots;
function connectRemainingBots(index = 1) {
  if (index >= botConfigs.length) return;
  setTimeout(() => {
    bots.push(connectBot(botConfigs[index]));
    connectRemainingBots(index + 1);
  }, 10000);
}
connectRemainingBots();

leader.on('chat', (username, message) => {
  if (username === leader.username || !message.startsWith('!')) return;
  if (owner && username.toLowerCase() !== owner) return;

  const [command, targetName] = message.slice(1).trim().split(/\s+/, 2);
  const player = leader.players[username]?.entity;

  switch (command?.toLowerCase()) {
    case 'farm':
      farmingEnabled = true;
      leader.chat('Alle Bots setzen ihre Arbeit fort.');
      break;
    case 'follow': {
      farmingEnabled = false;
      const target = leader.players[targetName || username]?.entity;
      if (!target) {
        leader.chat(`Spieler nicht sichtbar: ${targetName || username}`);
        return;
      }
      leader.pathfinder.setGoal(new goals.GoalFollow(target, 2), true);
      leader.chat(`Ich folge ${targetName || username}; !farm setzt die Arbeit fort.`);
      break;
    }
    case 'come':
      if (!player) {
        leader.chat('Deine Position ist gerade nicht sichtbar.');
        return;
      }
      farmingEnabled = false;
      leader.pathfinder.setGoal(
        new goals.GoalNear(player.position.x, player.position.y, player.position.z, 1),
      );
      leader.chat(`Ich komme zu ${username}; !farm setzt die Arbeit fort.`);
      break;
    case 'stop':
      farmingEnabled = false;
      for (const bot of bots) {
        bot.pathfinder.setGoal(null);
        bot.clearControlStates();
      }
      leader.chat('Alle Bots pausieren. !farm startet sie wieder.');
      break;
    case 'status':
      if (leader.entity) {
        leader.chat(
          `Arbeit ${farmingEnabled ? 'aktiv' : 'pausiert'}; Position ${leader.entity.position.floored().toString()}, Gesundheit ${leader.health}, Nahrung ${leader.food}.`,
        );
      }
      break;
    case 'help':
      leader.chat('Befehle: !farm, !stop, !follow [Spieler], !come, !status');
      break;
  }
});