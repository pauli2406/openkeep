import { palettes } from "@openkeep/tokens";
import { fireEvent } from "@testing-library/react-native";
import { ScrollView, Text } from "react-native";
import { Button, EmptyState, Notice, Pill, Row, Screen, SectionHeader } from "../components/ui";
import { fonts } from "../typography";
import { DENSITY_SCALE, type Density, type ThemeName } from "../theme";
import { renderThemed, styleOf } from "./render";

const THEMES: ThemeName[] = ["light", "dark"];
const DENSITIES: Density[] = ["standard", "compact"];

/**
 * These are not screenshots. What they assert is that the primitives resolve to
 * the tokens and faces they are supposed to — the level at which this redesign
 * actually went wrong — and that no density setting can shrink a tap target
 * below the 44pt floor the tickets set.
 */
describe("Row", () => {
  it.each(THEMES)("draws its title in the %s palette's ink", async (theme) => {
    const view = await renderThemed(<Row title="Stadtwerke invoice" />, { theme });
    expect(styleOf(view.getByText("Stadtwerke invoice")).color).toBe(palettes[theme].ink);
  });

  it.each(THEMES)("draws its meta line dimmer than its title in %s", async (theme) => {
    const view = await renderThemed(<Row title="Stadtwerke invoice" meta="Stadtwerke München" />, { theme });
    expect(styleOf(view.getByText("Stadtwerke München")).color).toBe(palettes[theme].dim);
  });

  it("sets the title in a sans face and the value in a mono one", async () => {
    const view = await renderThemed(<Row title="Stadtwerke invoice" value="84,50 €" />);
    expect(styleOf(view.getByText("Stadtwerke invoice")).fontFamily).toBe(fonts.sans.medium);
    expect(styleOf(view.getByText("84,50 €")).fontFamily).toBe(fonts.mono.semibold);
  });

  it("truncates a long value instead of pushing the label off screen", async () => {
    // The regression: a self-hosted archive URL in a settings row.
    const url = "https://archive.a-rather-long-self-hosted-hostname.example.com/openkeep";
    const view = await renderThemed(<Row title="Server" value={url} />);
    const value = view.getByText(url);
    expect(value.props.numberOfLines).toBe(1);
    // The cap is on the value column, so the title keeps its half of the row.
    expect(styleOf(value.parent!).maxWidth).toBe("55%");
  });

  describe.each(DENSITIES)("at %s density", (density) => {
    it("keeps a pressable row at or above 44pt", async () => {
      // 50pt scaled by the compact factor is 43pt, which is where this broke.
      const view = await renderThemed(<Row title="Appearance" minHeight={50} onPress={() => {}} />, {
        density,
      });
      const row = view.getByRole("button");
      expect(Number(styleOf(row).minHeight)).toBeGreaterThanOrEqual(44);
    });

    it("still scales a static row", async () => {
      const view = await renderThemed(<Row title="Type" value="application/pdf" minHeight={50} />, { density });
      const row = view.getByText("Type").parent?.parent;
      expect(Number(styleOf(row!).minHeight)).toBe(Math.round(50 * DENSITY_SCALE[density]));
    });
  });

  it("enters selection on a long press", async () => {
    const onLongPress = jest.fn();
    const view = await renderThemed(
      <Row title="Invoice" onPress={() => {}} onLongPress={onLongPress} />,
    );
    fireEvent(view.getByRole("button"), "longPress");
    expect(onLongPress).toHaveBeenCalled();
  });
});

describe("Button", () => {
  it.each(["primary", "secondary", "danger"] as const)(
    "keeps the shared semibold face in the %s variant",
    async (variant) => {
      // The variant styles used to set `fontFamily` after the base style, which
      // silently rendered every label in the regular face.
      const view = await renderThemed(<Button label="Confirm" variant={variant} onPress={() => {}} />);
      expect(styleOf(view.getByText("Confirm")).fontFamily).toBe(fonts.sans.semibold);
    },
  );

  it("meets the tap-target floor", async () => {
    const view = await renderThemed(<Button label="Confirm" onPress={() => {}} />);
    expect(Number(styleOf(view.getByRole("button")).height)).toBeGreaterThanOrEqual(44);
  });

  it("makes up the difference with slop at the small size", async () => {
    // 38pt is what the design draws; the target still has to reach 44.
    const view = await renderThemed(<Button label="Mark done" size="sm" onPress={() => {}} />);
    const button = view.getByRole("button");
    const height = Number(styleOf(button).height);
    const slop = button.props.hitSlop as { top: number; bottom: number };
    expect(height + slop.top + slop.bottom).toBeGreaterThanOrEqual(44);
  });

  it("keeps its label while loading and says it is busy", async () => {
    const onPress = jest.fn();
    const view = await renderThemed(<Button label="Confirm" loading onPress={onPress} />);
    // The label stays beside the spinner, so the button does not change width
    // mid-request; what changes is that it no longer accepts a press.
    expect(view.getByText("Confirm")).toBeTruthy();
    const button = view.getByRole("button");
    expect(button.props.accessibilityState).toMatchObject({ disabled: true, busy: true });
    fireEvent.press(button);
    expect(onPress).not.toHaveBeenCalled();
  });
});

describe("Screen", () => {
  it("renders its footer outside the scroll area", async () => {
    // A bulk action bar appended to the scroll content ends up below the fold.
    const view = await renderThemed(
      <Screen title="Documents" footer={<Text>Delete</Text>}>
        <Text>Row</Text>
      </Screen>,
    );
    const ancestors: unknown[] = [];
    for (let node = view.getByText("Delete").parent; node; node = node.parent) {
      ancestors.push(node.type);
    }
    expect(ancestors).not.toContain(ScrollView);
    expect(ancestors.some((type) => String(type).includes("ScrollView"))).toBe(false);
  });

  it.each(THEMES)("draws the bar title in the %s palette", async (theme) => {
    const view = await renderThemed(
      <Screen title="Documents">
        <Text>Row</Text>
      </Screen>,
      { theme },
    );
    expect(styleOf(view.getByText("Documents")).color).toBe(palettes[theme].ink);
  });
});

describe("state components", () => {
  it.each(THEMES)("tints a warning notice from the %s palette", async (theme) => {
    const view = await renderThemed(<Notice label="Offline — read-only" tone="warn" />, { theme });
    expect(styleOf(view.getByText("Offline — read-only")).color).toBe(palettes[theme].amber);
  });

  it("offers the empty state's action as a button", async () => {
    const onAction = jest.fn();
    const view = await renderThemed(
      <EmptyState title="Nothing here" body="Import a document" action="Show all" onAction={onAction} />,
    );
    expect(view.getByText("Show all")).toBeTruthy();
  });

  it("renders a section header with its count", async () => {
    const view = await renderThemed(<SectionHeader label="Overdue" count={3} />);
    expect(view.getByText("Overdue")).toBeTruthy();
    expect(view.getByText("3")).toBeTruthy();
  });

  it.each(THEMES)("gives a bad pill the %s palette's red ink", async (theme) => {
    const view = await renderThemed(<Pill label="failed" tone="bad" />, { theme });
    expect(styleOf(view.getByText("failed")).color).toBe(palettes[theme].red);
  });
});
