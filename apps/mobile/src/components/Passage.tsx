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
  options?: {
    /**
     * Match on the opening words when the whole needle is not on one line. A
     * chat quote spans lines and wants this; a review field does not — a 40
     * character prefix of a title matching some other line would point the
     * evidence at the wrong place.
     */
    allowPrefix?: boolean;
    /** Look here first. Headers and footers repeat across pages. */
    page?: number | null;
  },
): Passage | null {
  if (!blocks || blocks.length === 0) {
    return null;
  }

  const squash = (value: string) => value.replace(/[^0-9a-zA-Z]/g, "").toLowerCase();
  const target = needle ? squash(needle) : "";
  if (target.length < 3) {
    return null;
  }

  const probes = options?.allowPrefix
    ? [target, target.slice(0, 40), target.slice(0, 20)]
    : [target];
  const page = options?.page ?? null;

  const locate = (restrictToPage: boolean) => {
    for (const probe of probes) {
      if (probe.length < 3) continue;
      const found = blocks.findIndex(
        (block) =>
          (!restrictToPage || block.page === page) && squash(block.text).includes(probe),
      );
      if (found !== -1) return found;
    }
    return -1;
  };

  let index = page === null ? locate(false) : locate(true);
  if (index === -1 && page !== null) {
    index = locate(false);
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
