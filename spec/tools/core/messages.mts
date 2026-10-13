// The text that a tool prints when it cannot run; the tools/*.mts shells print it on stderr.

/** Each message after `prefix`, such as "gen: ". */
export function prefixLines(
  prefix: string,
  messages: readonly string[],
): string[] {
  return messages.map((message) => `${prefix}${message}`);
}

/** The message of a thrown Error; "" for any other thrown value. */
export function thrownMessage(error: unknown): string {
  return error instanceof Error ? error.message : "";
}
