import { pino } from "pino";

// 1. The actual logger instance, swapped out as needed
let currentLogger: any;

if (process.env.NODE_ENV === "development") {
  currentLogger = pino({
    level: "debug",
    transport: {
      targets: [
        {
          level: "debug",
          target: "pino-pretty",
          options: {
            colorize: true,
            levelFirst: true,
            destination:
              process.platform === "win32"
                ? "C:\\Windows\\Temp\\browserstack-mcp-server.log"
                : "/tmp/browserstack-mcp-server.log",
          },
        },
      ],
    },
  });
} else {
  currentLogger = pino({ level: "info", enabled: false });
}

// 2. Proxy logger: always delegates to the currentLogger
const logger: any = new Proxy(
  {},
  {
    get(_target, prop) {
      // Forward function calls to currentLogger
      if (typeof currentLogger[prop] === "function") {
        return (...args: any[]) => currentLogger[prop](...args);
      }
      // Forward property gets
      return currentLogger[prop];
    },
  },
);

// 3. Setter to update the logger instance everywhere
export function setLogger(customLogger: any): void {
  currentLogger = customLogger;
}

export default logger;
