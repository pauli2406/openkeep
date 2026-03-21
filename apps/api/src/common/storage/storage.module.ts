import { Global, Module } from "@nestjs/common";

import { ObjectStorageService } from "./storage.service";

@Global()
@Module({
  providers: [ObjectStorageService],
  exports: [ObjectStorageService],
})
export class StorageModule {}

