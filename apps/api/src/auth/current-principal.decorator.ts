import { createParamDecorator, type ExecutionContext } from "@nestjs/common";

import type { AuthenticatedPrincipal } from "./auth.types";

export const CurrentPrincipal = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthenticatedPrincipal => {
    const request = context.switchToHttp().getRequest<{ user: AuthenticatedPrincipal }>();
    return request.user;
  },
);

