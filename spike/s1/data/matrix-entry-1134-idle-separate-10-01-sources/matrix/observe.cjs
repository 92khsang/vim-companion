const { createHash } = require("node:crypto");
const hash = (value) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");

exports.observe = async (readEngine, readLeader) => {
  const started = performance.now();
  const before = readEngine();
  const leader = await readLeader();
  const after = readEngine();
  const beforeSha256 = hash(before);
  const afterSha256 = hash(after);
  return {
    ...after,
    leader,
    matrixObservation: {
      timeOrigin: performance.timeOrigin,
      started,
      finished: performance.now(),
      beforeSha256,
      afterSha256,
      engineStable: beforeSha256 === afterSha256,
    },
  };
};
