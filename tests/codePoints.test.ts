import { codePointLength, sliceCodePoints, spanText } from '@/domain/codePoints';
import { alignedSpanV1Schema, alignedTrackV1Schema } from '@/types/generated';
import { describe, expect, it } from 'vitest';

describe('code-point offsets (lacing aligned-track chars)', () => {
  const text = '🎵 la 𠀀 la'; // an emoji and a CJK extension char: 2 UTF-16 units each

  it('slices by code point, not by UTF-16 unit', () => {
    expect(codePointLength(text)).toBe(9);
    expect(sliceCodePoints(text, [7, 9])).toBe('la');
    expect(text.slice(7, 9)).not.toBe('la'); // what a naive slice would return
    expect(spanText(text, [2, 4])).toBe('la');
    expect(spanText(text, null)).toBeNull();
  });

  it('parses chars as a [start, end] tuple, not an any-array', () => {
    const span = { level: 'word', chars: [2, 4], time: { kind: 'measured' } };
    expect(alignedSpanV1Schema.safeParse(span).success).toBe(true);
    expect(alignedSpanV1Schema.safeParse({ ...span, chars: [2] }).success).toBe(false);
    expect(alignedSpanV1Schema.safeParse({ ...span, chars: ['a', 'b'] }).success).toBe(false);
  });

  it('types the spans of a track (no longer z.any())', () => {
    const bad = { asset_id: 'a', text: 't', spans: [{ level: 'nope' }] };
    expect(alignedTrackV1Schema.safeParse(bad).success).toBe(false);
  });
});
