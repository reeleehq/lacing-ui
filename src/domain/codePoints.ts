// Code-point offsets — the unit of lacing's aligned-track `chars`.
//
// lacing counts `chars: [start, end)` in Unicode code points (Python string
// indices), NOT JavaScript UTF-16 code units: an emoji or a CJK extension
// character is one code point but two code units, so `text.slice(start, end)`
// cuts the wrong span after the first such character (lacing#179). These
// helpers index through `Array.from(text)`, which iterates code points.

/** The code points of `text`, one string each (`Array.from` iterates by code point). */
export function codePoints(text: string): string[] {
  return Array.from(text);
}

/** `text[start:end)` in code points, as lacing means a span's `chars`. */
export function sliceCodePoints(text: string, chars: readonly [number, number]): string {
  const [start, end] = chars;
  return codePoints(text).slice(start, end).join('');
}

/** A span's surface text from its track's `text` and `chars`; `null` when it has none. */
export function spanText(
  text: string,
  chars: readonly [number, number] | null | undefined,
): string | null {
  return chars == null ? null : sliceCodePoints(text, chars);
}

/** The code-point length of `text` (what `chars` offsets are bounded by). */
export function codePointLength(text: string): number {
  return codePoints(text).length;
}
