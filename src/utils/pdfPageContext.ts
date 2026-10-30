import type { MessageContent, ImageContent } from "@/imageProcessing/imageProcessor";
import type { PdfPageRange } from "@/types/message";

/** A rendered page with local provenance, removed before calling a provider. */
export interface PdfPageImage extends ImageContent {
  pdfPage: { path: string; page: number };
}

/** Reject invalid ranges rather than silently sending a different set of pages. */
export function validatePdfPageRange(range: PdfPageRange, pageCount: number): void {
  if (
    !Number.isSafeInteger(range.startPage) ||
    !Number.isSafeInteger(range.endPage) ||
    range.startPage < 1 ||
    range.endPage < range.startPage ||
    range.endPage > pageCount
  ) {
    throw new Error(`Choose whole page numbers between 1 and ${pageCount}, with From ≤ To.`);
  }
}

/** Select the current page and available immediate neighbours. */
export function defaultPdfPageRange(currentPage: number, pageCount: number): PdfPageRange {
  const page = Math.min(pageCount, Math.max(1, Math.trunc(currentPage) || 1));
  return { startPage: Math.max(1, page - 1), endPage: Math.min(pageCount, page + 1) };
}

/** Identify pages produced by the local PDF renderer. */
export function isPdfPageImage(item: unknown): item is PdfPageImage {
  const page = item as Partial<PdfPageImage> | null;
  return (
    page?.type === "image_url" &&
    typeof page.pdfPage?.path === "string" &&
    Number.isSafeInteger(page.pdfPage?.page)
  );
}

/** Label each PDF image and strip local metadata from the provider payload. */
export function materializePdfPageImages(content: MessageContent[]): MessageContent[] {
  return content.flatMap((item): MessageContent[] => {
    if (item.type === "text" && !item.text) return [];
    if (!isPdfPageImage(item)) return [item];
    return [
      {
        type: "text",
        text: `PDF page: ${JSON.stringify(item.pdfPage.path)}, physical page ${item.pdfPage.page}.`,
      },
      { type: "image_url", image_url: { ...item.image_url } },
    ];
  });
}
