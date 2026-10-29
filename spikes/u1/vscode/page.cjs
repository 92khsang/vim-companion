const { randomBytes } = require("node:crypto");

exports.page = (
  asset,
  state,
  source = "'self'",
  theme = null,
  host = "sidebar",
) => {
  if (!["sidebar", "panel"].includes(host))
    throw new Error(`Unknown host: ${host}`);
  if (
    ![
      "idle",
      "prefix",
      "badges",
      "grammar",
      ...Object.keys(require("../vim-learning.json").scenarios),
    ].includes(state)
  ) {
    throw new Error(`Unknown gallery state: ${state}`);
  }
  const nonce = randomBytes(18).toString("hex");
  return `<!doctype html>
<html lang="en" data-host="${host}"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${source}; script-src 'nonce-${nonce}'; img-src ${source};">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Vim Keys — ${state}</title>
${theme ? `<link rel="stylesheet" href="${theme}">` : ""}
<link rel="stylesheet" href="${asset("styles.css")}">
<script nonce="${nonce}" src="${asset("data.js")}" defer></script>
<script nonce="${nonce}" src="${asset("renderer.js")}" defer></script>
</head><body data-state="${state}"><main id="keys" aria-label="Vim Keys"></main></body></html>`;
};
