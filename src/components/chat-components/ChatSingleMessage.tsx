import { ChatButtons } from "@/components/chat-components/ChatButtons";
import { SourcesModal } from "@/components/modals/SourcesModal";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  ContextFolderBadge,
  ContextNoteBadge,
  ContextSelectedTextBadge,
  ContextTagBadge,
  ContextUrlBadge,
  ContextWebTabBadge,
} from "@/components/chat-components/ContextBadges";
import { InlineMessageEditor } from "@/components/chat-components/InlineMessageEditor";
import { TokenLimitWarning } from "@/components/chat-components/TokenLimitWarning";
import {
  cleanupMessageErrorBlockRoots,
  cleanupMessageToolCallRoots,
  cleanupStaleErrorBlockRoots,
  cleanupStaleToolCallRoots,
  ensureErrorBlockRoot,
  ensureToolCallRoot,
  getMessageErrorBlockRoots,
  getMessageToolCallRoots,
  removeErrorBlockRoot,
  removeToolCallRoot,
  renderErrorBlock,
  renderToolCallBanner,
  type ToolCallRootRecord,
} from "@/components/chat-components/toolCallRootManager";
import { AgentReasoningBlock } from "@/components/chat-components/AgentReasoningBlock";
import { USER_SENDER } from "@/constants";
import { cn } from "@/lib/utils";
import { parseToolCallMarkers } from "@/LLMProviders/chainRunner/utils/toolCallParser";
import { parseReasoningBlock } from "@/LLMProviders/chainRunner/utils/AgentReasoningState";
import { processInlineCitations } from "@/LLMProviders/chainRunner/utils/citationUtils";
import { ChatMessage } from "@/types/message";
import { cleanMessageForCopy, extractYoutubeVideoId, insertIntoEditor } from "@/utils";
import { preprocessAIResponse } from "@/utils/markdownPreprocess";
import { App, Component, MarkdownRenderer, MarkdownView, TFile } from "obsidian";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSettingsValue } from "@/settings/model";
import {
  buildCopilotCollapsibleDomId,
  captureCopilotCollapsibleOpenStates,
  getCopilotCollapsibleDetailsFromEvent,
  getMessageCollapsibleStates,
  isEventWithinDetailsSummary,
} from "@/components/chat-components/collapsibleStateUtils";
import { findStableMarkdownBoundary } from "@/components/chat-components/utils/streamingMarkdownBoundary";
import {
  collectRevealTargets,
  EMPTY_APPENDED_TEXT_STATE,
  revealAppendedText,
  revealBlocks,
  revealClassFor,
  revealInlineClassFor,
  STREAM_REVEAL_DURATION_MS,
  STREAM_REVEAL_INLINE_DURATION_MS,
  type AppendedTextState,
} from "@/components/chat-components/utils/streamingReveal";
import { useStreamingRenderBuffer } from "@/components/chat-components/hooks/useStreamingRenderBuffer";

const FOOTNOTE_SUFFIX_PATTERN = /^\d+-\d+$/;

/**
 * Normalizes rendered markdown footnotes to align with inline citation UX.
 * Removes separators/backrefs and fixes numbering artifacts (e.g., "2-1").
 */
export const normalizeFootnoteRendering = (root: HTMLElement): void => {
  const footnoteSection = root.querySelector(".footnotes");

  if (footnoteSection) {
    footnoteSection.querySelectorAll("hr, hr.footnotes-sep").forEach((el) => el.remove());
    footnoteSection
      .querySelectorAll("a.footnote-backref, a.footnote-link.footnote-backref")
      .forEach((el) => el.remove());
  } else {
    root
      .querySelectorAll("a.footnote-backref, a.footnote-link.footnote-backref")
      .forEach((el) => el.remove());
  }

  root
    .querySelectorAll(
      'a.footnote-ref, sup a[href^="#fn"], sup a[href^="#fn-"], a[href^="#fn"], a[href^="#fn-"]'
    )
    .forEach((anchor) => {
      const text = anchor.textContent?.trim() ?? "";
      if (!text || !FOOTNOTE_SUFFIX_PATTERN.test(text)) {
        return;
      }

      const [primary] = text.split("-");
      if (primary && primary !== text) {
        anchor.textContent = primary;
      }
    });
};

const INLINE_CITATION_RE = /\[(\d+(?:\s*,\s*\d+)*)\]/g;

/**
 * Makes inline citation numbers (e.g., [1], [2]) clickable by linking them
 * to the corresponding source note. Reads the source mapping from the
 * rendered .copilot-sources section in the same message.
 */
