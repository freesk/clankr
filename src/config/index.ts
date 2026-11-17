export { ConfigError, type ConfigFlags, type LoadConfigOptions, loadConfig } from "./load.ts";
export { type Config, type ConfigInput, configSchema, type ModelProfile } from "./schema.ts";

import { type Config, configSchema } from "./schema.ts";

/** Every default, with no file, environment, or flags applied. Allowed roots are left empty. */
export function defaultConfig(): Config {
  return configSchema.parse({});
}
