import { Inject, Injectable } from "@nestjs/common";
import type { AppConfig } from "@openkeep/config";

import { APP_CONFIG } from "./app-config.constants";

@Injectable()
export class AppConfigService {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  get<K extends keyof AppConfig>(key: K): AppConfig[K] {
    return this.config[key];
  }

  all(): AppConfig {
    return this.config;
  }
}

