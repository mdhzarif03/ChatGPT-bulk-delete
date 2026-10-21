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
  #layer{position:fixed;inset:0;pointer-events:none}
  #layer input{position:fixed;width:16px;height:16px;margin:0;pointer-events:auto;cursor:pointer;accent-color:#10a37f;border-radius:4px}
  #bar{position:fixed;left:50%;bottom:104px;transform:translateX(-50%);max-width:min(94vw,640px);
    background:#2f2f2f;color:#ececec;border:1px solid #4a4a4a;border-radius:16px;padding:8px 10px;
    box-shadow:0 8px 28px rgba(0,0,0,.45);font-size:13px;pointer-events:auto;display:flex;flex-direction:column;gap:6px}
  #row{display:flex;align-items:center;gap:8px;flex-wrap:wrap;justify-content:center}
  #count{font-weight:600;padding:0 4px;white-space:nowrap}
  button{cursor:pointer;border:1px solid #5a5a5a;background:transparent;color:inherit;border-radius:999px;padding:6px 12px;font-size:13px;white-space:nowrap}
  button:hover:not(:disabled){background:rgba(255,255,255,.1)}
  button:disabled{opacity:.45;cursor:not-allowed}
  button.danger{background:#d93025;border-color:#d93025;color:#fff;font-weight:600}
  button.danger:hover:not(:disabled){background:#e8453b}
  button.icon{padding:6px 10px}
  #status{white-space:pre-wrap;max-height:160px;overflow:auto;line-height:1.4;padding:2px 6px;text-align:left}
  #diagBox{display:flex;flex-direction:column;gap:6px}
  textarea{width:100%;height:90px;font:11px monospace;background:#1e1e1e;color:#ddd;border:1px solid #4a4a4a;border-radius:8px}
  .hidden{display:none!important}
  @media (prefers-color-scheme: light){
    #bar{background:#fff;color:#111;border-color:#ccc}
    button{border-color:#bbb} button:hover:not(:disabled){background:rgba(0,0,0,.06)}
    textarea{background:#f6f6f6;color:#111;border-color:#ccc}
  }
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
  const hasStatus = () => $('status').textContent !== '';
  const status = (msg) => {
    $('status').textContent = msg || '';
    $('status').classList.toggle('hidden', !msg);
    updateCount();
  };

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
  $('more').addEventListener('click', () => $('diagBox').classList.toggle('hidden'));
  $('dismiss').addEventListener('click', () => { status(''); });
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
        $('diagBox').classList.remove('hidden');
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

  const css = document.createElement('style');
  css.setAttribute('data-cgbd', '1');
  css.textContent = 'nav a[href*="/c/"],aside a[href*="/c/"]{padding-inline-start:32px !important}';
  document.head.appendChild(css);
  document.documentElement.appendChild(host);
  scheduleSync();
})();
