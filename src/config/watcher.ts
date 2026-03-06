import { loadConfigFromString } from "./loader.js";
import type { Config } from "./schema.js";

export class ConfigWatcher {
  constructor(private onChange: (config: Config) => void) {}

  handleFileChange(yamlContent: string): void {
    try {
      const config = loadConfigFromString(yamlContent);
      this.onChange(config);
    } catch {
      // Invalid config — keep previous
    }
  }
}
