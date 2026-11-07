import { useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { EmptyState, Screen } from "../components/ui";
import { useI18n } from "../i18n";
import { createThemedStyles, radii } from "../theme";
import { text } from "../typography";
import { ArchiveSection } from "./settings/ArchiveSection";
import { DeviceSection } from "./settings/DeviceSection";
import { HealthSection } from "./settings/HealthSection";
import { LanguageSection } from "./settings/LanguageSection";
import { ProcessingSection } from "./settings/ProcessingSection";
import { ProvidersSection } from "./settings/ProvidersSection";
import { SettingsHeading, useIsOffline } from "./settings/shared";
import { TaxonomySection } from "./settings/TaxonomySection";

type Destination = "general" | "taxonomy" | "providers";

/**
 * The web's settings shell at phone width: a page heading, a row of pills and one
 * destination below. What a phone adds to the web's General page is its own
 * appearance and offline copy, which keep working without a connection; everything
 * that asks the server gives way to a calm note when the server is out of reach.
 */
export function SettingsScreen() {
  const styles = useStyles();
  const { t } = useI18n();
  const offline = useIsOffline();
  const [destination, setDestination] = useState<Destination>("general");

  // No icons in the pills: the web drops them at phone width too, so all three fit.
  const items: Array<{ value: Destination; label: string }> = [
    { value: "general", label: t("settingsNav.general") },
    { value: "taxonomy", label: t("settingsNav.taxonomy") },
    { value: "providers", label: t("settingsNav.providers") },
  ];

  const header = (
    <View>
      <View style={styles.pageHeading}>
        <Text style={styles.pageTitle} accessibilityRole="header">
          {t("settings.title")}
        </Text>
        <Text style={styles.pageSubtitle}>{t("settings.subtitle")}</Text>
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.nav}
        accessibilityRole="tablist"
      >
        {items.map((item) => {
          const active = item.value === destination;
          return (
            <Pressable
              key={item.value}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              onPress={() => setDestination(item.value)}
              style={[styles.navItem, active ? styles.navItemActive : null]}
            >
              <Text style={[styles.navText, active ? styles.navTextActive : null]}>{item.label}</Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );

  // The one list that can run to a thousand rows, so it owns the scrolling.
  if (destination === "taxonomy" && !offline) {
    return (
      <Screen
        title={t("settings.title")}
        hideHeader
        scroll={false}
        padded={false}
        contentContainerStyle={styles.flush}
      >
        <TaxonomySection header={header} />
      </Screen>
    );
  }

  return (
    <Screen title={t("settings.title")} hideHeader padded={false}>
      {header}
      <View style={styles.body}>
        {destination === "general" ? (
          <>
            <SettingsHeading
              title={t("settingsNav.general")}
              description={t("settingsNav.generalDescription")}
            />
            <LanguageSection />
            <DeviceSection />
            {offline ? (
              <EmptyState
                icon="cloud-off-outline"
                title={t("settings.onlineOnlyTitle")}
                body={t("settings.onlineOnlyBody")}
              />
            ) : (
              <>
                <HealthSection />
                <ProcessingSection />
                <ArchiveSection />
              </>
            )}
          </>
        ) : destination === "taxonomy" ? (
          <>
            <SettingsHeading
              title={t("settingsNav.taxonomy")}
              description={t("settingsNav.taxonomyDescription")}
            />
            <EmptyState
              icon="cloud-off-outline"
              title={t("taxonomy.onlineOnly")}
              body={t("taxonomy.onlineOnlyBody")}
            />
          </>
        ) : (
          <>
            <SettingsHeading
              title={t("settingsNav.providers")}
              description={t("settingsNav.providersDescription")}
            />
            {offline ? (
              <EmptyState
                icon="cloud-off-outline"
                title={t("providers.onlineOnly")}
                body={t("providers.onlineOnlyBody")}
              />
            ) : (
              <ProvidersSection />
            )}
          </>
        )}
      </View>
    </Screen>
  );
}

const useStyles = createThemedStyles((c) => ({
  flush: {
    paddingBottom: 0,
  },
  pageHeading: {
    paddingHorizontal: 16,
    paddingTop: 20,
    paddingBottom: 12,
  },
  pageTitle: {
    ...text.screenTitle,
    color: c.ink,
  },
  pageSubtitle: {
    ...text.body,
    marginTop: 2,
    color: c.muted,
  },
  nav: {
    flexDirection: "row",
    gap: 4,
    paddingHorizontal: 16,
  },
  navItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    minHeight: 44,
    paddingHorizontal: 12,
    borderRadius: radii.lg,
  },
  navItemActive: {
    backgroundColor: c.accentSoft,
  },
  navText: {
    ...text.body,
    color: c.muted,
  },
  navTextActive: {
    ...text.bodyStrong,
    color: c.accentSoftInk,
  },
  body: {
    gap: 16,
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 12,
  },
}));
