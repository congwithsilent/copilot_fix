import React from "react";
import { CustomModel } from "@/aiParams";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { ParameterControl } from "@/components/ui/parameter-controls";
import { SettingSwitch } from "@/components/ui/setting-switch";
import { Label } from "@/components/ui/label";
import {
  ChatModelProviders,
  DEFAULT_MODEL_SETTING,
  DEFAULT_OLLAMA_NUM_CTX,
  ModelCapability,
  ReasoningEffort,
} from "@/constants";
import { CopilotSettings } from "@/settings/model";
import {
  getDefaultReasoningEffort,
  getDefaultVerbosity,
  REASONING_EFFORT_OPTIONS,
  VERBOSITY_OPTIONS,
} from "@/utils/modelParamsHelper";

/**
 * Parameter range configuration
 */
const PARAM_RANGES = {
  temperature: { min: 0, max: 2, step: 0.01, default: DEFAULT_MODEL_SETTING.TEMPERATURE },
  topP: { min: 0, max: 1, step: 0.05, default: 0.9 },
  frequencyPenalty: { min: 0, max: 2, step: 0.05, default: 0 },
  maxTokens: { min: 100, max: 128000, step: 100, default: DEFAULT_MODEL_SETTING.MAX_TOKENS },
  numCtx: { min: 0, max: DEFAULT_OLLAMA_NUM_CTX, step: 1024, default: DEFAULT_OLLAMA_NUM_CTX },
};

interface ModelParametersEditorProps {
  model: CustomModel;
  settings: CopilotSettings;
  onChange: (field: keyof CustomModel, value: any) => void;
  onReset?: (field: keyof CustomModel) => void;
  showTokenLimit?: boolean; // Whether to show Token limit, defaults to true
}

/**
 * Shared model parameters editor component.
 * Used by ChatSettingsPopover and ModelEditDialog.
 */
