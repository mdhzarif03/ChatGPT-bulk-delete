// Builds dist/chatgpt-bulk-delete-<version>.zip. Unzipping gives ONE folder, "chatgpt-bulk-delete/", with manifest.json
// directly inside it - that is the folder to pick in chrome://extensions -> Load unpacked.
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const root = path.join(__dirname, '..');
const { version } = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
const out = path.join(root, 'dist', 'chatgpt-bulk-delete-' + version + '.zip');
const skip = new Set(['node_modules', 'dist', '.git', '.DS_Store']);

const stageRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cgbd-pack-'));
const stage = path.join(stageRoot, 'chatgpt-bulk-delete');
fs.cpSync(root, stage, { recursive: true, filter: (src) => !skip.has(path.basename(src)) && !src.endsWith('.zip') });
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.rmSync(out, { force: true });
execFileSync('zip', ['-qr', out, 'chatgpt-bulk-delete'], { cwd: stageRoot, stdio: 'inherit' });
fs.rmSync(stageRoot, { recursive: true, force: true });
console.log('wrote ' + path.relative(root, out));
