export interface Span {
  start: number;
  end: number;
  label: string;
}

export interface Segment {
  text: string;
  label: string | undefined;
}

/** Splits `text` into segments, tagging the ranges covered by `spans` with their label. */
export function highlightSpans(text: string, spans: Span[]): Segment[] {
  const sorted = [...spans].sort((a, b) => a.start - b.start);
  const segments: Segment[] = [];
  let cursor = 0;

  for (const span of sorted) {
    if (span.start > cursor) {
      segments.push({ text: text.slice(cursor, span.start), label: undefined });
    }
    segments.push({ text: text.slice(span.start, span.end), label: span.label });
    cursor = span.end;
  }
  if (cursor < text.length) {
    segments.push({ text: text.slice(cursor), label: undefined });
  }
  return segments;
}
