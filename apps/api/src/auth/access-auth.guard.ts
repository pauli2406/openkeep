import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";

import { AuthService } from "./auth.service";

@Injectable()
export class AccessAuthGuard implements CanActivate {
  constructor(@Inject(AuthService) private readonly authService: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<{
      headers: Record<string, string | string[] | undefined>;
      user?: unknown;
    }>();

    const authorization = request.headers.authorization;
    const bearer = Array.isArray(authorization) ? authorization[0] : authorization;
    const token = bearer?.startsWith("Bearer ") ? bearer.slice(7) : undefined;

    if (!token) {
      throw new UnauthorizedException("Missing bearer token");
    }

    try {
      request.user = await this.authService.authenticateAccessToken(token);
      return true;
    } catch {
      request.user = await this.authService.authenticateApiToken(token);
      return true;
    }
  }
}
