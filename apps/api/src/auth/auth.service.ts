import {
  BadRequestException,
  Inject,
  Injectable,
  OnModuleInit,
  UnauthorizedException,
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { apiTokens, documentTypes, refreshSessions, users } from "@openkeep/db";
import type {
  AuthTokens,
  CreateApiTokenInput,
  DisableTwoFactorInput,
  EnableTwoFactorInput,
  EnableTwoFactorResponse,
  LoginInput,
  LoginResponse,
  SetupOwnerInput,
  TwoFactorLoginInput,
  TwoFactorSetupResponse,
  UpdateUserLanguagePreferences,
} from "@openkeep/types";
import { and, count, eq, sql } from "drizzle-orm";
import { compare, hash } from "bcryptjs";
import { createHash, randomBytes, randomUUID, timingSafeEqual } from "crypto";
import { authenticator } from "otplib";
import * as QRCode from "qrcode";

import { AppConfigService } from "../common/config/app-config.service";
import { DatabaseService } from "../common/db/database.service";
import { createDefaultDocumentTypeValues } from "../taxonomies/default-document-types";
import type { AuthenticatedPrincipal } from "./auth.types";

// Allow one time-step of clock drift in either direction (±30s).
authenticator.options = { window: 1 };

interface JwtPayload {
  sub: string;
  email: string;
  type: "access" | "refresh";
  jti?: string;
}

interface TwoFactorChallengePayload {
  sub: string;
  type: "2fa";
}

interface EnrollmentPayload {
  sub: string;
  type: "totp-enroll";
  secret: string;
}

type RecoveryCode = { hash: string; usedAt: string | null };

@Injectable()
export class AuthService implements OnModuleInit {
  // A valid bcrypt hash used to equalize timing when an email is unknown,
  // preventing user-enumeration via response-time side channels.
  private dummyPasswordHash = "";

  constructor(
    @Inject(DatabaseService) private readonly databaseService: DatabaseService,
    @Inject(AppConfigService) private readonly configService: AppConfigService,
    @Inject(JwtService) private readonly jwtService: JwtService,
  ) {}

  async onModuleInit(): Promise<void> {
    // Precompute once so failed logins for unknown users still pay the
    // bcrypt cost (constant-time-ish login).
    this.dummyPasswordHash = await hash("openkeep-dummy-password", 12);

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

  async login(input: LoginInput): Promise<LoginResponse> {
    const [user] = await this.databaseService.db
      .select()
      .from(users)
      .where(eq(users.email, input.email.toLowerCase()))
      .limit(1);

    if (!user) {
      // Equalize timing for unknown emails.
      await compare(input.password, this.dummyPasswordHash);
      throw new UnauthorizedException("Invalid credentials");
    }

    const matches = await compare(input.password, user.passwordHash);
    if (!matches) {
      throw new UnauthorizedException("Invalid credentials");
    }

    if (user.totpEnabled) {
      const twoFactorToken = await this.jwtService.signAsync(
        { sub: user.id, type: "2fa" } satisfies TwoFactorChallengePayload,
        { secret: this.configService.get("JWT_ACCESS_SECRET"), expiresIn: "5m" },
      );
      return { requiresTwoFactor: true, twoFactorToken };
    }

    return this.issueTokens(user.id, user.email);
  }

  async completeTwoFactorLogin(input: TwoFactorLoginInput): Promise<AuthTokens> {
    let payload: TwoFactorChallengePayload;
    try {
      payload = await this.jwtService.verifyAsync<TwoFactorChallengePayload>(
        input.twoFactorToken,
        { secret: this.configService.get("JWT_ACCESS_SECRET") },
      );
    } catch {
      throw new UnauthorizedException("Two-factor session expired");
    }

    if (payload.type !== "2fa") {
      throw new UnauthorizedException("Invalid two-factor token");
    }

    const [user] = await this.databaseService.db
      .select()
      .from(users)
      .where(eq(users.id, payload.sub))
      .limit(1);

    if (!user || !user.totpEnabled || !user.totpSecret) {
      throw new UnauthorizedException("Two-factor is not enabled");
    }

    const ok = await this.consumeTwoFactorCode(user.id, user.totpSecret, user.totpRecoveryCodes, input.code);
    if (!ok) {
      throw new UnauthorizedException("Invalid authentication code");
    }

    return this.issueTokens(user.id, user.email);
  }

  async refresh(refreshToken: string): Promise<AuthTokens> {
    const payload = await this.verifyJwt(refreshToken, "refresh");
    if (!payload.jti) {
      throw new UnauthorizedException("Invalid refresh token");
    }

    const [session] = await this.databaseService.db
      .select()
      .from(refreshSessions)
      .where(eq(refreshSessions.id, payload.jti))
      .limit(1);

    if (!session) {
      throw new UnauthorizedException("Refresh session not found");
    }

    if (session.revokedAt) {
      // A revoked (already-rotated) refresh token was replayed. This is a
      // strong indicator of token theft — revoke the whole family.
      await this.revokeAllSessions(session.userId);
      throw new UnauthorizedException("Refresh token reuse detected");
    }

    if (session.expiresAt.getTime() < Date.now()) {
      throw new UnauthorizedException("Refresh token expired");
    }

    if (!this.safeEqualHex(session.tokenHash, this.hashToken(refreshToken))) {
      throw new UnauthorizedException("Invalid refresh token");
    }

    // Rotate: revoke the presented token and issue a fresh pair.
    await this.databaseService.db
      .update(refreshSessions)
      .set({ revokedAt: new Date(), lastUsedAt: new Date() })
      .where(eq(refreshSessions.id, session.id));

    return this.issueTokens(payload.sub, payload.email);
  }

  async logout(refreshToken: string): Promise<void> {
    let payload: JwtPayload;
    try {
      payload = await this.verifyJwt(refreshToken, "refresh");
    } catch {
      // Already invalid/expired — nothing to revoke.
      return;
    }
    if (payload.jti) {
      await this.databaseService.db
        .update(refreshSessions)
        .set({ revokedAt: new Date() })
        .where(eq(refreshSessions.id, payload.jti));
    }
  }

  async getMe(principal: AuthenticatedPrincipal) {
    const [user] = await this.databaseService.db
      .select({
        id: users.id,
        email: users.email,
        displayName: users.displayName,
        isOwner: users.isOwner,
        twoFactorEnabled: users.totpEnabled,
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
      twoFactorEnabled: user.twoFactorEnabled,
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

  // --- Two-factor (TOTP) enrollment ---

  async setupTwoFactor(principal: AuthenticatedPrincipal): Promise<TwoFactorSetupResponse> {
    this.assertInteractiveUser(principal);

    const [user] = await this.databaseService.db
      .select({ totpEnabled: users.totpEnabled })
      .from(users)
      .where(eq(users.id, principal.userId))
      .limit(1);

    if (!user) {
      throw new UnauthorizedException("User not found");
    }
    if (user.totpEnabled) {
      throw new BadRequestException("Two-factor is already enabled");
    }

    const secret = authenticator.generateSecret();
    const issuer = this.configService.get("TOTP_ISSUER");
    const otpauthUrl = authenticator.keyuri(principal.email, issuer, secret);
    const qrDataUrl = await QRCode.toDataURL(otpauthUrl);

    // The pending secret lives only inside this short-lived signed token,
    // never in the DB, until the user proves possession with a valid code.
    const enrollmentToken = await this.jwtService.signAsync(
      { sub: principal.userId, type: "totp-enroll", secret } satisfies EnrollmentPayload,
      { secret: this.configService.get("JWT_ACCESS_SECRET"), expiresIn: "10m" },
    );

    return { secret, otpauthUrl, qrDataUrl, enrollmentToken };
  }

  async enableTwoFactor(
    principal: AuthenticatedPrincipal,
    input: EnableTwoFactorInput,
  ): Promise<EnableTwoFactorResponse> {
    this.assertInteractiveUser(principal);

    let payload: EnrollmentPayload;
    try {
      payload = await this.jwtService.verifyAsync<EnrollmentPayload>(input.enrollmentToken, {
        secret: this.configService.get("JWT_ACCESS_SECRET"),
      });
    } catch {
      throw new UnauthorizedException("Enrollment session expired");
    }

    if (payload.type !== "totp-enroll" || payload.sub !== principal.userId) {
      throw new UnauthorizedException("Invalid enrollment token");
    }

    if (!authenticator.verify({ token: input.code, secret: payload.secret })) {
      throw new UnauthorizedException("Invalid authentication code");
    }

    const { plain, stored } = this.generateRecoveryCodes();

    await this.databaseService.db
      .update(users)
      .set({
        totpSecret: payload.secret,
        totpEnabled: true,
        totpRecoveryCodes: stored,
        updatedAt: new Date(),
      })
      .where(eq(users.id, principal.userId));

    return { recoveryCodes: plain };
  }

  async disableTwoFactor(
    principal: AuthenticatedPrincipal,
    input: DisableTwoFactorInput,
  ): Promise<void> {
    this.assertInteractiveUser(principal);

    const [user] = await this.databaseService.db
      .select()
      .from(users)
      .where(eq(users.id, principal.userId))
      .limit(1);

    if (!user || !user.totpEnabled || !user.totpSecret) {
      throw new BadRequestException("Two-factor is not enabled");
    }

    const passwordOk = await compare(input.password, user.passwordHash);
    if (!passwordOk) {
      throw new UnauthorizedException("Invalid credentials");
    }

    const codeOk = await this.consumeTwoFactorCode(
      user.id,
      user.totpSecret,
      user.totpRecoveryCodes,
      input.code,
    );
    if (!codeOk) {
      throw new UnauthorizedException("Invalid authentication code");
    }

    await this.databaseService.db
      .update(users)
      .set({
        totpSecret: null,
        totpEnabled: false,
        totpRecoveryCodes: [],
        updatedAt: new Date(),
      })
      .where(eq(users.id, principal.userId));
  }

  // --- API tokens ---

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

    if (!this.safeEqualHex(record.tokenHash, this.hashToken(secret))) {
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
    const jti = randomUUID();
    const refreshPayload: JwtPayload = { sub: userId, email, type: "refresh", jti };

    const accessToken = await this.jwtService.signAsync(accessPayload, {
      secret: this.configService.get("JWT_ACCESS_SECRET"),
      expiresIn: this.configService.get("ACCESS_TOKEN_TTL") as JwtExpiry,
    });
    const refreshToken = await this.jwtService.signAsync(refreshPayload, {
      secret: this.configService.get("JWT_REFRESH_SECRET"),
      expiresIn: this.configService.get("REFRESH_TOKEN_TTL") as JwtExpiry,
    });

    const decoded = this.jwtService.decode(refreshToken) as { exp?: number } | null;
    const expiresAt = decoded?.exp
      ? new Date(decoded.exp * 1000)
      : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    await this.databaseService.db.insert(refreshSessions).values({
      id: jti,
      userId,
      tokenHash: this.hashToken(refreshToken),
      expiresAt,
    });

    return { accessToken, refreshToken };
  }

  private async revokeAllSessions(userId: string): Promise<void> {
    await this.databaseService.db
      .update(refreshSessions)
      .set({ revokedAt: new Date() })
      .where(and(eq(refreshSessions.userId, userId), sql`${refreshSessions.revokedAt} IS NULL`));
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

  private async consumeTwoFactorCode(
    userId: string,
    secret: string,
    recoveryCodes: RecoveryCode[],
    code: string,
  ): Promise<boolean> {
    const normalized = code.trim();

    // 6-digit numeric input is treated as a TOTP code.
    if (/^\d{6}$/.test(normalized)) {
      return authenticator.verify({ token: normalized, secret });
    }

    // Otherwise treat it as a single-use recovery code.
    const target = this.hashToken(normalized.toLowerCase());
    const codes = recoveryCodes ?? [];
    const index = codes.findIndex(
      (entry) => !entry.usedAt && this.safeEqualHex(entry.hash, target),
    );
    if (index === -1) {
      return false;
    }

    const updated = codes.map((entry, i) =>
      i === index ? { ...entry, usedAt: new Date().toISOString() } : entry,
    );
    await this.databaseService.db
      .update(users)
      .set({ totpRecoveryCodes: updated, updatedAt: new Date() })
      .where(eq(users.id, userId));

    return true;
  }

  private generateRecoveryCodes(): { plain: string[]; stored: RecoveryCode[] } {
    const plain: string[] = [];
    const stored: RecoveryCode[] = [];
    for (let i = 0; i < 10; i += 1) {
      const raw = randomBytes(5).toString("hex"); // 10 hex chars
      const formatted = `${raw.slice(0, 5)}-${raw.slice(5)}`;
      plain.push(formatted);
      stored.push({ hash: this.hashToken(formatted), usedAt: null });
    }
    return { plain, stored };
  }

  private hashToken(value: string): string {
    return createHash("sha256").update(value).digest("hex");
  }

  private safeEqualHex(a: string, b: string): boolean {
    if (a.length !== b.length) {
      return false;
    }
    try {
      return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
    } catch {
      return false;
    }
  }
}
