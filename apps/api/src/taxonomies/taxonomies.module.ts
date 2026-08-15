import { Module, forwardRef } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module";
import { ExplorerModule } from "../explorer/explorer.module";
import { ProcessingModule } from "../processing/processing.module";
import { TaxonomiesController } from "./taxonomies.controller";
import { CategoryAssignmentService } from "./category-assignment.service";
import { TaxonomiesService } from "./taxonomies.service";

@Module({
  imports: [AuthModule, ProcessingModule, forwardRef(() => ExplorerModule)],
  controllers: [TaxonomiesController],
  providers: [TaxonomiesService, CategoryAssignmentService],
  exports: [TaxonomiesService, CategoryAssignmentService],
})
export class TaxonomiesModule {}
