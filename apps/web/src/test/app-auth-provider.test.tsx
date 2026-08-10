import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { App } from "@/app";

describe("App auth provider", () => {
  it("renders through an injected auth provider", () => {
    function HostAuthProvider({
      children: _children,
    }: {
      children: ReactNode;
    }) {
      return <div>Host-owned authentication</div>;
    }

    render(<App AuthProvider={HostAuthProvider} />);

    expect(screen.getByText("Host-owned authentication")).toBeInTheDocument();
  });
});
