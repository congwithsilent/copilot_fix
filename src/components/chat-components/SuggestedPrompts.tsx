import { useChainType } from "@/aiParams";
import { ChainType } from "@/chainFactory";
import { Button } from "@/components/ui/button";
import { VAULT_VECTOR_STORE_STRATEGY } from "@/constants";
import { useSettingsValue } from "@/settings/model";
import { PlusCircle, TriangleAlert } from "lucide-react";
import React, { useMemo } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

interface NotePrompt {
  title: string;
  prompts: string[];
}

const SUGGESTED_PROMPTS: Record<string, NotePrompt> = {
  activeNote: {
    title: "Active Note Insights",
    prompts: [
      `Provide three follow-up questions worded as if I'm asking you based on {activeNote}?`,
      `What key questions does {activeNote} answer?`,
      `Give me a quick recap of {activeNote} in two sentences.`,
    ],
  },
  quoteNote: {
    title: "Note Link Chat",
    prompts: [
      `Based on [[<note>]], what improvements should we focus on next?`,
      `Summarize the key points from [[<note>]].`,
      `Summarize the recent updates from [[<note>]].`,
      `Roast my writing in [[<note>]] and give concrete actionable feedback`,
    ],
  },
  fun: {
    title: "Test LLM",
    prompts: [
      `9.11 and 9.8, which is bigger?`,
      `What's the longest river in the world?`,
      `If a lead ball and a feather are dropped simultaneously from the same height, which will reach the ground first?`,
    ],
  },
  qaVault: {
    title: "Vault Q&A",
    prompts: [
      `What insights can I gather about <topic> from my notes?`,
      `Explain <concept> based on my stored notes.`,
      `Highlight important details on <topic> from my notes.`,
      `Based on my notes on <topic>, what is the question that I should be asking, but am not?`,
    ],
  },
  copilotPlus: {
    title: "Copilot Plus",
    prompts: [
      `Give me a recap of last week @vault`,
      `What are the key takeaways from my notes on <topic> @vault`,
      `Summarize <url> in under 10 bullet points`,
      `Summarize <youtube_video_url>`,
      `@websearch what are most recent updates in the AI industry`,
      `What are the key insights from this paper <arxiv_url>`,
      `What new methods are proposed in this paper [[<note_with_embedded_pdf>]]`,
    ],
  },
};

const PROMPT_KEYS: Record<ChainType, Array<keyof typeof SUGGESTED_PROMPTS>> = {
  [ChainType.LLM_CHAIN]: ["activeNote", "quoteNote", "fun"],
  [ChainType.VAULT_QA_CHAIN]: ["qaVault", "qaVault", "quoteNote"],
  [ChainType.COPILOT_PLUS_CHAIN]: ["copilotPlus", "copilotPlus", "copilotPlus"],
  [ChainType.PROJECT_CHAIN]: ["copilotPlus", "copilotPlus", "copilotPlus"],
};

function getRandomPrompt(chainType: ChainType = ChainType.LLM_CHAIN) {
  const keys = PROMPT_KEYS[chainType] || PROMPT_KEYS[ChainType.LLM_CHAIN];

  // For repeated keys, shuffle once and take multiple items
  const shuffledPrompts: Record<string, string[]> = {};

  return keys.map((key) => {
    if (!shuffledPrompts[key]) {
      shuffledPrompts[key] = [...SUGGESTED_PROMPTS[key].prompts].sort(() => Math.random() - 0.5);
    }
    return {
      title: SUGGESTED_PROMPTS[key].title,
      text: shuffledPrompts[key].pop() || SUGGESTED_PROMPTS[key].prompts[0],
    };
  });
}

interface SuggestedPromptsProps {
  onClick: (text: string) => void;
}

export const SuggestedPrompts: React.FC<SuggestedPromptsProps> = ({ onClick }) => {
  const [chainType] = useChainType();
  const prompts = useMemo(() => getRandomPrompt(chainType), [chainType]);
  const settings = useSettingsValue();
  const indexVaultToVectorStore = settings.indexVaultToVectorStore as VAULT_VECTOR_STORE_STRATEGY;

  return (
    <div className="tw-flex tw-flex-col tw-gap-3">
      <section>
        <h3 className="tw-mb-1 tw-mt-0 tw-px-1 tw-text-sm tw-font-medium tw-text-normal">
          Suggested prompts
        </h3>
        <div className="tw-flex tw-flex-col">
          {prompts.map((prompt, i) => (
            <div
              key={i}
              className="copilot-prompt-row tw-flex tw-items-start tw-justify-between tw-gap-2 tw-rounded-md tw-p-2 tw-text-sm"
            >
              <div className="tw-flex tw-min-w-0 tw-flex-col tw-gap-1">
                <div className="tw-text-xs tw-text-faint">{prompt.title}</div>
                <div className="tw-leading-normal tw-text-muted">{prompt.text}</div>
              </div>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost2"
                    size="icon"
                    className="tw-shrink-0"
                    onClick={() => onClick(prompt.text)}
                    aria-label="Add prompt to chat"
                  >
                    <PlusCircle className="tw-size-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Add to chat</TooltipContent>
              </Tooltip>
            </div>
          ))}
        </div>
      </section>
      {chainType === ChainType.VAULT_QA_CHAIN && (
        <div className="tw-rounded-md tw-bg-secondary-alt tw-p-3 tw-text-sm tw-leading-normal tw-text-muted">
          Retrieval-based QA works best when your question contains keywords and concepts that exist
          literally in your vault.
        </div>
      )}
      {chainType === ChainType.VAULT_QA_CHAIN &&
        indexVaultToVectorStore === VAULT_VECTOR_STORE_STRATEGY.NEVER && (
          <div className="tw-flex tw-items-start tw-gap-2 tw-rounded-md tw-bg-callout-warning/10 tw-p-3 tw-text-sm tw-text-muted">
            <TriangleAlert className="tw-mt-0.5 tw-size-4 tw-shrink-0 tw-text-warning" />
            <span>
              Your auto-index strategy is <b>NEVER</b>. Refresh the index before asking questions,
              or run <b>Copilot command: Index (refresh) vault for QA</b>.
            </span>
          </div>
        )}
    </div>
  );
};
