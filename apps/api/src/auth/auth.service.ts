import {
  BadRequestException,
  Inject,
  Injectable,
  OnModuleInit,
  UnauthorizedException,
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { apiTokens, documentTypes, users } from "@openkeep/db";
import type {
  AuthTokens,
  CreateApiTokenInput,
  LoginInput,
  SetupOwnerInput,
  UpdateUserLanguagePreferences,
} from "@openkeep/types";
import { and, count, eq, sql } from "drizzle-orm";
import { compare, hash } from "bcryptjs";
import { createHash, randomBytes } from "crypto";

import { AppConfigService } from "../common/config/app-config.service";
import { DatabaseService } from "../common/db/database.service";
import { createDefaultDocumentTypeValues } from "../taxonomies/default-document-types";
import type { AuthenticatedPrincipal } from "./auth.types";

interface JwtPayload {
  sub: string;
  email: string;
  type: "access" | "refresh";
}

@Injectable()
export class AuthService implements OnModuleInit {
  constructor(
    @Inject(DatabaseService) private readonly databaseService: DatabaseService,
    @Inject(AppConfigService) private readonly configService: AppConfigService,
    @Inject(JwtService) private readonly jwtService: JwtService,
  ) {}

  async onModuleInit(): Promise<void> {
    if (this.configService.get("SKIP_EXTERNAL_INIT")) {
      return;
    }

    await this.ensureSeedOwner();
    await this.ensureDefaultDocumentTypes();
  }

  async setupOwner(input: SetupOwnerInput): Promise<AuthTokens> {
    const existing = await this.ownerCount();
    if (existing > 0) {
      throw new BadRequestException("Owner already exists");
    }

    const passwordHash = await hash(input.password, 12);
    const user = await this.databaseService.db.transaction(async (tx) => {
      const [createdUser] = await tx
        .insert(users)
        .values({
          email: input.email.toLowerCase(),
          passwordHash,
          displayName: input.displayName,
          isOwner: true,
        })
        .returning();

      await tx
        .insert(documentTypes)
        .values(createDefaultDocumentTypeValues())
        .onConflictDoUpdate({
          target: documentTypes.slug,
          set: {
            name: sql`excluded.name`,
            description: sql`excluded.description`,
            requiredFields: sql`excluded.required_fields`,
          },
        });

      return createdUser!;
    });

    return this.issueTokens(user.id, user.email);
  }

  async login(input: LoginInput): Promise<AuthTokens> {
    const [user] = await this.databaseService.db
      .select()
      .from(users)
      .where(eq(users.email, input.email.toLowerCase()))
      .limit(1);

    if (!user) {
      throw new UnauthorizedException("Invalid credentials");
    }

    const matches = await compare(input.password, user.passwordHash);
    if (!matches) {
      throw new UnauthorizedException("Invalid credentials");
    }

    return this.issueTokens(user.id, user.email);
  }

  async refresh(refreshToken: string): Promise<AuthTokens> {
    const payload = await this.verifyJwt(refreshToken, "refresh");
    return this.issueTokens(payload.sub, payload.email);
  }

  async getMe(principal: AuthenticatedPrincipal) {
    const [user] = await this.databaseService.db
      .select({
        id: users.id,
        email: users.email,
        displayName: users.displayName,
        isOwner: users.isOwner,
        uiLanguage: users.uiLanguage,
        aiProcessingLanguage: users.aiProcessingLanguage,
        aiChatLanguage: users.aiChatLanguage,
        createdAt: users.createdAt,
      })
      .from(users)
      .where(eq(users.id, principal.userId))
      .limit(1);

    if (!user) {
      throw new UnauthorizedException("User not found");
    }

    return {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      isOwner: user.isOwner,
      preferences: {
        uiLanguage: user.uiLanguage,
        aiProcessingLanguage: user.aiProcessingLanguage,
        aiChatLanguage: user.aiChatLanguage,
      },
      createdAt: user.createdAt,
    };
  }

  async updatePreferences(
    principal: AuthenticatedPrincipal,
    input: UpdateUserLanguagePreferences,
  ) {
    this.assertInteractiveUser(principal);

    await this.databaseService.db
      .update(users)
      .set({
        uiLanguage: input.uiLanguage,
        aiProcessingLanguage: input.aiProcessingLanguage,
        aiChatLanguage: input.aiChatLanguage,
        updatedAt: new Date(),
      })
      .where(eq(users.id, principal.userId));

    return this.getMe(principal);
  }

  async createApiToken(
    principal: AuthenticatedPrincipal,
    input: CreateApiTokenInput,
  ): Promise<{ id: string; token: string; name: string; expiresAt: string | null }> {
    this.assertInteractiveUser(principal);
    const publicId = `okp_${randomBytes(6).toString("hex")}`;
    const secret = randomBytes(24).toString("hex");
    const token = `${publicId}.${secret}`;

    const [record] = await this.databaseService.db
      .insert(apiTokens)
      .values({
        userId: principal.userId,
        name: input.name,
        tokenPrefix: publicId,
        tokenHash: this.hashToken(secret),
        expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
      })
      .returning();

    return {
      id: record.id,
      token,
      name: record.name,
      expiresAt: record.expiresAt?.toISOString() ?? null,
    };
  }

  async listApiTokens(principal: AuthenticatedPrincipal) {
    this.assertInteractiveUser(principal);
    return this.databaseService.db
      .select({
        id: apiTokens.id,
        name: apiTokens.name,
        tokenPrefix: apiTokens.tokenPrefix,
        lastUsedAt: apiTokens.lastUsedAt,
        expiresAt: apiTokens.expiresAt,
        createdAt: apiTokens.createdAt,
      })
      .from(apiTokens)
      .where(eq(apiTokens.userId, principal.userId));
  }

  async revokeApiToken(principal: AuthenticatedPrincipal, tokenId: string): Promise<void> {
    this.assertInteractiveUser(principal);
    await this.databaseService.db
      .delete(apiTokens)
      .where(and(eq(apiTokens.id, tokenId), eq(apiTokens.userId, principal.userId)));
  }

  async authenticateAccessToken(token: string): Promise<AuthenticatedPrincipal> {
    const payload = await this.verifyJwt(token, "access");
    return {
      userId: payload.sub,
      email: payload.email,
      type: "user",
    };
  }

  async authenticateApiToken(token: string): Promise<AuthenticatedPrincipal> {
    const [prefix, secret] = token.split(".");
    if (!prefix || !secret) {
      throw new UnauthorizedException("Malformed API token");
    }

    const [record] = await this.databaseService.db
      .select({
        id: apiTokens.id,
        userId: apiTokens.userId,
        tokenHash: apiTokens.tokenHash,
        expiresAt: apiTokens.expiresAt,
        email: users.email,
      })
      .from(apiTokens)
      .innerJoin(users, eq(apiTokens.userId, users.id))
      .where(eq(apiTokens.tokenPrefix, prefix))
      .limit(1);

    if (!record) {
      throw new UnauthorizedException("Unknown API token");
    }

    if (record.expiresAt && record.expiresAt.getTime() < Date.now()) {
      throw new UnauthorizedException("API token expired");
    }

    if (record.tokenHash !== this.hashToken(secret)) {
      throw new UnauthorizedException("Invalid API token");
    }

    await this.databaseService.db
      .update(apiTokens)
      .set({ lastUsedAt: new Date() })
      .where(eq(apiTokens.id, record.id));

    return {
      userId: record.userId,
      email: record.email,
      type: "api-token",
      tokenId: record.id,
    };
  }

  assertInteractiveUser(principal: AuthenticatedPrincipal): void {
    if (principal.type !== "user") {
      throw new UnauthorizedException("Interactive user session required");
    }
  }

  private async ensureSeedOwner(): Promise<void> {
    const existing = await this.ownerCount();
    if (existing > 0) {
      return;
    }

    const passwordHash = await hash(this.configService.get("OWNER_PASSWORD"), 12);
    await this.databaseService.db.transaction(async (tx) => {
      await tx.insert(users).values({
        email: this.configService.get("OWNER_EMAIL").toLowerCase(),
        passwordHash,
        displayName: this.configService.get("OWNER_NAME"),
        isOwner: true,
      });

      await tx
        .insert(documentTypes)
        .values(createDefaultDocumentTypeValues())
        .onConflictDoNothing({
          target: documentTypes.slug,
        });
    });
  }

  private async ensureDefaultDocumentTypes(): Promise<void> {
    await this.databaseService.db
      .insert(documentTypes)
      .values(createDefaultDocumentTypeValues())
      .onConflictDoUpdate({
        target: documentTypes.slug,
        set: {
          name: sql`excluded.name`,
          description: sql`excluded.description`,
          requiredFields: sql`excluded.required_fields`,
        },
      });
  }

  private async ownerCount(): Promise<number> {
    const [result] = await this.databaseService.db
      .select({ value: count() })
      .from(users);
    return Number(result?.value ?? 0);
  }

  private async issueTokens(userId: string, email: string): Promise<AuthTokens> {
    type JwtExpiry = NonNullable<Parameters<JwtService["signAsync"]>[1]>["expiresIn"];
    const accessPayload: JwtPayload = { sub: userId, email, type: "access" };
    const refreshPayload: JwtPayload = { sub: userId, email, type: "refresh" };
    const accessToken = await this.jwtService.signAsync(
      accessPayload,
      {
        secret: this.configService.get("JWT_ACCESS_SECRET"),
        expiresIn: this.configService.get("ACCESS_TOKEN_TTL") as JwtExpiry,
      },
    );
    const refreshToken = await this.jwtService.signAsync(
      refreshPayload,
      {
        secret: this.configService.get("JWT_REFRESH_SECRET"),
        expiresIn: this.configService.get("REFRESH_TOKEN_TTL") as JwtExpiry,
      },
    );

    return { accessToken, refreshToken };
  }

  private async verifyJwt(token: string, expectedType: JwtPayload["type"]): Promise<JwtPayload> {
    const payload = await this.jwtService.verifyAsync<JwtPayload>(token, {
      secret:
        expectedType === "access"
          ? this.configService.get("JWT_ACCESS_SECRET")
          : this.configService.get("JWT_REFRESH_SECRET"),
    });

    if (payload.type !== expectedType) {
      throw new UnauthorizedException("Unexpected token type");
    }

    return payload;
  }

  private hashToken(value: string): string {
    return createHash("sha256").update(value).digest("hex");
  }
}
