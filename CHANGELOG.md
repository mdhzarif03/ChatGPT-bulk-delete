# Changelog

Version 1.0.0 was the first build; entries below describe what changed and the evidence behind it.

## 1.0.0
No earlier source was provided in this session, so this is a new implementation, not a patch of a previous build.
There is therefore no "root cause of the old bug" to report; I did not have the old code or the failing DOM.

Design (each choice answers a requirement, not a guess about the live DOM):
- Targets resolved by conversation ID parsed from `/c/<id>` links; re-resolved before every deletion; duplicate IDs stop the batch.
- Options button: found by structural evidence (aria-haspopup, options-like data-testid or label) near the row's own link, never
  climbing into a container with another conversation. Zero or tied candidates -> stop.
- Menu rendered anywhere in the document (portal-safe): the newly appeared `role=menu` is used; if it declares `aria-labelledby`
  that must match the trigger's id.
- Delete item: exact text/aria-label match ("Delete", "Delete chat", "Delete conversation") inside that menu only; duplicates -> stop.
- Confirmation: newly appeared `role=dialog/alertdialog`; exact Delete button, Cancel excluded; handles sites with no dialog.
- Success = row ID absent from sidebar AND no dialog left; other rows must not vanish (collateral check).
- Event-driven waits (MutationObserver + bounded timeouts); no fixed sleeps.
- UI in a Shadow DOM overlay; the site's DOM is never modified, so rerenders cannot drop the checkboxes.
- Built-in non-destructive DOM evidence dump to verify the live site before any deletion.

## 1.0.1 (after first live run: `menu_not_opened`, panel covering sidebar, stray checkboxes)
Evidence: user screenshot of the live site.
- Layout: panel overlapped sidebar rows and the checkbox layer painted above it; checkboxes were shown for rows hidden under the
  sticky header and sat on top of titles. Fixed: panel placed beside the sidebar, layer below panel, a row gets a checkbox only if
  `elementFromPoint` hits that row, checkbox moved to the right side of the row.
- `menu_not_opened` (live): root cause NOT yet confirmed (no live DOM was available). Suspected: my click helper called `focus()` on
  the trigger right after the menu opened, which Radix-style menus treat as "focus outside" and dismiss. Removed that call, and added
  two fallbacks (keyboard Enter on the trigger, plain click). Local tests cannot tell whether this was the live cause.
- Every failure now captures DOM evidence (trigger attributes, active element, any menu/dialog elements in any state) into the
  Diagnostics box and the clipboard, so a failed live run gives the exact data needed to fix the next step.

## 1.0.2 (live delete confirmed working by user; UI rework)
- Checkboxes moved to the left of each conversation; sidebar rows get extra left padding (CSS only) so the box never covers the title.
- Controls are now a bar at bottom-centre that appears only while chats are selected, a batch is running, or a result is shown
  (dismiss with x). Diagnostics moved behind the "..." button.

## 1.1.0
- Theme: colours and font are read from the live ChatGPT page (light, dark, custom accents, `oklch()` colours) and update when
  the theme changes. Checkbox restyled to match; selected rows are highlighted (CSS only; site elements are not modified).
- Bar no longer wraps its buttons; added icons, MIT license, PRIVACY.md, CONTRIBUTING.md, .gitignore, public README.
- Project root is now the extension itself (load the folder containing `manifest.json`); `npm run pack` builds a release ZIP.
- Tests: 29 (added theme, runtime theme switch, modern colour syntax, selection highlight).

## 1.1.1
Evidence: user-supplied failure report from the live site: `menu_not_opened`, button `aria-label="Chat actions"` (no
`data-testid`), page URL = the open conversation, and a `role=dialog` side panel titled like the chat.
Root cause (inferred from that report, not yet reproduced on the live site): the engine accepted ANY `a[href*="/c/"]` inside
any `<nav>/<aside>` as a sidebar row. A link to the open chat outside the sidebar list (header/breadcrumb area) was therefore
treated as a row, and the nearest "menu" button, the header's "Chat actions", was targeted instead of a sidebar row's button.
Fix:
- Rows now come only from the sidebar: the nav/aside holding the most conversation links (ties: not in a header, then leftmost).
  The sidebar container is pinned for the duration of a batch so deleting the last row can't promote a header link to a "row".
- An options button must sit on the row's own line (vertical alignment check); anything else is rejected, never clicked.
- Failures now include the row's HTML (`rowHtml`) in the debug report.
- 4 regression tests reproduce the header scenario (header-only link, header + sidebar link, single sidebar row, misplaced button).
