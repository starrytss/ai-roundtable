import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const build = dir => execFileSync(process.execPath, [path.join(root, 'scripts', 'build.mjs'), dir], { encoding: 'utf8' });

test('two builds of the same tree are byte-identical and BUILD.json hashes match the files', () => {
  const a = fs.mkdtempSync(path.join(os.tmpdir(), 'rt-b1-')), b = fs.mkdtempSync(path.join(os.tmpdir(), 'rt-b2-'));
  build(a); build(b);
  const za = fs.readdirSync(a).find(n => n.endsWith('.zip'));
  assert.deepEqual(fs.readFileSync(path.join(a, za)), fs.readFileSync(path.join(b, za)));
  const info = JSON.parse(fs.readFileSync(path.join(a, 'BUILD.json'), 'utf8'));
  assert.match(info.commit, /^[0-9a-f]{40}$/);
  for (const [f, h] of Object.entries(info.files)) assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(root, f))).digest('hex'), h, f);
  assert.ok(info.files['app/server.js'] && info.files['setup.ps1'] && info.files['app/ui/index.html']);
  assert.ok(!Object.keys(info.files).some(f => f.startsWith('test/') || f.startsWith('scripts/')), 'tests and scripts are not shipped');
  const sum = fs.readFileSync(path.join(a, 'SHA256SUMS.txt'), 'utf8');
  assert.equal(sum.split(' ')[0], crypto.createHash('sha256').update(fs.readFileSync(path.join(a, za))).digest('hex'));
});

test('the zip opens with the Windows/PowerShell extractor and keeps exact script bytes', { skip: process.platform !== 'win32' }, () => {
  const a = fs.mkdtempSync(path.join(os.tmpdir(), 'rt-b3-')); build(a);
  const zip = path.join(a, fs.readdirSync(a).find(n => n.endsWith('.zip'))), dest = path.join(a, 'x');
  execFileSync('powershell.exe', ['-NoProfile', '-Command', `Expand-Archive -LiteralPath '${zip}' -DestinationPath '${dest}'`]);
  for (const f of ['launch.vbs', 'setup.ps1', 'app/server.js', 'app/ui/js/main.js']) assert.deepEqual(fs.readFileSync(path.join(dest, f)), fs.readFileSync(path.join(root, f)), f);
});
