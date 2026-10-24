// 產生安裝包：同一個 Git 提交每次產生的 zip 位元組完全相同（檔案排序固定、時間用提交時間）
// node scripts/build.mjs [輸出資料夾]  → AI_Roundtable_Setup_v<版本>.zip、BUILD.json、SHA256SUMS.txt
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.resolve(process.argv[2] || path.join(root, 'dist'));
const { VERSION } = require('../app/server.js');

const TOP = ['Setup.bat', 'setup.ps1', 'uninstall.bat', 'uninstall.ps1', 'launch.vbs', 'start.bat', 'roundtable.ico', 'README.txt'];
const walk = d => fs.readdirSync(path.join(root, d), { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
const files = [...TOP, ...walk('app')].map(f => f.split(path.sep).join('/')).sort();

const git = (...a) => execFileSync('git', a, { cwd: root, encoding: 'utf8' }).trim();
const commit = git('rev-parse', 'HEAD');
const dirty = git('status', '--porcelain', '--', '.') !== '';
const when = new Date(git('show', '-s', '--format=%cI', 'HEAD'));
const sha = b => crypto.createHash('sha256').update(b).digest('hex');

const entries = files.map(f => ({ name: f, data: fs.readFileSync(path.join(root, f)) }));
const build = { app: 'AI圓桌會議', version: VERSION, commit, dirty, committedAt: when.toISOString(), files: Object.fromEntries(entries.map(e => [e.name, sha(e.data)])) };
entries.push({ name: 'BUILD.json', data: Buffer.from(JSON.stringify(build, null, 2) + '\n') });
entries.sort((a, b) => a.name.localeCompare(b.name));

// 最小的 zip 寫入器（deflate、UTF-8 檔名、固定時間）
const dosTime = (d => ({ time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1), date: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate() }))(when);
const parts = [], central = []; let offset = 0;
for (const e of entries) {
  const name = Buffer.from(e.name, 'utf8'), raw = e.data, comp = zlib.deflateRawSync(raw, { level: 9 }), crc = zlib.crc32(raw);
  const h = Buffer.alloc(30);
  h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(0x0800, 6); h.writeUInt16LE(8, 8);
  h.writeUInt16LE(dosTime.time, 10); h.writeUInt16LE(dosTime.date, 12); h.writeUInt32LE(crc, 14);
  h.writeUInt32LE(comp.length, 18); h.writeUInt32LE(raw.length, 22); h.writeUInt16LE(name.length, 26); h.writeUInt16LE(0, 28);
  parts.push(h, name, comp);
  const c = Buffer.alloc(46);
  c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0x0800, 8); c.writeUInt16LE(8, 10);
  c.writeUInt16LE(dosTime.time, 12); c.writeUInt16LE(dosTime.date, 14); c.writeUInt32LE(crc, 16); c.writeUInt32LE(comp.length, 20);
  c.writeUInt32LE(raw.length, 24); c.writeUInt16LE(name.length, 28); c.writeUInt32LE(offset, 42);
  central.push(c, name);
  offset += h.length + name.length + comp.length;
}
const cd = Buffer.concat(central), end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
const zip = Buffer.concat([...parts, cd, end]);

fs.mkdirSync(out, { recursive: true });
const zipName = `AI_Roundtable_Setup_v${VERSION}.zip`;
fs.writeFileSync(path.join(out, zipName), zip);
fs.writeFileSync(path.join(out, 'BUILD.json'), JSON.stringify(build, null, 2) + '\n');
fs.writeFileSync(path.join(out, 'SHA256SUMS.txt'), `${sha(zip)}  ${zipName}\n`);
console.log(`${zipName}  ${entries.length} 個檔案  ${zip.length} bytes`);
console.log(`SHA-256 ${sha(zip)}`);
console.log(`commit ${commit}${dirty ? '（有未提交的修改，正式發布前請先提交）' : ''}`);
