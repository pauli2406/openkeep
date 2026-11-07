import { useState } from "react";
import { Alert, Pressable, Text, View } from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  TOKEN_EXPIRY_PRESETS,
  createApiToken,
  deleteApiToken,
  expiryFromPreset,
  listApiTokens,
  type ApiToken,
  type TokenExpiryPreset,
} from "../../api/account";
import { useAuth } from "../../auth";
import { BottomSheet, Chip, Gradient } from "../../components/layout";
import { Button, EmptyState } from "../../components/ui";
import { useI18n } from "../../i18n";
import { createThemedStyles, radii, useColors } from "../../theme";
import { text } from "../../typography";
import {
  FormField,
  InlineError,
  RowsSkeleton,
  SecretBlock,
  SectionCard,
  ShownOnceNote,
  errorText,
  formatDay,
} from "./shared";

export function ApiTokensSection() {
  const styles = useStyles();
  const colors = useColors();
  const auth = useAuth();
  const queryClient = useQueryClient();
  const { t, language } = useI18n();

  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [expiry, setExpiry] = useState<TokenExpiryPreset>(null);
  const [revealed, setRevealed] = useState<string | null>(null);

  const queryKey = ["settings", "api-tokens", auth.apiUrl];
  const tokensQuery = useQuery({
    queryKey,
    queryFn: () => listApiTokens(auth.authFetch, t("settings.failedToFetchTokens")),
  });
  const createMutation = useMutation({
    mutationFn: () =>
      createApiToken(
        auth.authFetch,
        { name: name.trim(), expiresAt: expiryFromPreset(expiry) },
        t("settings.failedToCreateToken"),
      ),
    onSuccess: (created) => {
      setRevealed(created.token);
      setName("");
      setExpiry(null);
      void queryClient.invalidateQueries({ queryKey });
    },
  });
  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteApiToken(auth.authFetch, id, t("settings.failedToDeleteToken")),
    onSettled: () => void queryClient.invalidateQueries({ queryKey }),
  });

  function closeCreate() {
    setCreateOpen(false);
    setRevealed(null);
    setName("");
    setExpiry(null);
    createMutation.reset();
  }

  function confirmDelete(token: ApiToken) {
    deleteMutation.reset();
    Alert.alert(
      t("settings.deleteTokenTitle"),
      `${token.name} · ${t("settings.deleteTokenDescription")}`,
      [
        { text: t("settings.cancel"), style: "cancel" },
        {
          text: t("settings.delete"),
          style: "destructive",
          onPress: () => deleteMutation.mutate(token.id),
        },
      ],
    );
  }

  const expiryLabels: Record<string, string> = {
    none: t("settings.noExpiry"),
    "30": t("profile.expiry30"),
    "90": t("profile.expiry90"),
    "365": t("profile.expiry365"),
  };
  const tokens = tokensQuery.data ?? [];

  return (
    <SectionCard
      icon="key-outline"
      title={t("settings.apiTokensTitle")}
      description={t("settings.apiTokensDescription")}
      action={
        <Button
          size="sm"
          variant="secondary"
          icon="plus"
          label={t("settings.createToken")}
          onPress={() => setCreateOpen(true)}
        />
      }
    >
      {tokensQuery.isLoading ? <RowsSkeleton rows={2} /> : null}
      {tokensQuery.isError ? (
        <InlineError
          message={errorText(tokensQuery.error, t("settings.failedToFetchTokens"))}
          onRetry={() => void tokensQuery.refetch()}
        />
      ) : null}
      {tokensQuery.data && tokens.length === 0 ? (
        <Gradient name="wash" borderRadius={radii.xl} style={styles.empty}>
          <EmptyState
            icon="key-outline"
            title={t("settings.noApiTokens")}
            body={t("settings.noApiTokensHint")}
          />
        </Gradient>
      ) : null}
      {tokens.length > 0 ? (
        <View style={styles.list}>
          {tokens.map((token, index) => (
            <View key={token.id} style={[styles.token, index > 0 ? styles.tokenRule : null]}>
              <View style={styles.tokenText}>
                <View style={styles.tokenHead}>
                  <Text style={styles.tokenName} numberOfLines={1}>
                    {token.name}
                  </Text>
                  <Text style={styles.tokenPrefix} numberOfLines={1}>
                    {`${token.tokenPrefix}...`}
                  </Text>
                </View>
                <Text style={styles.tokenMeta}>
                  {token.lastUsedAt
                    ? `${t("settings.lastUsed")}: ${formatDay(token.lastUsedAt, language)}`
                    : t("settings.neverUsed")}
                  {" · "}
                  {token.expiresAt
                    ? `${t("settings.expires")}: ${formatDay(token.expiresAt, language)}`
                    : t("settings.noExpiry")}
                </Text>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${t("settings.delete")}: ${token.name}`}
                onPress={() => confirmDelete(token)}
                style={styles.delete}
              >
                <MaterialCommunityIcons name="trash-can-outline" size={18} color={colors.muted} />
              </Pressable>
            </View>
          ))}
        </View>
      ) : null}
      {deleteMutation.isError ? (
        <InlineError message={errorText(deleteMutation.error, t("settings.failedToDeleteToken"))} />
      ) : null}

      <BottomSheet
        visible={createOpen}
        onClose={closeCreate}
        title={revealed ? t("settings.tokenCreated") : t("settings.createApiToken")}
        footer={
          revealed ? (
            <View style={styles.footerButton}>
              <Button label={t("settings.done")} onPress={closeCreate} />
            </View>
          ) : (
            <>
              <View style={styles.footerButton}>
                <Button variant="secondary" label={t("settings.cancel")} onPress={closeCreate} />
              </View>
              <View style={styles.footerButton}>
                <Button
                  label={createMutation.isPending ? t("settings.creating") : t("settings.create")}
                  disabled={!name.trim()}
                  loading={createMutation.isPending}
                  onPress={() => createMutation.mutate()}
                />
              </View>
            </>
          )
        }
      >
        {revealed ? (
          <>
            <Text style={styles.body}>{t("settings.tokenCreatedDescription")}</Text>
            <SecretBlock value={revealed} />
            <ShownOnceNote>{t("settings.tokenShownOnce")}</ShownOnceNote>
          </>
        ) : (
          <>
            <Text style={styles.body}>{t("settings.createApiTokenDescription")}</Text>
            <FormField
              label={t("settings.name")}
              value={name}
              onChangeText={setName}
              placeholder={t("settings.tokenNamePlaceholder")}
              maxLength={120}
              error={
                createMutation.isError
                  ? errorText(createMutation.error, t("settings.failedToCreateToken"))
                  : undefined
              }
            />
            <Text style={styles.expiryLabel}>{t("settings.expiryOptional")}</Text>
            <View style={styles.expiry}>
              {TOKEN_EXPIRY_PRESETS.map((preset) => (
                <Chip
                  key={preset ?? "none"}
                  label={expiryLabels[preset === null ? "none" : String(preset)]}
                  active={expiry === preset}
                  onPress={() => setExpiry(preset)}
                />
              ))}
            </View>
          </>
        )}
      </BottomSheet>
    </SectionCard>
  );
}

const useStyles = createThemedStyles((c) => ({
  empty: {
    overflow: "hidden",
  },
  list: {
    borderWidth: 1,
    borderColor: c.border,
    borderRadius: radii.lg,
    overflow: "hidden",
  },
  token: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingLeft: 12,
    paddingVertical: 8,
    minHeight: 56,
  },
  tokenRule: {
    borderTopWidth: 1,
    borderTopColor: c.border,
  },
  tokenText: {
    flex: 1,
    minWidth: 0,
    gap: 3,
  },
  tokenHead: {
    gap: 2,
  },
  tokenName: {
    ...text.rowTitle,
    color: c.ink,
  },
  tokenPrefix: {
    ...text.mono,
    color: c.muted,
  },
  tokenMeta: {
    ...text.small,
    color: c.muted,
  },
  delete: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  body: {
    ...text.body,
    color: c.muted,
  },
  footerButton: {
    flex: 1,
  },
  expiryLabel: {
    ...text.metaStrong,
    color: c.ink,
  },
  expiry: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },
}));
