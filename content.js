/*
 * content.js - selection UI.
 * - Checkboxes and the action bar live in a Shadow DOM overlay; the page's own DOM is never modified.
 * - The only page-level additions are one <style> tag (row padding + highlight of selected rows).
 * - Colours and font are read from the live page, so the UI follows ChatGPT's light / dark / custom themes.
 */
(function () {
  'use strict';
  if (window.__cgbdLoaded || !window.CGBD) return;
  window.__cgbdLoaded = true;
  const E = window.CGBD;

  const selected = new Set();
  const boxes = new Map(); // id -> checkbox element
  const state = { running: false, stop: false };

  // ---------- host + shadow ----------
  const host = document.createElement('div');
  host.setAttribute('data-cgbd', '1');
  host.style.cssText = 'all:initial;position:fixed;inset:0;z-index:2147483646;pointer-events:none;';
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `
<style>
  :host{all:initial}
  *{box-sizing:border-box;font-family:var(--cg-font,system-ui,sans-serif)}
  #layer{position:fixed;inset:0;pointer-events:none}
  #layer input{
    -webkit-appearance:none;appearance:none;position:fixed;width:16px;height:16px;margin:0;
    border:1.5px solid var(--cg-box);border-radius:5px;background:transparent;cursor:pointer;pointer-events:auto;
    transition:background-color .12s,border-color .12s}
  #layer input:hover{border-color:var(--cg-fg)}
  #layer input:checked{background:var(--cg-fg);border-color:var(--cg-fg)}
  #layer input:checked::after{content:"";position:absolute;left:4.5px;top:1px;width:4px;height:8px;
    border:solid var(--cg-bg);border-width:0 2px 2px 0;transform:rotate(45deg)}
  #layer input:focus-visible{outline:2px solid var(--cg-fg);outline-offset:2px}

  #bar{position:fixed;left:50%;bottom:104px;transform:translateX(-50%);width:max-content;max-width:min(94vw,680px);
    background:var(--cg-bar);color:var(--cg-fg);border:1px solid var(--cg-line);border-radius:20px;padding:8px 10px;
    box-shadow:0 10px 30px rgba(0,0,0,.28);font-size:14px;pointer-events:auto;display:flex;flex-direction:column;gap:6px}
  #row{display:flex;align-items:center;gap:8px;flex-wrap:wrap;justify-content:center}
  #count{font-weight:600;padding:0 6px;white-space:nowrap}
  button{cursor:pointer;border:1px solid var(--cg-line);background:transparent;color:inherit;border-radius:999px;
    padding:6px 13px;font-size:14px;line-height:1.3;white-space:nowrap;transition:background-color .12s}
  button:hover:not(:disabled){background:var(--cg-hover)}
  button:focus-visible{outline:2px solid var(--cg-fg);outline-offset:1px}
  button:disabled{opacity:.45;cursor:not-allowed}
  button.danger{background:var(--cg-danger);border-color:var(--cg-danger);color:#fff;font-weight:600}
  button.danger:hover:not(:disabled){background:var(--cg-danger-hover);border-color:var(--cg-danger-hover)}
  button.icon{padding:6px 11px}
  #status{white-space:pre-wrap;max-height:160px;overflow:auto;line-height:1.45;padding:2px 8px;text-align:left;color:var(--cg-fg)}
  #diagBox{display:flex;flex-direction:column;gap:6px}
  textarea{width:100%;height:90px;font:11px ui-monospace,Menlo,Consolas,monospace;background:var(--cg-hover);
    color:var(--cg-fg);border:1px solid var(--cg-line);border-radius:10px;padding:6px}
  .hidden{display:none!important}
</style>
<div id="layer"></div>
<div id="bar" class="hidden" role="region" aria-label="Bulk delete">
  <div id="row">
    <span id="count">0 selected</span>
    <button id="selVis" title="Select every conversation currently shown in the sidebar">Select visible</button>
    <button id="clear">Clear</button>
    <button id="del" class="danger" disabled>Delete selected</button>
    <button id="stop" class="hidden">Stop after current</button>
    <button id="more" class="icon" title="Diagnostics" aria-label="Diagnostics">&#8943;</button>
    <button id="dismiss" class="icon hidden" title="Dismiss" aria-label="Dismiss">&times;</button>
  </div>
  <div id="status" class="hidden" role="status"></div>
  <div id="diagBox" class="hidden">
    <button id="diag" title="Opens (then closes) the options menu of one row. Deletes nothing.">Dump DOM evidence (no delete)</button>
    <textarea id="out" readonly></textarea>
  </div>
</div>`;
  const $ = (id) => root.getElementById(id);
  const layer = $('layer');

  // ---------- theme: derive everything from the live page ----------
  const cv = document.createElement('canvas');
  cv.width = cv.height = 1;
  const cx = cv.getContext('2d', { willReadFrequently: true });
  function toRGBA(css) { // any CSS colour syntax -> [r,g,b,a]
    try {
      cx.clearRect(0, 0, 1, 1);
      cx.fillStyle = '#000';
      cx.fillStyle = css;
      cx.fillRect(0, 0, 1, 1);
      const d = cx.getImageData(0, 0, 1, 1).data;
      return [d[0], d[1], d[2], d[3] / 255];
    } catch (e) { return null; }
  }
  const mix = (a, b, t) => a.map((v, i) => Math.round(v * (1 - t) + b[i] * t));
  const rgb = (c, a) => (a == null ? 'rgb(' + c.join(',') + ')' : 'rgba(' + c.join(',') + ',' + a + ')');
  const lum = (c) => (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) / 255;

  let themeKey = '';
  let selectedStyle = null;
  function applyTheme() {
    let bg = null;
    for (const el of [document.querySelector('main'), document.body, document.documentElement]) {
      if (!el) continue;
      const c = toRGBA(getComputedStyle(el).backgroundColor);
      if (c && c[3] > 0.5) { bg = c.slice(0, 3); break; }
    }
    const dark = matchMedia('(prefers-color-scheme: dark)').matches;
    if (!bg) bg = dark ? [33, 33, 33] : [255, 255, 255];
    let fg = toRGBA(getComputedStyle(document.body).color);
    fg = fg && fg[3] > 0.5 ? fg.slice(0, 3) : (lum(bg) < 0.5 ? [236, 236, 236] : [13, 13, 13]);
    const isDark = lum(bg) < 0.5;
    const font = getComputedStyle(document.body).fontFamily || 'system-ui, sans-serif';
    const key = [bg, fg, font].join('|');
    if (key === themeKey) return;
    themeKey = key;
    const bar = isDark ? mix(bg, [255, 255, 255], 0.1) : bg;
    const v = {
      '--cg-font': font,
      '--cg-bg': rgb(bg),
      '--cg-fg': rgb(fg),
      '--cg-bar': rgb(bar),
      '--cg-line': rgb(fg, isDark ? 0.2 : 0.16),
      '--cg-hover': rgb(fg, 0.1),
      '--cg-box': rgb(fg, 0.5),
      '--cg-danger': isDark ? '#e5484d' : '#d92d20',
      '--cg-danger-hover': isDark ? '#f0595e' : '#b42318'
    };
    for (const k in v) host.style.setProperty(k, v[k]);
    renderSelectionStyle(fg);
  }

  // ---------- page-level style: row padding + highlight of selected rows ----------
  const pageStyle = document.createElement('style');
  pageStyle.setAttribute('data-cgbd', '1');
  let lastFg = [236, 236, 236];
  function renderSelectionStyle(fg) {
    if (fg) lastFg = fg;
    const base = 'nav a[href*="/c/"],aside a[href*="/c/"]{padding-inline-start:32px !important}';
    const sel = [...selected].map((id) => 'nav a[href$="/c/' + id + '"],aside a[href$="/c/' + id + '"]');
    pageStyle.textContent = base + (sel.length ? '\n' + sel.join(',') + '{background-color:' + rgb(lastFg, 0.12) + ' !important}' : '');
  }

  // ---------- checkbox overlay ----------
  function makeBox(id) {
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.title = 'Select for bulk delete';
    cb.setAttribute('aria-label', 'Select conversation for bulk delete');
    cb.checked = selected.has(id);
    cb.addEventListener('click', (ev) => {
      ev.stopPropagation();
      if (cb.checked) selected.add(id); else selected.delete(id);
      renderSelectionStyle();
      updateCount();
    });
    layer.appendChild(cb);
    boxes.set(id, cb);
    return cb;
  }

  let rafPending = false;
  function scheduleSync() {
    if (rafPending) return;
    rafPending = true;
    requestAnimationFrame(sync);
  }

  // A row is "really visible" only if its own pixels are what the user would hit at that point
  // (excludes rows scrolled under sticky headers, covered by menus, etc.).
  function visibleRect(a) {
    const r = a.getBoundingClientRect();
    if (r.width < 40 || r.height < 12) return null;
    const cy = r.top + r.height / 2;
    if (cy < 0 || cy > innerHeight) return null;
    const hit = document.elementFromPoint(r.left + Math.min(60, r.width / 2), cy);
    return hit && a.contains(hit) ? r : null;
  }

  function sync() {
    rafPending = false;
    const seen = new Set();
    for (const r of E.listRows(document)) {
      const rect = visibleRect(r.anchor);
      if (!rect) continue;
      seen.add(r.id);
      const cb = boxes.get(r.id) || makeBox(r.id);
      cb.style.left = Math.round(rect.left + 9) + 'px';
      cb.style.top = Math.round(rect.top + rect.height / 2 - 8) + 'px';
      if (cb.checked !== selected.has(r.id)) cb.checked = selected.has(r.id);
    }
    for (const [id, cb] of boxes) {
      if (!seen.has(id)) { cb.remove(); boxes.delete(id); }
    }
    updateCount();
  }

  const hasStatus = () => $('status').textContent !== '';
  function updateCount() {
    $('count').textContent = selected.size + ' selected';
    $('del').disabled = state.running || selected.size === 0;
    $('selVis').disabled = state.running;
    $('clear').disabled = state.running;
    $('diag').disabled = state.running;
    $('dismiss').classList.toggle('hidden', state.running || !hasStatus());
    $('bar').classList.toggle('hidden', !(selected.size > 0 || state.running || hasStatus()));
    layer.style.visibility = state.running ? 'hidden' : 'visible';
  }
  const status = (msg) => {
    $('status').textContent = msg || '';
    $('status').classList.toggle('hidden', !msg);
    updateCount();
  };

  // Throttle page churn so a busy sidebar cannot indefinitely postpone its next sync.
  let syncTimer = null;
  new MutationObserver(() => {
    if (syncTimer !== null) return;
    syncTimer = setTimeout(() => { syncTimer = null; scheduleSync(); }, 120);
  }).observe(document.body, { childList: true, subtree: true });
  // Theme switches change attributes/classes on <html>/<body>, not the sidebar subtree.
  let themeTimer = null;
  const scheduleThemeSync = () => {
    if (themeTimer !== null) return;
    themeTimer = setTimeout(() => {
      themeTimer = null;
      applyTheme();
      scheduleSync();
    }, 60);
  };
  const themeMO = new MutationObserver(scheduleThemeSync);
  themeMO.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'style', 'data-theme', 'data-color-mode'] });
  themeMO.observe(document.body, { attributes: true, attributeFilter: ['class', 'style', 'data-theme'] });
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', scheduleThemeSync);
  addEventListener('scroll', scheduleSync, { capture: true, passive: true });
  addEventListener('resize', scheduleSync, { passive: true });
  addEventListener('popstate', scheduleSync);

  // ---------- actions ----------
  $('selVis').addEventListener('click', () => {
    for (const id of boxes.keys()) selected.add(id);
    for (const [id, cb] of boxes) cb.checked = selected.has(id);
    renderSelectionStyle();
    updateCount();
  });
  $('clear').addEventListener('click', () => {
    selected.clear();
    for (const cb of boxes.values()) cb.checked = false;
    renderSelectionStyle();
    updateCount();
  });
  $('more').addEventListener('click', () => $('diagBox').classList.toggle('hidden'));
  $('dismiss').addEventListener('click', () => status(''));
  $('stop').addEventListener('click', () => { state.stop = true; status('Stopping after the current conversation…'); });

  $('diag').addEventListener('click', async () => {
    const id = [...selected][0] || [...boxes.keys()][0];
    if (!id) { status('No conversation row available to inspect.'); return; }
    state.running = true; updateCount();
    status('Inspecting row ' + id + ' (opens and closes its menu; deletes nothing)…');
    try {
      const res = await E.diagnose(document, id);
      const json = JSON.stringify(res, null, 2);
      $('out').value = json;
      try { await navigator.clipboard.writeText(json); status('Evidence dumped below and copied to clipboard.'); }
      catch (e) { status('Evidence dumped below. Select all and copy it manually.'); }
    } catch (e) {
      status('Diagnostics failed: ' + (e && e.message ? e.message : e));
    } finally { state.running = false; updateCount(); scheduleSync(); }
  });

  function report(summary) {
    const lines = [];
    lines.push('Deleted (verified): ' + summary.deleted.length);
    if (summary.skipped.length) lines.push('Skipped (not in sidebar): ' + summary.skipped.length);
    if (summary.failed.length) {
      const f = summary.failed[0];
      lines.push('FAILED on ' + f.id + ': [' + f.code + '] ' + f.message);
    }
    if (summary.stopped && !summary.failed.length) lines.push(summary.stopped.message);
    if (summary.notAttempted.length) lines.push('Not attempted: ' + summary.notAttempted.length + ' (still selected)');
    const warn = summary.results.flatMap((r) => r.warnings || []);
    if (warn.length) lines.push('Warnings: ' + [...new Set(warn)].join(' | '));
    if (summary.failed.length) lines.push('The batch stopped; no further deletions were attempted.');
    return lines.join('\n');
  }

  $('del').addEventListener('click', async () => {
    const ids = [...selected];
    if (!ids.length || state.running) return;
    if (!window.confirm('Delete ' + ids.length + ' conversation' + (ids.length > 1 ? 's' : '') + '?\nThis cannot be undone.')) return;
    state.running = true; state.stop = false;
    $('stop').classList.remove('hidden');
    updateCount();
    try {
      const summary = await E.runBatch(ids, {
        doc: document,
        hooks: {
          shouldStop: () => state.stop,
          onProgress: (p) => {
            if (p.phase === 'start') status('Deleting ' + (p.index + 1) + ' of ' + p.total + '…');
          }
        }
      });
      for (const id of summary.deleted.concat(summary.skipped)) selected.delete(id);
      renderSelectionStyle();
      let msg = report(summary);
      if (summary.failed.length) {
        const dbg = JSON.stringify({ code: summary.failed[0].code, message: summary.failed[0].message, detail: summary.failed[0].detail }, null, 2);
        $('out').value = dbg;
        $('diagBox').classList.remove('hidden');
        try { await navigator.clipboard.writeText(dbg); msg += '\nDebug info copied to clipboard - paste it into a bug report.'; }
        catch (e) { msg += '\nDebug info is in the Diagnostics box - copy it.'; }
      }
      status(msg);
    } catch (e) {
      status('Unexpected error: ' + (e && e.message ? e.message : e));
    } finally {
      state.running = false; state.stop = false;
      $('stop').classList.add('hidden');
      updateCount(); scheduleSync();
    }
  });

  document.head.appendChild(pageStyle);
  document.documentElement.appendChild(host);
  applyTheme();
  scheduleSync();
})();
