import * as assert from 'assert';
import { resolveUsageStatsTarget } from '../extension.js';
import getScript, { getSessionTokenTotals } from '../script.js';

suite('Usage panel routing', () => {
	test('routes usage button to local stats modal', () => {
		assert.strictEqual(resolveUsageStatsTarget('api'), 'local-modal');
		assert.strictEqual(resolveUsageStatsTarget('plan'), 'local-modal');
	});
});

suite('Usage stats script', () => {
	test('renders session tokens from anthropic aggregate totals', () => {
		const script = getScript(false);
		assert.ok(script.includes('const sessionInputTokens = (anthropicTotalInputTokens + anthropicTotalOutputTokens) > 0 ? anthropicTotalInputTokens : totalTokensInput;'));
		assert.ok(script.includes('const sessionOutputTokens = (anthropicTotalInputTokens + anthropicTotalOutputTokens) > 0 ? anthropicTotalOutputTokens : totalTokensOutput;'));
		assert.ok(script.includes('formatTokenCount(sessionInputTokens)'));
		assert.ok(script.includes('formatTokenCount(sessionOutputTokens)'));
	});
});

suite('Session token totals', () => {
	test('prefers local Anthropic aggregate totals over direct session totals', () => {
		const totals = getSessionTokenTotals({
			totalTokensInput: 0,
			totalTokensOutput: 0,
			anthropicTotalInputTokens: 123,
			anthropicTotalOutputTokens: 456,
		});
		assert.strictEqual(totals.input, 123);
		assert.strictEqual(totals.output, 456);
	});

	test('falls back to direct session totals when anthropic aggregates are empty', () => {
		const totals = getSessionTokenTotals({
			totalTokensInput: 10,
			totalTokensOutput: 20,
			anthropicTotalInputTokens: 0,
			anthropicTotalOutputTokens: 0,
		});
		assert.strictEqual(totals.input, 10);
		assert.strictEqual(totals.output, 20);
	});
});

suite('Router Anthropic usage stats', () => {
	test('always uses local usage stats view', async () => {
		const extension = await import('../extension.js');
		assert.strictEqual(typeof (extension as any).shouldOpenLocalUsageStats, 'function');
		assert.strictEqual((extension as any).shouldOpenLocalUsageStats('api'), true);
		assert.strictEqual((extension as any).shouldOpenLocalUsageStats('plan'), true);
	});

	test('accumulates token totals and computes cache hit rate', async () => {
		const router = await import('../router/index.js');
		const resetStats = (router as any).__testResetAnthropicUsageStats;
		const recordUsage = (router as any).__testRecordAnthropicUsage;
		const getStats = (router as any).__testGetAnthropicUsageStats;

		assert.strictEqual(typeof resetStats, 'function');
		assert.strictEqual(typeof recordUsage, 'function');
		assert.strictEqual(typeof getStats, 'function');

		resetStats();
		recordUsage({
			input_tokens: 100,
			output_tokens: 40,
			cache_read_input_tokens: 300,
			cache_creation_input_tokens: 20,
		});
		recordUsage({
			input_tokens: 100,
			output_tokens: 60,
			cache_read_input_tokens: 100,
			cache_creation_input_tokens: 10,
		});

		const stats = getStats();
		assert.strictEqual(stats.totalInputTokens, 200);
		assert.strictEqual(stats.totalOutputTokens, 100);
		assert.strictEqual(stats.totalCacheReadInputTokens, 400);
		assert.strictEqual(stats.totalCacheCreationInputTokens, 30);
		assert.strictEqual(stats.cacheHitRate, 400 / 600);
	});

	test('keeps cache hit rate at zero when no input tokens were recorded', async () => {
		const router = await import('../router/index.js');
		const resetStats = (router as any).__testResetAnthropicUsageStats;
		const getStats = (router as any).__testGetAnthropicUsageStats;
		resetStats();
		const stats = getStats();
		assert.strictEqual(stats.totalInputTokens, 0);
		assert.strictEqual(stats.totalOutputTokens, 0);
		assert.strictEqual(stats.totalCacheReadInputTokens, 0);
		assert.strictEqual(stats.totalCacheCreationInputTokens, 0);
		assert.strictEqual(stats.cacheHitRate, 0);
	});
});
