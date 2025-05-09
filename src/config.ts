if (
  !process.env.BROWSERSTACK_ACCESS_KEY ||
  !process.env.BROWSERSTACK_USERNAME
) {
  throw new Error(
    "Unable to start MCP server. Please set the BROWSERSTACK_ACCESS_KEY and BROWSERSTACK_USERNAME environment variables. Go to https://www.browserstack.com/accounts/profile/details to access them",
  );
}

export class Config {
  constructor(
    public readonly browserstackUsername: string,
    public readonly browserstackAccessKey: string,
    public readonly DEV_MODE: boolean,
  ) {}
}

const config = new Config(
  process.env.BROWSERSTACK_USERNAME!,
  process.env.BROWSERSTACK_ACCESS_KEY!,
  process.env.DEV_MODE === "true"
);

export default config;
