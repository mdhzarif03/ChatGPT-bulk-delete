const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const dir = path.join(__dirname, '..', 'extension');
let bad = 0;
for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.js'))) {
  try {
    execFileSync(process.execPath, ['--check', path.join(dir, f)], { stdio: 'pipe' });
    console.log('syntax ok  extension/' + f);
  } catch (e) {
    bad++;
    console.error('SYNTAX ERROR extension/' + f + '\n' + e.stderr);
  }
}
process.exit(bad ? 1 : 0);
