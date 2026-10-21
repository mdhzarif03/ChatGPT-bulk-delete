/* content.js - selection UI. All UI lives in a closed-off Shadow DOM overlay; the page's own DOM is never modified. */
(function () {
  'use strict';
  if (window.__cgbdLoaded || !window.CGBD) return;
  window.__cgbdLoaded = true;
  const E = window.CGBD;

  const selected = new Set();
  const boxes = new Map(); // id -> checkbox element
  const state = { running: false, stop: false, minimized: false };

  const host = document.createElement('div');
  host.setAttribute('data-cgbd', '1');
  host.style.cssText = 'all:initial;position:fixed;inset:0;z-index:2147483646;pointer-events:none;';
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `
<style>
  :host{all:initial}
  *{box-sizing:border-box;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
  .panel{position:fixed;left:12px;bottom:90px;width:244px;background:#1f1f1f;color:#eee;border:1px solid #444;border-radius:10px;
    box-shadow:0 6px 24px rgba(0,0,0,.35);font-size:12.5px;pointer-events:auto}
  @media (prefers-color-scheme: light){.panel{background:#fff;color:#111;border-color:#ccc}}
  .hdr{display:flex;align-items:center;gap:6px;padding:8px 10px;border-bottom:1px solid #444}
  .hdr b{flex:1}
  .body{padding:8px 10px;display:flex;flex-direction:column;gap:6px}
  .row{display:flex;gap:6px}
  button{cursor:pointer;border:1px solid #666;background:transparent;color:inherit;border-radius:6px;padding:5px 8px;font-size:12px;flex:1}
  button:hover:not(:disabled){background:rgba(128,128,128,.2)}
  button:disabled{opacity:.45;cursor:not-allowed}
  button.danger{background:#b3261e;border-color:#b3261e;color:#fff}
  button.danger:disabled{background:#b3261e}
  #status{white-space:pre-wrap;max-height:150px;overflow:auto;line-height:1.35}
  textarea{width:100%;height:80px;font:11px monospace}
  summary{cursor:pointer}
  .hidden{display:none!important}
  #layer{position:fixed;inset:0;pointer-events:none}
  #layer input{position:fixed;width:16px;height:16px;margin:0;pointer-events:auto;cursor:pointer;accent-color:#10a37f;outline:1px solid rgba(128,128,128,.6);border-radius:3px;background:#2a2a2a}
</style>
<div id="layer"></div>
<div class="panel" id="panel">
  <div class="hdr"><b>Bulk delete</b><span id="count">0 selected</span><button id="min" style="flex:none" title="Minimize">–</button></div>
  <div class="body" id="body">
    <div class="row"><button id="selVis">Select visible</button><button id="clear">Clear</button></div>
    <button id="del" class="danger" disabled>Delete selected</button>
    <button id="stop" class="hidden">Stop after current</button>
    <div id="status" role="status"></div>
    <details><summary>Diagnostics</summary>
      <button id="diag" title="Opens (then closes) the options menu of one row. Deletes nothing.">Dump DOM evidence (no delete)</button>
      <textarea id="out" readonly></textarea>
    </details>
  </div>
</div>`;
  const $ = (id) => root.getElementById(id);
  const layer = $('layer');

  // ---------- checkbox overlay ----------
  function makeBox(id) {
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.title = 'Select for bulk delete';
    cb.checked = selected.has(id);
    cb.addEventListener('click', (ev) => {
      ev.stopPropagation();
      if (cb.checked) selected.add(id); else selected.delete(id);
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

  function placePanel() {
    const nav = document.querySelector('nav');
    const nr = nav ? nav.getBoundingClientRect() : null;
    const left = nr && nr.width > 40 && nr.right < innerWidth * 0.6 ? Math.round(nr.right + 12) : 12;
    $('panel').style.left = left + 'px';
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
    placePanel();
    const seen = new Set();
    for (const r of E.listRows(document)) {
      const rect = visibleRect(r.anchor);
      if (!rect) continue;
      seen.add(r.id);
      const cb = boxes.get(r.id) || makeBox(r.id);
      cb.style.left = Math.round(rect.right - 62) + 'px';
      cb.style.top = Math.round(rect.top + rect.height / 2 - 8) + 'px';
      if (cb.checked !== selected.has(r.id)) cb.checked = selected.has(r.id);
    }
    for (const [id, cb] of boxes) {
      if (!seen.has(id)) { cb.remove(); boxes.delete(id); }
    }
    updateCount();
  }

  function updateCount() {
    $('count').textContent = selected.size + ' selected';
    $('del').disabled = state.running || selected.size === 0;
    $('selVis').disabled = state.running;
    $('clear').disabled = state.running;
    $('diag').disabled = state.running;
    layer.style.visibility = state.running ? 'hidden' : 'visible';
  }

  // Debounced observation; ignores nothing expensive: callback only schedules a cheap sync.
  let moTimer = null;
  new MutationObserver(() => {
    clearTimeout(moTimer);
    moTimer = setTimeout(scheduleSync, 120);
  }).observe(document.body, { childList: true, subtree: true });
  addEventListener('scroll', scheduleSync, { capture: true, passive: true });
  addEventListener('resize', scheduleSync, { passive: true });
  addEventListener('popstate', scheduleSync);

  // ---------- actions ----------
  const status = (msg) => { $('status').textContent = msg; };

  $('selVis').addEventListener('click', () => {
    for (const id of boxes.keys()) selected.add(id);
    for (const [id, cb] of boxes) cb.checked = selected.has(id);
    updateCount();
  });
  $('clear').addEventListener('click', () => {
    selected.clear();
    for (const cb of boxes.values()) cb.checked = false;
    updateCount();
  });
  $('min').addEventListener('click', () => {
    state.minimized = !state.minimized;
    $('body').classList.toggle('hidden', state.minimized);
    $('min').textContent = state.minimized ? '+' : '–';
  });
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
    } finally { state.running = false; updateCount(); scheduleSync(); }
  });

  function report(summary, wasSelected) {
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
      let msg = report(summary);
      if (summary.failed.length) {
        const dbg = JSON.stringify({ code: summary.failed[0].code, message: summary.failed[0].message, detail: summary.failed[0].detail }, null, 2);
        $('out').value = dbg;
        root.querySelector('details').open = true;
        try { await navigator.clipboard.writeText(dbg); msg += '\nDebug info copied to clipboard - paste it to the developer.'; }
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

  document.documentElement.appendChild(host);
  scheduleSync();
})();
