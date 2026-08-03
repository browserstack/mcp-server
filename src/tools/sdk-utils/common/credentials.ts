// Single source of truth for the credential placeholders emitted in generated
// SDK setup instructions, so the web (sdk-utils) and App Automate (appium-sdk)
// trees cannot drift apart. Real credentials are never embedded — see
// rules/security.md.

export const USERNAME_PLACEHOLDER = "<your_browserstack_username>";
export const ACCESS_KEY_PLACEHOLDER = "<your_browserstack_access_key>";

// Tells the reader (often a coding agent that runs steps verbatim) to swap the
// placeholders for real values, so they are not baked into browserstack.yml.
export const CREDENTIALS_SUBSTITUTION_NOTE =
  `Replace ${USERNAME_PLACEHOLDER} and ${ACCESS_KEY_PLACEHOLDER} in the steps below ` +
  `with your BrowserStack credentials from https://www.browserstack.com/accounts/profile/details ` +
  `(or export them as BROWSERSTACK_USERNAME / BROWSERSTACK_ACCESS_KEY). Do not commit real credentials.`;
