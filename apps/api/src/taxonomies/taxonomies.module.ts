import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module";
import { ProcessingModule } from "../processing/processing.module";
import { TaxonomiesController } from "./taxonomies.controller";
import { TaxonomiesService } from "./taxonomies.service";

@Module({
  imports: [AuthModule, ProcessingModule],
  controllers: [TaxonomiesController],
  providers: [TaxonomiesService],
  exports: [TaxonomiesService],
})
export class TaxonomiesModule {}
