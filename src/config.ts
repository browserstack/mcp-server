export class Config {
  constructor(
    public readonly browserstackUsername: string,
    public readonly browserstackAccessKey: string,
    public readonly DEV_MODE: boolean,
    public readonly DYNAMIC_SERVER: boolean,
  ) {}
}

const config = new Config(
  process.env.BROWSERSTACK_USERNAME!,
  process.env.BROWSERSTACK_ACCESS_KEY!,
  process.env.DEV_MODE === "true",
  process.env.DYNAMIC_SERVER === "true",
);

export default config;
