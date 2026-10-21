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
