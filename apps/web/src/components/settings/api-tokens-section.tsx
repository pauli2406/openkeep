import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Key, Plus, Trash2 } from "lucide-react";
import { format } from "date-fns";
import { api, getApiErrorMessage } from "@/lib/api";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { useI18n } from "@/lib/i18n";
import {
  type ApiToken,
  type CreateTokenResponse,
  RetryAlert,
  RowsSkeleton,
  SecretBlock,
  SectionCard,
  ShownOnceNote,
} from "./shared";

export function ApiTokensSection() {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [tokenName, setTokenName] = useState("");
  const [tokenExpiry, setTokenExpiry] = useState("");
  const [generatedToken, setGeneratedToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  const tokensQuery = useQuery({
    queryKey: ["auth", "tokens"],
    queryFn: async () => {
      const { data, error } = await api.GET("/api/auth/tokens", {});
      if (error) {
        throw new Error(
          getApiErrorMessage(error, t("settings.failedToFetchTokens")),
        );
      }
      return (data ?? []) as ApiToken[];
    },
  });

  const createMutation = useMutation({
    mutationFn: async (params: { name: string; expiresAt?: string }) => {
      const body: { name: string; expiresAt?: string } = { name: params.name };
      if (params.expiresAt) {
        body.expiresAt = params.expiresAt;
      }
      const { data, error } = await api.POST("/api/auth/tokens", {
        body,
      });
      if (error) {
        throw new Error(
          getApiErrorMessage(error, t("settings.failedToCreateToken")),
        );
      }
      return data as unknown as CreateTokenResponse;
    },
    onSuccess: (data) => {
      setGeneratedToken(data.token);
      setTokenName("");
      setTokenExpiry("");
      queryClient.invalidateQueries({ queryKey: ["auth", "tokens"] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await api.DELETE("/api/auth/tokens/{id}", {
        params: { path: { id } },
      });
      if (error) {
        throw new Error(
          getApiErrorMessage(error, t("settings.failedToDeleteToken")),
        );
      }
    },
    onSuccess: () => {
      setDeleteConfirmId(null);
      queryClient.invalidateQueries({ queryKey: ["auth", "tokens"] });
    },
  });

  function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!tokenName.trim()) return;
    createMutation.mutate({
      name: tokenName.trim(),
      expiresAt: tokenExpiry || undefined,
    });
  }

  function handleCopy() {
    if (generatedToken) {
      navigator.clipboard.writeText(generatedToken);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  function handleDialogClose(open: boolean) {
    if (!open) {
      setGeneratedToken(null);
      setTokenName("");
      setTokenExpiry("");
      setCopied(false);
      createMutation.reset();
    }
    setCreateDialogOpen(open);
  }

  const tokens = tokensQuery.data ?? [];
  const tokenToDelete = tokens.find((token) => token.id === deleteConfirmId) ?? null;

  return (
    <SectionCard
      headingLevel="h2"
      icon={<Key />}
      title={t("settings.apiTokensTitle")}
      description={t("settings.apiTokensDescription")}
      action={
        <Dialog open={createDialogOpen} onOpenChange={handleDialogClose}>
          <DialogTrigger asChild>
            <Button variant="outline" size="sm">
              <Plus />
              {t("settings.createToken")}
            </Button>
          </DialogTrigger>
          <DialogContent>
            {generatedToken ? (
              <>
                <DialogHeader>
                  <DialogTitle>{t("settings.tokenCreated")}</DialogTitle>
                  <DialogDescription>
                    {t("settings.tokenCreatedDescription")}
                  </DialogDescription>
                </DialogHeader>
                <div className="flex flex-col gap-3">
                  <SecretBlock value={generatedToken} copied={copied} onCopy={handleCopy} />
                  <ShownOnceNote>{t("settings.tokenShownOnce")}</ShownOnceNote>
                </div>
                <DialogFooter>
                  <Button onClick={() => handleDialogClose(false)}>{t("settings.done")}</Button>
                </DialogFooter>
              </>
            ) : (
              <>
                <DialogHeader>
                  <DialogTitle>{t("settings.createApiToken")}</DialogTitle>
                  <DialogDescription>
                    {t("settings.createApiTokenDescription")}
                  </DialogDescription>
                </DialogHeader>
                <form onSubmit={handleCreate} className="flex flex-col gap-5">
                  <FieldGroup>
                    <Field>
                      <FieldLabel htmlFor="token-name">{t("settings.name")}</FieldLabel>
                      <Input
                        id="token-name"
                        value={tokenName}
                        onChange={(e) => setTokenName(e.target.value)}
                        placeholder={t("settings.tokenNamePlaceholder")}
                        required
                      />
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="token-expiry">
                        {t("settings.expiryOptional")}
                      </FieldLabel>
                      <Input
                        id="token-expiry"
                        type="date"
                        value={tokenExpiry}
                        onChange={(e) => setTokenExpiry(e.target.value)}
                        min={format(new Date(), "yyyy-MM-dd")}
                      />
                    </Field>
                  </FieldGroup>
                  {createMutation.isError ? (
                    <FieldError>
                      {createMutation.error instanceof Error
                        ? createMutation.error.message
                        : t("settings.createTokenFailed")}
                    </FieldError>
                  ) : null}
                  <DialogFooter>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => handleDialogClose(false)}
                    >
                      {t("settings.cancel")}
                    </Button>
                    <Button type="submit" disabled={createMutation.isPending || !tokenName.trim()}>
                      {createMutation.isPending ? (
                        <>
                          <Spinner />
                          {t("settings.creating")}
                        </>
                      ) : (
                        t("settings.create")
                      )}
                    </Button>
                  </DialogFooter>
                </form>
              </>
            )}
          </DialogContent>
        </Dialog>
      }
    >
      <div className="flex flex-col gap-3">
        {tokensQuery.isLoading ? <RowsSkeleton rows={2} /> : null}

        {tokensQuery.isError ? (
          <RetryAlert
            message={
              tokensQuery.error instanceof Error
                ? tokensQuery.error.message
                : t("settings.loadTokensFailed")
            }
            onRetry={() => void tokensQuery.refetch()}
          />
        ) : null}

        {tokensQuery.data && tokens.length === 0 ? (
          <Empty className="bg-gradient-wash py-10">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Key />
              </EmptyMedia>
              <EmptyTitle>{t("settings.noApiTokens")}</EmptyTitle>
              <EmptyDescription>{t("settings.noApiTokensHint")}</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : null}

        {tokens.length > 0 ? (
          <div className="divide-y rounded-lg border">
            {tokens.map((token) => (
              <div key={token.id} className="flex items-center gap-3 px-3.5 py-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                    <p className="truncate text-sm font-medium">{token.name}</p>
                    <Badge variant="secondary" className="font-mono">
                      {token.tokenPrefix}...
                    </Badge>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                    {token.lastUsedAt ? (
                      <span>
                        {t("settings.lastUsed")}:{" "}
                        <span className="num">
                          {format(new Date(token.lastUsedAt), "MMM d, yyyy")}
                        </span>
                      </span>
                    ) : (
                      <span>{t("settings.neverUsed")}</span>
                    )}
                    {token.expiresAt ? (
                      <span>
                        {t("settings.expires")}:{" "}
                        <span className="num">
                          {format(new Date(token.expiresAt), "MMM d, yyyy")}
                        </span>
                      </span>
                    ) : (
                      <span>{t("settings.noExpiry")}</span>
                    )}
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="shrink-0 text-muted-foreground hover:text-destructive"
                  onClick={() => setDeleteConfirmId(token.id)}
                >
                  <Trash2 />
                  <span className="sr-only">{t("settings.delete")}</span>
                </Button>
              </div>
            ))}
          </div>
        ) : null}

        {deleteMutation.isError && !deleteConfirmId ? (
          <RetryAlert
            message={
              deleteMutation.error instanceof Error
                ? deleteMutation.error.message
                : t("settings.failedToDeleteToken")
            }
          />
        ) : null}
      </div>

      <AlertDialog
        open={deleteConfirmId !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteConfirmId(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("settings.deleteTokenTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {tokenToDelete ? (
                <span className="font-medium text-foreground">{tokenToDelete.name}</span>
              ) : null}
              {tokenToDelete ? " · " : null}
              {t("settings.deleteTokenDescription")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {deleteMutation.isError ? (
            <p className="text-sm text-destructive" role="alert">
              {deleteMutation.error instanceof Error
                ? deleteMutation.error.message
                : t("settings.failedToDeleteToken")}
            </p>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel>{t("settings.cancel")}</AlertDialogCancel>
            <Button
              variant="destructive"
              disabled={deleteMutation.isPending}
              onClick={() => {
                if (deleteConfirmId) deleteMutation.mutate(deleteConfirmId);
              }}
            >
              {deleteMutation.isPending ? <Spinner /> : null}
              {t("settings.delete")}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SectionCard>
  );
}
