/*
 * Unit tests (pure helpers, in Node) + SIMULATED-UI tests (real Chromium via Playwright, fake page).
 * The fake page imitates a Radix-style sidebar. It is NOT the real ChatGPT site: passing here proves the
 * engine's logic and event handling, not that the live site matches these assumptions.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const E = require('../extension/engine.js');

let chromium;
try { ({ chromium } = require('playwright')); }
catch (e) { ({ chromium } = require(process.env.PLAYWRIGHT_PATH || '/home/claude/.npm-global/lib/node_modules/playwright')); }

const ENGINE_SRC = fs.readFileSync(path.join(__dirname, '../extension/engine.js'), 'utf8');
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
    const s = await CGBD.runBatch(p.ids, { doc: document, timeouts: T });
    return { code: s.failed[0].code, rows: p.rowCount(), ms: performance.now() - t0 };
  }, T);
  assert.strictEqual(r.code, 'menu_not_opened');
  assert.strictEqual(r.rows, 1);
  assert.ok(r.ms < 2000, 'timeout must be bounded');
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

// ---------------- content-script UI smoke test (real Chromium, fake page) ----------------
test('ui: checkboxes appear per row, Select visible / Clear / count, and a batch runs through the panel', async () => {
  const page = await newPage();
  try {
    await page.evaluate(() => buildPage(3));
    await page.addScriptTag({ content: fs.readFileSync(path.join(__dirname, '../extension/content.js'), 'utf8') });
    const q = (sel) => page.evaluate((s) => document.querySelector('[data-cgbd]').shadowRoot.querySelectorAll(s).length, sel);
    await page.waitForFunction(() => document.querySelector('[data-cgbd]').shadowRoot.querySelectorAll('#layer input').length === 3);
    const txt = (id) => page.evaluate((i) => document.querySelector('[data-cgbd]').shadowRoot.getElementById(i).textContent, id);
    const click = (id) => page.evaluate((i) => document.querySelector('[data-cgbd]').shadowRoot.getElementById(i).click(), id);
    assert.strictEqual(await txt('count'), '0 selected');
    await click('selVis');
    assert.strictEqual(await txt('count'), '3 selected');
    await click('clear');
    assert.strictEqual(await txt('count'), '0 selected');
    // select first row via its real checkbox with a real mouse click
    const box = await page.evaluate(() => { const r = document.querySelector('[data-cgbd]').shadowRoot.querySelector('#layer input').getBoundingClientRect(); return { x: r.x + 8, y: r.y + 8 }; });
    await page.mouse.click(box.x, box.y);
    assert.strictEqual(await txt('count'), '1 selected');
    assert.strictEqual(page.url(), 'https://chatgpt.com/', 'clicking a checkbox must not navigate');
    page.on('dialog', (d) => d.accept());
    await click('del');
    await page.waitForFunction(() => /Deleted \(verified\): 1/.test(document.querySelector('[data-cgbd]').shadowRoot.getElementById('status').textContent), null, { timeout: 8000 });
    assert.strictEqual(await page.evaluate(() => document.querySelectorAll('li[data-id]').length), 2);
    assert.strictEqual(await txt('count'), '0 selected');
  } finally { await page.close(); }
});
