import { Global, Module } from "@nestjs/common";

import { ArtifactStorageService } from "./artifact-storage.service.js";

@Global()
@Module({
  providers: [ArtifactStorageService],
  exports: [ArtifactStorageService],
})
export class StorageModule {}
