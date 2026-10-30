import { App, loadPdfJs, TFile, Vault } from "obsidian";
import { getOpenPdfPage, renderPdfPageRange } from "./pdfPageContextService";
import {
  defaultPdfPageRange,
  materializePdfPageImages,
  validatePdfPageRange,
} from "@/utils/pdfPageContext";

jest.mock("obsidian", () => ({ ...jest.requireActual("obsidian"), loadPdfJs: jest.fn() }));
jest.mock("@/logger", () => ({ logWarn: jest.fn() }));

describe("PDF page context", () => {
  let file: TFile;
  let vault: Vault;
  let pdf: any;
  let cached: Map<string, ArrayBuffer>;

  beforeEach(() => {
    file = {
      path: "papers/article.pdf",
      name: "article.pdf",
      stat: { size: 123, mtime: 1 },
    } as TFile;
    cached = new Map();
    const dirs = new Set<string>();
    vault = {
      readBinary: jest.fn().mockResolvedValue(new ArrayBuffer(8)),
      adapter: {
        exists: jest.fn(async (path: string) => dirs.has(path) || cached.has(path)),
        mkdir: jest.fn(async (path: string) => {
          dirs.add(path);
        }),
        writeBinary: jest.fn(async (path: string, bytes: ArrayBuffer) => {
          cached.set(path, bytes);
        }),
        readBinary: jest.fn(async (path: string) => cached.get(path)),
      },
    } as unknown as Vault;
    pdf = {
      numPages: 20,
      getPage: jest.fn().mockImplementation(async () => ({
        getViewport: ({ scale }: { scale: number }) => ({
          width: 600 * scale,
          height: 800 * scale,
        }),
        render: jest.fn().mockReturnValue({ promise: Promise.resolve() }),
        cleanup: jest.fn(),
      })),
      destroy: jest.fn().mockResolvedValue(undefined),
    };
    (loadPdfJs as jest.Mock).mockResolvedValue({
      getDocument: () => ({ promise: Promise.resolve(pdf) }),
    });
    jest
      .spyOn(HTMLCanvasElement.prototype, "getContext")
      .mockReturnValue({} as CanvasRenderingContext2D);
    jest
      .spyOn(HTMLCanvasElement.prototype, "toDataURL")
      .mockReturnValue("data:image/jpeg;base64,cGFnZQ==");
  });

  afterEach(() => jest.restoreAllMocks());

  it("renders exactly the selected inclusive range and reuses overlapping pages", async () => {
    const first = await renderPdfPageRange(vault, file, { startPage: 10, endPage: 12 });
    expect(first.map((image) => image.pdfPage.page)).toEqual([10, 11, 12]);
    const second = await renderPdfPageRange(vault, file, { startPage: 11, endPage: 13 });
    expect(pdf.getPage.mock.calls.map(([page]: number[]) => page)).toEqual([10, 11, 12, 13]);
    expect(second.map((image) => image.pdfPage.page)).toEqual([11, 12, 13]);
    expect(second[0].image_url).toEqual(first[1].image_url);
    expect(cached.size).toBe(4);
    expect(pdf.destroy).toHaveBeenCalledTimes(2);
  });

  it("invalidates page images when the document changes", async () => {
    await renderPdfPageRange(vault, file, { startPage: 1, endPage: 1 });
    file.stat.mtime++;
    await renderPdfPageRange(vault, file, { startPage: 1, endPage: 1 });
    expect(pdf.getPage).toHaveBeenCalledTimes(2);
  });

  it.each([
    { startPage: 0, endPage: 1 },
    { startPage: 3, endPage: 2 },
    { startPage: 1, endPage: 21 },
    { startPage: 1.5, endPage: 2 },
    { startPage: NaN, endPage: 2 },
  ])("rejects invalid ranges before rendering: %j", async (range) => {
    await expect(renderPdfPageRange(vault, file, range)).rejects.toThrow(
      "Choose whole page numbers"
    );
    expect(pdf.getPage).not.toHaveBeenCalled();
    expect(pdf.destroy).toHaveBeenCalled();
  });

  it("keeps valid images usable when writing the cache fails", async () => {
    (vault.adapter.writeBinary as jest.Mock).mockRejectedValue(new Error("disk full"));
    const images = await renderPdfPageRange(vault, file, { startPage: 2, endPage: 2 });
    expect(images[0].image_url.url).toContain("data:image/jpeg;base64,");
  });

  it("cleans up and fails instead of sending a partial range on a rendering error", async () => {
    pdf.getPage.mockRejectedValueOnce(new Error("broken page"));
    await expect(renderPdfPageRange(vault, file, { startPage: 1, endPage: 3 })).rejects.toThrow(
      "broken page"
    );
    expect(pdf.destroy).toHaveBeenCalled();
  });

  it("labels pages and strips local metadata from the API content", async () => {
    const images = await renderPdfPageRange(vault, file, { startPage: 7, endPage: 8 });
    const payload = materializePdfPageImages(images);
    expect(payload.map((part) => part.type)).toEqual(["text", "image_url", "text", "image_url"]);
    expect(payload[0]).toEqual({
      type: "text",
      text: 'PDF page: "papers/article.pdf", physical page 7.',
    });
    expect(payload[1]).toEqual({ type: "image_url", image_url: images[0].image_url });
    expect(JSON.stringify(payload)).not.toContain('"pdfPage"');
    expect(JSON.stringify(payload)).not.toContain("application/pdf");
  });

  it("uses the matching reader position and clamps neighbours at document boundaries", () => {
    const app = {
      workspace: {
        getLeavesOfType: () => [
          { view: { file: { path: "other.pdf" } } },
          {
            view: {
              file,
              viewer: { child: { pdfViewer: { pdfViewer: { currentPageNumber: 12 } } } },
            },
          },
        ],
      },
    } as unknown as App;
    expect(getOpenPdfPage(app, file)).toBe(12);
    expect(defaultPdfPageRange(12, 20)).toEqual({ startPage: 11, endPage: 13 });
    expect(defaultPdfPageRange(1, 1)).toEqual({ startPage: 1, endPage: 1 });
    expect(defaultPdfPageRange(20, 20)).toEqual({ startPage: 19, endPage: 20 });
    expect(() => validatePdfPageRange({ startPage: 1, endPage: 20 }, 20)).not.toThrow();
  });
});