export const linkInlineCitations = (root: HTMLElement): void => {
  // Build citation number -> source anchor mapping from the rendered sources section.
  // We store the anchor element (not just the href) so we can copy Obsidian-specific
  // attributes like data-href and class="internal-link" onto the inline citation link.
  const sourceItems = root.querySelectorAll(".copilot-sources__item");
  if (sourceItems.length === 0) return;

  const citationAnchors = new Map<number, HTMLAnchorElement>();
  sourceItems.forEach((item) => {
    const indexEl = item.querySelector(".copilot-sources__index");
    const textEl = item.querySelector(".copilot-sources__text");
    if (!indexEl || !textEl) return;

    const indexMatch = indexEl.textContent?.match(/\[(\d+)\]/);
    if (!indexMatch) return;
    const num = parseInt(indexMatch[1], 10);

    const link = textEl.querySelector("a");
    if (link) {
      citationAnchors.set(num, link);
    }
  });

  if (citationAnchors.size === 0) return;

  // Collect text nodes that contain citation patterns (outside sources section)
  const sourcesEl = root.querySelector(".copilot-sources");
  const textNodes: Text[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (sourcesEl?.contains(node)) return NodeFilter.FILTER_REJECT;
      if (node.parentElement?.closest("code, pre")) return NodeFilter.FILTER_REJECT;
      INLINE_CITATION_RE.lastIndex = 0;
      if (INLINE_CITATION_RE.test(node.textContent || "")) {
        INLINE_CITATION_RE.lastIndex = 0;
        return NodeFilter.FILTER_ACCEPT;
      }
      return NodeFilter.FILTER_REJECT;
    },
  });

  let n: Text | null;
  while ((n = walker.nextNode() as Text | null)) textNodes.push(n);

  // Replace citation text with clickable links
  textNodes.forEach((node) => {
    const text = node.textContent || "";
    INLINE_CITATION_RE.lastIndex = 0;

    const fragment = document.createDocumentFragment();
    let lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = INLINE_CITATION_RE.exec(text)) !== null) {
      // Text before the citation
      if (match.index > lastIndex) {
        fragment.appendChild(document.createTextNode(text.slice(lastIndex, match.index)));
      }

      const nums = match[1].split(/\s*,\s*/).map((s) => parseInt(s.trim(), 10));
      const allResolved = nums.every((num) => citationAnchors.has(num));

      if (allResolved) {
        const span = document.createElement("span");
        span.className = "copilot-citation-group";
        span.appendChild(document.createTextNode("["));
        nums.forEach((num, i) => {
          if (i > 0) span.appendChild(document.createTextNode(", "));
          const sourceAnchor = citationAnchors.get(num)!;
          const link = document.createElement("a");
          // Copy all attributes from the source anchor so Obsidian internal-link
          // metadata (e.g. data-href, class="internal-link") is preserved.
          for (const attr of Array.from(sourceAnchor.attributes)) {
            link.setAttribute(attr.name, attr.value);
          }
          // Override class and add our citation-specific styling
          link.className = `copilot-citation-link${sourceAnchor.className ? ` ${sourceAnchor.className}` : ""}`;
          link.textContent = String(num);
          link.setAttribute("aria-label", `Source ${num}`);
          span.appendChild(link);
        });
        span.appendChild(document.createTextNode("]"));
        fragment.appendChild(span);
      } else {
        fragment.appendChild(document.createTextNode(match[0]));
      }

      lastIndex = match.index + match[0].length;
    }

    if (lastIndex < text.length) {
      fragment.appendChild(document.createTextNode(text.slice(lastIndex)));
    }

    // If the text node is inside a placeholder span, replace the span itself
    // so the placeholder wrapper is cleanly removed.
    const replaceTarget = node.parentElement?.classList.contains("copilot-citation-ref")
      ? node.parentElement
      : node;
    replaceTarget.parentNode?.replaceChild(fragment, replaceTarget);
  });
};

function MessageContext({ context }: { context: ChatMessage["context"] }) {
  if (
    !context ||
    (!context.notes?.length &&
      !context.urls?.length &&
      !context.webTabs?.length &&
      !context.tags?.length &&
      !context.folders?.length &&
      !context.selectedTextContexts?.length)
  ) {
    return null;
  }

  return (
    <div className="tw-flex tw-flex-wrap tw-gap-2">
      {context.notes.map((note, index) => (
        <Tooltip key={`note-${index}-${note.path}`}>
          <TooltipTrigger asChild>
            <div>
              <ContextNoteBadge note={note} />
            </div>
          </TooltipTrigger>
          <TooltipContent className="tw-max-w-sm tw-break-words">{note.path}</TooltipContent>
        </Tooltip>
      ))}
      {context.urls.map((url, index) => (
        <Tooltip key={`url-${index}-${url}`}>
          <TooltipTrigger asChild>
            <div>
              <ContextUrlBadge url={url} />
            </div>
          </TooltipTrigger>
          <TooltipContent className="tw-max-w-sm tw-break-words">{url}</TooltipContent>
        </Tooltip>
      ))}
      {context.webTabs?.map((webTab, index) => (
        <Tooltip key={`webTab-${index}-${webTab.url}`}>
          <TooltipTrigger asChild>
            <div>
              <ContextWebTabBadge webTab={webTab} />
            </div>
          </TooltipTrigger>
          <TooltipContent className="tw-max-w-sm tw-break-words">
            {webTab.title ? (
              <div className="tw-text-left">
                <div className="tw-font-medium">{webTab.title}</div>
                <div>{webTab.url}</div>
              </div>
            ) : (
              webTab.url
            )}
          </TooltipContent>
        </Tooltip>
      ))}
      {context.tags?.map((tag, index) => (
        <Tooltip key={`tag-${index}-${tag}`}>
          <TooltipTrigger asChild>
            <div>
              <ContextTagBadge tag={tag} />
            </div>
          </TooltipTrigger>
          <TooltipContent className="tw-max-w-sm tw-break-words">{tag}</TooltipContent>
        </Tooltip>
      ))}
      {context.folders?.map((folder, index) => (
        <Tooltip key={`folder-${index}-${folder}`}>
          <TooltipTrigger asChild>
            <div>
              <ContextFolderBadge folder={folder} />
            </div>
          </TooltipTrigger>
          <TooltipContent className="tw-max-w-sm tw-break-words">{folder}</TooltipContent>
        </Tooltip>
      ))}
      {context.selectedTextContexts?.map((selectedText, index) => (
        <Tooltip key={`selectedText-${index}-${selectedText.id}`}>
          <TooltipTrigger asChild>
            <div>
              <ContextSelectedTextBadge selectedText={selectedText} />
            </div>
          </TooltipTrigger>
          <TooltipContent className="tw-max-w-sm tw-break-words">
            {selectedText.sourceType === "web" ? selectedText.url : selectedText.notePath}
          </TooltipContent>
        </Tooltip>
      ))}
    </div>
  );
}

