// The text that a tool prints when it cannot run; the tools/*.mts shells print it on stderr.

/**
 * Each line of each message after `prefix`, such as "gen: ". A message can have several lines:
 * V8 quotes the text around a JSON syntax error, line breaks included.
 */
export function prefixLines(
  prefix: string,
  messages: readonly string[],
): string[] {
  return messages.flatMap((message) =>
    message.split("\n").map((line) => `${prefix}${line}`),
  );
}

/** The message of a thrown Error, or any other thrown value as text. */
export function thrownMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
