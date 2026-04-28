export interface OpenAIBridgeRuntimeConfig {
  configPath: string;
  listenHost: string;
  port: number;
  upstreamBaseUrl: string;
  models: string[];
  reasoningContentMode: string;
  reasoningCachePath: string;
  requestBodyLimitBytes: number;
  upstreamTimeoutMs: number;
}
