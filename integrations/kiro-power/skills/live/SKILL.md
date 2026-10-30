---
name: live
description: Open a URL on a real desktop browser or mobile device in BrowserStack Live for a quick manual check. Use when the user wants to open or check a website on a specific browser, OS or mobile device.
---

# BrowserStack Live: manual check on a real browser

Load this skill when the user wants to look at a website themselves: "open this on Safari 17", "check my site on a Galaxy S23", "how does it look on Windows Edge", "try the checkout on an iPad".

**Governing rule: the tool returns a link, it does not show the page.** `runBrowserLiveSession` creates a session and returns a dashboard URL. The user clicks it and the browser streams in their own browser. Say so, and never claim to have seen the page.

## Inputs

| Target | `platformType` | Required |
|---|---|---|
| Desktop browser | `desktop` | `desiredURL`, `desiredOS` (`Windows` or `OS X`), `desiredOSVersion`, `desiredBrowser` (chrome, firefox, safari, edge, ie), `desiredBrowserVersion` |
| Phone or tablet | `mobile` | `desiredURL`, `desiredOS` (`android` or `ios`), `desiredOSVersion`, `desiredBrowser`, `desiredDevice` |

- Ask for the URL if the user described a page without giving one.
- Ask for the browser or device when not stated. Do not choose for the user.
- "latest", "newest", "current" become `latest`; "oldest", "earliest" become `oldest`. macOS versions are names such as `Sequoia`, not numbers.
- Device names must match BrowserStack's catalogue exactly, for example `Samsung Galaxy S23`, `iPhone 14 Pro`, `Google Pixel 8`. On a not-found error with suggestions, choose from them or ask.

## Result card

- **Opened**: the URL on the browser or device
- **Link**: the session URL, with "click to start; it opens in your browser"
- **Next**: "open the same page on another device" or "run an accessibility scan on this URL"

## Never

- Never start a session without a URL.
- Never guess a device.
- Never read the dashboard link's query string back as if it were the user's settings.
