import { Global, Module } from "@nestjs/common";
import { loadConfig } from "@openkeep/config";

import { APP_CONFIG } from "./app-config.constants";
import { AppConfigService } from "./app-config.service";

@Global()
@Module({
  providers: [
    {
      provide: APP_CONFIG,
      useFactory: () => loadConfig(),
    },
    AppConfigService,
  ],
  exports: [APP_CONFIG, AppConfigService],
})
export class AppConfigModule {}

