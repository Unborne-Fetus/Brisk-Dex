#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const manifestPath = path.join(root, 'brisk-battle-effects.json');
const serverPath = path.join(root, 'battle-server.js');

function normalize(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '').replace(/^moveeffect/, '');
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const server = fs.readFileSync(serverPath, 'utf8').toLowerCase().replace(/[^a-z0-9]/g, '');

function missing(entries) {
  return (entries || []).filter(entry => !server.includes(normalize(entry)));
}

const missingPrimary = missing(manifest.primaryEffects);
const missingSecondary = missing(manifest.secondaryEffects);
const primaryTotal = (manifest.primaryEffects || []).length;
const secondaryTotal = (manifest.secondaryEffects || []).length;
const covered = primaryTotal + secondaryTotal - missingPrimary.length - missingSecondary.length;
const total = primaryTotal + secondaryTotal;
const percent = total ? (covered / total * 100) : 100;

console.log('Brisk battle effect-family coverage');
console.log('  Primary:   ' + (primaryTotal - missingPrimary.length) + '/' + primaryTotal);
console.log('  Secondary: ' + (secondaryTotal - missingSecondary.length) + '/' + secondaryTotal);
console.log('  Total:     ' + covered + '/' + total + ' (' + percent.toFixed(2) + '%)');

if (missingPrimary.length) console.error('Missing primary effects: ' + missingPrimary.join(', '));
if (missingSecondary.length) console.error('Missing secondary effects: ' + missingSecondary.join(', '));

if (missingPrimary.length || missingSecondary.length) process.exit(1);
