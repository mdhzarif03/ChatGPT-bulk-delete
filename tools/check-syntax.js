// Syntax-checks every top-level .js file (the extension scripts) with `node --check`.
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const dir = path.join(__dirname, '..');
let bad = 0;
for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.js'))) {
  try {
    execFileSync(process.execPath, ['--check', path.join(dir, f)], { stdio: 'pipe' });
    console.log('syntax ok  ' + f);
  } catch (e) {
    bad++;
    console.error('SYNTAX ERROR ' + f + '\n' + e.stderr);
  }
}
process.exit(bad ? 1 : 0);
