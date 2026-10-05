import fs from 'node:fs/promises';
import path from 'node:path';
import { build } from 'esbuild';

const root = process.cwd();
const webDir = path.join(root, 'www');

await fs.rm(webDir, { recursive: true, force: true });
await fs.mkdir(webDir, { recursive: true });

for (const file of ['brisk-dex-data.json', 'brisk-dex-trainer-teams.json']) {
  await fs.copyFile(path.join(root, file), path.join(webDir, file));
}

for (const dir of ['brisk-dex-icons', 'brisk-dex-trainers']) {
  await fs.cp(path.join(root, dir), path.join(webDir, dir), { recursive: true });
}

const iconFiles = await fs.readdir(path.join(root, 'brisk-dex-icons'));
const icons = {};
const shinyIcons = {};
for (const name of iconFiles) {
  const match = name.match(/^(\d+)(_shiny)?\.png$/i);
  if (!match) continue;
  const target = match[2] ? shinyIcons : icons;
  target[match[1]] = 'brisk-dex-icons/' + name;
}
await fs.writeFile(
  path.join(webDir, 'brisk-dex-icon-manifest.json'),
  JSON.stringify({ icons, shinyIcons })
);

await build({
  entryPoints: [path.join(root, 'android-bridge-src.js')],
  outfile: path.join(webDir, 'android-bridge.js'),
  bundle: true,
  minify: true,
  format: 'iife',
  platform: 'browser',
  target: ['chrome120']
});

let html = await fs.readFile(path.join(root, 'index.html'), 'utf8');
const marker = '<script>';
if (!html.includes(marker)) throw new Error('Could not find the Brisk Dex application script.');
html = html.replace(marker, '<script src="android-bridge.js"></script>\n' + marker);
await fs.writeFile(path.join(webDir, 'index.html'), html);

console.log(`Prepared Android web bundle with ${Object.keys(icons).length} normal and ${Object.keys(shinyIcons).length} shiny icons.`);
