/* global S1_REFERENCE, S1_VIEW_STATE, acquireVsCodeApi */
const api = acquireVsCodeApi();
const instance = document.body.dataset.instance + ":" + crypto.randomUUID();
const persisted = api.getState();
let selectedTab = persisted?.tab === "vim" ? "vim" : "leader";
let selectedTopic = S1_REFERENCE.some((item) => item.id === persisted?.topic)
  ? persisted.topic
  : "movement";
let state = { revision: -1, phase: "idle", session: null, prefix: [] };
const element = (tag, className, text) => {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};
const key = (value) => element("kbd", "keycap", value);
const muted = (text) => element("p", "muted", text);
function rows(items) {
  const list = element("ul", "rows");
  for (const [keys, text] of items) {
    const row = element("li", "row");
    row.append(key(keys), element("span", "row-label", text));
    list.append(row);
  }
  return list;
}
const tabs = element("div", "tabs");
const leaderButton = element("button", "tab", "Leader");
const vimButton = element("button", "tab", "Vim");
tabs.append(leaderButton, vimButton);
const leader = element("section", "content");
const learning = element("section", "content");
const categories = element("div", "categories");
const reference = element("div", "reference");
learning.append(
  element("p", "eyebrow", "VIM REFERENCE"),
  element("h2", "", "Live guidance unavailable"),
  muted("Browse a topic below. Live Vim input is not connected."),
  categories,
  reference,
);
const footer = element("div", "doctor");
footer.append(
  element("strong", "", "Experimental input"),
  muted("Leader input can be missed. Read here · type in the editor."),
);
document.querySelector("#keys").append(tabs, leader, learning, footer);
function report() {
  api.postMessage({
    type: "s1-applied",
    instance,
    revision: state.revision,
    session: state.session,
    phase: state.phase,
    prefix: state.prefix,
    tab: selectedTab,
    topic: selectedTopic,
    leaderText: leader.textContent,
    visibleText:
      selectedTab === "leader" ? leader.textContent : learning.textContent,
  });
}
function select() {
  leader.hidden = selectedTab !== "leader";
  learning.hidden = selectedTab !== "vim";
  leaderButton.setAttribute("aria-pressed", String(selectedTab === "leader"));
  vimButton.setAttribute("aria-pressed", String(selectedTab === "vim"));
  for (const button of categories.children)
    button.setAttribute(
      "aria-pressed",
      String(button.dataset.topic === selectedTopic),
    );
  const category = S1_REFERENCE.find((item) => item.id === selectedTopic);
  reference.replaceChildren(muted(category.note), rows(category.rows));
  api.setState({ tab: selectedTab, topic: selectedTopic });
  report();
}
for (const category of S1_REFERENCE) {
  const button = element("button", "category", category.title);
  button.dataset.topic = category.id;
  button.addEventListener("click", () => {
    selectedTopic = category.id;
    select();
  });
  categories.append(button);
}
leaderButton.addEventListener("click", () => {
  selectedTab = "leader";
  select();
});
vimButton.addEventListener("click", () => {
  selectedTab = "vim";
  select();
});
function render() {
  const header = element("header", "header");
  header.append(element("p", "eyebrow", "LEADER KEYS"));
  const active = state.phase === "active";
  if (active) {
    const sequence = element("div", "sequence");
    for (const [i, value] of ["SPC", ...state.prefix].entries()) {
      if (i) sequence.append(element("span", "separator", "›"));
      sequence.append(key(value));
    }
    header.append(sequence);
  }
  const windowGroup = active && state.prefix.join(" ") === "w";
  header.append(element("h1", "", windowGroup ? "Windows" : "Leader keys"));
  leader.replaceChildren(
    header,
    rows(windowGroup ? [["h", "Focus left group"]] : [["w", "Windows"]]),
  );
  if (!active) leader.append(muted("Leader reference · no active prefix"));
  report();
}
window.addEventListener("message", ({ data: message }) => {
  if (message?.type === "s1-select" && message.instance === instance) {
    if (["leader", "vim"].includes(message.tab)) selectedTab = message.tab;
    if (S1_REFERENCE.some((item) => item.id === message.topic))
      selectedTopic = message.topic;
    select();
    return;
  }
  const next = S1_VIEW_STATE.accept(state, message, instance);
  if (next === state) return;
  state = next;
  render();
});
document.addEventListener("securitypolicyviolation", (event) => {
  api.postMessage({
    type: "s1-csp",
    instance,
    violation: {
      directive: event.violatedDirective,
      blocked: event.blockedURI,
    },
  });
});
select();
render();
api.postMessage({ type: "s1-ready", instance });
