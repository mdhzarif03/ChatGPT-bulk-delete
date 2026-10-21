/*
 * Browser-side fake ChatGPT-like page (injected into real Chromium by the tests).
 * Imitates a Radix-style sidebar: options button opens a portal-rendered menu on pointerdown,
 * menu aria-labelledby = trigger id, Delete opens a confirmation dialog, confirm removes the row.
 * This is a SIMULATION. It is not the real ChatGPT site.
 */
window.buildPage = function (n, b) {
  b = b || {};
  document.body.innerHTML =
    '<nav id="nav" style="width:260px"><button id="newchat">New chat</button><ul id="list" style="list-style:none;margin:0;padding:0"></ul>' +
    '<button id="acct" aria-haspopup="menu" aria-label="Account menu">Account</button></nav><div id="portal"></div>';
  const list = document.getElementById('list');
  const portal = document.getElementById('portal');
  const ids = [];
  const titles = {};
  let openMenuEl = null, openDialogEl = null;

  function closeAll() {
    if (openMenuEl) { openMenuEl.remove(); openMenuEl = null; }
    if (openDialogEl) { openDialogEl.remove(); openDialogEl = null; }
  }
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeAll(); });

  function item(text, extra) {
    const d = document.createElement('div');
    d.setAttribute('role', 'menuitem');
    d.textContent = text;
    Object.entries(extra || {}).forEach(([k, v]) => d.setAttribute(k, v));
    return d;
  }

  function showDialog(id) {
    const dlg = document.createElement('div');
    dlg.setAttribute('role', 'dialog');
    dlg.innerHTML = '<h2>Delete chat?</h2><p>This will delete <b></b>.</p>';
    dlg.querySelector('b').textContent = titles[id];
    const cancel = document.createElement('button');
    cancel.textContent = 'Cancel';
    cancel.addEventListener('click', closeAll);
    dlg.appendChild(cancel);
    if (!b.noConfirmButton) {
      const del = document.createElement('button');
      del.textContent = 'Delete';
      del.setAttribute('data-testid', 'delete-conversation-confirm-button');
      let clicks = 0;
      del.addEventListener('click', () => {
        if (++clicks > 1) return;
        setTimeout(() => {
          if (!b.noDelete) {
            const li = document.querySelector('li[data-id="' + id + '"]');
            if (li) li.remove();
            if (b.collateral) { const o = document.querySelector('li[data-id]'); if (o) o.remove(); }
          }
          closeAll();
        }, 15);
      });
      dlg.appendChild(del);
    }
    portal.appendChild(dlg);
    openDialogEl = dlg;
  }

  function showMenu(btn, id) {
    const menu = document.createElement('div');
    menu.setAttribute('role', 'menu');
    menu.setAttribute('aria-labelledby', b.wrongLabelledBy ? 'someone-else' : btn.id);
    menu.append(item('Share'), item('Rename'), item('Archive'));
    const del = item('Delete', { 'data-testid': 'delete-chat-menu-item' });
    let clicks = 0;
    del.addEventListener('click', () => {
      if (++clicks > 1) return;
      closeAll();
      if (!b.noDialog) showDialog(id);
    });
    menu.appendChild(del);
    if (b.twoDeletes) menu.appendChild(item('Delete chat'));
    portal.appendChild(menu);
    openMenuEl = menu;
  }

  function addRow(id, title) {
    const li = document.createElement('li');
    li.setAttribute('data-id', id);
    li.style.cssText = 'display:flex;height:32px';
    const a = document.createElement('a');
    a.href = '/c/' + id;
    a.textContent = title;
    a.style.flex = '1';
    const btn = document.createElement('button');
    btn.id = 'radix-' + id;
    btn.setAttribute('aria-haspopup', 'menu');
    btn.setAttribute('aria-expanded', 'false');
    btn.setAttribute('data-testid', 'history-item-options');
    btn.setAttribute('aria-label', 'Open conversation options');
    btn.textContent = '...';
    btn.addEventListener('pointerdown', (e) => {
      if (b.noMenu || e.button !== 0) return;
      showMenu(btn, id);
    });
    li.append(a, btn);
    if (b.twoButtons) {
      const b2 = document.createElement('button');
      b2.setAttribute('aria-haspopup', 'menu');
      b2.setAttribute('aria-label', 'Open conversation options');
      b2.setAttribute('data-testid', 'history-item-options');
      li.appendChild(b2);
    }
    list.appendChild(li);
  }

  for (let i = 0; i < n; i++) {
    const id = 'conv0000-0000-0000-0000-' + String(i + 1).padStart(12, '0');
    ids.push(id);
    titles[id] = 'Test chat ' + (i + 1);
    addRow(id, titles[id]);
  }

  return {
    ids,
    rowCount: () => document.querySelectorAll('li[data-id]').length,
    has: (id) => !!document.querySelector('li[data-id="' + id + '"]'),
    open: () => ({ menu: !!document.querySelector('[role=menu]'), dialog: !!document.querySelector('[role=dialog]') }),
    // replace every remaining row with brand-new elements (simulates a framework rerender)
    rerender: () => {
      const present = ids.filter((id) => document.querySelector('li[data-id="' + id + '"]'));
      list.innerHTML = '';
      for (const id of present) addRow(id, titles[id]);
    }
  };
};
