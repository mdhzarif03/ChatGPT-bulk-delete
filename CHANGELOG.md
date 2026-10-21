# Changelog

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
