import { MD5 } from "crypto-js";
import { App, loadPdfJs, TFile, Vault } from "obsidian";
import { logWarn } from "@/logger";
import { PdfPageRange } from "@/types/message";
import { arrayBufferToBase64 } from "@/utils/base64";
import { PdfPageImage, validatePdfPageRange } from "@/utils/pdfPageContext";

// The render profile is part of every key: changing quality invalidates old images.
const RENDER_PROFILE = "v1-jpeg-2000-0.9";
const CACHE_DIR = ".copilot/pdf-page-cache";

/** Minimal PDF.js surface used by the renderer (provided by Obsidian). */
interface PdfDocument {
  numPages: number;
  getPage(page: number): Promise<{
    getViewport(options: { scale: number }): { width: number; height: number };
    render(options: object): { promise: Promise<void> };
    cleanup(): void;
  }>;
  destroy(): Promise<void>;
}

/** Version a local PDF by its path and filesystem metadata. */
export function pdfSourceKey(file: TFile): string {
  return MD5(`${file.path}:${file.stat.size}:${file.stat.mtime}`).toString();
}

/** Open vault bytes locally; no file or page is uploaded by this service. */
async function openPdf(vault: Vault, file: TFile): Promise<PdfDocument> {
  const pdfjs = await loadPdfJs();
  const bytes = await vault.readBinary(file);
  return pdfjs.getDocument({ data: new Uint8Array(bytes), isEvalSupported: false }).promise;
}

/** Read the page count and release the PDF.js document immediately. */
export async function getPdfPageCount(vault: Vault, file: TFile): Promise<number> {
  const pdf = await openPdf(vault, file);
  try {
    return pdf.numPages;
  } finally {
    await pdf.destroy();
  }
}

/** Read the matching open reader's position, retaining a safe first-page fallback. */
export function getOpenPdfPage(app: App, file: TFile): number {
  const recentLeaf = app.workspace.getMostRecentLeaf?.();
  const leaves = [
    ...new Set([...(recentLeaf ? [recentLeaf] : []), ...app.workspace.getLeavesOfType("pdf")]),
  ];
  for (const leaf of leaves) {
    // Reader internals are optional and isolated here; manual range selection
    // continues to work if Obsidian changes this undocumented surface.
    const view = leaf.view as typeof leaf.view & {
      file?: TFile;
      viewer?: { child?: { pdfViewer?: { pdfViewer?: { currentPageNumber?: number } } } };
    };
    if (view.file?.path !== file.path) continue;
    const page =
      view.viewer?.child?.pdfViewer?.pdfViewer?.currentPageNumber ?? view.getState().page;
    if (Number.isSafeInteger(page) && page > 0) return page;
  }
  return 1;
}

/** Cache one image per physical page so overlapping ranges reuse rendered pages. */
export async function renderPdfPageRange(
  vault: Vault,
  file: TFile,
  range: PdfPageRange,
  onProgress?: (message: string) => void
): Promise<PdfPageImage[]> {
  const sourceKey = pdfSourceKey(file);
  const pdf = await openPdf(vault, file);
  const images: PdfPageImage[] = [];
  try {
    validatePdfPageRange(range, pdf.numPages);
    for (let pageNumber = range.startPage; pageNumber <= range.endPage; pageNumber++) {
      onProgress?.(
        `Reading ${file.name}: page ${pageNumber} (${range.startPage}–${range.endPage})…`
      );
      const cachePath = `${CACHE_DIR}/${sourceKey}-${RENDER_PROFILE}-${pageNumber}.jpg`;
      let dataUrl: string | undefined;
      try {
        if (await vault.adapter.exists(cachePath)) {
          dataUrl = `data:image/jpeg;base64,${arrayBufferToBase64(await vault.adapter.readBinary(cachePath))}`;
        }
      } catch (error) {
        logWarn("[PDF pages] Could not read cached page; rendering again", error);
      }
      if (!dataUrl) {
        const page = await pdf.getPage(pageNumber);
        const canvas = document.createElement("canvas");
        try {
          const nativeViewport = page.getViewport({ scale: 1 });
          const viewport = page.getViewport({
            scale: 2000 / Math.max(nativeViewport.width, nativeViewport.height),
          });
          canvas.width = Math.ceil(viewport.width);
          canvas.height = Math.ceil(viewport.height);
          const canvasContext = canvas.getContext("2d");
          if (!canvasContext) throw new Error("Could not create a PDF page canvas.");
          await page.render({ canvasContext, viewport, background: "rgb(255,255,255)" }).promise;
          dataUrl = canvas.toDataURL("image/jpeg", 0.9);
          const encoded = dataUrl.split(",")[1];
          if (!encoded) throw new Error(`Could not render PDF page ${pageNumber}.`);
          try {
            for (const dir of [".copilot", CACHE_DIR]) {
              if (!(await vault.adapter.exists(dir))) await vault.adapter.mkdir(dir);
            }
            const binary = Uint8Array.from(atob(encoded), (char) => char.charCodeAt(0));
            await vault.adapter.writeBinary(cachePath, binary.buffer);
          } catch (error) {
            // A cache write failure should not discard an otherwise usable image.
            logWarn("[PDF pages] Could not cache rendered page", error);
          }
        } finally {
          canvas.width = 0;
          canvas.height = 0;
          page.cleanup();
        }
      }
      images.push({
        type: "image_url",
        image_url: { url: dataUrl },
        pdfPage: { path: file.path, page: pageNumber },
      });
    }
    if (sourceKey !== pdfSourceKey(file)) {
      throw new Error(`${file.name} changed while rendering. Please send again.`);
    }
    return images;
  } finally {
    await pdf.destroy();
  }
}
