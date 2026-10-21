/*
 * Unit tests (pure helpers, in Node) + SIMULATED-UI tests (real Chromium via Playwright, fake page).
 * The fake page imitates a Radix-style sidebar. It is NOT the real ChatGPT site: passing here proves the
 * engine's logic and event handling, not that the live site matches these assumptions.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const E = require('../engine.js');

let chromium;
try { ({ chromium } = require('playwright')); }
catch (e) { ({ chromium } = require(process.env.PLAYWRIGHT_PATH || '/home/claude/.npm-global/lib/node_modules/playwright')); }

const ENGINE_SRC = fs.readFileSync(path.join(__dirname, '../engine.js'), 'utf8');
const FAKE_SRC = fs.readFileSync(path.join(__dirname, 'fakepage.js'), 'utf8');
const T = { menu: 400, dialog: 400, verify: 600, close: 200, settle: 100 };

let browser;
test.before(async () => {
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--no-sandbox'] });
});
test.after(async () => { if (browser) await browser.close(); });

async function newPage() {
  const page = await browser.newPage();
  await page.route('https://chatgpt.com/**', (r) => r.fulfill({ contentType: 'text/html', body: '<!doctype html><body></body>' }));
  await page.goto('https://chatgpt.com/');
  await page.addScriptTag({ content: ENGINE_SRC });
  await page.addScriptTag({ content: FAKE_SRC });
  return page;
}
// run fn(arg) inside a fresh fake page; fn has access to window.CGBD, window.buildPage
async function inPage(fn, arg) {
  const page = await newPage();
  try { return await page.evaluate(fn, arg); } finally { await page.close(); }
}

// ---------------- unit tests (pure helpers) ----------------
test('unit: extractId handles relative, absolute and project URLs', () => {
  assert.strictEqual(E.extractId('/c/abcd1234-aaaa-bbbb'), 'abcd1234-aaaa-bbbb');
  assert.strictEqual(E.extractId('https://chatgpt.com/c/abcd1234-aaaa-bbbb?x=1'), 'abcd1234-aaaa-bbbb');
  assert.strictEqual(E.extractId('/g/g-p-123/c/abcd1234-aaaa-bbbb'), 'abcd1234-aaaa-bbbb');
  assert.strictEqual(E.extractId('/gpts'), null);
  assert.strictEqual(E.extractId('/c/short'), null);
  assert.strictEqual(E.extractId(null), null);
});

test('unit: norm collapses whitespace and case', () => {
  assert.strictEqual(E.norm('  Delete \n Chat '), 'delete chat');
});

// ---------------- DOM-level helper tests (real Chromium) ----------------
test('dom: IDs sharing a prefix are never confused; same titles resolve by ID', async () => {
  const r = await inPage(() => {
    document.body.innerHTML = '<nav><a href="/c/abcdef12-0001">Same</a><a href="/c/abcdef12-00011">Same</a></nav>';
    const rows = CGBD.listRows(document);
    return { ids: rows.map((x) => x.id), href: CGBD.resolveEntry(document, 'abcdef12-00011').anchor.getAttribute('href') };
  });
  assert.deepStrictEqual(r.ids, ['abcdef12-0001', 'abcdef12-00011']);
  assert.strictEqual(r.href, '/c/abcdef12-00011');
});

test('dom: same ID twice in the sidebar is ambiguous_row', async () => {
  const code = await inPage(() => {
    document.body.innerHTML = '<nav><a href="/c/aaaaaaaa-1">X</a><a href="/c/aaaaaaaa-1">X</a></nav>';
    try { CGBD.resolveEntry(document, 'aaaaaaaa-1'); return 'none'; } catch (e) { return e.code; }
  });
  assert.strictEqual(code, 'ambiguous_row');
});

test('dom: findDeleteItem exact-matches, rejects duplicates and absence', async () => {
  const r = await inPage(() => {
    const out = {};
    const mk = (html) => { document.body.innerHTML = html; return document.querySelector('[role=menu]'); };
    out.ok = CGBD.norm(CGBD.findDeleteItem(mk('<div role="menu"><div role="menuitem">Archive</div><div role="menuitem">Delete</div><div role="menuitem">Delete account data</div></div>')).textContent);
    try { CGBD.findDeleteItem(mk('<div role="menu"><div role="menuitem">Delete</div><div role="menuitem">Delete chat</div></div>')); } catch (e) { out.dup = e.code; }
    try { CGBD.findDeleteItem(mk('<div role="menu"><div role="menuitem">Share</div></div>')); } catch (e) { out.none = e.code; }
    return out;
  });
  assert.deepStrictEqual(r, { ok: 'delete', dup: 'ambiguous_delete', none: 'no_delete_item' });
});

test('dom: findConfirmButton ignores Cancel', async () => {
  const t = await inPage(() => {
    document.body.innerHTML = '<div role="dialog"><button>Cancel</button><button>Delete</button></div>';
    return CGBD.norm(CGBD.findConfirmButton(document.querySelector('[role=dialog]')).textContent);
  });
  assert.strictEqual(t, 'delete');
});

// ---------------- simulated-UI tests (real Chromium, fake page) ----------------

test('sim: deletes one conversation, verified by sidebar disappearance', async () => {
  const r = await inPage(async (T) => {
    const p = buildPage(3);
    const target = p.ids[1];
    const s = await CGBD.runBatch([target], { doc: document, timeouts: T });
    return { deleted: s.deleted, target, has: p.has(target), rows: p.rowCount(), open: p.open(), usedDialog: s.results[0].usedDialog };
  }, T);
  assert.deepStrictEqual(r.deleted, [r.target]);
  assert.strictEqual(r.has, false);
  assert.strictEqual(r.rows, 2);
  assert.deepStrictEqual(r.open, { menu: false, dialog: false });
  assert.strictEqual(r.usedDialog, true);
});

test('sim: account menu button in the nav is never used', async () => {
  const r = await inPage(async (T) => {
    const p = buildPage(1);
    let clicked = false;
    document.getElementById('acct').addEventListener('pointerdown', () => { clicked = true; });
    const s = await CGBD.runBatch(p.ids, { doc: document, timeouts: T });
    return { n: s.deleted.length, clicked };
  }, T);
  assert.strictEqual(r.n, 1);
  assert.strictEqual(r.clicked, false);
});

test('sim: two sequential deletions with a full sidebar rerender between them', async () => {
  const r = await inPage(async (T) => {
    const p = buildPage(4);
    const targets = [p.ids[0], p.ids[2]];
    const s = await CGBD.runBatch(targets, { doc: document, timeouts: T, hooks: { onProgress: (e) => { if (e.phase === 'deleted') p.rerender(); } } });
    return { deleted: s.deleted, targets, remaining: p.ids.filter(p.has), ids: p.ids };
  }, T);
  assert.deepStrictEqual(r.deleted, r.targets);
  assert.deepStrictEqual(r.remaining, [r.ids[1], r.ids[3]]);
});

test('sim: conversation already gone is skipped and the batch continues', async () => {
  const r = await inPage(async (T) => {
    const p = buildPage(3);
    const s = await CGBD.runBatch(['ghost000-0000-0000', p.ids[0]], { doc: document, timeouts: T });
    return { skipped: s.skipped, deleted: s.deleted, failed: s.failed.length, first: p.ids[0] };
  }, T);
  assert.deepStrictEqual(r.skipped, ['ghost000-0000-0000']);
  assert.deepStrictEqual(r.deleted, [r.first]);
  assert.strictEqual(r.failed, 0);
});

test('sim: ambiguous options buttons -> stop, delete nothing', async () => {
  const r = await inPage(async (T) => {
    const p = buildPage(2, { twoButtons: true });
    const s = await CGBD.runBatch(p.ids, { doc: document, timeouts: T });
    return { code: s.failed[0].code, deleted: s.deleted, na: s.notAttempted, rows: p.rowCount(), ids: p.ids };
  }, T);
  assert.strictEqual(r.code, 'ambiguous_button');
  assert.deepStrictEqual(r.deleted, []);
  assert.deepStrictEqual(r.na, [r.ids[1]]);
  assert.strictEqual(r.rows, 2);
});

test('sim: ambiguous Delete items -> stop, menu closed afterwards', async () => {
  const r = await inPage(async (T) => {
    const p = buildPage(2, { twoDeletes: true });
    const s = await CGBD.runBatch(p.ids, { doc: document, timeouts: T });
    return { code: s.failed[0].code, rows: p.rowCount(), open: p.open() };
  }, T);
  assert.strictEqual(r.code, 'ambiguous_delete');
  assert.strictEqual(r.rows, 2);
  assert.deepStrictEqual(r.open, { menu: false, dialog: false });
});

test('sim: menu never opens -> menu_not_opened (timeout path)', async () => {
  const r = await inPage(async (T) => {
    const p = buildPage(1, { noMenu: true });
    const t0 = performance.now();
    const s = await CGBD.runBatch(p.ids, { doc: document, timeouts: Object.assign({}, T, { menu: 900 }) });
    return { code: s.failed[0].code, rows: p.rowCount(), ms: performance.now() - t0 };
  }, T);
  assert.strictEqual(r.code, 'menu_not_opened');
  assert.strictEqual(r.rows, 1);
  assert.ok(r.ms < 1800, 'all menu-opening strategies must share one timeout; took ' + r.ms + 'ms');
});

test('sim: menu never opens -> failure carries DOM evidence for debugging', async () => {
  const r = await inPage(async (T) => {
    const p = buildPage(1, { noMenu: true });
    const s = await CGBD.runBatch(p.ids, { doc: document, timeouts: T });
    const d = s.failed[0].detail;
    return { tried: d.strategiesTried, haspopup: d.button.attrs['aria-haspopup'], hasActive: !!d.activeElement };
  }, T);
  assert.deepStrictEqual(r.tried, ['pointer', 'keyboard', 'click']);
  assert.strictEqual(r.haspopup, 'menu');
  assert.ok(r.hasActive);
});

test('sim: trigger that only opens via keyboard still works (fallback strategy)', async () => {
  const r = await inPage(async (T) => {
    const p = buildPage(1, { keyboardOnly: true });
    const s = await CGBD.runBatch(p.ids, { doc: document, timeouts: T });
    return { deleted: s.deleted.length, rows: p.rowCount() };
  }, T);
  assert.strictEqual(r.deleted, 1);
  assert.strictEqual(r.rows, 0);
});

test('sim: menu bound to a different trigger -> menu_mismatch', async () => {
  const r = await inPage(async (T) => {
    const p = buildPage(1, { wrongLabelledBy: true });
    const s = await CGBD.runBatch(p.ids, { doc: document, timeouts: T });
    return { code: s.failed[0].code, rows: p.rowCount(), open: p.open() };
  }, T);
  assert.strictEqual(r.code, 'menu_mismatch');
  assert.strictEqual(r.rows, 1);
  assert.deepStrictEqual(r.open, { menu: false, dialog: false });
});

test('sim: no dialog and row remains -> no_confirm_dialog', async () => {
  const r = await inPage(async (T) => {
    const p = buildPage(1, { noDialog: true });
    const s = await CGBD.runBatch(p.ids, { doc: document, timeouts: T });
    return { code: s.failed[0].code, rows: p.rowCount() };
  }, T);
  assert.strictEqual(r.code, 'no_confirm_dialog');
  assert.strictEqual(r.rows, 1);
});

test('sim: dialog without recognizable confirm button -> stop and close dialog', async () => {
  const r = await inPage(async (T) => {
    const p = buildPage(2, { noConfirmButton: true });
    const s = await CGBD.runBatch(p.ids, { doc: document, timeouts: T });
    return { code: s.failed[0].code, open: p.open(), na: s.notAttempted.length };
  }, T);
  assert.strictEqual(r.code, 'no_confirm_button');
  assert.deepStrictEqual(r.open, { menu: false, dialog: false });
  assert.strictEqual(r.na, 1);
});

test('sim: confirm clicked but conversation stays -> not_deleted, no false success', async () => {
  const r = await inPage(async (T) => {
    const p = buildPage(3, { noDelete: true });
    const s = await CGBD.runBatch([p.ids[0], p.ids[1]], { doc: document, timeouts: T });
    return { code: s.failed[0].code, deleted: s.deleted, na: s.notAttempted, rows: p.rowCount(), ids: p.ids };
  }, T);
  assert.strictEqual(r.code, 'not_deleted');
  assert.deepStrictEqual(r.deleted, []);
  assert.deepStrictEqual(r.na, [r.ids[1]]);
  assert.strictEqual(r.rows, 3);
});

test('sim: collateral deletion of another conversation is detected', async () => {
  const r = await inPage(async (T) => {
    const p = buildPage(3, { collateral: true });
    const s = await CGBD.runBatch([p.ids[1], p.ids[2]], { doc: document, timeouts: T });
    return { code: s.failed[0].code, na: s.notAttempted.length };
  }, T);
  assert.strictEqual(r.code, 'collateral');
  assert.strictEqual(r.na, 1);
});

test('sim: user stop between items', async () => {
  const r = await inPage(async (T) => {
    const p = buildPage(3);
    let stop = false;
    const s = await CGBD.runBatch([p.ids[0], p.ids[1]], { doc: document, timeouts: T, hooks: { shouldStop: () => stop, onProgress: (e) => { if (e.phase === 'deleted') stop = true; } } });
    return { deleted: s.deleted, stopped: s.stopped.code, na: s.notAttempted, ids: p.ids };
  }, T);
  assert.deepStrictEqual(r.deleted, [r.ids[0]]);
  assert.strictEqual(r.stopped, 'user_stop');
  assert.deepStrictEqual(r.na, [r.ids[1]]);
});

test('sim: a stray open menu from before is closed first, then deletion proceeds', async () => {
  const r = await inPage(async (T) => {
    const p = buildPage(2);
    const stray = document.createElement('div');
    stray.setAttribute('role', 'menu');
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') stray.remove(); });
    document.getElementById('portal').appendChild(stray);
    const s = await CGBD.runBatch([p.ids[0]], { doc: document, timeouts: T });
    return { deleted: s.deleted, id: p.ids[0] };
  }, T);
  assert.deepStrictEqual(r.deleted, [r.id]);
});

test('sim: diagnose is non-destructive and reports menu evidence', async () => {
  const r = await inPage(async (T) => {
    const p = buildPage(2);
    const d = await CGBD.diagnose(document, p.ids[0], { timeouts: T });
    return { error: d.error, haspopup: d.optionsButton.attrs['aria-haspopup'], items: d.menuItems.map((i) => i.text), closed: d.menuClosedAfter, rows: p.rowCount() };
  }, T);
  assert.strictEqual(r.error, undefined);
  assert.strictEqual(r.haspopup, 'menu');
  assert.ok(r.items.includes('Delete'));
  assert.strictEqual(r.closed, true);
  assert.strictEqual(r.rows, 2);
});

test('sim: 20 sequential deletions stay bounded', async () => {
  const r = await inPage(async (T) => {
    const p = buildPage(20);
    const t0 = performance.now();
    const s = await CGBD.runBatch(p.ids, { doc: document, timeouts: T });
    return { n: s.deleted.length, ms: performance.now() - t0 };
  }, T);
  assert.strictEqual(r.n, 20);
  assert.ok(r.ms < 15000, 'took ' + r.ms);
});

test('sim: 300 sequential deletions complete with each result verified', async () => {
  const r = await inPage(async (T) => {
    const p = buildPage(300);
    const t0 = performance.now();
    const s = await CGBD.runBatch(p.ids, { doc: document, timeouts: T });
    return { deleted: s.deleted.length, failed: s.failed.length, rows: p.rowCount(), ms: performance.now() - t0, phaseMs: s.phaseMs };
  }, T);
  assert.strictEqual(r.deleted, 300);
  assert.strictEqual(r.failed, 0);
  assert.strictEqual(r.rows, 0);
  assert.ok(Object.values(r.phaseMs).every((ms) => Number.isFinite(ms) && ms >= 0));
  assert.ok(r.ms < 30000, 'took ' + r.ms + 'ms');
});

// ---------------- content-script UI smoke test (real Chromium, fake page) ----------------
test('ui: checkboxes appear per row, Select visible / Clear / count, and a batch runs through the panel', async () => {
  const page = await newPage();
  try {
    await page.evaluate(() => buildPage(3));
    await page.addScriptTag({ content: fs.readFileSync(path.join(__dirname, '../content.js'), 'utf8') });
    const q = (sel) => page.evaluate((s) => document.querySelector('div[data-cgbd]').shadowRoot.querySelectorAll(s).length, sel);
    await page.waitForFunction(() => document.querySelector('div[data-cgbd]').shadowRoot.querySelectorAll('#layer input:not([data-cgbd-master])').length === 3);
    await page.waitForFunction(() => !!document.querySelector('div[data-cgbd]').shadowRoot.querySelector('#layer input[data-cgbd-master]'));
    const txt = (id) => page.evaluate((i) => document.querySelector('div[data-cgbd]').shadowRoot.getElementById(i).textContent, id);
    const click = (id) => page.evaluate((i) => document.querySelector('div[data-cgbd]').shadowRoot.getElementById(i).click(), id);
    const barHidden = () => page.evaluate(() => document.querySelector('div[data-cgbd]').shadowRoot.getElementById('bar').classList.contains('hidden'));
    assert.strictEqual(await txt('count'), '0 selected');
    assert.strictEqual(await barHidden(), true, 'bar must be hidden until something is selected');
    // checkbox sits to the LEFT of the conversation link text
    const geo = await page.evaluate(() => {
      const cb = document.querySelector('div[data-cgbd]').shadowRoot.querySelector('#layer input:not([data-cgbd-master])').getBoundingClientRect();
      const a = document.querySelector('li[data-id] a').getBoundingClientRect();
      return { cbRight: cb.right, aLeft: a.left, aRight: a.right };
    });
    assert.ok(geo.cbRight <= geo.aLeft + 40 && geo.cbRight < (geo.aLeft + geo.aRight) / 2, 'checkbox on the left of the row');
    await click('selVis');
    assert.strictEqual(await barHidden(), false);
    assert.strictEqual(await txt('count'), '3 selected');
    await click('clear');
    assert.strictEqual(await txt('count'), '0 selected');
    assert.strictEqual(await barHidden(), true, 'bar hides again when selection is cleared');
    // select first row via its real checkbox with a real mouse click
    const box = await page.evaluate(() => { const r = document.querySelector('div[data-cgbd]').shadowRoot.querySelector('#layer input:not([data-cgbd-master])').getBoundingClientRect(); return { x: r.x + 8, y: r.y + 8 }; });
    await page.mouse.click(box.x, box.y);
    assert.strictEqual(await txt('count'), '1 selected');
    assert.strictEqual(page.url(), 'https://chatgpt.com/', 'clicking a checkbox must not navigate');
    const bar = await page.evaluate(() => { const r = document.querySelector('div[data-cgbd]').shadowRoot.getElementById('bar').getBoundingClientRect(); return { cx: r.left + r.width / 2, bottom: r.bottom, vw: innerWidth, vh: innerHeight }; });
    assert.ok(Math.abs(bar.cx - bar.vw / 2) < 3 && bar.bottom > bar.vh / 2, 'bar is bottom-centre');
    page.on('dialog', (d) => d.accept());
    await click('del');
    await page.waitForFunction(() => /Deleted \(verified\): 1/.test(document.querySelector('div[data-cgbd]').shadowRoot.getElementById('status').textContent), null, { timeout: 8000 });
    assert.strictEqual(await page.evaluate(() => document.querySelectorAll('li[data-id]').length), 2);
    assert.strictEqual(await txt('count'), '0 selected');
  } finally { await page.close(); }
});

test('ui: Recents checkbox selects its loaded rows without selecting Pinned or Projects', async () => {
  const page = await newPage();
  try {
    await page.evaluate(() => {
      buildPage(4);
      const nav = document.getElementById('nav');
      const makeSection = (name, id) => {
        const heading = document.createElement('div');
        heading.textContent = name;
        heading.style.display = 'inline-block';
        const list = document.createElement('ul');
        const li = document.createElement('li');
        li.innerHTML = '<a href="/c/' + id + '">Test ' + name + '</a>';
        list.appendChild(li);
        nav.insertBefore(heading, document.getElementById('recent-heading'));
        nav.insertBefore(list, document.getElementById('recent-heading'));
      };
      makeSection('Projects', 'project000-0000-0000-000000000000');
      makeSection('Pinned', 'pinned000-0000-0000-000000000000');
      document.getElementById('recent-heading').style.display = 'inline-block';
      document.querySelectorAll('li[data-id]')[3].style.cssText += ';position:fixed;top:1000px';
    });
    await page.addScriptTag({ content: fs.readFileSync(path.join(__dirname, '../content.js'), 'utf8') });
    await page.waitForFunction(() => document.querySelector('div[data-cgbd]').shadowRoot.querySelectorAll('#layer input[data-cgbd-master]').length === 3);

    const state = () => page.evaluate(() => {
      const shadow = document.querySelector('div[data-cgbd]').shadowRoot;
      const master = shadow.querySelector('#layer input[data-cgbd-master="recents"]');
      const heading = document.getElementById('recent-heading');
      const range = document.createRange();
      range.selectNodeContents(heading);
      const headingText = range.getBoundingClientRect();
      const masterRect = master.getBoundingClientRect();
      return {
        count: shadow.getElementById('count').textContent,
        checked: master.checked,
        indeterminate: master.indeterminate,
        visibleBoxes: shadow.querySelectorAll('#layer input:not([data-cgbd-master])').length,
        masterLeft: masterRect.left,
        masterRight: masterRect.right,
        headingTextLeft: headingText.left,
        pinnedSelected: shadow.querySelector('#layer input[data-cgbd-master="pinned"]').checked,
        projectsSelected: shadow.querySelector('#layer input[data-cgbd-master="projects"]').checked
      };
    });
    const clickMaster = () => page.evaluate(() => document.querySelector('div[data-cgbd]').shadowRoot.querySelector('#layer input[data-cgbd-master="recents"]').click());
    assert.strictEqual((await state()).visibleBoxes, 5, 'visible project and pinned rows each have their own row checkbox');
    const initial = await state();
    assert.ok(initial.masterLeft >= 8, 'master checkbox has a sidebar inset');
    assert.ok(initial.masterRight + 4 <= initial.headingTextLeft,
      'master checkbox sits left of the heading with a gap (' + JSON.stringify(initial) + ')');
    await clickMaster();
    const selectedAll = await state();
    assert.strictEqual(selectedAll.count, '4 selected');
    assert.strictEqual(selectedAll.checked, true);
    assert.strictEqual(selectedAll.indeterminate, false);
    assert.strictEqual(selectedAll.pinnedSelected, false);
    assert.strictEqual(selectedAll.projectsSelected, false);
    await clickMaster();
    const cleared = await state();
    assert.strictEqual(cleared.count, '0 selected');
    assert.strictEqual(cleared.checked, false);
    assert.strictEqual(cleared.indeterminate, false);
    assert.strictEqual(cleared.pinnedSelected, false);
    assert.strictEqual(cleared.projectsSelected, false);
    await page.evaluate(() => document.querySelector('div[data-cgbd]').shadowRoot.querySelector('#layer input[data-cgbd-id$="000000000001"]').click());
    assert.strictEqual((await state()).indeterminate, true, 'master checkbox reflects partial selection');
    await clickMaster();
    const selectedPartial = await state();
    assert.strictEqual(selectedPartial.count, '4 selected');
    assert.strictEqual(selectedPartial.checked, true);
    assert.strictEqual(selectedPartial.indeterminate, false);
    assert.strictEqual(selectedPartial.pinnedSelected, false);
    assert.strictEqual(selectedPartial.projectsSelected, false);
  } finally { await page.close(); }
});

// ---------------- theming ----------------
async function themed(bodyStyle) {
  const page = await newPage();
  await page.evaluate((st) => { document.body.style.cssText = st; buildPage(3); }, bodyStyle);
  await page.addScriptTag({ content: fs.readFileSync(path.join(__dirname, '../content.js'), 'utf8') });
  await page.waitForFunction(() => document.querySelector('div[data-cgbd]').shadowRoot.querySelectorAll('#layer input:not([data-cgbd-master])').length === 3);
  return page;
}
const cssVar = (page, name) => page.evaluate((n) => document.querySelector('div[data-cgbd]').style.getPropertyValue(n), name);

test('theme: dark page -> light foreground, raised bar; light page -> dark foreground', async () => {
  const dark = await themed('background:#212121;color:#ececec;font-family:Georgia,serif');
  try {
    assert.strictEqual(await cssVar(dark, '--cg-bg'), 'rgb(33,33,33)');
    assert.strictEqual(await cssVar(dark, '--cg-fg'), 'rgb(236,236,236)');
    assert.notStrictEqual(await cssVar(dark, '--cg-bar'), 'rgb(33,33,33)', 'dark bar is raised above the page');
    assert.match(await cssVar(dark, '--cg-font'), /Georgia/);
  } finally { await dark.close(); }
  const light = await themed('background:#ffffff;color:#0d0d0d');
  try {
    assert.strictEqual(await cssVar(light, '--cg-bg'), 'rgb(255,255,255)');
    assert.strictEqual(await cssVar(light, '--cg-fg'), 'rgb(13,13,13)');
    assert.strictEqual(await cssVar(light, '--cg-bar'), 'rgb(255,255,255)');
  } finally { await light.close(); }
});

test('theme: switching the page theme at runtime updates the UI colours', async () => {
  const page = await themed('background:#212121;color:#ececec');
  try {
    await page.evaluate(() => { document.body.style.background = '#ffffff'; document.body.style.color = '#0d0d0d'; });
    await page.waitForFunction(() => document.querySelector('div[data-cgbd]').style.getPropertyValue('--cg-bg') === 'rgb(255,255,255)', null, { timeout: 3000 });
  } finally { await page.close(); }
});

test('theme: oklch / modern colour syntax is understood', async () => {
  const page = await themed('background:oklch(0.25 0 0);color:oklch(0.95 0 0)');
  try {
    const bg = await cssVar(page, '--cg-bg');
    const m = bg.match(/\d+/g).map(Number);
    assert.ok(m[0] < 80 && m[0] === m[1], 'parsed dark grey from oklch: ' + bg);
  } finally { await page.close(); }
});

test('ui: selected rows are highlighted via CSS (page DOM untouched) and cleared with Clear', async () => {
  const page = await themed('background:#212121;color:#ececec');
  try {
    const css = () => page.evaluate(() => document.querySelector('style[data-cgbd]').textContent);
    assert.ok(!/background-color/.test(await css()));
    const attrsOf = () => page.evaluate(() => document.querySelector('li[data-id] a').outerHTML);
    const before = await attrsOf();
    await page.evaluate(() => document.querySelector('div[data-cgbd]').shadowRoot.querySelector('#layer input:not([data-cgbd-master])').click());
    const c = await css();
    assert.match(c, /a\[href\$="\/c\/conv0000-0000-0000-0000-000000000001"\]/);
    assert.match(c, /background-color:rgba\(236,236,236,0.12\)/);
    assert.strictEqual(await attrsOf(), before, 'the site row element must not be modified');
    await page.evaluate(() => document.querySelector('div[data-cgbd]').shadowRoot.getElementById('clear').click());
    assert.ok(!/background-color/.test(await css()));
  } finally { await page.close(); }
});

// ---------------- regression: header "Chat actions" button for the open chat (seen on the live site) ----------------
const addHeader = (id) => {
  document.body.insertAdjacentHTML('afterbegin',
    '<header style="position:fixed;top:0;left:400px"><nav id="crumb"><a href="/c/' + id + '">Open chat title</a>' +
    '<button id="radix-header" aria-haspopup="menu" aria-expanded="false" aria-label="Chat actions" data-state="closed">...</button></nav></header>');
  window.__headerClicked = false;
  document.getElementById('radix-header').addEventListener('pointerdown', () => { window.__headerClicked = true; });
};

test('regression: chat that is only linked from the header is NOT treated as a sidebar row (skipped, header untouched)', async () => {
  const r = await inPage(async ([T, addHeaderSrc]) => {
    const p = buildPage(3);
    new Function('return ' + addHeaderSrc)()('openchat-0000-0000-0000-000000000000');
    const s = await CGBD.runBatch(['openchat-0000-0000-0000-000000000000'], { doc: document, timeouts: T });
    return { skipped: s.skipped, failed: s.failed.length, headerClicked: window.__headerClicked, rows: p.rowCount(), listed: CGBD.listRows(document).length };
  }, [T, addHeader.toString()]);
  assert.deepStrictEqual(r.skipped, ['openchat-0000-0000-0000-000000000000']);
  assert.strictEqual(r.failed, 0);
  assert.strictEqual(r.headerClicked, false);
  assert.strictEqual(r.listed, 3);
});

test('regression: chat linked from header AND sidebar is deleted via the sidebar button only', async () => {
  const r = await inPage(async ([T, addHeaderSrc]) => {
    const p = buildPage(3);
    new Function('return ' + addHeaderSrc)()(p.ids[1]);
    const s = await CGBD.runBatch([p.ids[1]], { doc: document, timeouts: T });
    return { deleted: s.deleted, id: p.ids[1], headerClicked: window.__headerClicked, has: p.has(p.ids[1]) };
  }, [T, addHeader.toString()]);
  assert.deepStrictEqual(r.deleted, [r.id]);
  assert.strictEqual(r.headerClicked, false);
  assert.strictEqual(r.has, false);
});

test('regression: single sidebar row + header link to the same chat still picks the sidebar', async () => {
  const r = await inPage(async ([T, addHeaderSrc]) => {
    const p = buildPage(1);
    new Function('return ' + addHeaderSrc)()(p.ids[0]);
    const s = await CGBD.runBatch([p.ids[0]], { doc: document, timeouts: T });
    return { deleted: s.deleted.length, headerClicked: window.__headerClicked };
  }, [T, addHeader.toString()]);
  assert.strictEqual(r.deleted, 1);
  assert.strictEqual(r.headerClicked, false);
});

test('regression: an options-like button far from the row line is rejected (no_options_button + row evidence)', async () => {
  const r = await inPage(async (T) => {
    const p = buildPage(2);
    const btn = document.querySelector('li[data-id="' + p.ids[0] + '"] button');
    btn.style.cssText = 'position:fixed;top:600px;left:700px';
    const s = await CGBD.runBatch([p.ids[0]], { doc: document, timeouts: T });
    return { code: s.failed[0].code, html: s.failed[0].detail.rowHtml, rows: p.rowCount() };
  }, T);
  assert.strictEqual(r.code, 'no_options_button');
  assert.match(r.html, /<a href="\/c\//);
  assert.strictEqual(r.rows, 2);
});
