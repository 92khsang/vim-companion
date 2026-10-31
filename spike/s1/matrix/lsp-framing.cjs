const { Buffer } = require("node:buffer");

exports.frame = (value) => {
  const body = Buffer.from(JSON.stringify(value));
  return Buffer.concat([
    Buffer.from(`Content-Length: ${body.length}\r\n\r\n`),
    body,
  ]);
};

exports.decoder = (receive) => {
  let buffered = Buffer.alloc(0);
  return (bytes) => {
    buffered = Buffer.concat([buffered, bytes]);
    for (;;) {
      const separator = buffered.indexOf("\r\n\r\n");
      if (separator === -1) {
        if (buffered.length > 8192) throw new Error("LSP header too large");
        return;
      }
      const header = buffered.subarray(0, separator).toString("ascii");
      const lengths = [...header.matchAll(/^Content-Length: (\d+)\r?$/gim)];
      if (lengths.length !== 1)
        throw new Error("LSP Content-Length missing or duplicated");
      const length = Number(lengths[0][1]);
      if (!Number.isSafeInteger(length) || length > 1048576)
        throw new Error("LSP body too large");
      const end = separator + 4 + length;
      if (buffered.length < end) return;
      const message = JSON.parse(
        buffered.subarray(separator + 4, end).toString("utf8"),
      );
      buffered = buffered.subarray(end);
      receive(message);
    }
  };
};
