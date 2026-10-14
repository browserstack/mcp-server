---
name: app-live
description: Open an uploaded mobile app on a real Android or iOS device in BrowserStack App Live for a manual check or crash debugging
---

# BrowserStack App Live: manual check of a mobile app

Load this skill when the user wants to use their app by hand on a real device: "try my app on a Pixel 8", "debug the crash on iOS 17", "see the onboarding on a Galaxy S24".

**Governing rule: the app must already be uploaded, and the tool does not check.** `runAppLiveSession` takes a `bs://` app id and returns a session link. It accepted a non-existent id in testing and produced a link that fails when opened. Verify where the id came from before calling.

## Inputs

`browserstackAppUrl` (a `bs://` id), `desiredPhone` (exact device name), `desiredPlatform` (`android` for .apk, `ios` for .ipa), `desiredPlatformVersion` (a number or `latest`/`oldest`).

- Ask for the device. Do not pick one.
- If the user has only a file, call `help-asset-upload` with `asset_type: app-live-upload` and the file path. It returns a curl command the user runs with their own credentials in their own shell; the response contains the `bs://` id. Never ask for credentials in chat.
- Device names must be exact; choose from the suggestions on a not-found error.

## Validated behaviour

- `help-asset-upload` returned the upload command, endpoint, size limit (50 MB) and the expected response shape.
- `runAppLiveSession` with a made-up id returned a session link without error.

## Result card

- **Opened**: the app on the device and OS version
- **Link**: the session URL, with "click to start"
- **Next**: "take a screenshot on this device" (see `app-automate`) or "try another device"

## Never

- Never call the tool with an id the user has not confirmed came from an upload.
- Never guess a device.
- Never collect an access key; the upload runs in the user's shell.
