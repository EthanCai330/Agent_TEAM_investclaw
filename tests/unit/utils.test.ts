/**
 * Utility Functions Tests
 */
import { describe, it, expect } from 'vitest';
import { cn, formatDuration, formatElapsedDuration, truncate } from '@/lib/utils';

describe('cn (class name merge)', () => {
  it('should merge class names', () => {
    expect(cn('foo', 'bar')).toBe('foo bar');
  });
  
  it('should handle conditional classes', () => {
    expect(cn('base', 'active')).toBe('base active');
    expect(cn('base', false)).toBe('base');
  });
  
  it('should merge tailwind classes correctly', () => {
    expect(cn('px-2', 'px-4')).toBe('px-4');
    expect(cn('text-red-500', 'text-blue-500')).toBe('text-blue-500');
  });
});

describe('formatDuration', () => {
  it('should format seconds only', () => {
    expect(formatDuration(45)).toBe('45s');
  });
  
  it('should format minutes and seconds', () => {
    expect(formatDuration(125)).toBe('2m 5s');
  });
  
  it('should format hours and minutes', () => {
    expect(formatDuration(3725)).toBe('1h 2m');
  });
});

describe('formatElapsedDuration', () => {
  it('should format seconds without padding', () => {
    expect(formatElapsedDuration(42)).toBe('42s');
  });

  it('should format minutes and seconds with padded seconds', () => {
    expect(formatElapsedDuration(629)).toBe('10m 29s');
  });

  it('should format hours, minutes, and seconds with padded minutes and seconds', () => {
    expect(formatElapsedDuration(3723)).toBe('1h 02m 03s');
  });
});

describe('truncate', () => {
  it('should not truncate short text', () => {
    expect(truncate('Hello', 10)).toBe('Hello');
  });
  
  it('should truncate long text with ellipsis', () => {
    expect(truncate('Hello World!', 8)).toBe('Hello...');
  });
});
