const fs = require('fs');
const path = require('path');
const dir = path.join(__dirname, '..', 'extension');
const errors = [];
let m;
try { m = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8')); }
catch (e) { console.error('manifest.json is not valid JSON: ' + e.message); process.exit(1); }

if (m.manifest_version !== 3) errors.push('manifest_version must be 3');
for (const k of ['name', 'version', 'description']) if (!m[k] || typeof m[k] !== 'string') errors.push('missing ' + k);
if (!/^\d+(\.\d+){0,3}$/.test(m.version || '')) errors.push('invalid version');
if (m.permissions && m.permissions.length) errors.push('unexpected permissions: ' + m.permissions.join(','));
if (m.host_permissions && m.host_permissions.length) errors.push('unexpected host_permissions');
if (m.background) errors.push('no background worker expected');
const cs = m.content_scripts || [];
if (cs.length !== 1) errors.push('expected exactly one content_scripts entry');
for (const c of cs) {
  if (JSON.stringify(c.matches) !== JSON.stringify(['https://chatgpt.com/*'])) errors.push('matches must be only https://chatgpt.com/*');
  for (const f of c.js || []) if (!fs.existsSync(path.join(dir, f))) errors.push('missing file ' + f);
  if (!(c.js || []).length) errors.push('no js listed');
  if ((c.js || [])[0] !== 'engine.js') errors.push('engine.js must load before content.js');
}
if (errors.length) { console.error('MANIFEST INVALID:\n- ' + errors.join('\n- ')); process.exit(1); }
console.log('manifest ok (MV3, no permissions, matches https://chatgpt.com/* only)');
