import type { ProviderConfig } from '../../utils/secure-storage';

export function normalizeOpenAiCompatibleBaseUrl(baseUrl: string): string {
  let normalized = baseUrl.trim().replace(/\/+$/, '');
  normalized = normalized.replace(/\/(?:models)(?:\?.*)?$/i, '');
  normalized = normalized.replace(/\/chat\/completions$/i, '');
  normalized = normalized.replace(/\/responses?$/i, '');
  return normalized.replace(/\/+$/, '');
}

export function normalizeProviderBaseUrl(
  config: Pick<ProviderConfig, 'type' | 'apiProtocol'>,
  baseUrl?: string,
  apiProtocol?: string,
): string | undefined {
  if (!baseUrl) {
    return undefined;
  }

  const normalized = baseUrl.trim().replace(/\/+$/, '');

  if (config.type === 'minimax-portal' || config.type === 'minimax-portal-cn') {
    return normalized.replace(/\/v1$/, '').replace(/\/anthropic$/, '').replace(/\/$/, '') + '/anthropic';
  }

  if (config.type === 'custom' || config.type === 'ollama') {
    const protocol = apiProtocol || config.apiProtocol || 'openai-completions';
    if (protocol === 'openai-responses' || protocol === 'openai-completions') {
      return normalizeOpenAiCompatibleBaseUrl(normalized);
    }
    if (protocol === 'anthropic-messages') {
      return normalized.replace(/\/v1\/messages$/i, '').replace(/\/messages$/i, '');
    }
  }

  return normalized;
}
