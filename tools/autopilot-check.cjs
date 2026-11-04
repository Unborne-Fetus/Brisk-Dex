'use strict';
// Autopilot's bounded, read-only Brisk Dex regression check.
// No game process, network write, APK rebuild or save mutation is performed.
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
function run(name, executable, args) {
  console.log('\n=== ' + name + ' ===');
  const result = spawnSync(executable, args, {
    cwd: root, encoding: 'utf8', timeout: 120000, windowsHide: true,
    maxBuffer: 8 * 1024 * 1024
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error) console.error(name + ': ' + result.error.message);
  const pass = !result.error && result.status === 0 && !result.signal;
  console.log(name + ': ' + (pass ? 'PASS' : 'FAIL'));
  return pass;
}
const testFiles = [];
for (const dir of ['desktop', 'android']) {
  const directory = path.join(root, 'test', dir);
  if (!fs.existsSync(directory)) {
    console.error('Missing regression suite ' + directory);
    process.exitCode = 1;
    continue;
  }
  for (const file of fs.readdirSync(directory).sort()) {
    if (file.endsWith('.test.cjs')) testFiles.push(path.join(directory, file));
  }
}
if (!testFiles.length) {
  console.error('No Node regression tests available');
  process.exit(2);
}
const results = [
  run('Desktop and Android Node regressions', process.execPath, ['--test', ...testFiles]),
  run('Windows embedded app UI smoke', process.execPath, ['tools/test_embedded_ui.cjs']),
  run('Native controls and update UI smoke', process.execPath, ['tools/test_native_controls_ui.cjs']),
  run('Android source patch compatibility', 'python', ['-m', 'unittest', 'discover', '-s', 'test/android', '-p', 'test_android_source_port.py', '-v']),
  run('Android debug-trap portability', 'python', ['-m', 'unittest', 'discover', '-s', 'test/android', '-p', 'test_android_debug_traps.py', '-v']),
  run('Android callback type portability', 'python', ['-m', 'unittest', 'discover', '-s', 'test/android', '-p', 'test_android_callback_types.py', '-v']),
  run('APK core packaging verification', 'python', ['-m', 'unittest', 'discover', '-s', 'test/android', '-p', 'test_apk_archive.py', '-v'])
];
if (results.some(pass => !pass)) process.exitCode = 1;
