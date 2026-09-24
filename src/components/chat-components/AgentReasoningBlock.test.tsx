import React from "react";
import { render, screen } from "@testing-library/react";
import { AgentReasoningBlock } from "@/components/chat-components/AgentReasoningBlock";

// Mock the Collapsible components from Radix UI so we can assert the `open`
// prop passed down without depending on Radix internals.
jest.mock("@/components/ui/collapsible", () => ({
  Collapsible: ({ children, open }: { children: React.ReactNode; open: boolean }) => (
    <div data-testid="collapsible" data-open={String(open)}>
      {children}
    </div>
  ),
  CollapsibleContent: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="collapsible-content">{children}</div>
  ),
  CollapsibleTrigger: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="collapsible-trigger">{children}</div>
  ),
}));

jest.mock("lucide-react", () => ({
  ChevronRight: () => <div data-testid="chevron-icon">ChevronRight</div>,
}));

describe("AgentReasoningBlock", () => {
  it("is collapsed by default while reasoning", () => {
    render(
      <AgentReasoningBlock
        status="reasoning"
        elapsedSeconds={5}
        steps={["step one"]}
        isStreaming={true}
      />
    );

    const collapsible = screen.getByTestId("collapsible");
    expect(collapsible.getAttribute("data-open")).toBe("false");
    // Header stays visible with the active indicator and timer.
    expect(screen.getByText("Reasoning")).toBeTruthy();
    expect(screen.getByText("5s")).toBeTruthy();
  });

  it("is collapsed by default after reasoning completes", () => {
    render(
      <AgentReasoningBlock
        status="complete"
        elapsedSeconds={12}
        steps={["step one", "step two"]}
        isStreaming={false}
      />
    );

    const collapsible = screen.getByTestId("collapsible");
    expect(collapsible.getAttribute("data-open")).toBe("false");
    expect(screen.getByText("Thought for")).toBeTruthy();
  });

  it("renders nothing when idle", () => {
    const { container } = render(
      <AgentReasoningBlock status="idle" elapsedSeconds={0} steps={[]} isStreaming={false} />
    );

    expect(container.querySelector('[data-testid="collapsible"]')).toBeNull();
  });
});
