// C# instructions and commands for App SDK utilities
import {
  PLATFORM_UTILS,
  createStep,
  createEnvStep,
  combineInstructions,
} from "../index.js";

export function getCSharpAppInstructions(): string {
  const { isWindows, isAppleSilicon, getPlatformLabel } = PLATFORM_UTILS;

  let runCommand = "";
  if (isWindows) {
    runCommand = `\`\`\`cmd
dotnet build
dotnet test --filter <EXPRESSION> [other_args]
\`\`\``;
  } else if (isAppleSilicon) {
    runCommand = `\`\`\`bash
dotnet build
dotnet test --filter <EXPRESSION> [other_args]
\`\`\`

**Did not set the alias?**
Use the absolute path to the dotnet installation to run your tests on Mac computers with Apple silicon chips:
\`\`\`bash
</absolute/path/to/location/of/dotnet/>/dotnet test
\`\`\``;
  } else {
    runCommand = `\`\`\`bash
dotnet build
dotnet test --filter <EXPRESSION> [other_args]
\`\`\``;
  }

  const runStep = createStep(
    "Run your C# test suite:",
    `**${getPlatformLabel()}:**
${runCommand}

**Debug Guidelines:**
If you encounter the error: java.lang.IllegalArgumentException: Multiple entries with the same key,
__Resolution:__
- The app capability should only be set in one place: browserstack.yml.
- Remove or comment out any code or configuration in your test setup (e.g., step definitions, runners, or capabilities setup) that sets the app path directly.`,
  );

  return runStep;
}

export function getCSharpSDKCommand(
  username: string,
  accessKey: string,
): string {
  const {
    isWindows = false,
    isAppleSilicon = false,
    getPlatformLabel = () => "Unknown",
  } = PLATFORM_UTILS || {};
  if (!PLATFORM_UTILS) {
    console.warn("PLATFORM_UTILS is undefined. Defaulting platform values.");
  }

  const envStep = createEnvStep(
    username,
    accessKey,
    isWindows,
    getPlatformLabel(),
  );

  const installCommands = isWindows
    ? `\`\`\`cmd
dotnet add package BrowserStack.TestAdapter
dotnet build
dotnet browserstack-sdk setup --userName "${username}" --accessKey "${accessKey}"
\`\`\``
    : `\`\`\`bash
dotnet add package BrowserStack.TestAdapter
dotnet build
dotnet browserstack-sdk setup --userName "${username}" --accessKey "${accessKey}"
\`\`\``;

  const installStep = createStep(
    "Install BrowserStack SDK",
    `Run the following command to install the BrowserStack SDK and create a browserstack.yml file in the root directory of your project:

**${getPlatformLabel()}:**
${installCommands}`,
  );

  const appleSiliconNote = isAppleSilicon
    ? createStep(
        "[Only for Macs with Apple silicon] Install dotnet x64 on MacOS",
        `If you are using a Mac computer with Apple silicon chip (M1 or M2) architecture, use the given command:

\`\`\`bash
cd #(project folder Android or iOS)
dotnet browserstack-sdk setup-dotnet --dotnet-path "<path>" --dotnet-version "<version>"
\`\`\`

- \`<path>\` - Mention the absolute path to the directory where you want to save dotnet x64
- \`<version>\` - Mention the dotnet version which you want to use to run tests

This command performs the following functions:
- Installs dotnet x64
- Installs the required version of dotnet x64 at an appropriate path
- Sets alias for the dotnet installation location on confirmation (enter y option)`,
      )
    : "";

  return combineInstructions(envStep, installStep, appleSiliconNote);
}
