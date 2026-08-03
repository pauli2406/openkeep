import { useState } from "react";
import { createFileRoute, Link, redirect, useNavigate } from "@tanstack/react-router";
import { AuthPanel, FieldError } from "@/components/auth/auth-panel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAuth } from "@/hooks/use-auth";
import { useI18n } from "@/lib/i18n";

/**
 * Creating the owner authenticates them, and `AppRouter` invalidates the
 * router as soon as that happens — which re-runs this guard while the user is
 * still on step 1. Without this flag the wizard would bounce to "/" and the
 * language and watch-folder steps would be unreachable.
 */
let wizardInProgress = false;

export const Route = createFileRoute("/setup")({
  beforeLoad: ({ context }) => {
    if (context.auth.isAuthenticated && !wizardInProgress) {
      throw redirect({ to: "/" });
    }
  },
  component: SetupPage,
});

type DocLanguage = "en" | "de";

function SetupPage() {
  const auth = useAuth();
  const { t, language } = useI18n();
  const navigate = useNavigate();
  const [step, setStep] = useState(1);
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [docLanguage, setDocLanguage] = useState<DocLanguage>("de");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const copy =
    language === "de"
      ? {
          step1Title: "Archiv einrichten",
          step1Subtitle: "Das Inhaberkonto — es gibt genau eines.",
          step2Title: "Dokumentsprache",
          step2Subtitle:
            "Die Sprache, in der OCR und Extraktion deine Dokumente lesen.",
          step3Title: "Überwachungsordner",
          step3Subtitle:
            "Optional: ein Ordner, den OpenKeep automatisch importiert.",
          step3Body:
            "Der Überwachungsordner wird über die Umgebungsvariable WATCH_FOLDER_PATH des Servers konfiguriert. Ist sie gesetzt, erscheint der Ordner auf der Import-Seite und wird regelmäßig eingelesen.",
          continue: "Weiter",
          skip: "Überspringen",
          done: "Fertig",
          save: "Speichern und weiter",
        }
      : {
          step1Title: "Set up archive",
          step1Subtitle: "The owner account — there is exactly one.",
          step2Title: "Document language",
          step2Subtitle: "The language OCR and extraction read your documents in.",
          step3Title: "Watch folder",
          step3Subtitle: "Optional: a folder OpenKeep imports automatically.",
          step3Body:
            "The watch folder is configured through the server's WATCH_FOLDER_PATH environment variable. Once set, the folder shows up on the Import page and is scanned regularly.",
          continue: "Continue",
          skip: "Skip",
          done: "Done",
          save: "Save and continue",
        };

  async function handleCreateOwner(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (password.length < 12) {
      setError(t("setup.errorPasswordLength"));
      return;
    }
    if (password !== confirmPassword) {
      setError(t("setup.errorPasswordsMatch"));
      return;
    }
    setIsSubmitting(true);
    wizardInProgress = true;
    try {
      await auth.setup(email, password, displayName);
      setStep(2);
    } catch (err) {
      wizardInProgress = false;
      setError(err instanceof Error ? err.message : "Setup failed");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleSaveLanguage() {
    setIsSubmitting(true);
    setError("");
    try {
      await auth.updatePreferences({
        uiLanguage: language,
        aiProcessingLanguage: docLanguage,
        aiChatLanguage: docLanguage,
      });
      setStep(3);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setIsSubmitting(false);
    }
  }

  if (step === 2) {
    return (
      <AuthPanel title={copy.step2Title} subtitle={copy.step2Subtitle} step="2 / 3">
        <div className="flex flex-col gap-3">
          <Select
            value={docLanguage}
            onValueChange={(value) => setDocLanguage(value as DocLanguage)}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="de">Deutsch</SelectItem>
              <SelectItem value="en">English</SelectItem>
            </SelectContent>
          </Select>
          <FieldError>{error}</FieldError>
          <Button className="w-full" disabled={isSubmitting} onClick={handleSaveLanguage}>
            {copy.save}
          </Button>
          <button
            type="button"
            className="text-center text-xs text-muted-foreground hover:underline"
            onClick={() => setStep(3)}
          >
            {copy.skip}
          </button>
        </div>
      </AuthPanel>
    );
  }

  if (step === 3) {
    return (
      <AuthPanel title={copy.step3Title} subtitle={copy.step3Subtitle} step="3 / 3">
        <div className="flex flex-col gap-3">
          <p className="rounded-[var(--r-md)] border bg-[var(--ok-bar)] px-3 py-2.5 text-sm leading-relaxed text-muted-foreground">
            {copy.step3Body.split("WATCH_FOLDER_PATH")[0]}
            <code className="ok-num text-foreground">WATCH_FOLDER_PATH</code>
            {copy.step3Body.split("WATCH_FOLDER_PATH")[1]}
          </p>
          <Button
            className="w-full"
            onClick={() => {
              wizardInProgress = false;
              void navigate({ to: "/" });
            }}
          >
            {copy.done}
          </Button>
        </div>
      </AuthPanel>
    );
  }

  return (
    <AuthPanel
      title={copy.step1Title}
      subtitle={copy.step1Subtitle}
      step="1 / 3"
      footer={
        <span className="text-muted-foreground">
          {t("setup.alreadySetup")}{" "}
          <Link to="/login" className="font-semibold text-[var(--ok-accent)] hover:underline">
            {t("setup.signIn")}
          </Link>
        </span>
      }
    >
      <form onSubmit={handleCreateOwner} className="flex flex-col gap-3">
        <div>
          <Label htmlFor="displayName" className="text-xs text-muted-foreground">
            {t("setup.displayName")}
          </Label>
          <Input
            id="displayName"
            type="text"
            placeholder={t("setup.yourName")}
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            required
            className="mt-1"
          />
        </div>
        <div>
          <Label htmlFor="email" className="text-xs text-muted-foreground">
            {t("setup.email")}
          </Label>
          <Input
            id="email"
            type="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            className="mt-1"
          />
        </div>
        <div>
          <Label htmlFor="password" className="text-xs text-muted-foreground">
            {t("setup.password")}
          </Label>
          <Input
            id="password"
            type="password"
            placeholder={t("setup.passwordMin")}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={12}
            className="mt-1"
          />
        </div>
        <div>
          <Label htmlFor="confirmPassword" className="text-xs text-muted-foreground">
            {t("setup.confirmPassword")}
          </Label>
          <Input
            id="confirmPassword"
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            required
            minLength={12}
            className="mt-1"
          />
          <FieldError>{error}</FieldError>
        </div>
        <Button type="submit" className="mt-1 w-full" disabled={isSubmitting}>
          {isSubmitting ? t("setup.creatingAccount") : copy.continue}
        </Button>
      </form>
    </AuthPanel>
  );
}
