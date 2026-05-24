import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { OpenAIBridgeRuntimeConfig } from './types';

const DEFAULT_BASE_URL = 'https://opencode.ai/zen/go/v1';
const DEFAULT_MODELS = ['deepseek-v4-pro[1m]', 'deepseek-v4-flash'];
const DEFAULT_REASONING_CACHE_PATH = path.join(os.homedir(), '.claude', 'deepseek-v4-opencode-claude-code-bridge-reasoning-cache.json');
const DEFAULT_REQUEST_BODY_LIMIT_BYTES = 100 * 1024 * 1024;
const DEFAULT_UPSTREAM_TIMEOUT_MS = 10 * 60 * 1000;
const DEFAULT_WORKSPACE_REASONING_CACHE_RELATIVE_PATH = path.join('.claude', 'reasoning-cache.json');

function readJson(file: string): any {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function argValue(name: string): string | null {
  const prefix = `${name}=`;
  for (let i = 2; i < process.argv.length; i += 1) {
    const arg = process.argv[i];
    if (arg === name) return process.argv[i + 1] || null;
    if (arg.startsWith(prefix)) return arg.slice(prefix.length);
  }
  return null;
}

function expandHome(value: string): string {
  if (!value) return value;
  if (value === '~') return os.homedir();
  if (value.startsWith('~/') || value.startsWith('~\\')) {
    return path.join(os.homedir(), value.slice(2));
  }
  return value;
}

function resolveMaybeRelative(value: string, baseDir: string): string {
  const expanded = expandHome(value);
  if (!expanded || path.isAbsolute(expanded)) return expanded;
  return path.resolve(baseDir, expanded);
}

function numberConfig(value: any, fallback: number): number {
  const parsed = Number(value ?? fallback);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeBaseUrl(url: string): string {
  const base = (url || DEFAULT_BASE_URL).replace(/\/+$/, '');
  return base.endsWith('/v1') ? base : `${base}/v1`;
}

function resolveReasoningCachePath(
  configuredValue: string,
  workspaceDir: string,
  configDir: string,
  fallbackPath: string
): string {
  const trimmedValue = String(configuredValue || '').trim();
  if (trimmedValue) {
    return resolveMaybeRelative(trimmedValue, configDir);
  }
  if (workspaceDir) {
    return path.join(workspaceDir, DEFAULT_WORKSPACE_REASONING_CACHE_RELATIVE_PATH);
  }
  return fallbackPath;
}

export const __testResolveReasoningCachePath = resolveReasoningCachePath;

export function loadBridgeConfig(): OpenAIBridgeRuntimeConfig {
  const defaultPath = path.join(__dirname, 'config.json');
  const configPath = process.env.CLAUDE_OPENCODE_PROXY_CONFIG || argValue('--config') || defaultPath;
  const resolvedPath = path.resolve(configPath);
  const fileConfig = readJson(resolvedPath) || {};
  const configDir = path.dirname(resolvedPath);
  const workspaceDir = String(process.env.CLAUDE_CODE_WORKSPACE || process.env.PWD || '').trim();

  return {
    configPath: resolvedPath,
    listenHost: fileConfig?.listen?.host || '127.0.0.1',
    port: numberConfig(fileConfig?.listen?.port, 8787),
    upstreamBaseUrl: normalizeBaseUrl(fileConfig?.upstream?.baseUrl || DEFAULT_BASE_URL),
    models: Array.isArray(fileConfig?.models) && fileConfig.models.length ? fileConfig.models : DEFAULT_MODELS,
    reasoningContentMode: String(fileConfig?.reasoningContent || 'auto'),
    reasoningCachePath: resolveReasoningCachePath(fileConfig?.reasoningCachePath || '', workspaceDir, configDir, DEFAULT_REASONING_CACHE_PATH),
    requestBodyLimitBytes: numberConfig(fileConfig?.requestBodyLimitBytes, DEFAULT_REQUEST_BODY_LIMIT_BYTES),
    upstreamTimeoutMs: numberConfig(fileConfig?.upstreamTimeoutMs, DEFAULT_UPSTREAM_TIMEOUT_MS)
  };
}