interface ChatSingleMessageProps {
  message: ChatMessage;
  app: App;
  isStreaming: boolean;
  onRegenerate?: () => void;
  onEdit?: (newMessage: string) => void;
  onDelete: () => void;
}

const ChatSingleMessage: React.FC<ChatSingleMessageProps> = ({
  message,
  app,
  isStreaming,
  onRegenerate,
  onEdit,
  onDelete,
}) => {
  const [isCopied, setIsCopied] = useState<boolean>(false);
  const [isEditing, setIsEditing] = useState<boolean>(false);
  // Agent Reasoning Block state
  const [reasoningData, setReasoningData] = useState<{
    status: "reasoning" | "collapsed" | "complete";
    elapsedSeconds: number;
    steps: string[];
  } | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const componentRef = useRef<Component | null>(null);
  const isUnmountingRef = useRef<boolean>(false);
  /**
   * Frozen markdown prefix per text segment, keyed by the segment's ordinal
   * within the message.
   *
   * While streaming, a segment's already-complete markdown is rendered once and
   * kept; only the trailing fragment is re-rendered as new tokens arrive. This
   * avoids rebuilding tables, code fences, and math on every chunk, which is
   * both quadratic and visibly flickery.
   */
  const renderedStablePrefixRef = useRef<Map<number, string>>(new Map());
  // Use a stable ID for the message to preserve tool call roots across re-renders
  // Prefer message.id (persistent) over timestamp.epoch (regenerated on load)
  const messageId = useRef(
    message.id ||
      (message.timestamp?.epoch
        ? String(message.timestamp.epoch)
        : `temp-${Date.now()}-${Math.random()}`)
  );

  // Store roots in a global map to preserve them across component instances
  const rootsRef = useRef<Map<string, ToolCallRootRecord>>(
    getMessageToolCallRoots(messageId.current)
  );

  // Store error block roots separately to prevent ID collisions and race conditions
  const errorRootsRef = useRef<Map<string, ToolCallRootRecord>>(
    getMessageErrorBlockRoots(messageId.current)
  );

  // Get the global collapsible state map for this message
  // This persists across component lifecycles (streaming -> final message)
  // Use ref to avoid triggering re-renders when map contents change
  const collapsibleOpenStateMapRef = useRef(getMessageCollapsibleStates(messageId.current));
  const collapsibleOpenStateMap = collapsibleOpenStateMapRef.current;

  // Check if current model has reasoning capability
  const settings = useSettingsValue();

  /**
   * First-seen timestamp per block index and text segment, used to animate only
   * blocks that are genuinely revealing and to resume their animation when the
   * renderer recreates their DOM (see streamingReveal).
   */
  const revealedBlockTimesRef = useRef<Map<number, number[]>>(new Map());
  /**
   * Reveal state of each segment's streaming tail across commits, used to fade
   * in only the text at the writing edge (see streamingReveal).
   */
  const renderedTailTextRef = useRef<Map<number, AppendedTextState>>(new Map());

  /**
   * Render buffer: while streaming, text is committed to the renderer on a
   * fixed cadence instead of per chunk, so output arrives in readable gulps
   * rather than as a typewriter. Disabled outside streaming, so the final
   * render is always the complete message.
   */
  const bufferedContent = useStreamingRenderBuffer(
    message.message,
    isStreaming && message.sender !== USER_SENDER
  );

  /**
   * Snapshot the render effect consumes. Identical object while nothing is
   * buffered, so unrelated message changes (sources, metadata) still propagate.
   */
  const renderMessage = useMemo(
    () =>
      bufferedContent === message.message ? message : { ...message, message: bufferedContent },
    [message, bufferedContent]
  );

  const copyToClipboard = () => {
    if (!navigator.clipboard || !navigator.clipboard.writeText) {
      return;
    }

    const cleanedContent = cleanMessageForCopy(message.message);
    navigator.clipboard.writeText(cleanedContent).then(() => {
      setIsCopied(true);

      setTimeout(() => {
        setIsCopied(false);
      }, 2000);
    });
  };

  const preprocess = useCallback(
    (content: string): string => {
      const activeFile = app.workspace.getActiveFile();
      const sourcePath = activeFile ? activeFile.path : "";

      const processCollapsibleSection = (
        content: string,
        tagName: string,
        summaryText: string,
        streamingSummaryText: string,
        streamingCollapsed: boolean
      ): string => {
        const openTag = `<${tagName}>`;
        let sectionIndex = 0;

        // During streaming, if we find any tag that's either unclosed or being processed
        if (isStreaming && content.includes(openTag)) {
          // Replace any complete sections first
          const completeRegex = new RegExp(`<${tagName}>([\\s\\S]*?)<\\/${tagName}>`, "g");
          content = content.replace(completeRegex, (_match, sectionContent) => {
            const sectionKey = `${tagName}-${sectionIndex}`;
            sectionIndex += 1;
            const domId = buildCopilotCollapsibleDomId(messageId.current, sectionKey);
            // Check if user has explicitly set a state; if not, default to collapsed (original behavior)
            const openAttribute = collapsibleOpenStateMap.get(domId) ? " open" : "";

            return `<details id="${domId}" class="copilot-collapsible"${openAttribute}>
              <summary class="copilot-collapsible-summary">${summaryText}</summary>
              <div class="copilot-collapsible-body">${sectionContent.trim()}</div>
            </details>\n\n`;
          });

          // Then handle any unclosed tag, preserving the streamed content. When
          // streamingCollapsed is true (think sections), render as a <details>
          // that is collapsed unless the user explicitly expanded it, so thinking
          // stays hidden while streaming. The unstable boundary never splits a
          // block tag (see streamingMarkdownBoundary BLOCK_TAGS), so the section
          // re-renders as a unit and open state restores from the state map.
          const unClosedRegex = new RegExp(`<${tagName}>([\\s\\S]*)$`);
          if (streamingCollapsed) {
            content = content.replace(unClosedRegex, (_match, partialContent) => {
              const sectionKey = `${tagName}-streaming`;
              const domId = buildCopilotCollapsibleDomId(messageId.current, sectionKey);
              // Default collapsed: open only when the user explicitly expanded it.
              const openAttribute = collapsibleOpenStateMap.get(domId) ? " open" : "";

              return `<details id="${domId}" class="copilot-collapsible"${openAttribute}>
                <summary class="copilot-collapsible-summary">${streamingSummaryText}</summary>
                <div class="copilot-collapsible-body">${partialContent.trim()}</div>
              </details>\n\n`;
            });
          } else {
            content = content.replace(
              unClosedRegex,
              (_match, partialContent) => `<div class="copilot-collapsible-streaming">
              <div class="copilot-collapsible-streaming-label">${streamingSummaryText}</div>
              <div class="copilot-collapsible-streaming-body">${partialContent.trim()}</div>
            </div>`
            );
          }
          return content;
        }

        // Not streaming, process all sections normally
        const regex = new RegExp(`<${tagName}>([\\s\\S]*?)<\\/${tagName}>`, "g");
        return content.replace(regex, (_match, sectionContent) => {
          const sectionKey = `${tagName}-${sectionIndex}`;
          sectionIndex += 1;
          const domId = buildCopilotCollapsibleDomId(messageId.current, sectionKey);
          // Restore open state from previous render
          const openAttribute = collapsibleOpenStateMap.get(domId) ? " open" : "";

          return `<details id="${domId}" class="copilot-collapsible"${openAttribute}>
            <summary class="copilot-collapsible-summary">${summaryText}</summary>
            <div class="copilot-collapsible-body">${sectionContent.trim()}</div>
          </details>\n\n`;
        });
      };

      const processThinkSection = (content: string): string => {
        return processCollapsibleSection(
          content,
          "think",
          "Thought for a while",
          "Thinking...",
          // Thinking stays collapsed by default, even while streaming.
          true
        );
      };

      const processWriteFileSection = (content: string): string => {
        // Normalise legacy <writeToFile> tags from saved history to <writeFile>
        // so they continue to render correctly after the tool rename.
        const normalizeLegacyTags = (text: string): string =>
          text.replace(/<(\/?)writeToFile>/g, "<$1writeFile>");

        // First, unwrap any XML codeblocks that contain writeFile tags
        const unwrapXmlCodeblocks = (text: string): string => {
          // Pattern to match XML codeblocks that contain writeFile tags (or legacy writeToFile)
          const xmlCodeblockRegex =
            /```(?:xml)?\s*([\s\S]*?<writeFile>[\s\S]*?<\/writeFile>[\s\S]*?)\s*```/g;

          return text.replace(xmlCodeblockRegex, (_match, xmlContent) => {
            // Extract just the content inside the codeblock and return it without the codeblock wrapper
            return xmlContent.trim();
          });
        };

        // During streaming, also handle unclosed writeFile tags in XML codeblocks
        const unwrapStreamingXmlCodeblocks = (text: string): string => {
          if (!isStreaming) return text;

          // Pattern to match XML codeblocks that contain unclosed writeFile tags
          const streamingXmlCodeblockRegex = /```xml\s*([\s\S]*?<writeFile>[\s\S]*?)$/g;

          return text.replace(streamingXmlCodeblockRegex, (_match, xmlContent) => {
            // Extract the content and return it without the codeblock wrapper
            return xmlContent.trim();
          });
        };

        // Normalise legacy tags, then unwrap XML codeblocks
        let processedContent = normalizeLegacyTags(content);
        processedContent = unwrapXmlCodeblocks(processedContent);
        processedContent = unwrapStreamingXmlCodeblocks(processedContent);

        // Then process the writeFile sections normally (streaming body stays
        // expanded so users can watch content being generated)
        return processCollapsibleSection(
          processedContent,
          "writeFile",
          "Generated new content",
          "Generating changes...",
          false
        );
      };

      const replaceLinks = (text: string, regex: RegExp, template: (file: TFile) => string) => {
        // Split text into code blocks and non-code blocks
        const parts = text.split(/(```[\s\S]*?```|`[^`]*`)/g);

        return parts
          .map((part, index) => {
            // Even indices are normal text, odd indices are code blocks
            if (index % 2 === 0) {
              // Process links only in non-code blocks
              return part.replace(regex, (match: string, selection: string) => {
                const file = app.metadataCache.getFirstLinkpathDest(selection, sourcePath);
                return file ? template(file) : match;
              });
            }
            // Return code blocks unchanged
            return part;
          })
          .join("");
      };

      // Common AI response preprocessing (LaTeX, dataview/tasks escaping)
      const commonProcessed = preprocessAIResponse(content);

      // Process only Obsidian internal images (starting with ![[)
      const noteImageProcessed = replaceLinks(
        commonProcessed,
        /!\[\[(.*?)]]/g,
        (file) => `![](${app.vault.getResourcePath(file)})`
      );

      // Process think sections (no-op if none); do not depend on current model selection
      const thinkSectionProcessed = processThinkSection(noteImageProcessed);

      // Process writeFile sections
      const writeFileSectionProcessed = processWriteFileSection(thinkSectionProcessed);

      // Transform markdown sources section into HTML structure
      const sourcesSectionProcessed = processInlineCitations(
        writeFileSectionProcessed,
        settings.enableInlineCitations
      );

      // Wrap any remaining raw [^N] footnote marks as placeholder badges.
      // During streaming, processInlineCitations can't process them until the
      // sources section has streamed in. Without this, the markdown renderer
      // interprets [^N] as footnote references and shows bare superscript numbers.
      const citationPlaceholderProcessed = sourcesSectionProcessed.replace(
        /\[\^(\d+)\](?!:)/g,
        '<span class="copilot-citation-ref">[$1]</span>'
      );

      // Transform [[link]] to clickable format but exclude ![[]] image links
      const noteLinksProcessed = replaceLinks(
        citationPlaceholderProcessed,
        /(?<!!)\[\[([^\]]+)]]/g,
        (file: TFile) =>
          `<a href="obsidian://open?file=${encodeURIComponent(file.path)}">${file.basename}</a>`
      );

      /**
       * Converts YouTube video embeds to static thumbnails during streaming.
       * This prevents iframe flickering caused by repeated DOM recreation.
       * After streaming ends, the original embed syntax is preserved for full video display.
       */
      const processYouTubeEmbed = (content: string): string => {
        if (!isStreaming) {
          // After streaming: keep original syntax for full video embed
          return content;
        }

        // Match ![title](url) format and check if URL is YouTube
        const imageEmbedRegex = /!\[([^\]]*)\]\(([^)]+)\)/g;

        return content.replace(imageEmbedRegex, (match, title, url) => {
          const videoId = extractYoutubeVideoId(url);
          if (!videoId) {
            // Not a YouTube URL, keep original
            return match;
          }
          // During streaming: convert to clickable thumbnail to avoid iframe reload flicker
          const displayTitle = title || "YouTube Video";
          const thumbnail = `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
          return `[![${displayTitle}](${thumbnail})](${url})`;
        });
      };

      return processYouTubeEmbed(noteLinksProcessed);
    },
    [app, isStreaming, settings.enableInlineCitations, collapsibleOpenStateMap]
  );

  /**
   * Find a direct child of `container` carrying the given class.
   *
   * Direct-child lookup avoids matching same-named classes that model output
   * could have produced inside the rendered markdown.
   *
   * @param container Parent element.
   * @param className Class to match.
   * @returns The matching child, or null.
   */
  const findDirectChild = (container: HTMLElement, className: string): HTMLElement | null => {
    for (const child of Array.from(container.children)) {
      if (child.classList.contains(className)) {
        return child as HTMLElement;
      }
    }
    return null;
  };

  /**
   * Animate the blocks of a segment that appeared since the previous commit.
   *
   * Newly committed output fades in instead of snapping into place. Blocks that
   * were already on screen are left alone even though the renderer recreated
   * their DOM, so text never re-animates while it is being extended.
   *
   * @param container Segment element that owns the rendered output.
   * @param ordinal Position of the segment within the message.
   */
  const applyStreamReveal = useCallback((container: HTMLElement, ordinal: number): void => {
    const targets = collectRevealTargets(container);
    const previousTimes = revealedBlockTimesRef.current.get(ordinal) ?? [];
    const nextTimes = revealBlocks(targets, previousTimes, {
      className: revealClassFor(),
      durationMs: STREAM_REVEAL_DURATION_MS,
      now: Date.now(),
    });
    revealedBlockTimesRef.current.set(ordinal, nextTimes);
  }, []);

  /**
   * Render one markdown segment into its container, reusing already-rendered
   * output while streaming.
   *
   * The segment is split at the last structurally complete blank line. While the
   * boundary does not move, only the trailing fragment is re-rendered and the
   * frozen prefix is left untouched — so completed blocks (tables, code fences,
   * math) are not torn down and rebuilt on every chunk, which is both quadratic
   * and visibly flickery. When the boundary advances (or the content changes
   * shape through an edit or regeneration), the prefix is re-rendered once.
   *
   * @param content Markdown for this segment.
   * @param container Element that owns the segment's rendered output.
   * @param ordinal Position of this text segment within the message.
   */
  const renderSegmentMarkdown = useCallback(
    (content: string, container: HTMLElement, ordinal: number): void => {
      if (!isStreaming) {
        // Final state: render the segment once, in full, and drop any memo.
        container.replaceChildren();
        renderedStablePrefixRef.current.delete(ordinal);
        renderedTailTextRef.current.delete(ordinal);
        if (content) {
          MarkdownRenderer.renderMarkdown(content, container, "", componentRef.current!);
          normalizeFootnoteRendering(container);
        }
        applyStreamReveal(container, ordinal);
        return;
      }

      const previousStable = renderedStablePrefixRef.current.get(ordinal);
      const boundary = findStableMarkdownBoundary(content);
      const stablePrefix = content.slice(0, boundary);
      const unstableTail = content.slice(boundary);

      let stableDiv = findDirectChild(container, "message-segment-stable");
      let tailDiv = findDirectChild(container, "message-segment-tail");

      // Re-render the frozen prefix only when it actually changed. While the
      // boundary holds steady this branch is skipped entirely.
      if (stablePrefix !== previousStable) {
        if (stablePrefix) {
          if (!stableDiv) {
            stableDiv = document.createElement("div");
            stableDiv.className = "message-segment-stable";
            // Keep the prefix ahead of the tail.
            container.insertBefore(stableDiv, tailDiv);
          }
          stableDiv.replaceChildren();
          MarkdownRenderer.renderMarkdown(stablePrefix, stableDiv, "", componentRef.current!);
          normalizeFootnoteRendering(stableDiv);
        } else if (stableDiv) {
          stableDiv.remove();
          stableDiv = null;
        }
        renderedStablePrefixRef.current.set(ordinal, stablePrefix);
      }

      // The tail is re-rendered on every pass; markdown is still being written
      // to it, so its rendering is expected to change.
      if (unstableTail) {
        if (!tailDiv) {
          tailDiv = document.createElement("div");
          tailDiv.className = "message-segment-tail";
          container.appendChild(tailDiv);
        }
        tailDiv.replaceChildren();
        MarkdownRenderer.renderMarkdown(unstableTail, tailDiv, "", componentRef.current!);
        normalizeFootnoteRendering(tailDiv);
      } else if (tailDiv) {
        tailDiv.remove();
      }

      // Fade in the text at the writing edge. Without it the block being
      // written still jumps a gulp at a time, which is what makes the output
      // feel like it is being spat out paragraph by paragraph.
      if (tailDiv && unstableTail) {
        const previousState = renderedTailTextRef.current.get(ordinal) ?? EMPTY_APPENDED_TEXT_STATE;
        renderedTailTextRef.current.set(
          ordinal,
          revealAppendedText(tailDiv, previousState, {
            className: revealInlineClassFor(),
            durationMs: STREAM_REVEAL_INLINE_DURATION_MS,
            now: Date.now(),
          })
        );
      } else {
        renderedTailTextRef.current.delete(ordinal);
      }

      applyStreamReveal(container, ordinal);
    },
    [componentRef, isStreaming, applyStreamReveal]
  );

  // Persist collapsible open/closed state during streaming in real time.
  // Streaming updates can rebuild the markdown DOM between pointer down/up, preventing a click.
  useEffect(() => {
    const root = contentRef.current;
    if (!root || message.sender === USER_SENDER || !isStreaming) {
      return;
    }

    /**
     * Handles user click on collapsible summary during streaming.
     * Directly sets details.open to avoid race conditions where DOM rebuilds
     * between pointerdown and click, causing double toggle that cancels user intent.
     */
    const handleSummaryPointerDown = (event: Event): void => {
      // Only handle primary button (left click)
      if (event instanceof PointerEvent && (event.button !== 0 || !event.isPrimary)) {
        return;
      }

      const details = getCopilotCollapsibleDetailsFromEvent(event, root);
      if (!details || !isEventWithinDetailsSummary(event, details)) {
        return;
      }

      // Calculate and apply the next state immediately
      const nextOpen = !details.open;
      details.open = nextOpen;
      collapsibleOpenStateMap.set(details.id, nextOpen);
    };

    /**
     * Prevents native click from triggering another toggle on <details>.
     * Since we already handled the state change in pointerdown, block the default behavior.
     */
    const handleSummaryClick = (event: Event): void => {
      const details = getCopilotCollapsibleDetailsFromEvent(event, root);
      if (!details || !isEventWithinDetailsSummary(event, details)) {
        return;
      }
      event.preventDefault();
    };

    /**
     * Captures actual open/closed state changes from native <details> interactions.
     */
    const handleDetailsToggle = (event: Event): void => {
      const details = getCopilotCollapsibleDetailsFromEvent(event, root);
      if (!details) {
        return;
      }
      collapsibleOpenStateMap.set(details.id, details.open);
    };

    // Use capture phase and listen on root (not document) to minimize scope
    root.addEventListener("pointerdown", handleSummaryPointerDown, true);
    root.addEventListener("click", handleSummaryClick, true);
    root.addEventListener("toggle", handleDetailsToggle, true);
    return () => {
      root.removeEventListener("pointerdown", handleSummaryPointerDown, true);
      root.removeEventListener("click", handleSummaryClick, true);
      root.removeEventListener("toggle", handleDetailsToggle, true);
    };
  }, [isStreaming, message.sender, collapsibleOpenStateMap]);

  useEffect(() => {
    // Reset unmounting flag when effect runs
    isUnmountingRef.current = false;

    if (contentRef.current && message.sender !== USER_SENDER) {
      // Create a new Component instance if it doesn't exist
      if (!componentRef.current) {
        componentRef.current = new Component();
        componentRef.current.load();
      }

      // Capture open states of collapsible sections before re-rendering
      // During streaming, don't overwrite user's explicit state changes from pointerdown
      captureCopilotCollapsibleOpenStates(contentRef.current, collapsibleOpenStateMap, {
        overwriteExisting: !isStreaming,
      });

      // Render the buffered snapshot: text arrives in gulps while streaming and
      // is always complete once streaming ends.
      const originMessage = renderMessage.message;

      // Parse and extract agent reasoning block if present
      const reasoningBlockData = parseReasoningBlock(originMessage);
      if (reasoningBlockData?.hasReasoning && reasoningBlockData.status !== "idle") {
        setReasoningData({
          status: reasoningBlockData.status as "reasoning" | "collapsed" | "complete",
          elapsedSeconds: reasoningBlockData.elapsedSeconds,
          steps: reasoningBlockData.steps,
        });
      } else {
        setReasoningData(null);
      }

      // Use content after reasoning block (or full message if no reasoning block)
      const messageContent = reasoningBlockData?.contentAfter ?? originMessage;
      const processedMessage = preprocess(messageContent);
      const parsedMessage = parseToolCallMarkers(processedMessage, messageId.current);

      if (!isUnmountingRef.current) {
        // Track existing tool call and error block IDs
        const existingToolCallIds = new Set<string>();
        const existingErrorIds = new Set<string>();

        const existingToolCalls = contentRef.current.querySelectorAll('[id^="tool-call-"]');
        existingToolCalls.forEach((el) => {
          const id = el.id.replace("tool-call-", "");
          existingToolCallIds.add(id);
        });

        const existingErrors = contentRef.current.querySelectorAll('[id^="error-block-"]');
        existingErrors.forEach((el) => {
          const id = el.id.replace("error-block-", "");
          existingErrorIds.add(id);
        });

        // Reuse existing text segment elements by ordinal. Reusing the element
        // (rather than removing and recreating it) is what lets an already
        // rendered stable prefix survive a streaming update untouched.
        const existingSegmentEls = new Map<number, HTMLElement>();
        contentRef.current.querySelectorAll<HTMLElement>(".message-segment").forEach((el) => {
          const ordinal = Number(el.dataset.segmentIndex);
          if (!Number.isNaN(ordinal)) {
            existingSegmentEls.set(ordinal, el);
          }
        });

        // Process segments and only update what's needed
        let currentIndex = 0;
        let textSegmentOrdinal = 0;
        const reusedSegmentOrdinals = new Set<number>();

        parsedMessage.segments.forEach((segment) => {
          if (segment.type === "text" && segment.content.trim()) {
            const ordinal = textSegmentOrdinal++;
            let textDiv = existingSegmentEls.get(ordinal);

            if (!textDiv) {
              textDiv = document.createElement("div");
              textDiv.className = "message-segment";
              textDiv.dataset.segmentIndex = String(ordinal);
            }

            // Position the segment at the current stream position. Skipped when
            // the element is already the node at that position.
            const insertBefore = contentRef.current!.children[currentIndex] ?? null;
            if (insertBefore !== textDiv) {
              contentRef.current!.insertBefore(textDiv, insertBefore);
            }

            reusedSegmentOrdinals.add(ordinal);
            renderSegmentMarkdown(segment.content, textDiv, ordinal);
            currentIndex++;
          } else if (segment.type === "toolCall" && segment.toolCall) {
            const toolCallId = segment.toolCall.id;
            let container = document.getElementById(`tool-call-${toolCallId}`);

            if (!container) {
              const insertBefore = contentRef.current!.children[currentIndex];
              const toolDiv = document.createElement("div");
              toolDiv.className = "tool-call-container";
              toolDiv.id = `tool-call-${toolCallId}`;

              if (insertBefore) {
                contentRef.current!.insertBefore(toolDiv, insertBefore);
              } else {
                contentRef.current!.appendChild(toolDiv);
              }

              container = toolDiv;
            }

            const rootRecord = ensureToolCallRoot(
              messageId.current,
              rootsRef.current,
              toolCallId,
              container as HTMLElement,
              "render refresh"
            );

            if (!isUnmountingRef.current && !rootRecord.isUnmounting) {
              renderToolCallBanner(rootRecord, segment.toolCall);
            }

            currentIndex++;
          } else if (segment.type === "error" && segment.error) {
            const errorId = segment.error.id;
            let container = document.getElementById(`error-block-${errorId}`);

            if (!container) {
              // Insert error block at the current stream position
              const insertBefore = contentRef.current!.children[currentIndex];
              const errorDiv = document.createElement("div");
              errorDiv.className = "error-block-container";
              errorDiv.id = `error-block-${errorId}`;

              if (insertBefore) {
                contentRef.current!.insertBefore(errorDiv, insertBefore);
              } else {
                contentRef.current!.appendChild(errorDiv);
              }

              container = errorDiv;
            }

            // Use dedicated error block root to prevent ID collisions with tool calls
            const rootRecord = ensureErrorBlockRoot(
              messageId.current,
              errorRootsRef.current,
              errorId,
              container as HTMLElement,
              "error render"
            );

            if (!isUnmountingRef.current && !rootRecord.isUnmounting) {
              renderErrorBlock(rootRecord, segment.error);
            }

            currentIndex++;
          }
        });

        // Drop text segments that no longer correspond to a segment in the
        // current parse (message shortened by an edit or regeneration).
        existingSegmentEls.forEach((el, ordinal) => {
          if (!reusedSegmentOrdinals.has(ordinal)) {
            el.remove();
            revealedBlockTimesRef.current.delete(ordinal);
            renderedStablePrefixRef.current.delete(ordinal);
            renderedTailTextRef.current.delete(ordinal);
          }
        });

        // Clean up any tool calls that no longer exist
        const currentToolCallIds = new Set(
          parsedMessage.segments
            .filter((s) => s.type === "toolCall" && s.toolCall)
            .map((s) => s.toolCall!.id)
        );

        existingToolCallIds.forEach((id) => {
          if (!currentToolCallIds.has(id)) {
            const element = document.getElementById(`tool-call-${id}`);
            if (element) {
              removeToolCallRoot(messageId.current, rootsRef.current, id, "tool call removal");
              element.remove();
            }
          }
        });

        // Clean up any error blocks that no longer exist
        const currentErrorIds = new Set(
          parsedMessage.segments
            .filter((s) => s.type === "error" && s.error)
            .map((s) => s.error!.id)
        );

        existingErrorIds.forEach((id) => {
          if (!currentErrorIds.has(id)) {
            const element = document.getElementById(`error-block-${id}`);
            if (element) {
              removeErrorBlockRoot(
                messageId.current,
                errorRootsRef.current,
                id,
                "error block removal"
              );
              element.remove();
            }
          }
        });

        // Link inline citations only after streaming completes. During streaming
        // the sources section is incomplete and the DOM is rebuilt every chunk,
        // so linking mid-stream wastes cycles and causes visible flickering.
        if (contentRef.current && !isStreaming) {
          linkInlineCitations(contentRef.current);
        }
      }
    }

    // Cleanup function - no longer needed as roots are managed by toolCallRootManager
    return () => {
      isUnmountingRef.current = true;
    };
  }, [
    renderMessage,
    message.sender,
    app,
    componentRef,
    isStreaming,
    preprocess,
    collapsibleOpenStateMap,
    renderSegmentMarkdown,
  ]);

  // Cleanup effect that only runs on component unmount
  useEffect(() => {
    const currentComponentRef = componentRef;
    const currentMessageId = messageId.current;
    const messageRootsSnapshot = rootsRef.current;
    const errorRootsSnapshot = errorRootsRef.current;

    // Clean up old message roots to prevent memory leaks (older than 1 hour)
    const cleanupOldRoots = () => {
      cleanupStaleToolCallRoots();
      cleanupStaleErrorBlockRoots();
    };

    // Run cleanup on mount
    cleanupOldRoots();

    return () => {
      // Set unmounting flag immediately
      isUnmountingRef.current = true;

      // Defer cleanup to avoid React rendering conflicts
      setTimeout(() => {
        // Clean up component
        if (currentComponentRef.current) {
          currentComponentRef.current.unload();
          currentComponentRef.current = null;
        }

        // Only clean up roots if this is a temporary message (streaming message with temp- prefix).
        // For shared messageId (msg-xxx), container changes are handled by ensureToolCallRoot/ensureErrorBlockRoot
        // which detect container mismatch and recreate roots as needed.
        if (currentMessageId.startsWith("temp-")) {
          cleanupMessageToolCallRoots(currentMessageId, messageRootsSnapshot, "component cleanup");
          cleanupMessageErrorBlockRoots(currentMessageId, errorRootsSnapshot, "component cleanup");
        }
      }, 0);
    };
  }, []); // Empty dependency array ensures this only runs on unmount

  const handleEdit = () => {
    setIsEditing(true);
  };

  const handleCancelEdit = () => {
    setIsEditing(false);
  };

  const handleSaveEdit = (newText: string) => {
    setIsEditing(false);
    if (onEdit) {
      onEdit(newText);
    }
  };

  const handleShowSources = () => {
    if (message.sources && message.sources.length > 0) {
      new SourcesModal(app, message.sources).open();
    }
  };

  const handleInsertIntoEditor = () => {
    let leaf = app.workspace.getMostRecentLeaf();
    if (!leaf || !(leaf.view instanceof MarkdownView)) {
      leaf = app.workspace.getLeaf(false);
      if (!leaf || !(leaf.view instanceof MarkdownView)) return;
    }

    const editor = leaf.view.editor;
    const hasSelection = editor.getSelection().length > 0;
    insertIntoEditor(message.message, hasSelection);
  };

  const renderMessageContent = () => {
    if (message.content) {
      return (
        <div className="tw-flex tw-flex-col tw-gap-3">
          {message.content.map((item, index) => {
            if (item.type === "text") {
              return (
                <div key={index}>
                  {message.sender === USER_SENDER ? (
                    <div className="copilot-chat-text tw-whitespace-pre-wrap tw-break-words tw-font-normal">
                      {message.message}
                    </div>
                  ) : (
                    <div
                      ref={contentRef}
                      className={message.isErrorMessage ? "tw-text-error" : ""}
                    ></div>
                  )}
                </div>
              );
            } else if (item.type === "image_url") {
              return (
                <div key={index} className="message-image-content">
                  <img
                    src={item.image_url.url}
                    alt="User uploaded image"
                    className="chat-message-image"
                  />
                </div>
              );
            }
            return null;
          })}
        </div>
      );
    }

    // Fallback for messages without content array
    return message.sender === USER_SENDER ? (
      <div className="copilot-chat-text tw-whitespace-pre-wrap tw-break-words tw-font-normal">
        {message.message}
      </div>
    ) : (
      <div ref={contentRef} className={message.isErrorMessage ? "tw-text-error" : ""}></div>
    );
  };

  // If editing a user message, replace the entire message container with the inline editor
  if (isEditing && message.sender === USER_SENDER) {
    return (
      <div className="tw-my-1 tw-flex tw-w-full tw-flex-col">
        <InlineMessageEditor
          initialValue={message.message}
          initialContext={message.context}
          onSave={handleSaveEdit}
          onCancel={handleCancelEdit}
          app={app}
        />
      </div>
    );
  }

  return (
    <div className="tw-my-1 tw-flex tw-w-full tw-flex-col">
      <div
        className={cn(
          "tw-group tw-mx-2 tw-rounded-lg tw-p-2",
          message.sender === USER_SENDER && "tw-bg-secondary-alt"
        )}
        style={
          message.sender === USER_SENDER
            ? { backgroundColor: "var(--background-modifier-hover)" }
            : undefined
        }
      >
        <div className="tw-flex tw-max-w-full tw-flex-col tw-gap-2 tw-overflow-hidden">
          {!isEditing && <MessageContext context={message.context} />}

          {/* Agent Reasoning Block (if present) */}
          {reasoningData && message.sender !== USER_SENDER && (
            <AgentReasoningBlock
              status={reasoningData.status}
              elapsedSeconds={reasoningData.elapsedSeconds}
              steps={reasoningData.steps}
              isStreaming={isStreaming}
            />
          )}

          <div className="message-content">{renderMessageContent()}</div>

          {message.responseMetadata?.wasTruncated && message.sender !== USER_SENDER && (
            <TokenLimitWarning message={message} app={app} />
          )}

          {!isStreaming && (
            <div className="tw-flex tw-items-center tw-justify-between">
              <div className="tw-text-xs tw-text-faint">{message.timestamp?.display}</div>
              <ChatButtons
                message={message}
                onCopy={copyToClipboard}
                isCopied={isCopied}
                onInsertIntoEditor={handleInsertIntoEditor}
                onRegenerate={onRegenerate}
                onEdit={handleEdit}
                onDelete={onDelete}
                onShowSources={handleShowSources}
                hasSources={message.sources && message.sources.length > 0 ? true : false}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ChatSingleMessage;
