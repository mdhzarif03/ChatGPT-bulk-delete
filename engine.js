/*
 * engine.js - DOM automation core for bulk conversation deletion.
 * Pure logic, no extension APIs. Works in the page (window.CGBD) and in Node (module.exports) for tests.
 *
 * Principles:
 *  - Targets are resolved by conversation ID (from /c/<id> in the anchor href), never by title.
 *  - The row is re-resolved before every deletion.
 *  - Every step requires UNIQUE evidence; zero or multiple matches stop the batch.
 *  - Success is only reported after the ID has disappeared from the sidebar.
 *  - No private APIs, no tokens, no cookies: only visible UI + synthetic DOM events.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CGBD = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const DEFAULT_TIMEOUTS = { menu: 3000, dialog: 3000, verify: 8000, close: 1500, settle: 600 };
  const ID_RE = /\/c\/([0-9A-Za-z][0-9A-Za-z-]{7,})(?:[/?#]|$)/;
  const DELETE_TEXT = /^delete( chat| conversation)?$/;

  class BatchError extends Error {
    constructor(code, message, detail) {
      super(message);
      this.name = 'BatchError';
      this.code = code;
      this.detail = detail || null;
    }
  }

  // ---------- small helpers ----------
  const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim().toLowerCase();

  function extractId(href) {
    const m = ID_RE.exec(href || '');
    return m ? m[1] : null;
  }

  const inOwnUi = (el) => !!(el.closest && el.closest('[data-cgbd]'));

  function styleVisible(el) {
    const win = el.ownerDocument.defaultView;
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
      if (n.hidden) return false;
      const cs = win.getComputedStyle(n);
      if (cs.display === 'none') return false;
      if (n === el && cs.visibility === 'hidden') return false;
    }
    return true;
  }

  function waitFor(check, { timeout = 3000, interval = 75, doc = document } = {}) {
    return new Promise((resolve) => {
      const start = Date.now();
      let done = false, timer = null, mo = null, last = 0;
      const finish = (v) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        if (mo) mo.disconnect();
        resolve(v);
      };
      const tick = () => {
        if (done) return;
        last = Date.now();
        let v;
        try { v = check(); } catch (e) { v = undefined; }
        if (v) return finish(v);
        if (Date.now() - start >= timeout) return finish(undefined);
        clearTimeout(timer);
        timer = setTimeout(tick, interval);
      };
      const MO = doc.defaultView && doc.defaultView.MutationObserver;
      if (MO && doc.documentElement) {
        mo = new MO(() => {
          if (done) return;
          clearTimeout(timer);
          timer = setTimeout(tick, Math.max(0, 10 - (Date.now() - last)));
        });
        mo.observe(doc.documentElement, { childList: true, subtree: true, attributes: true });
      }
      tick();
    });
  }

  function fire(el, type, init, Ctor) {
    const view = el.ownerDocument.defaultView;
    const C = Ctor || view.MouseEvent;
    el.dispatchEvent(new C(type, Object.assign({ bubbles: true, cancelable: true, composed: true, view }, init)));
  }

  function hover(el) {
    const view = el.ownerDocument.defaultView;
    const P = view.PointerEvent || view.MouseEvent;
    fire(el, 'pointerover', { pointerType: 'mouse' }, P);
    fire(el, 'mouseover', {});
    fire(el, 'pointerenter', { bubbles: false, pointerType: 'mouse' }, P);
    fire(el, 'mouseenter', { bubbles: false });
    fire(el, 'pointermove', { pointerType: 'mouse' }, P);
    fire(el, 'mousemove', {});
  }

  // Full pointer sequence. Radix-style triggers open on pointerdown, items select on click.
  function realClick(el) {
    const view = el.ownerDocument.defaultView;
    const P = view.PointerEvent || view.MouseEvent;
    const r = el.getBoundingClientRect();
    const pos = { clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, button: 0 };
    const ptr = { pointerId: 1, pointerType: 'mouse', isPrimary: true };
    hover(el);
    fire(el, 'pointerdown', Object.assign({ buttons: 1 }, pos, ptr), P);
    fire(el, 'mousedown', Object.assign({ buttons: 1 }, pos));
    // Deliberately NO el.focus(): menu libraries dismiss on focus moving outside the menu.
    fire(el, 'pointerup', Object.assign({ buttons: 0 }, pos, ptr), P);
    fire(el, 'mouseup', Object.assign({ buttons: 0 }, pos));
    fire(el, 'click', Object.assign({ buttons: 0, detail: 1 }, pos));
  }

  function pressEscape(doc) {
    const target = doc.activeElement || doc.body;
    for (const t of [target, doc]) {
      for (const type of ['keydown', 'keyup']) {
        t.dispatchEvent(new doc.defaultView.KeyboardEvent(type, {
          key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true, cancelable: true
        }));
      }
    }
  }

  // ---------- sidebar rows ----------
  // Only the SIDEBAR list counts. Links to the open chat elsewhere (header, breadcrumb, canvas panel...) must never be
  // treated as rows. The sidebar is the nav/aside group holding the most conversation links (ties: the leftmost).
  function conversationAnchors(doc) {
    const isConversationAnchor = (a) =>
      !inOwnUi(a) && extractId(a.getAttribute('href')) && !a.closest('[role=menu],[role=dialog],[role=alertdialog]');
    // Once a batch starts, avoid rescanning the whole page on every verification poll.
    if (pinnedSidebar && pinnedSidebar.isConnected) {
      return [...pinnedSidebar.querySelectorAll('a[href*="/c/"]')].filter(isConversationAnchor);
    }
    const all = [...doc.querySelectorAll('a[href*="/c/"]')].filter(isConversationAnchor);
    if (!doc.querySelector('nav,aside')) return all;
    return pickSidebar(all).list;
  }

  let pinnedSidebar = null;
  function pickSidebar(all) {
    const groups = new Map();
    for (const a of all) {
      const g = a.closest('nav,aside');
      if (!g) continue;
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g).push(a);
    }
    let best = null;
    for (const [g, list] of groups) {
      const hdr = !!g.closest('header,[role=banner]');
      const left = g.getBoundingClientRect().left;
      const score = [list.length, hdr ? 0 : 1, -left];
      if (!best || score[0] > best.score[0] ||
        (score[0] === best.score[0] && (score[1] > best.score[1] || (score[1] === best.score[1] && score[2] > best.score[2])))) {
        best = { g, list, score };
      }
    }
    return best ? { g: best.g, list: best.list } : { g: null, list: [] };
  }

  function listRows(doc) {
    const map = new Map();
    for (const a of conversationAnchors(doc)) {
      const id = extractId(a.getAttribute('href'));
      const e = map.get(id);
      if (e) e.anchors.push(a);
      else map.set(id, { id, anchor: a, anchors: [a], title: (a.textContent || '').replace(/\s+/g, ' ').trim() });
    }
    return [...map.values()];
  }

  function snapshotEntryAndIds(doc, targetId) {
    const ids = new Set();
    let entry = null;
    for (const a of conversationAnchors(doc)) {
      const id = extractId(a.getAttribute('href'));
      if (!id) continue;
      ids.add(id);
      if (id !== targetId) continue;
      if (!entry) entry = { id, anchor: a, anchors: [a], title: (a.textContent || '').replace(/\s+/g, ' ').trim() };
      else entry.anchors.push(a);
    }
    return { ids: [...ids], entry };
  }

  function conversationIdSet(doc) {
    const ids = new Set();
    for (const a of conversationAnchors(doc)) {
      const id = extractId(a.getAttribute('href'));
      if (id) ids.add(id);
    }
    return ids;
  }

  function hasConversationId(doc, id) {
    const container = pinnedSidebar && pinnedSidebar.isConnected ? pinnedSidebar : null;
    const anchors = container
      ? container.querySelectorAll('a[href*="/c/"]')
      : conversationAnchors(doc);
    for (const a of anchors) {
      if (!inOwnUi(a) && !a.closest('[role=menu],[role=dialog],[role=alertdialog]') &&
        extractId(a.getAttribute('href')) === id) return true;
    }
    return false;
  }

  function resolveEntryFromRows(rows, id) {
    const e = rows.find((r) => r.id === id);
    if (!e) return null;
    const distinct = new Set(e.anchors);
    if (distinct.size > 1) {
      throw new BatchError('ambiguous_row', 'Conversation ' + id + ' appears in the sidebar more than once; refusing to guess.', { count: distinct.size });
    }
    return e;
  }

  function resolveEntry(doc, id) {
    return resolveEntryFromRows(listRows(doc), id);
  }

  // ---------- options button ----------
  function optionEvidence(b) {
    let score = 0;
    const reasons = [];
    const hp = b.getAttribute('aria-haspopup');
    if (hp === 'menu' || hp === 'true') { score += 2; reasons.push('aria-haspopup'); }
    if (/option/i.test(b.getAttribute('data-testid') || '')) { score += 2; reasons.push('data-testid'); }
    if (/option|more|menu|actions/i.test(b.getAttribute('aria-label') || b.getAttribute('title') || '')) { score += 1; reasons.push('label'); }
    return { score, reasons };
  }

  // A row's options button must sit on the row's own line. Anything with a real box that is not vertically aligned with
  // the row's link (a header button, another row's button) is rejected. Zero-size boxes (hover-only UI) are not judged.
  function alignedWithRow(btn, anchor) {
    const b = btn.getBoundingClientRect();
    if (!b.width && !b.height) return true;
    const a = anchor.getBoundingClientRect();
    if (!a.width && !a.height) return true;
    const dy = Math.abs((b.top + b.height / 2) - (a.top + a.height / 2));
    return dy <= Math.max(a.height * 0.75, 22);
  }

  function rowEvidence(anchor) {
    let n = anchor;
    for (let i = 0; i < 2 && n.parentElement && !n.parentElement.matches('nav,aside,body'); i++) n = n.parentElement;
    return n.outerHTML.replace(/\s+/g, ' ').slice(0, 1800);
  }

  // Walk up from the anchor one level at a time; the first level that contains candidates wins.
  // Never climb into a container that holds a different conversation, nor into nav/aside/body.
  function findOptionsButton(entry) {
    const { id, anchor } = entry;
    let level = anchor;
    for (let i = 0; i < 7 && level; i++) {
      if (i > 0 && level.matches && level.matches('nav,aside,body,html')) break;
      const cands = [...level.querySelectorAll('button,[role=button]')]
        .filter((b) => !inOwnUi(b) && alignedWithRow(b, anchor))
        .map((b) => Object.assign({ b }, optionEvidence(b)))
        .filter((c) => c.score > 0);
      if (cands.length) {
        const max = Math.max(...cands.map((c) => c.score));
        const top = cands.filter((c) => c.score === max);
        if (top.length === 1) return top[0].b;
        throw new BatchError('ambiguous_button', 'Found ' + top.length + ' equally likely options buttons for ' + id + '; refusing to guess.', { count: top.length });
      }
      const parent = level.parentElement;
      if (!parent) break;
      const other = [...parent.querySelectorAll('a[href*="/c/"]')].some((a) => {
        const x = extractId(a.getAttribute('href'));
        return x && x !== id;
      });
      if (other) break;
      level = parent;
    }
    throw new BatchError('no_options_button', 'Could not find an options button on the row of conversation ' + id + '.', { rowHtml: rowEvidence(anchor) });
  }

  // ---------- menu / dialog ----------
  const visibleMenus = (doc) => [...doc.querySelectorAll('[role=menu]')]
    .filter((m) => !inOwnUi(m) && m.getAttribute('data-state') !== 'closed' && styleVisible(m));
  const visibleDialogs = (doc) => [...doc.querySelectorAll('[role=dialog],[role=alertdialog]')]
    .filter((d) => !inOwnUi(d) && d.getAttribute('data-state') !== 'closed' && styleVisible(d));

  async function ensureClean(doc, t) {
    if (!visibleMenus(doc).length && !visibleDialogs(doc).length) return;
    pressEscape(doc);
    const ok = await waitFor(() => !visibleMenus(doc).length && !visibleDialogs(doc).length, { timeout: t.close, doc });
    if (!ok) throw new BatchError('ui_busy', 'A menu or dialog is already open and could not be closed.');
  }

  function pressKey(el, key) {
    const view = el.ownerDocument.defaultView;
    for (const type of ['keydown', 'keyup']) {
      el.dispatchEvent(new view.KeyboardEvent(type, { key, code: key, bubbles: true, cancelable: true }));
    }
  }

  function snapshot(doc, btn) {
    const q = (sel) => [...doc.querySelectorAll(sel)].map(describe);
    return {
      url: doc.defaultView.location.href,
      button: describe(btn),
      activeElement: describe(doc.activeElement || doc.body),
      menusAnyState: q('[role=menu],[data-radix-menu-content],[data-radix-popper-content-wrapper]'),
      dialogsAnyState: q('[role=dialog],[role=alertdialog]')
    };
  }

  async function openMenu(doc, btn, t, opts) {
    const before = new Set(visibleMenus(doc));
    const fresh = () => {
      const f = visibleMenus(doc).filter((m) => !before.has(m));
      return f.length ? f : null;
    };
    // Try progressively different (still ordinary-UI) ways to open the menu; stop at the first that works.
    const strategies = [
      ['pointer', () => realClick(btn)],
      ['keyboard', () => { try { btn.focus({ preventScroll: true }); } catch (e) { /* ignore */ } pressKey(btn, 'Enter'); }],
      ['click', () => btn.click()]
    ];
    let found = null;
    const tried = [];
    const deadline = Date.now() + t.menu;
    for (const [name, go] of strategies) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) break;
      go();
      tried.push(name);
      found = await waitFor(fresh, { timeout: Math.min(remaining, Math.max(100, t.menu / strategies.length)), doc });
      if (found) break;
      if (visibleMenus(doc).length) break; // something opened that we cannot attribute; do not keep clicking
    }
    if (!found && Date.now() < deadline && visibleMenus(doc).length === 0) {
      found = await waitFor(fresh, { timeout: deadline - Date.now(), doc });
    }
    if (!found) {
      const ev = snapshot(doc, btn);
      ev.strategiesTried = tried;
      if (opts && opts.anchor) ev.rowHtml = rowEvidence(opts.anchor);
      throw new BatchError('menu_not_opened', 'The options menu did not open (tried: ' + tried.join(', ') + ').', ev);
    }
    let menus = found;
    if (menus.length > 1 && btn.id) {
      const bound = menus.filter((m) => m.getAttribute('aria-labelledby') === btn.id);
      if (bound.length === 1) menus = bound;
    }
    if (menus.length !== 1) throw new BatchError('ambiguous_menu', menus.length + ' menus opened; cannot tell which belongs to the target row.', { count: menus.length });
    const menu = menus[0];
    const lb = menu.getAttribute('aria-labelledby');
    if (lb && btn.id && lb !== btn.id) {
      throw new BatchError('menu_mismatch', 'The opened menu belongs to a different trigger than the target row\'s options button.', { labelledby: lb, button: btn.id });
    }
    return menu;
  }

  function dedupeNested(list) {
    return list.filter((el) => !list.some((o) => o !== el && o.contains(el)));
  }

  function findDeleteItem(menu) {
    let items = [...menu.querySelectorAll('[role=menuitem],[role=menuitemradio],[role=menuitemcheckbox]')];
    if (!items.length) items = [...menu.querySelectorAll('button,a,[tabindex]')];
    const matches = dedupeNested(items.filter((it) => {
      const tid = (it.getAttribute('data-testid') || '').toLowerCase();
      return DELETE_TEXT.test(norm(it.textContent)) || DELETE_TEXT.test(norm(it.getAttribute('aria-label'))) ||
        (/delete/.test(tid) && !/cancel|confirm/.test(tid));
    }));
    if (matches.length === 1) return matches[0];
    if (!matches.length) throw new BatchError('no_delete_item', 'No Delete action found in the opened menu.', { items: items.map((i) => norm(i.textContent)) });
    throw new BatchError('ambiguous_delete', matches.length + ' Delete actions found in the menu; refusing to guess.', { count: matches.length });
  }

  function findConfirmButton(dlg) {
    const btns = [...dlg.querySelectorAll('button,[role=button]')];
    const matches = dedupeNested(btns.filter((b) => {
      const tid = (b.getAttribute('data-testid') || '').toLowerCase();
      if (/cancel/.test(tid) || /^cancel$/.test(norm(b.textContent))) return false;
      return DELETE_TEXT.test(norm(b.textContent)) || DELETE_TEXT.test(norm(b.getAttribute('aria-label'))) ||
        (/delete/.test(tid) && /confirm/.test(tid));
    }));
    if (matches.length === 1) return matches[0];
    if (!matches.length) throw new BatchError('no_confirm_button', 'The dialog has no recognizable Delete confirmation button.', { buttons: btns.map((b) => norm(b.textContent)) });
    throw new BatchError('ambiguous_confirm', matches.length + ' confirm buttons found in the dialog; refusing to guess.', { count: matches.length });
  }

  async function timePhase(doc, opts, id, phase, action) {
    const now = doc.defaultView.performance.now.bind(doc.defaultView.performance);
    const start = now();
    try {
      return await action();
    } finally {
      opts.phaseMs[phase] += now() - start;
    }
  }

  // ---------- one deletion ----------
  async function deleteOne(doc, id, opts) {
    opts.phaseMs = opts.phaseMs || { prepare: 0, menu: 0, delete_action: 0, confirm: 0, verify: 0 };
    const t = Object.assign({}, DEFAULT_TIMEOUTS, opts.timeouts || {});
    const prepared = await timePhase(doc, opts, id, 'prepare', async () => {
      await ensureClean(doc, t);
      const beforeSnapshot = snapshotEntryAndIds(doc, id);
      const entry = resolveEntryFromRows(beforeSnapshot.entry ? [beforeSnapshot.entry] : [], id);
      if (!entry) return null;
      const btn = findOptionsButton(entry);
      hover(entry.anchor);
      return { entry, before: beforeSnapshot.ids, btn };
    });
    if (!prepared) return { id, status: 'skipped', reason: 'not_in_sidebar' };
    const { entry, before, btn } = prepared;
    const menu = await timePhase(doc, opts, id, 'menu', () => openMenu(doc, btn, t, { anchor: entry.anchor }));
    const { first, rowGone } = await timePhase(doc, opts, id, 'delete_action', async () => {
      const item = findDeleteItem(menu);
      const dialogsBefore = new Set(visibleDialogs(doc));
      realClick(item);
      const isGone = () => !hasConversationId(doc, id);
      const result = await waitFor(() => {
        const fresh = visibleDialogs(doc).filter((d) => !dialogsBefore.has(d));
        if (fresh.length) return { dialogs: fresh };
        if (isGone()) return { gone: true };
        return null;
      }, { timeout: t.dialog, doc });
      if (!result) throw new BatchError('no_confirm_dialog', 'No confirmation dialog appeared after choosing Delete, and the conversation is still listed.');
      return { first: result, rowGone: isGone };
    });
    const warnings = [];
    let usedDialog = false;
    if (first.dialogs) {
      if (first.dialogs.length > 1) throw new BatchError('ambiguous_dialog', first.dialogs.length + ' dialogs appeared; cannot tell which to confirm.');
      const dlg = first.dialogs[0];
      if (entry.title && !norm(dlg.textContent).includes(norm(entry.title))) {
        warnings.push('Dialog text did not mention the conversation title; target verified by ID only.');
      }
      usedDialog = true;
      await timePhase(doc, opts, id, 'confirm', () => {
        realClick(findConfirmButton(dlg));
      });
    }

    await timePhase(doc, opts, id, 'verify', async () => {
      const ok = await waitFor(() => rowGone() && visibleDialogs(doc).length === 0, { timeout: t.verify, doc });
      if (!ok) {
        throw new BatchError(rowGone() ? 'dialog_stuck' : 'not_deleted',
          rowGone() ? 'Conversation disappeared but a dialog is still open.' : 'Confirmation was clicked but the conversation is still in the sidebar.');
      }

      const others = before.filter((x) => x !== id);
      const missing = () => {
        const present = conversationIdSet(doc);
        return others.filter((x) => !present.has(x));
      };
      const settled = await waitFor(() => missing().length === 0, { timeout: t.settle, doc });
      if (!settled) {
        throw new BatchError('collateral', 'Other conversations disappeared during this deletion: ' + missing().join(', '), { missing: missing() });
      }
    });
    return { id, status: 'deleted', title: entry.title, usedDialog, warnings };
  }

  async function safeCleanup(doc, opts) {
    const t = Object.assign({}, DEFAULT_TIMEOUTS, opts.timeouts || {});
    try {
      for (let i = 0; i < 2 && (visibleMenus(doc).length || visibleDialogs(doc).length); i++) {
        pressEscape(doc);
        await waitFor(() => !visibleMenus(doc).length && !visibleDialogs(doc).length, { timeout: t.close / 2, doc });
      }
    } catch (e) { /* best effort */ }
  }

  // ---------- batch ----------
  async function runBatch(ids, opts) {
    opts = opts || {};
    const doc = opts.doc || document;
    const hooks = opts.hooks || {};
    const results = [];
    const phaseMs = { prepare: 0, menu: 0, delete_action: 0, confirm: 0, verify: 0 };
    let stopped = null;
    pinnedSidebar = null;
    pinnedSidebar = pickSidebar(conversationAnchors(doc)).g || null;
    try {
    for (let i = 0; i < ids.length; i++) {
      if (hooks.shouldStop && hooks.shouldStop()) { stopped = { code: 'user_stop', message: 'Stopped by user.' }; break; }
      const id = ids[i];
      if (hooks.onProgress) hooks.onProgress({ index: i, total: ids.length, id, phase: 'start' });
      try {
        const r = await deleteOne(doc, id, Object.assign({}, opts, { phaseMs }));
        results.push(r);
        if (hooks.onProgress) hooks.onProgress({ index: i, total: ids.length, id, phase: r.status, result: r });
      } catch (err) {
        const e = err instanceof BatchError ? err : new BatchError('unexpected', String((err && err.message) || err));
        await safeCleanup(doc, opts);
        results.push({ id, status: 'failed', code: e.code, message: e.message, detail: e.detail });
        stopped = { code: e.code, message: e.message };
        if (hooks.onProgress) hooks.onProgress({ index: i, total: ids.length, id, phase: 'failed', result: results[results.length - 1] });
        break;
      }
    }
    } finally { pinnedSidebar = null; }
    const attempted = new Set(results.map((r) => r.id));
    const notAttempted = ids.filter((x) => !attempted.has(x));
    return {
      deleted: results.filter((r) => r.status === 'deleted').map((r) => r.id),
      skipped: results.filter((r) => r.status === 'skipped').map((r) => r.id),
      failed: results.filter((r) => r.status === 'failed'),
      notAttempted,
      stopped,
      results,
      phaseMs
    };
  }

  // ---------- non-destructive DOM evidence dump ----------
  const describe = (el) => ({
    tag: el.tagName.toLowerCase(),
    id: el.id || null,
    role: el.getAttribute('role'),
    text: (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80),
    attrs: [...el.attributes].filter((a) => /^(aria-|data-testid|data-state|href|type|title)/.test(a.name)).reduce((o, a) => (o[a.name] = a.value.slice(0, 120), o), {})
  });

  async function diagnose(doc, id, opts) {
    opts = opts || {};
    const t = Object.assign({}, DEFAULT_TIMEOUTS, opts.timeouts || {});
    const out = { id, steps: [] };
    try {
      await ensureClean(doc, t);
      const entry = resolveEntry(doc, id);
      if (!entry) { out.error = 'row_not_found'; return out; }
      out.anchor = describe(entry.anchor);
      out.anchorOuterHTML = entry.anchor.outerHTML.slice(0, 600);
      const btn = findOptionsButton(entry);
      out.optionsButton = describe(btn);
      out.optionsButtonEvidence = optionEvidence(btn);
      out.rowChain = [];
      for (let n = btn, i = 0; n && i < 6; n = n.parentElement, i++) out.rowChain.push(n.tagName.toLowerCase() + (n.getAttribute('role') ? '[role=' + n.getAttribute('role') + ']' : ''));
      const menu = await openMenu(doc, btn, t, { anchor: entry.anchor });
      out.menu = describe(menu);
      out.menuParentChain = [];
      for (let n = menu, i = 0; n && i < 5; n = n.parentElement, i++) out.menuParentChain.push(n.tagName.toLowerCase());
      out.menuItems = [...menu.querySelectorAll('*')].filter((e) => /^menuitem/.test(e.getAttribute('role') || '')).map(describe);
      try { out.deleteItem = describe(findDeleteItem(menu)); } catch (e) { out.deleteItemError = e.code + ': ' + e.message; }
    } catch (e) {
      out.error = (e.code || 'error') + ': ' + e.message;
    } finally {
      await safeCleanup(doc, opts);
      out.menuClosedAfter = visibleMenus(doc).length === 0;
    }
    return out;
  }

  return {
    BatchError, DEFAULT_TIMEOUTS,
    extractId, norm, waitFor, realClick, pressEscape, hover,
    listRows, resolveEntry, findOptionsButton, findDeleteItem, findConfirmButton,
    visibleMenus, visibleDialogs, deleteOne, runBatch, diagnose, snapshot
  };
});
