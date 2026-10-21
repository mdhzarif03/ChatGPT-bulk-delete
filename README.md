# ChatGPT Bulk Conversation Delete

A small Chrome extension that lets you tick several conversations in the ChatGPT sidebar and delete them in one go.
It uses the normal ChatGPT interface (options menu -> Delete -> confirm), one conversation at a time, and only counts a
conversation as deleted once it has actually left the sidebar.

> **Unofficial.** Not affiliated with or endorsed by OpenAI. **Deleting a conversation is permanent.** Use at your own risk.

## Features
- Checkbox on the left of every visible conversation, with separate master checkboxes beside **Projects**, **Pinned**, and **Recents**. Each selects only its own loaded section, including off-screen rows. **Select visible** and **Clear** are also available.
- A bar at the bottom centre appears only while something is selected, showing the count and the actions.
- Selected rows are highlighted. Colours and font follow ChatGPT's own theme (light, dark and custom accents).
- Deletes sequentially, with progress and a final report: deleted / skipped / failed / not attempted.
- The final report includes time spent preparing each row, opening menus, selecting Delete, confirming, and verifying removal.
- Responsive batch operation: menu fallbacks are bounded by one timeout, and sidebar verification scans only the pinned sidebar.
- **Verified deletion:** success is reported only after that conversation's ID has disappeared from the sidebar.
- **Safe by default:** if anything is ambiguous or fails (wrong menu, missing button, unexpected dialog, another chat vanishing),
  it stops and tells you exactly what happened instead of guessing.
- Targets conversations by their **ID**, not their title, and re-finds each row right before deleting it.
- **Stop after current** button for long batches.
- No permissions, no network requests, no tracking. See [PRIVACY.md](PRIVACY.md).

## Install (Developer mode)
The extension is not on the Chrome Web Store, so you load it from a folder.

1. Download this project (**Code -> Download ZIP** on GitHub, or the release ZIP) and unzip it.
   You should end up with a folder that has `manifest.json` directly inside it.
2. Open `chrome://extensions` and turn on **Developer mode** (top right).
3. Click **Load unpacked** and choose that folder (the one containing `manifest.json`).
4. Open or reload https://chatgpt.com/.

Works in Chromium-based browsers that support Manifest V3 (Chrome, Edge, Brave...). Tested in Chrome.

### Update
Replace the old folder's contents with the new version, then press the reload icon on the extension's card in
`chrome://extensions` and reload the ChatGPT tab.

## Use
1. Tick one or more conversations in the sidebar. The bar appears at the bottom.
2. (Optional) Use the checkbox beside **Projects**, **Pinned**, or **Recents** to select or clear only that loaded section, including off-screen rows. **Select visible** selects currently visible rows across sections; **Clear** unticks everything.
3. Press **Delete selected** and confirm.
4. Watch the progress. Leave the tab open and in front while it runs. Press **Stop after current** to halt after the
   conversation in progress.
5. Read the result in the bar and dismiss it with **x**.

Tip: try it on one throwaway conversation first.

## How it works
For each selected conversation, in order:
1. Re-locate its sidebar link by conversation ID (`/c/<id>`). If it is gone, it is skipped.
2. Find that row's own options button using accessibility attributes (popup/menu, options-like labels).
3. Open the menu (the menu may be rendered outside the row) and find the single exact **Delete** item.
4. Click it, then handle the confirmation dialog if one appears.
5. Wait (event-driven, with time limits) until the ID has left the sidebar and no dialog is open, and check that no other
   conversation disappeared.

If any step finds zero or more than one candidate, or times out, the batch stops and nothing further is deleted.
The engine lives in [`engine.js`](engine.js) and the interface in [`content.js`](content.js).

## Troubleshooting
| Symptom | What to do |
| --- | --- |
| No checkboxes | Reload the ChatGPT tab; make sure the extension is enabled. |
| Bar says `menu_not_opened` / `no_delete_item` / `no_confirm_button` | ChatGPT's interface probably changed. Use the debug text the bar copies to your clipboard and open an issue (see [CONTRIBUTING.md](CONTRIBUTING.md)). |
| Some chats were not deleted | The bar lists what was not attempted; they stay selected, so just press **Delete selected** again. |
| Bulk deletion is unexpectedly slow | Check the final report's phase timings to see whether time is spent waiting on ChatGPT's UI or on verification. |
| A message box asks to confirm | That is this extension's safety prompt, not ChatGPT's. |

The **...** button in the bar opens **Diagnostics**: *Dump DOM evidence* opens and closes one row's menu (deleting nothing)
and prints what the extension found there.

## Development
```
npm install      # Playwright (tests run in real Chromium)
npm test         # syntax check + manifest validation + 35 tests
```
- `engine.js` - deletion engine (pure DOM logic, no extension APIs).
- `content.js` - checkbox overlay, action bar, theming.
- `tests/` - unit tests, plus UI tests that run the real scripts in Chromium against a **simulated** ChatGPT-like sidebar
  (`tests/fakepage.js`).
- `tools/` - syntax and manifest checks.

## Limitations
- Depends on ChatGPT's visible interface. The simulated tests cannot prove the live site stays compatible; it was confirmed
  working on chatgpt.com by the author in October 2026, and a future redesign may break it (the extension is built to stop
  and report, not to guess).
- Only conversations loaded in the sidebar can be selected; scroll to load older ones.
- Deletion speed is bounded by how fast ChatGPT's own menus respond. The extension keeps deletions sequential and verifies each one to avoid deleting the wrong conversation. Large batches avoid redundant sidebar scans, and checkbox positioning pauses while deletion is running.
- Archiving or "delete all chats" are out of scope (use ChatGPT's own Settings for that).
- Chrome / Chromium only; the extension is English-UI oriented (it looks for a menu item literally named "Delete").

## License
[MIT](LICENSE)
