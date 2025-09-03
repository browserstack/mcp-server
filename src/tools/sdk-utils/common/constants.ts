export const IMPORTANT_SETUP_WARNING =
  "IMPORTANT: DO NOT SKIP ANY STEP. All the setup steps described below MUST be executed regardless of any existing configuration or setup. This ensures proper BrowserStack SDK setup.";

export const SETUP_PERCY_DESCRIPTION =
  "Set up Percy visual testing for your project. This supports both Percy Web Standalone and Percy Automate.";

export const LIST_TEST_FILES_DESCRIPTION =
  "Lists all test files for a given set of directories.";

export const PERCY_SNAPSHOT_COMMANDS_DESCRIPTION =
  "Adds Percy snapshot commands to the specified test files.";

export const RUN_ON_BROWSERSTACK_DESCRIPTION =
  "Set up and run automated web-based tests on BrowserStack using the BrowserStack SDK. Use this tool for functional or integration test setup on BrowserStack only. For any visual testing or Percy integration, use the dedicated Percy setup tool. Example prompts: run this test on browserstack; set up this project for browserstack.";

export const SIMULATE_PERCY_CHANGE_DESCRIPTION =
  "This tool helps new users simulate a Percy visual change by guiding them to make a visible UI modification, rerun Percy, and verify that the change is detected. Only Percy web is supported";

export const PERCY_REPLACE_REGEX =
  /Invoke listTestFiles\(\) with the provided directories[\s\S]*?- DO NOT STOP until you add commands in all the files or you reach end of the files\./;

export const PERCY_SNAPSHOT_INSTRUCTION = `
Invoke listTestFiles() with the provided directories from user to gather all test files in memory and obtain the generated UUID ---STEP---
Process files in STRICT sequential order using tool addPercySnapshotCommands() with below instructions:
- Start with index 0
- Then index 1  
- Then index 2
- Continue sequentially until the last index
- DO NOT skip any index numbers
- DO NOT jump to random indices like 10, 20, 30
- DO NOT worry about time consuming and any constraints.
- DO NOT STOP until you add commands in all the files or you reach end of the files.
`;

export const PERCY_SIMULATE_INSTRUCTION = `
MANDATORY: Aggressive, Accurate Percy Snapshots Integration

Prerequisite: Before making any code changes in the user's repository, create and switch to a new branch named browserstack-simulation. Stage all changes but do not commit them. If the repository has not been initialized yet, run git init first.

You MUST follow these steps with NO EXCEPTIONS:
1. Identify 4-5 key test files in the project that are critical for visual testing.
2. For EACH identified test file, analyze the code to find EVERY location where a Percy snapshot should be called (e.g., after each navigation, UI change, or significant state in tests).
3. Insert snapshot calls at ALL such points, not just the first or most obvious one.

Iteratively update every selected test file with percy snapshot calls at all identified points, ensuring comprehensive coverage of visual changes.`;

export const PERCY_SIMULATION_DRIVER_INSTRUCTION = `
MANDATORY: Step-by-Step Percy Visual Change Simulation
You MUST follow these steps with NO EXCEPTIONS:

STEP 1: At this case we have added Percy snapshot commands to the test files at the appropriate locations (e.g., after navigation, UI change, or significant state). 
- Use ONLY existing snapshot names.
- Do NOT add any popup injection or visual changes yet.
- Do NOT run any Percy builds at this stage.

STEP 2: Run ONE comprehensive baseline Percy build that executes ALL tests containing Percy snapshots in a SINGLE build. This creates one baseline build with all snapshots for comparison. Use a command like: npx percy exec -- python -m pytest tests/ -k 'test_name1 or test_name2 or test_name3' -v to run multiple specific tests in one build."

STEP 3: Modify your test to inject a visible UI change (such as a popup) IMMEDIATELY BEFORE an EXISTING snapshot command (e.g., before percy_snapshot(self.driver, "screenshot name")).
- Do NOT add a new snapshot name for the popup.
- The popup must appear in an existing snapshot, not a new one.
- Add this popup code in some test files before the percy_snapshot command you've added, to display the visual changes.

\`\`\`Javascript
popup_script = \`
var popup = document.createElement('div');
popup.id = 'percy-test-popup';
popup.style.cssText = popup.style.cssText = \`
  /* TODO: Add styles to make the popup large, centered, and visually noticeable.
     Suggested properties: position: fixed; top/left; transform; background; color; font-size; padding; z-index; animation, etc. */
\`;
popup.innerHTML = 'PERCY TEST<br>VISUAL CHANGE<br>DETECTED!';
document.body.appendChild(popup);
\`;

# Insert this just before the EXISTING snapshot command:
driver.execute_script(popup_script)
percy_snapshot(self.driver, "Before Adding to Cart")  # (Do NOT change the snapshot name, keep existing one)
\`\`\`

STEP 4: Run a second Percy build.
- Strictly use the same build command you ran for the baseline.
- The snapshot names must remain the same as in the baseline.
- The visual change should now appear in the same snapshot as before.

STEP 5: Compare the two Percy builds to see the detected visual difference.

STEP 6: Now ask user if they want to setup percy for full project coverage? If yes, discard all the unstaged changes and call the "setupPercyVisualTesting" tool to enable complete coverage for the entire project.

CONSTRAINTS:
- Do NOT run any builds until explicitly instructed in the steps.
- Do NOT add new snapshot names—only use existing ones.
- Do NOT add popup injection until the baseline is established.
- Visual changes must appear in EXISTING snapshots, not new ones.

VALIDATION CHECKPOINTS (before proceeding to the next step):
- Are you adding only snapshot commands (not running builds)?
- Are you reusing existing snapshot names (not creating new ones)?
- Have you established the baseline first (before adding visual changes)

CRITICAL: 
Do NOT run tests separately or create multiple builds during baseline establishment. The goal is to have exactly TWO builds total: (1) baseline build with all original snapshots, (2) modified build with the same tests but visual changes injected.
`;

export const PERCY_VERIFICATION_REGEX =
  /\*\*✅ Verification:\*\*\nPlease verify that you have completed all[\s\S]*?double-check each step and ensure all commands executed successfully\./s;