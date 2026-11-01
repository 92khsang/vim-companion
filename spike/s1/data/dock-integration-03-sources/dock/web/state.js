// Shared with deterministic tests; stale messages never revive an older prefix.
const S1_VIEW_STATE = {
  accept(current, message, instance) {
    if (
      message?.type !== "s1-state" ||
      message.instance !== instance ||
      !Number.isInteger(message.state?.revision) ||
      message.state.revision <= current.revision
    )
      return current;
    return { ...message.state, prefix: [...message.state.prefix] };
  },
};
if (typeof module !== "undefined") module.exports = S1_VIEW_STATE;
