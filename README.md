# ChatGPT Bulk Conversation Delete (Chrome, Manifest V3)

Adds a small panel and a checkbox beside each conversation in the chatgpt.com sidebar. Deletes the selected
conversations one at a time through the normal visible UI (options menu -> Delete -> confirm), and counts a
conversation as deleted only after its ID has disappeared from the sidebar.

No permissions, no background worker, no network calls, no tokens/cookies, no private APIs. Runs only on `https://chatgpt.com/*`.

## Install
1. Unzip `chatgpt-bulk-delete.zip`. You get a folder `extension/`.
2. Open `chrome://extensions`, enable **Developer mode** (top right).
3. **Load unpacked** -> choose the `extension` folder.
4. Open https://chatgpt.com/ and reload the tab. A "Bulk delete" panel appears bottom-left.

## Update
Replace the old `extension` folder contents with the new ones, then on `chrome://extensions` press the reload icon on the
extension card, then reload the ChatGPT tab (Ctrl/Cmd+R).

## Use
- Tick conversations (checkbox sits at the left edge of each sidebar row), or **Select visible**; **Clear** resets.
- **Delete selected** -> browser confirm -> runs sequentially. **Stop after current** finishes the in-flight item, then stops.
- The status box shows: verified deletions, skipped (already gone), the first failure (with an error code) and what was not attempted.
- The panel hides checkboxes while a batch runs. Nothing is reported as deleted unless the row actually left the sidebar.

## FIRST RUN ON THE REAL SITE (required, 2 minutes, deletes nothing)
This project could not be run against your logged-in ChatGPT session, so the live DOM is unverified. Before deleting anything:
1. Pick ONE disposable conversation, tick it.
2. Open the panel's **Diagnostics** section and press **Dump DOM evidence (no delete)**. It opens that row's options menu,
   records what it found, and closes it. The JSON is copied to your clipboard and shown in the box.
3. Paste that JSON back to me. It shows the options button, menu structure and the Delete item as found on the live site.
4. If `error` is absent and `deleteItem` is populated, try a real delete of that one disposable chat, then two.

## Developer checks
```
npm install        # installs playwright (tests use real Chromium)
npm test           # syntax check + manifest validation + 23 tests
```
Error codes: `ambiguous_row, ambiguous_button, no_options_button, menu_not_opened, ambiguous_menu, menu_mismatch,
no_delete_item, ambiguous_delete, no_confirm_dialog, ambiguous_dialog, no_confirm_button, not_deleted, dialog_stuck,
collateral, ui_busy`.
