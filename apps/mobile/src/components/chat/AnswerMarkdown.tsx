import { useMemo } from "react";
import { Linking, Text, View } from "react-native";
import Markdown, { type RenderRules } from "react-native-markdown-display";
import { linkifyCitations, type AnswerCitation } from "../../lib";
import { createThemedStyles, radii } from "../../theme";
import { fonts, text as type } from "../../typography";
import { citationForHref } from "./conversations";

/**
 * A rendered answer. `[1]` markers become inline citations: a small soft button
 * in the sentence that opens the passage. It is a nested `Text`, because a `View`
 * inside a sentence wraps badly on both platforms; the non-breaking spaces are its
 * padding, since nested text takes neither padding nor, on Android, a radius.
 */
export function AnswerMarkdown({
  text,
  citations,
  onCitationSelect,
}: {
  text: string;
  citations: AnswerCitation[];
  onCitationSelect?: (citation: AnswerCitation) => void;
}) {
  const markdownStyles = useMarkdownStyles();
  const styles = useStyles();

  const rules = useMemo<RenderRules>(
    () => ({
      link: (node, children) => {
        const href = String(node.attributes.href ?? "");
        const citation = citationForHref(href, citations);
        if (citation) {
          const marker = citation.index ?? citations.indexOf(citation) + 1;
          return (
            <Text
              key={node.key}
              accessibilityRole="button"
              accessibilityLabel={`${marker} · ${citation.documentTitle}`}
              onPress={() => onCitationSelect?.(citation)}
              style={styles.marker}
            >
              {` ${marker} `}
            </Text>
          );
        }
        // A document link with no citation behind it leads nowhere on a phone,
        // and an answer is built from document text, so only a plain web link is
        // handed to the OS.
        const external = /^https?:\/\//i.test(href);
        return (
          <Text
            key={node.key}
            accessibilityRole={external ? "link" : undefined}
            onPress={external ? () => void Linking.openURL(href) : undefined}
            style={external ? styles.link : null}
          >
            {children}
          </Text>
        );
      },
    }),
    [citations, onCitationSelect, styles],
  );

  return (
    <View style={styles.root}>
      <Markdown style={markdownStyles} rules={rules}>
        {linkifyCitations(text, citations, [])}
      </Markdown>
    </View>
  );
}

const useStyles = createThemedStyles((c) => ({
  root: {
    minWidth: 0,
  },
  marker: {
    ...type.numericStrong,
    fontSize: 11,
    color: c.accentSoftInk,
    backgroundColor: c.accentSoft,
    borderRadius: radii.sm,
  },
  link: {
    color: c.accent,
    textDecorationLine: "underline",
  },
}));

const useMarkdownStyles = createThemedStyles((c) => ({
  body: {
    ...type.body,
    color: c.ink,
    lineHeight: 22,
  },
  heading1: {
    ...type.barTitle,
    color: c.ink,
    marginTop: 12,
    marginBottom: 6,
  },
  heading2: {
    ...type.bodyStrong,
    color: c.ink,
    marginTop: 10,
    marginBottom: 5,
  },
  heading3: {
    ...type.bodyStrong,
    color: c.ink,
    marginTop: 8,
    marginBottom: 4,
  },
  strong: {
    fontFamily: fonts.sans.semibold,
    color: c.ink,
  },
  em: {
    // Android will not synthesise an italic for a named face, so name the face.
    fontFamily: fonts.sans.regular,
  },
  paragraph: {
    marginTop: 0,
    marginBottom: 8,
  },
  bullet_list: {
    marginTop: 0,
    marginBottom: 8,
  },
  ordered_list: {
    marginTop: 0,
    marginBottom: 8,
  },
  list_item: {
    marginBottom: 4,
    flexDirection: "row",
  },
  code_inline: {
    ...type.mono,
    color: c.ink,
    backgroundColor: c.raised,
    borderRadius: radii.sm,
  },
  fence: {
    ...type.mono,
    color: c.ink,
    backgroundColor: c.raised,
    borderColor: c.border,
    borderRadius: radii.lg,
    padding: 12,
    marginVertical: 8,
  },
  blockquote: {
    backgroundColor: c.raised,
    borderLeftWidth: 3,
    borderLeftColor: c.accent,
    paddingLeft: 12,
    paddingVertical: 8,
    marginVertical: 8,
    borderRadius: radii.sm,
  },
  table: {
    borderWidth: 1,
    borderColor: c.border,
    borderRadius: radii.lg,
    marginVertical: 8,
  },
  thead: {
    backgroundColor: c.bar,
  },
  th: {
    ...type.metaStrong,
    padding: 8,
    color: c.ink,
    borderColor: c.border,
  },
  td: {
    ...type.meta,
    padding: 8,
    color: c.ink,
    borderColor: c.border,
  },
  tr: {
    borderBottomWidth: 1,
    borderColor: c.border,
  },
}));
