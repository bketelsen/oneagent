/**
 * Token cost estimation utility.
 *
 * Estimates the dollar cost of an agent run based on model and token counts.
 */

interface ModelPricing {
  /** Price per 1M input tokens (USD) */
  input: number;
  /** Price per 1M output tokens (USD) */
  output: number;
}

/** Per-1M-token pricing for known models. */
const MODEL_PRICING: Record<string, ModelPricing> = {
  "claude-opus-4-6": { input: 15, output: 75 },
  "claude-sonnet-4-6": { input: 3, output: 15 },
  "claude-haiku-4-5-20251001": { input: 0.8, output: 4 },
};

/**
 * Estimate the dollar cost of a model invocation.
 *
 * @returns Estimated cost in USD, or 0 when the cost cannot be determined
 *          (unknown model, undefined model, or claude-code provider).
 */
export function estimateCost(
  provider: string,
  model: string | undefined,
  tokensIn: number,
  tokensOut: number,
): number {
  // claude-code is billed separately via subscription
  if (provider === "claude-code") {
    return 0;
  }

  if (!model) {
    return 0;
  }

  const pricing = MODEL_PRICING[model];
  if (!pricing) {
    return 0;
  }

  return (tokensIn * pricing.input + tokensOut * pricing.output) / 1_000_000;
}
