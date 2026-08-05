import { Text, View } from "react-native";
import { createThemedStyles, radii } from "../theme";
import { text } from "../typography";
import type { DocumentTextResponse } from "../lib";

export type Passage = {
  page: number;
  lines: Array<{ text: string; hit: boolean }>;
};

/**
 * Where a value or a quote appears in the recognised text. Blocks carry `page`
 * and `lineIndex`, so a match yields a real page number for a chip or a jump.
 *
 * Extracted in #122 so the review reader, the document tab and a chat citation
 * all highlight a passage the same way instead of three ways.
 */
export function findPassage(
  blocks: DocumentTextResponse["blocks"] | undefined,
  needle: string | null,
): Passage | null {
  if (!blocks || blocks.length === 0) {
    return null;
  }

  const squash = (value: string) => value.replace(/[^0-9a-zA-Z]/g, "").toLowerCase();
  const target = needle ? squash(needle) : "";
  if (target.length < 3) {
    return null;
  }

  // A quote can be longer than one OCR line, so fall back to its opening words.
  const probes = [target, target.slice(0, 40), target.slice(0, 20)];
  let index = -1;
  for (const probe of probes) {
    if (probe.length < 3) continue;
    index = blocks.findIndex((block) => squash(block.text).includes(probe));
    if (index !== -1) break;
  }
  if (index === -1) {
    return null;
  }

  const from = Math.max(0, index - 1);
  const to = Math.min(blocks.length, index + 2);
  return {
    page: blocks[index].page,
    lines: blocks.slice(from, to).map((block, offset) => ({
      text: block.text,
      hit: from + offset === index,
    })),
  };
}

export function firstLines(
  blocks: DocumentTextResponse["blocks"] | undefined,
  count: number,
): Passage | null {
  if (!blocks || blocks.length === 0) {
    return null;
  }
  return {
    page: blocks[0].page,
    lines: blocks.slice(0, count).map((block) => ({ text: block.text, hit: false })),
  };
}

/** The passage on a paper surface, the matching line highlighted amber. */
export function PassagePaper({ passage, compact }: { passage: Passage; compact?: boolean }) {
  const styles = useStyles();
  return (
    <View style={[styles.paper, compact ? styles.paperCompact : null]}>
      {passage.lines.map((line, index) => (
        <View key={`${index}-${line.text.slice(0, 12)}`} style={line.hit ? styles.hitLine : null}>
          <Text
            style={[styles.paperText, line.hit ? styles.paperTextHit : null]}
            numberOfLines={compact ? 2 : undefined}
          >
            {line.text}
          </Text>
        </View>
      ))}
    </View>
  );
}

const useStyles = createThemedStyles((c) => ({
  paper: {
    alignSelf: "stretch",
    backgroundColor: c.paper,
    borderWidth: 1,
    borderColor: c.paperBorder,
    borderRadius: radii.sm,
    padding: 13,
    gap: 4,
  },
  paperCompact: {
    maxWidth: 300,
    alignSelf: "center",
  },
  paperText: {
    ...text.small,
    color: c.paperInk,
  },
  paperTextHit: {
    color: c.highlightRule,
  },
  hitLine: {
    backgroundColor: c.highlight,
    borderLeftWidth: 2,
    borderLeftColor: c.highlightRule,
    paddingHorizontal: 5,
    paddingVertical: 4,
    marginVertical: 3,
    borderRadius: 2,
  },
}));
