import React, { useState } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { App, TFile } from "obsidian";
import { PdfPageRange } from "@/types/message";
import { getOpenPdfPage, getPdfPageCount } from "@/services/pdfPageContextService";
import { PdfPageRangeControl } from "./PdfPageRangeControl";

jest.mock("@/services/pdfPageContextService", () => ({
  getPdfPageCount: jest.fn(),
  getOpenPdfPage: jest.fn(),
  pdfSourceKey: () => "file-v1",
}));

const app = { vault: {} } as App;
const file = { path: "paper.pdf", name: "paper.pdf" } as TFile;

/** Exercise the same controlled range state used by the composer. */
function Composer() {
  const [range, setRange] = useState<PdfPageRange>();
  return (
    <PdfPageRangeControl
      app={app}
      file={file}
      range={range}
      onChange={(_, next) => setRange(next)}
      onPageCount={() => {}}
    />
  );
}

describe("PDF page range controls", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (getPdfPageCount as jest.Mock).mockResolvedValue(20);
    (getOpenPdfPage as jest.Mock).mockReturnValue(12);
  });

  it("defaults to the reader's neighbours and allows arbitrary inclusive ranges", async () => {
    render(<Composer />);
    const start = (await screen.findByLabelText("paper.pdf start page")) as HTMLInputElement;
    const end = screen.getByLabelText("paper.pdf end page") as HTMLInputElement;
    await waitFor(() => expect(start.value).toBe("11"));
    expect(end.value).toBe("13");
    fireEvent.change(start, { target: { value: "3" } });
    fireEvent.change(end, { target: { value: "9" } });
    expect(screen.getByText(/7 page images/)).toBeTruthy();
    expect(getPdfPageCount).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByText("All pages"));
    expect(start.value).toBe("1");
    expect(end.value).toBe("20");
    fireEvent.click(screen.getByText("Current ±1"));
    expect(start.value).toBe("11");
    expect(end.value).toBe("13");
  });

  it("shows reversed, empty and out-of-bounds range errors", async () => {
    render(<Composer />);
    const start = await screen.findByLabelText("paper.pdf start page");
    fireEvent.change(start, { target: { value: "19" } });
    expect(screen.getByRole("alert").textContent).toContain("From ≤ To");
    fireEvent.change(start, { target: { value: "" } });
    expect(screen.getByRole("alert").textContent).toContain("whole page numbers");
    fireEvent.change(start, { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText("paper.pdf end page"), { target: { value: "21" } });
    expect(screen.getByRole("alert").textContent).toContain("between 1 and 20");
  });

  it("surfaces metadata errors with a retry action", async () => {
    (getPdfPageCount as jest.Mock).mockRejectedValueOnce(new Error("Cannot open encrypted PDF"));
    render(<Composer />);
    expect((await screen.findByRole("alert")).textContent).toContain("encrypted PDF");
    fireEvent.click(screen.getByText("Retry"));
    expect(await screen.findByLabelText("paper.pdf start page")).toBeTruthy();
  });
});
