import { loadConfigFromString } from "./loader.js";
import pino, { type Logger } from "pino";
import type { Config } from "./schema.js";

export class ConfigWatcher {
  private logger: Logger;

  constructor(private onChange: (config: Config) => void, logger?: Logger) {
    this.logger = (logger ?? pino({ level: "silent" })).child({ module: "config" });
  }

  handleFileChange(yamlContent: string): void {
    try {
      const config = loadConfigFromString(yamlContent);
      this.onChange(config);
      this.logger.info("config reloaded");
    } catch (err) {
      this.logger.error({ err }, "config validation failed, keeping previous config");
    }
  }
}
