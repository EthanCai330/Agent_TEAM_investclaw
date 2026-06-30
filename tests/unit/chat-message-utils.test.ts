import { describe, expect, it } from 'vitest';

import { formatExactTimestamp } from '@/pages/Chat/message-utils';
import { extractRawFilePaths } from '@/stores/chat/helpers';

describe('chat message timestamp helpers', () => {
  it('formats exact hover timestamps from millisecond values', () => {
    const timestamp = new Date(2026, 5, 23, 15, 8, 45).getTime();

    expect(formatExactTimestamp(timestamp)).toBe('2026-06-23 15:08:45');
  });

  it('formats exact hover timestamps from second values', () => {
    const timestamp = Math.floor(new Date(2026, 5, 23, 15, 8, 45).getTime() / 1000);

    expect(formatExactTimestamp(timestamp)).toBe('2026-06-23 15:08:45');
  });
});

describe('chat raw file path extraction', () => {
  it('ignores bare root-level filenames that are likely prompt text, not real artifacts', () => {
    const refs = extractRawFilePaths('请查看 /scorecard.csv、/error_results.csv 和 /report.md。');

    expect(refs).toEqual([]);
  });

  it('keeps real absolute artifact paths', () => {
    const refs = extractRawFilePaths('产物：/workspace/project/experiment_results/version_1/agent_b/round_1/llm_candidates.json');

    expect(refs).toEqual([{
      filePath: '/workspace/project/experiment_results/version_1/agent_b/round_1/llm_candidates.json',
      mimeType: 'application/json',
    }]);
  });
});
