/**
 * Cost estimation utilities for token usage.
 *
 * Default pricing is based on Claude (Anthropic) rates.
 * All prices are expressed as cost per 1 million tokens.
 */

/** Cost per 1M input tokens (USD). */
export const DEFAULT_INPUT_COST_PER_MILLION = 15;

/** Cost per 1M output tokens (USD). */
export const DEFAULT_OUTPUT_COST_PER_MILLION = 75;

/**
 * Calculate estimated cost in USD from token counts.
 *
 * @param tokensIn  Number of input tokens
 * @param tokensOut Number of output tokens
 * @param inputCostPerMillion  Cost per 1M input tokens (default $15)
 * @param outputCostPerMillion Cost per 1M output tokens (default $75)
 * @returns Estimated cost in USD
 */
export function getCostEstimate(
  tokensIn: number,
  tokensOut: number,
  inputCostPerMillion: number = DEFAULT_INPUT_COST_PER_MILLION,
  outputCostPerMillion: number = DEFAULT_OUTPUT_COST_PER_MILLION,
): number {
  return (
    (tokensIn / 1_000_000) * inputCostPerMillion +
    (tokensOut / 1_000_000) * outputCostPerMillion
  );
}

/**
 * Format a cost value as a USD string with 2 decimal places.
 *
 * @example formatCost(0.4275) => "$0.43"
 */
export function formatCost(cost: number): string {
  return `$${cost.toFixed(2)}`;
}
