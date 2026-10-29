/* global U1_DATA, acquireVsCodeApi */
const violations = [];
document.addEventListener("securitypolicyviolation", (event) => {
  violations.push({
    directive: event.violatedDirective,
    blocked: event.blockedURI,
  });
});
window.u1Violations = violations;

const container = document.querySelector("#keys");
const state = document.body.dataset.state;
const data = U1_DATA;
const badgeNames = {
  unsupported: ["⊘", "Unsupported"],
  "differs-from-vim": ["≠", "Differs from Vim"],
  fallback: ["↪", "Fallback"],
  experimental: ["◇", "Experimental"],
};
const element = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
};
const root = element("div", "content");
const key = (value) => element("kbd", "keycap", value);
const label = (text) => element("p", "eyebrow", text);
const muted = (text) => element("p", "muted", text);

function sequence(values) {
  const group = element("div", "sequence");
  values.forEach((value, index) => {
    if (index) group.append(element("span", "separator", "›"));
    group.append(key(value));
  });
  return group;
}

function header(title, prefix = [], eyebrow = "LEADER KEYS") {
  const header = element("header", "header");
  header.append(label(eyebrow));
  if (prefix.length) header.append(sequence(prefix));
  const heading = element("div", "heading");
  heading.append(element("h1", "", title));
  if (state === "prefix") {
    const chips = element("div", "chips");
    chips.append(
      element("span", "chip", "Visual"),
      element("span", "chip", "×3"),
    );
    heading.append(chips);
  }
  header.append(heading);
  return header;
}

function rows(items) {
  const list = element("ul", "rows");
  for (const item of items) {
    const row = element("li", `row${item.group ? " group" : ""}`);
    row.append(key(item.key));
    const content = element("div", "row-content");
    content.append(element("span", "row-label", item.label));
    if (item.badge) {
      const [icon, text] = badgeNames[item.badge];
      const badge = element("span", `badge ${item.badge}`);
      const symbol = element("span", "badge-icon", icon);
      symbol.setAttribute("aria-hidden", "true");
      badge.append(symbol, document.createTextNode(text));
      content.append(badge);
    }
    row.append(content);
    if (item.group) {
      const chevron = element("span", "chevron", "›");
      chevron.setAttribute("aria-hidden", "true");
      row.append(chevron);
    }
    list.append(row);
  }
  return list;
}

if (data.vim.scenarios[state]) {
  root.append(
    header("Start with Space"),
    muted("In the editor, press Space, then choose a key."),
    rows(data.idle.rows),
  );
} else if (state === "idle") {
  root.append(header("Start with Space"));
  const intro = muted("In the editor, press Space, then choose a key.");
  intro.classList.add("intro");
  root.append(intro, rows(data.idle.rows));
  const doctor = element("aside", "doctor");
  doctor.append(
    element("strong", "", "!  Setup needs attention"),
    element("p", "", "1 key conflict found. Run Doctor to review."),
  );
  root.append(doctor);
} else if (state === "grammar") {
  root.append(header("Build a Vim command", [], "VIM GRAMMAR"));
  root.append(muted("A small pattern. Many combinations."));
  const card = element("section", "grammar-card");
  card.append(
    label("OPERATOR  +  MOTION"),
    sequence(["d", "w"]),
    element("h2", "", "Delete to the next word"),
  );
  const parts = element("dl", "parts");
  for (const [symbol, explanation] of data.grammar.parts) {
    const term = element("dt", "");
    term.append(key(symbol));
    parts.append(term, element("dd", "", explanation));
  }
  card.append(
    parts,
    element(
      "p",
      "grammar-note",
      "A count repeats the motion: d2w deletes to the second next word.",
    ),
  );
  root.append(card, label("TRY THE SAME PATTERN"));
  const example = element("div", "example");
  example.append(key("c"), key("w"), element("span", "", "Change a word"));
  root.append(example, muted("Reference card · type in the editor"));
} else {
  root.append(header("Window", ["SPC", "w"]));
  const items = data[state].rows;
  const visible = data[state].visibleRows ?? items.length;
  root.append(rows(items.slice(0, visible)));
  if (visible < items.length)
    root.append(element("p", "more", `+${items.length - visible} more`));
  const footer = element("footer", "footer");
  footer.append(key("Esc"), element("span", "", "Cancel"));
  root.append(footer);
}

