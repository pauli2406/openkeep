import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";
import {
  ArchiveSwitcher,
  type ArchiveSwitcherProfile,
} from "./archive-switcher";

const profiles: ArchiveSwitcherProfile[] = [
  {
    id: "home",
    label: "Paper room",
    serverUrl: "https://home.example.com",
  },
  {
    id: "office",
    label: "Paper room",
    serverUrl: "https://office.example.com",
  },
];

function renderSwitcher(
  overrides: Partial<ComponentProps<typeof ArchiveSwitcher>> = {},
) {
  const props: ComponentProps<typeof ArchiveSwitcher> = {
    profiles,
    activeProfileId: "home",
    onActivate: vi.fn(),
    onAdd: vi.fn(),
    onEdit: vi.fn(),
    onRemove: vi.fn(),
    ...overrides,
  };

  return { ...render(<ArchiveSwitcher {...props} />), props };
}

describe("archive switcher", () => {
  it("shows the active archive and distinguishes duplicate labels by URL", async () => {
    const user = userEvent.setup();
    renderSwitcher();

    const trigger = screen.getByRole("button", {
      name: /active archive paper room/i,
    });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    await user.click(trigger);

    const menu = screen.getByRole("menu", { name: "Archive profiles" });
    expect(
      within(menu).getByText("https://home.example.com"),
    ).toBeInTheDocument();
    expect(
      within(menu).getByText("https://office.example.com"),
    ).toBeInTheDocument();
    expect(
      within(menu).getByRole("menuitem", {
        name: "Paper room (https://home.example.com), active",
      }),
    ).toHaveAttribute("aria-current", "true");
  });

  it("switches archives and supports keyboard menu navigation", async () => {
    const user = userEvent.setup();
    const onActivate = vi.fn();
    renderSwitcher({ onActivate });

    const trigger = screen.getByRole("button", {
      name: /active archive paper room/i,
    });
    trigger.focus();
    await user.keyboard("{ArrowDown}");
    const office = screen.getByRole("menuitem", {
      name: "Switch to Paper room (https://office.example.com)",
    });
    expect(screen.getByRole("menu")).toBeInTheDocument();

    await user.click(office);
    expect(onActivate).toHaveBeenCalledWith("office");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("starts add and edit actions with the exact profile", async () => {
    const user = userEvent.setup();
    const onAdd = vi.fn();
    const onEdit = vi.fn();
    renderSwitcher({ onAdd, onEdit });

    await user.click(
      screen.getByRole("button", { name: /active archive paper room/i }),
    );
    await user.click(
      screen.getByRole("menuitem", {
        name: "Edit Paper room (https://office.example.com)",
      }),
    );
    expect(onEdit).toHaveBeenCalledWith(profiles[1]);

    await user.click(
      screen.getByRole("button", { name: /active archive paper room/i }),
    );
    await user.click(
      screen.getByRole("menuitem", { name: "Add another archive" }),
    );
    expect(onAdd).toHaveBeenCalledOnce();
  });

  it("requires explicit confirmation before removing a saved archive", async () => {
    const user = userEvent.setup();
    const onRemove = vi.fn();
    renderSwitcher({ onRemove });

    await user.click(
      screen.getByRole("button", { name: /active archive paper room/i }),
    );
    await user.click(
      screen.getByRole("menuitem", {
        name: "Remove Paper room (https://office.example.com)",
      }),
    );

    const dialog = screen.getByRole("alertdialog", {
      name: "Remove Paper room?",
    });
    expect(dialog).toHaveTextContent(
      "The remote archive and every document stored there remain untouched.",
    );
    expect(onRemove).not.toHaveBeenCalled();

    await user.click(
      within(dialog).getByRole("button", { name: "Keep archive" }),
    );
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(onRemove).not.toHaveBeenCalled();

    await user.click(
      screen.getByRole("button", { name: /active archive paper room/i }),
    );
    await user.click(
      screen.getByRole("menuitem", {
        name: "Remove Paper room (https://office.example.com)",
      }),
    );
    await user.click(
      screen.getByRole("button", { name: "Remove saved archive" }),
    );
    expect(onRemove).toHaveBeenCalledWith(profiles[1]);
  });
});