export function ModelParametersEditor({
  model,
  settings,
  onChange,
  onReset,
  showTokenLimit = true,
}: ModelParametersEditorProps) {
  const isOllamaModel = model.provider === ChatModelProviders.OLLAMA;

  // Parameter values: model.xxx ?? settings.xxx
  const temperature = model.temperature ?? settings.temperature;
  const maxTokens = model.maxTokens ?? settings.maxTokens;
  const topP = model.topP;
  const frequencyPenalty = model.frequencyPenalty;
  // Reason: Ollama defaults to a small num_ctx (2048), so we default to 131072
  // for backward compatibility. Users can adjust via slider.
  const numCtx = isOllamaModel ? (model.numCtx ?? PARAM_RANGES.numCtx.default) : model.numCtx;
  const reasoningEffort = model.reasoningEffort;
  const verbosity = model.verbosity;

  // Check if this is an OpenAI native reasoning model
  const isOpenAIReasoningModel =
    (model.name.startsWith("o1") ||
      model.name.startsWith("o3") ||
      model.name.startsWith("o4") ||
      model.name.startsWith("gpt-5")) &&
    model.provider === ChatModelProviders.OPENAI;

  // Check if model has REASONING capability enabled
  const hasReasoningCapability = model.capabilities?.includes(ModelCapability.REASONING) ?? false;

  // Show reasoning effort for: OpenAI reasoning models, OpenRouter, LM Studio, or any model with REASONING capability
  const showReasoningEffort =
    isOpenAIReasoningModel ||
    model.provider === ChatModelProviders.OPENROUTERAI ||
    model.provider === "lm_studio" ||
    model.provider === ChatModelProviders.LM_STUDIO ||
    hasReasoningCapability;
  const showVerbosity =
    model.name.startsWith("gpt-5") && model.provider === ChatModelProviders.OPENAI;

  return (
    <div className="tw-space-y-4">
      {/* Token limit */}
      {showTokenLimit && (
        <FormField>
          <ParameterControl
            type="slider"
            optional={false}
            label="Token limit"
            value={maxTokens}
            onChange={(value) => onChange("maxTokens", value)}
            max={PARAM_RANGES.maxTokens.max}
            min={PARAM_RANGES.maxTokens.min}
            step={PARAM_RANGES.maxTokens.step}
            defaultValue={PARAM_RANGES.maxTokens.default}
            helpText={
              <>
                <p>
                  The maximum number of <em>output tokens</em> to generate. Default is{" "}
                  {PARAM_RANGES.maxTokens.default}.
                </p>
                <em>
                  This number plus the length of your prompt (input tokens) must be smaller than the
                  context window of the model.
                </em>
              </>
            }
          />
        </FormField>
      )}

      {/* num_ctx - Ollama only */}
      {isOllamaModel && (
        <FormField>
          <ParameterControl
            type="slider"
            optional={false}
            label="num_ctx"
            value={numCtx}
            onChange={(value) => onChange("numCtx", value)}
            min={PARAM_RANGES.numCtx.min}
            max={PARAM_RANGES.numCtx.max}
            step={PARAM_RANGES.numCtx.step}
            defaultValue={PARAM_RANGES.numCtx.default}
            helpText={
              <>
                <p>
                  The <code>num_ctx</code> parameter sent to Ollama. Controls how many tokens the
                  model can use as context. Default is {DEFAULT_OLLAMA_NUM_CTX}.
                </p>
                <em>
                  Lower this value to reduce VRAM usage on GPUs with limited memory. Ollama will cap
                  this at the model&apos;s actual maximum.
                </em>
              </>
            }
          />
        </FormField>
      )}

      {/* Temperature */}
      <FormField>
        <ParameterControl
          type="slider"
          optional={false}
          label="Temperature"
          value={temperature}
          onChange={(value) => onChange("temperature", value)}
          min={PARAM_RANGES.temperature.min}
          max={PARAM_RANGES.temperature.max}
          step={PARAM_RANGES.temperature.step}
          defaultValue={PARAM_RANGES.temperature.default}
          helpText={`Default is ${PARAM_RANGES.temperature.default}. Higher values will result in more creativeness, but also more mistakes. Set to 0 for no randomness.`}
        />
      </FormField>

      {/* Top-P */}
      <FormField>
        <ParameterControl
          type="slider"
          optional={true}
          label="Top-P"
          value={topP}
          onChange={(value) => onChange("topP", value)}
          disableFn={onReset ? () => onReset("topP") : undefined}
          min={PARAM_RANGES.topP.min}
          max={PARAM_RANGES.topP.max}
          step={PARAM_RANGES.topP.step}
          defaultValue={PARAM_RANGES.topP.default}
          helpText={`Default value is ${PARAM_RANGES.topP.default}, the smaller the value, the less variety in the answers, the easier to understand, the larger the value, the larger the range of the AI's vocabulary, the more diverse`}
        />
      </FormField>

      {/* Frequency Penalty */}
      <FormField>
        <ParameterControl
          type="slider"
          optional={true}
          label="Frequency Penalty"
          value={frequencyPenalty}
          onChange={(value) => onChange("frequencyPenalty", value)}
          disableFn={onReset ? () => onReset("frequencyPenalty") : undefined}
          min={PARAM_RANGES.frequencyPenalty.min}
          max={PARAM_RANGES.frequencyPenalty.max}
          step={PARAM_RANGES.frequencyPenalty.step}
          defaultValue={PARAM_RANGES.frequencyPenalty.default}
          helpText={
            <>
              <p>
                The frequency penalty parameter tells the model not to repeat a word that has
                already been used multiple times in the conversation.
              </p>
              <em>The higher the value, the more the model is penalized for repeating words.</em>
            </>
          }
        />
      </FormField>

      {/* Reasoning Effort - For models with reasoning capability */}
      {showReasoningEffort && (
        <FormField>
          <ParameterControl
            type="select"
            optional={true}
            label="Reasoning Effort"
            value={reasoningEffort}
            onChange={(value) => onChange("reasoningEffort", value)}
            disableFn={onReset ? () => onReset("reasoningEffort") : undefined}
            defaultValue={settings.reasoningEffort ?? getDefaultReasoningEffort()}
            options={(() => {
              const opts = [...REASONING_EFFORT_OPTIONS];
              if (reasoningEffort && !opts.some((opt) => opt.value === reasoningEffort)) {
                opts.push({
                  value: reasoningEffort as ReasoningEffort,
                  label: `Custom (${reasoningEffort})`,
                });
              }
              return opts;
            })()}
            helpText={
              <>
                <p>
                  Controls the amount of reasoning effort the model uses. Higher effort provides
                  more thorough reasoning but takes longer. Supported across OpenAI, OpenRouter, and
                  OpenAI-compatible/domestic endpoints.
                </p>
                <ul className="tw-mt-2 tw-space-y-1 tw-text-xs">
                  <li>
                    <strong>None:</strong> Disable reasoning / thinking tokens
                  </li>
                  <li>
                    <strong>Minimal:</strong> Fastest response, minimal thinking (e.g. GPT-5)
                  </li>
                  <li>
                    <strong>Low:</strong> Faster responses, basic reasoning (default)
                  </li>
                  <li>
                    <strong>Medium:</strong> Balanced performance and thoroughness
                  </li>
                  <li>
                    <strong>High:</strong> In-depth reasoning and rigorous validation
                  </li>
                  <li>
                    <strong>Extra High:</strong> Maximum depth for o-series / GPT-5.4 (xhigh)
                  </li>
                  <li>
                    <strong>Max:</strong> Full-budget / maximum thinking depth (common in Chinese
                    models & gateways)
                  </li>
                  <li>
                    <strong>Auto:</strong> Automatically managed by model / gateway
                  </li>
                </ul>
                {!hasReasoningCapability && !isOpenAIReasoningModel && (
                  <p className="tw-mt-2 tw-text-warning">
                    Tip: Enable the &quot;Reasoning&quot; capability above to ensure thinking
                    streamer is active.
                  </p>
                )}
              </>
            }
          />
        </FormField>
      )}

      {/* Verbosity - Only for GPT-5 models */}
      {showVerbosity && (
        <FormField>
          <ParameterControl
            type="select"
            optional={true}
            label="Verbosity"
            value={verbosity}
            onChange={(value) => onChange("verbosity", value)}
            disableFn={onReset ? () => onReset("verbosity") : undefined}
            defaultValue={settings.verbosity ?? getDefaultVerbosity()}
            options={VERBOSITY_OPTIONS}
            helpText={
              <>
                <p>Controls the length and detail of the model responses.</p>
                <ul className="tw-mt-2 tw-space-y-1 tw-text-xs">
                  <li>Low: Concise, brief responses</li>
                  <li>Medium: Balanced detail</li>
                  <li>High: Detailed, comprehensive responses</li>
                </ul>
              </>
            }
          />
        </FormField>
      )}

      {/* Disable Thinking - For OpenAI format / compatible endpoints */}
      {(model.provider === ChatModelProviders.OPENAI_FORMAT ||
        model.provider === ChatModelProviders.SILICONFLOW ||
        model.provider === ChatModelProviders.OPENAI) && (
        <FormField>
          <div className="tw-space-y-1.5">
            <div className="tw-flex tw-items-center tw-justify-between">
              <Label htmlFor="disable-thinking" className="tw-text-sm tw-font-medium">
                Disable Thinking
              </Label>
              <SettingSwitch
                id="disable-thinking"
                checked={model.disableThinking ?? false}
                onCheckedChange={(checked) => onChange("disableThinking", checked)}
              />
            </div>
            <div className="tw-pr-12 tw-text-xs tw-leading-relaxed tw-text-muted">
              Explicitly disable deep thinking / reasoning in the request payload (sends{" "}
              <code>thinking: &#123; type: &quot;disabled&quot; &#125;</code>) for compatible models
              (e.g. Ark / 火山方舟, Kimi, etc.).
            </div>
          </div>
        </FormField>
      )}
      {/* OpenRouter endpoint routing */}
      {model.provider === ChatModelProviders.OPENROUTERAI && (
        <FormField>
          <div className="tw-space-y-3">
            <div className="tw-space-y-1.5">
              <Label htmlFor="openrouter-provider-only" className="tw-text-sm tw-font-medium">
                OpenRouter Endpoint(s)
              </Label>
              <Input
                id="openrouter-provider-only"
                type="text"
                placeholder="google-ai-studio/flex"
                value={model.openRouterProviderOnly ?? ""}
                onChange={(e) => onChange("openRouterProviderOnly", e.target.value)}
              />
              <div className="tw-pr-12 tw-text-xs tw-leading-relaxed tw-text-muted">
                Comma-separated endpoint tags from OpenRouter&apos;s endpoints API (sends{" "}
                <code>provider.only</code>). For example <code>google-ai-studio/flex</code> or{" "}
                <code>google-vertex/global/flex</code>. Leave empty to let OpenRouter choose.
              </div>
            </div>
            <div className="tw-flex tw-items-center tw-justify-between">
              <div>
                <Label htmlFor="openrouter-allow-fallbacks" className="tw-text-sm tw-font-medium">
                  Allow fallbacks
                </Label>
                <div className="tw-pr-12 tw-text-xs tw-leading-relaxed tw-text-muted">
                  When disabled, the request fails instead of routing to another endpoint (
                  <code>provider.allow_fallbacks: false</code>). Only applies when an endpoint is
                  specified above.
                </div>
              </div>
              <SettingSwitch
                id="openrouter-allow-fallbacks"
                checked={model.openRouterAllowFallbacks ?? true}
                onCheckedChange={(checked) => onChange("openRouterAllowFallbacks", checked)}
              />
            </div>
          </div>
        </FormField>
      )}
    </div>
  );
}
