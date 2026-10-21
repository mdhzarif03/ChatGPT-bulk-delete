# Privacy

ChatGPT Bulk Conversation Delete runs entirely inside your browser tab on `https://chatgpt.com/*`.

- **No data leaves your browser.** The extension makes no network requests, has no server, no analytics and no telemetry.
- **No permissions.** The manifest requests no extension permissions and no host permissions beyond the content-script match on `https://chatgpt.com/*`.
- **No credentials.** It does not read cookies, session tokens or API keys, and it does not call ChatGPT's internal or private APIs.
- **How it works.** It reads the sidebar conversation links (to get each conversation's ID and title) and clicks the same buttons you would click by hand: options menu, Delete, confirm.
- **Storage.** Nothing is stored. The current selection exists only in memory and disappears when you reload the page.
- **Clipboard.** Only when you press "Dump DOM evidence", or when a deletion fails, the extension copies a short technical report (element attributes, no message content) to your clipboard so you can paste it into a bug report. Review it before sharing; it can include conversation titles shown in the sidebar.