const tabs = element("nav", "tabs");
tabs.setAttribute("aria-label", "Learning views");
const leaderButton = element("button", "tab", "Leader");
const vimButton = element("button", "tab", "Vim");
leaderButton.type = vimButton.type = "button";
tabs.append(leaderButton, vimButton);
const learning = element("section", "learning");
learning.append(element("h1", "", "Learn Vim"));
const context = element("section", "context-card");
context.setAttribute("aria-label", "Example input guidance");
const browse = element("section", "browse");
browse.append(label("BROWSE REFERENCE"));
const categories = element("div", "categories");
const reference = element("div", "reference");
function selectCategory(id) {
  const category = data.vim.categories.find((item) => item.id === id);
  if (!category) throw new Error(`Unknown reference category: ${id}`);
  reference.dataset.category = id;
  for (const button of categories.children) {
    button.setAttribute("aria-pressed", String(button.dataset.category === id));
  }
  reference.replaceChildren(muted(category.note), learningRows(category.rows));
}
function learningRows(items) {
  return rows(items.map(([key, label]) => ({ key, label })));
}
for (const category of data.vim.categories) {
  const button = element("button", "category", category.title);
  button.type = "button";
  button.dataset.category = category.id;
  button.addEventListener("click", () => selectCategory(category.id));
  categories.append(button);
}
browse.append(categories, reference);
learning.append(context, browse, muted("Read here · type in the editor"));
function updateContext(next) {
  const scenario = data.vim.scenarios[next];
  if (!scenario) throw new Error(`Unknown Vim scenario: ${next}`);
  context.dataset.scenario = next;
  context.replaceChildren(label("EXAMPLE INPUT · PREVIEW"));
  if (scenario.input) context.append(sequence([scenario.input]));
  context.append(element("h2", "", scenario.title), muted(scenario.detail));
  if (scenario.rows.length) context.append(learningRows(scenario.rows));
  context.append(muted(scenario.footer));
}
function selectTab(name) {
  const isVim = name === "vim";
  leaderButton.setAttribute("aria-pressed", String(!isVim));
  vimButton.setAttribute("aria-pressed", String(isVim));
  root.hidden = isVim;
  learning.hidden = !isVim;
}
leaderButton.addEventListener("click", () => {
  if (state === "grammar")
    root.replaceChildren(
      header("Start with Space"),
      muted("In the editor, press Space, then choose a key."),
      rows(data.idle.rows),
    );
  selectTab("leader");
});
vimButton.addEventListener("click", () => selectTab("vim"));
// Reference selection is independent of context updates, including unavailable input.
window.addEventListener("message", ({ data: message }) => {
  if (message?.type === "u1-context") updateContext(message.state);
});
const initialVim = data.vim.scenarios[state] ? state : "vim-reference";
selectCategory(data.vim.scenarios[initialVim].category);
updateContext(initialVim);
container.append(tabs, root, learning);
selectTab(data.vim.scenarios[state] ? "vim" : "leader");
if (state === "grammar") {
  // Preserve the original operator + motion review cell under the Vim tab.
  learning.hidden = true;
  root.hidden = false;
  leaderButton.setAttribute("aria-pressed", "false");
  vimButton.setAttribute("aria-pressed", "true");
}

window.u1Ready = true;
if (typeof acquireVsCodeApi === "function") {
  const vscode = acquireVsCodeApi();
  setTimeout(() => {
    const computed = getComputedStyle(document.documentElement);
    const variables = {};
    for (const name of computed) {
      if (name.startsWith("--vscode-"))
        variables[name] = computed.getPropertyValue(name).trim();
    }
    vscode.postMessage({
      type: "u1-theme",
      capture: {
        state,
        host: document.documentElement.dataset.host,
        variables,
        viewport: { width: innerWidth, height: innerHeight },
        windowSize: { width: outerWidth, height: outerHeight },
        deviceScaleFactor: devicePixelRatio,
        bodyBackground: getComputedStyle(document.body).backgroundColor,
        themeKind: document.body.className,
      },
    });
  }, 800);
}
