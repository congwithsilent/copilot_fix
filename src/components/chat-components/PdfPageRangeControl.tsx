import React, { useEffect, useState } from "react";
import { App, TFile } from "obsidian";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PdfPageRange } from "@/types/message";
import { defaultPdfPageRange, validatePdfPageRange } from "@/utils/pdfPageContext";
import { getOpenPdfPage, getPdfPageCount, pdfSourceKey } from "@/services/pdfPageContextService";

interface PdfPageRangeControlProps {
  app: App;
  file: TFile;
  range?: PdfPageRange;
  disabled?: boolean;
  onChange: (path: string, range: PdfPageRange) => void;
  onPageCount: (path: string, count: number) => void;
}

/** Choose exactly which physical pages of an attached PDF become image context. */
export function PdfPageRangeControl({
  app,
  file,
  range,
  disabled,
  onChange,
  onPageCount,
}: PdfPageRangeControlProps) {
  const [pageCount, setPageCount] = useState<number>();
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const sourceKey = pdfSourceKey(file);

  useEffect(() => {
    let cancelled = false;
    setPageCount(undefined);
    setError("");
    onPageCount(file.path, 0);
    void getPdfPageCount(app.vault, file)
      .then((count) => {
        if (cancelled) return;
        setPageCount(count);
        onPageCount(file.path, count);
        if (!range) onChange(file.path, defaultPdfPageRange(getOpenPdfPage(app, file), count));
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
    // Only file revisions/retries reload metadata; typing in the fields must not reopen the PDF.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [app, sourceKey, attempt]);

  let rangeError = "";
  if (range && pageCount) {
    try {
      validatePdfPageRange(range, pageCount);
    } catch (err) {
      rangeError = (err as Error).message;
    }
  }

  return (
    <div className="tw-flex tw-flex-col tw-gap-1 tw-rounded-md tw-bg-primary tw-p-2 tw-text-xs">
      <div className="tw-truncate" title={file.path}>
        {file.name} · PDF pages as images
      </div>
      {!pageCount ? (
        <div role={error ? "alert" : "status"}>
          {error || "Reading page count…"}
          {error && (
            <Button size="sm" variant="ghost" onClick={() => setAttempt(attempt + 1)}>
              Retry
            </Button>
          )}
        </div>
      ) : (
        <>
          <div className="tw-flex tw-flex-wrap tw-items-center tw-gap-2">
            <label className="tw-flex tw-items-center tw-gap-1">
              From
              <Input
                type="number"
                min={1}
                max={pageCount}
                step={1}
                value={Number.isFinite(range?.startPage) ? range!.startPage : ""}
                aria-label={`${file.name} start page`}
                className="tw-w-20"
                disabled={disabled}
                onChange={(event) =>
                  onChange(file.path, {
                    startPage: event.target.valueAsNumber,
                    endPage: range?.endPage ?? pageCount,
                  })
                }
              />
            </label>
            <label className="tw-flex tw-items-center tw-gap-1">
              To
              <Input
                type="number"
                min={1}
                max={pageCount}
                step={1}
                value={Number.isFinite(range?.endPage) ? range!.endPage : ""}
                aria-label={`${file.name} end page`}
                className="tw-w-20"
                disabled={disabled}
                onChange={(event) =>
                  onChange(file.path, {
                    startPage: range?.startPage ?? 1,
                    endPage: event.target.valueAsNumber,
                  })
                }
              />
            </label>
            <span>of {pageCount}</span>
            <Button
              size="sm"
              variant="ghost"
              disabled={disabled}
              onClick={() =>
                onChange(file.path, defaultPdfPageRange(getOpenPdfPage(app, file), pageCount))
              }
            >
              Current ±1
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={disabled}
              onClick={() => onChange(file.path, { startPage: 1, endPage: pageCount })}
            >
              All pages
            </Button>
          </div>
          {rangeError ? (
            <span role="alert" className="tw-text-error">
              {rangeError}
            </span>
          ) : (
            range && (
              <span className="tw-text-muted">
                {range.endPage - range.startPage + 1} page images · Physical page numbers, starting
                at 1.
              </span>
            )
          )}
        </>
      )}
    </div>
  );
}
