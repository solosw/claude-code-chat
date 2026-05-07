interface AnthropicUsageLike {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
}

export interface AnthropicUsageStats {
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheReadInputTokens: number;
  totalCacheCreationInputTokens: number;
  cacheHitRate: number;
}

let stats: AnthropicUsageStats = {
  totalInputTokens: 0,
  totalOutputTokens: 0,
  totalCacheReadInputTokens: 0,
  totalCacheCreationInputTokens: 0,
  cacheHitRate: 0,
};

function recalculateCacheHitRate(): void {
  const totalPromptTokens = stats.totalInputTokens + stats.totalCacheReadInputTokens;
  stats.cacheHitRate = totalPromptTokens > 0
    ? stats.totalCacheReadInputTokens / totalPromptTokens
    : 0;
}

export function recordAnthropicUsage(usage?: AnthropicUsageLike | null): void {
  if (!usage || typeof usage !== 'object') {
    return;
  }

  stats.totalInputTokens += Number(usage.input_tokens || 0);
  stats.totalOutputTokens += Number(usage.output_tokens || 0);
  stats.totalCacheReadInputTokens += Number(usage.cache_read_input_tokens || 0);
  stats.totalCacheCreationInputTokens += Number(usage.cache_creation_input_tokens || 0);
  recalculateCacheHitRate();
}

export function getAnthropicUsageStats(): AnthropicUsageStats {
  return { ...stats };
}

export function resetAnthropicUsageStats(): void {
  stats = {
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalCacheReadInputTokens: 0,
    totalCacheCreationInputTokens: 0,
    cacheHitRate: 0,
  };
}
