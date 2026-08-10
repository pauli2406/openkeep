import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { DesktopBridge } from "../shared/desktop-api";
import { ConnectionScreen } from "./connection-screen";

function createBridge(
  result: Awaited<ReturnType<DesktopBridge["connection"]["checkHealth"]>>,
): DesktopBridge {
  return {
    connection: { checkHealth: vi.fn(async () => result) },
    runtime: {
      getInfo: vi.fn(async () => ({ platform: "darwin" as const, version: "0.1.0" })),
    },
  };
}

describe("desktop connection screen", () => {
  it("opens the shared application after a successful archive check", async () => {
    const onConnected = vi.fn();
    const bridge = createBridge({
      ok: true,
      serverUrl: "https://archive.example.com",
      serverStatus: "ok",
    });
    const user = userEvent.setup();
    render(<ConnectionScreen bridge={bridge} onConnected={onConnected} />);

    const input = screen.getByLabelText("Archive address");
    await user.clear(input);
    await user.type(input, "https://archive.example.com");
    await user.click(screen.getByRole("button", { name: /check and open/i }));

    expect(bridge.connection.checkHealth).toHaveBeenCalledWith({
      serverUrl: "https://archive.example.com",
    });
    expect(onConnected).toHaveBeenCalledOnce();
    expect(await screen.findByText("Desktop 0.1.0 · darwin")).toBeInTheDocument();
  });

  it("shows a sanitized connection failure", async () => {
    const bridge = createBridge({
      ok: false,
      code: "unreachable",
      message: "Could not reach the OpenKeep server.",
    });
    const user = userEvent.setup();
    render(<ConnectionScreen bridge={bridge} onConnected={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: /check and open/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Could not reach the OpenKeep server.",
    );
  });
});
