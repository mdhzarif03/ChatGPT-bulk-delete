# Contributing

Bug reports and pull requests are welcome.

## Reporting a problem
ChatGPT's interface changes often. If deleting stops working:
1. Select one disposable conversation and try **Delete selected**.
2. When it fails, the extension copies a debug report to your clipboard (also shown under the **...** button). Paste it into your issue.
3. Include your Chrome version and whether you use the light or dark theme.

Please review the report before posting; it can include conversation titles.

## Development
```
npm install
npm test
```
`npm test` runs a syntax check, manifest validation and the test suite (real Chromium via Playwright against a *simulated*
sidebar in `tests/fakepage.js`).

Rules of thumb:
- Never delete by title; always by conversation ID, re-resolved right before each deletion.
- If something is ambiguous (two matches, a mismatched menu), stop and report - do not guess.
- Report success only after the conversation has actually left the sidebar.
- No private APIs, no token or cookie access.
- Keep engine logic (`engine.js`) free of extension APIs so it stays testable.
