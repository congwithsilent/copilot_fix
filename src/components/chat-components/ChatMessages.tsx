import ChatSingleMessage from "@/components/chat-components/ChatSingleMessage";
import { GeneratingIndicator } from "@/components/chat-components/GeneratingIndicator";
import { RelevantNotes } from "@/components/chat-components/RelevantNotes";
import { SuggestedPrompts } from "@/components/chat-components/SuggestedPrompts";
import { USER_SENDER } from "@/constants";
import { useChatScrolling } from "@/hooks/useChatScrolling";
import { useSettingsValue } from "@/settings/model";
import { ChatMessage } from "@/types/message";
import { App } from "obsidian";
import { ArrowDown } from "lucide-react";
import React, { memo, useMemo } from "react";

interface ChatMessagesProps {
  chatHistory: ChatMessage[];
  currentAiMessage: string;
  /** Stable ID for streaming message, shared with final persisted message */
  streamingMessageId?: string | null;
  loading?: boolean;
  loadingMessage?: string;
  app: App;
  onRegenerate: (messageIndex: number) => void;
  onEdit: (messageIndex: number, newMessage: string) => void;
  onDelete: (messageIndex: number) => void;
  onReplaceChat: (prompt: string) => void;
  showHelperComponents: boolean;
}

const ChatMessages = memo(
  ({
    chatHistory,
    currentAiMessage,
    streamingMessageId,
    loading,
    loadingMessage,
    app,
    onRegenerate,
    onEdit,
    onDelete,
    onReplaceChat,
    showHelperComponents = true,
  }: ChatMessagesProps) => {
    const settings = useSettingsValue();

    // Chat scrolling behavior
    const {
      containerMinHeight,
      scrollContainerCallbackRef,
      getMessageKey,
      showScrollToBottom,
      scrollToBottom,
      handleScroll,
    } = useChatScrolling({
      chatHistory,
      streamContent: currentAiMessage,
    });

    // Count visible messages once instead of filtering inside the render map.
    const visibleMessagesCount = useMemo(
      () => chatHistory.reduce((count, message) => (message.isVisible ? count + 1 : count), 0),
      [chatHistory]
    );

    // Index of the last visible message, used to identify the truly-last message
    // even when hidden messages exist later in the history.
    const lastVisibleMessageIndex = useMemo(() => {
      for (let i = chatHistory.length - 1; i >= 0; i--) {
        if (chatHistory[i].isVisible) return i;
      }
      return -1;
    }, [chatHistory]);

    if (visibleMessagesCount === 0 && !currentAiMessage) {
      const activeFile = app.workspace.getActiveFile();
      return (
        <div className="copilot-empty-state tw-flex tw-size-full tw-flex-col tw-gap-4 tw-overflow-y-auto tw-p-3">
          <div className="tw-flex tw-flex-col tw-gap-1 tw-px-1 tw-pt-2">
            <h2 className="tw-m-0 tw-text-lg tw-font-semibold tw-text-normal">
              Start a conversation
            </h2>
            <p className="tw-m-0 tw-text-sm tw-leading-normal tw-text-muted">
              {activeFile
                ? `Ask about “${activeFile.basename}”, or bring in other notes with @.`
                : "Ask a question, or bring in notes and sources with @."}
            </p>
          </div>
          {showHelperComponents && settings.showRelevantNotes && (
            <RelevantNotes defaultOpen={false} key="relevant-notes-before-chat" />
          )}
          {showHelperComponents && settings.showSuggestedPrompts && (
            <SuggestedPrompts onClick={onReplaceChat} />
          )}
        </div>
      );
    }

    return (
      <div className="tw-relative tw-flex tw-h-full tw-flex-1 tw-flex-col tw-overflow-hidden">
        {showHelperComponents && settings.showRelevantNotes && (
          <RelevantNotes className="tw-mb-4" defaultOpen={false} key="relevant-notes-in-chat" />
        )}
        <div
          ref={scrollContainerCallbackRef}
          onScroll={handleScroll}
          data-testid="chat-messages"
          className="copilot-chat-text tw-relative tw-flex tw-w-full tw-flex-1 tw-select-text tw-flex-col tw-items-start tw-justify-start tw-overflow-y-auto tw-scroll-smooth tw-break-words"
        >
          {/* isLastMessage compares against the index of the last *visible*
                message so hidden messages later in the history cannot displace it. */}
          {chatHistory.map((message, index) => {
            const isLastVisible = index === lastVisibleMessageIndex;
            // Only apply min-height to AI messages that are last
            const shouldApplyMinHeight =
              isLastVisible && !currentAiMessage && message.sender !== USER_SENDER;

            return (
              message.isVisible && (
                <div
                  key={getMessageKey(message, index)}
                  data-message-key={getMessageKey(message, index)}
                  className="tw-w-full"
                  style={{
                    minHeight: shouldApplyMinHeight ? `${containerMinHeight}px` : "auto",
                  }}
                >
                  <ChatSingleMessage
                    message={message}
                    app={app}
                    isStreaming={false}
                    onRegenerate={() => onRegenerate(index)}
                    onEdit={(newMessage) => onEdit(index, newMessage)}
                    onDelete={() => onDelete(index)}
                  />
                </div>
              )
            );
          })}
          {currentAiMessage && (
            <div
              className="tw-w-full"
              style={{
                minHeight: `${containerMinHeight}px`,
              }}
            >
              <ChatSingleMessage
                key={streamingMessageId ?? "ai_message_streaming"}
                message={{
                  id: streamingMessageId ?? undefined,
                  sender: "AI",
                  message: currentAiMessage,
                  isVisible: true,
                  timestamp: null,
                }}
                app={app}
                isStreaming={true}
                onDelete={() => {}}
              />
            </div>
          )}
          {/* Waiting for the first token: no content to mark down yet, so the
                status line is rendered directly rather than through the renderer */}
          {!currentAiMessage && loading && (
            <div className="tw-w-full tw-p-2">
              <GeneratingIndicator isGenerating={loading} loadingMessage={loadingMessage} />
            </div>
          )}
        </div>
        {showScrollToBottom && (
          <button
            type="button"
            aria-label="Scroll to bottom"
            onClick={() => scrollToBottom()}
            className="tw-absolute tw-bottom-3 tw-left-1/2 tw-z-modal tw-flex tw-size-7 tw--translate-x-1/2 tw-items-center tw-justify-center tw-rounded-full tw-border tw-border-solid tw-border-border tw-bg-primary tw-text-muted tw-shadow-md tw-transition-colors hover:tw-text-accent"
          >
            <ArrowDown className="tw-size-4" />
          </button>
        )}
      </div>
    );
  }
);

ChatMessages.displayName = "ChatMessages";

export default ChatMessages;
