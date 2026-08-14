import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module";
import { TaxesController } from "./taxes.controller";
import { TaxesService } from "./taxes.service";

@Module({
  imports: [AuthModule],
  controllers: [TaxesController],
  providers: [TaxesService],
  exports: [TaxesService],
})
export class TaxesModule {}
