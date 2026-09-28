import { DEFAULT_MODEL_SETTING, ReasoningEffort, Verbosity } from "@/constants";

/**
 * Model parameters configuration interface
 */
export interface ModelParams {
  temperature?: number;
  topP?: number;
  frequencyPenalty?: number;
  maxTokens?: number;
  reasoningEffort?: ReasoningEffort | string;
  verbosity?: Verbosity;
}

/**
 * Reasoning effort options configuration covering all major protocols & providers
 */
export const REASONING_EFFORT_OPTIONS = [
  { value: ReasoningEffort.NONE, label: "None (关闭推理)" },
  { value: ReasoningEffort.MINIMAL, label: "Minimal (极低)" },
  { value: ReasoningEffort.LOW, label: "Low (低)" },
  { value: ReasoningEffort.MEDIUM, label: "Medium (中)" },
  { value: ReasoningEffort.HIGH, label: "High (高)" },
  { value: ReasoningEffort.XHIGH, label: "Extra High (超高 / xhigh)" },
  { value: ReasoningEffort.MAX, label: "Max (最大 / 顶格思考)" },
  { value: ReasoningEffort.AUTO, label: "Auto (自动)" },
];

/**
 * Verbosity options configuration
 */
export const VERBOSITY_OPTIONS = [
  { value: Verbosity.LOW, label: "Low" },
  { value: Verbosity.MEDIUM, label: "Medium" },
  { value: Verbosity.HIGH, label: "High" },
];

/**
 * Get the default reasoning effort value
 */
export function getDefaultReasoningEffort(): ReasoningEffort {
  return DEFAULT_MODEL_SETTING.REASONING_EFFORT;
}

/**
 * Get the default verbosity value
 */
export function getDefaultVerbosity(): Verbosity {
  return DEFAULT_MODEL_SETTING.VERBOSITY;
}
