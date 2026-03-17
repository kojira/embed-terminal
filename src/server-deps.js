const childProcess = require('child_process');
const nodePty = require('node-pty');

function spawnSync(...args) {
  return childProcess.spawnSync(...args);
}

function spawnPty(...args) {
  return nodePty.spawn(...args);
}

module.exports = { spawnSync, spawnPty };
