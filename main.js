const { Plugin, PluginSettingTab, Setting } = require("obsidian");

const KEYWORDS = new Set(["null", "true", "false"]);
const NUMBER_RE = /^-?\d+(\.\d+)?([eE][+-]?\d+)?$/;
const HEADER_RE = /^([A-Za-z_][\w.]*)?\[(\d+)([|,\t])?\](\{[^}]*\})?:(\s*)$/;

const DEFAULT_SETTINGS = {
  wrapLines: false,
};

// Toggled on <body> so already-rendered blocks restyle instantly when the
// setting changes. Markdown post processors do not re-run on settings changes,
// so a per-block class would leave open notes stale until they re-render.
const WRAP_CLASS = "toon-wrap-lines";

function addSpan(parent, cls, text) {
  parent.createSpan({ cls: "toon-" + cls, text });
}

// Single source of truth for how quotes behave in a TOON line: a double quote
// opens a string, "" and \" are escapes that stay inside it, and the next lone
// quote closes it. Returns a per-character mask of "this index is inside a
// quoted string".
//
// Everything that needs to reason about quotes consumes this mask, so the
// delimiter splitter and the top-level search cannot disagree about where a
// string begins and ends.
function scanQuotes(line) {
  const inString = new Array(line.length).fill(false);
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const c = line[i];

    if (inQuotes) {
      inString[i] = true;
      if (c === '"') {
        if (line[i + 1] === '"') inString[++i] = true;
        else inQuotes = false;
      } else if (c === "\\" && line[i + 1] === '"') {
        inString[++i] = true;
      }
    } else if (c === '"') {
      inQuotes = true;
      inString[i] = true;
    }
  }

  return inString;
}

// Splits a data row on the delimiter, ignoring delimiters inside quotes.
// Slices the original line so the token text is preserved byte for byte.
function splitRespectingQuotes(line, delimiter) {
  const inString = scanQuotes(line);
  const tokens = [];
  let start = 0;

  for (let i = 0; i < line.length; i++) {
    if (line[i] === delimiter && !inString[i]) {
      tokens.push(line.slice(start, i));
      start = i + 1;
    }
  }

  tokens.push(line.slice(start));
  return tokens;
}

function tokenClass(value) {
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) return "string";
  if (KEYWORDS.has(value)) return "keyword";
  if (NUMBER_RE.test(value)) return "num";
  return "plain";
}

// Emits a token, keeping any surrounding whitespace as plain text nodes.
// The rendered block must read back byte for byte identical to the source:
// a highlighter that reflows or trims content is altering the document.
function addToken(parent, token) {
  if (token.trim() === "") {
    if (token !== "") parent.appendText(token);
    return;
  }

  const lead = token.match(/^\s*/)[0];
  const trail = token.match(/\s*$/)[0];
  const value = token.slice(lead.length, token.length - trail.length);

  if (lead !== "") parent.appendText(lead);
  addSpan(parent, tokenClass(value), value);
  if (trail !== "") parent.appendText(trail);
}

function addDataRow(parent, line, delimiter) {
  const tokens = splitRespectingQuotes(line, delimiter);
  tokens.forEach((token, i) => {
    if (i > 0) addSpan(parent, "punct", delimiter);
    addToken(parent, token);
  });
}

// Index of the first occurrence of target outside a quoted string, or -1.
function findTopLevelChar(line, target) {
  const inString = scanQuotes(line);

  for (let i = 0; i < line.length; i++) {
    if (line[i] === target && !inString[i]) return i;
  }

  return -1;
}

function renderLine(parent, rawLine) {
  const indent = rawLine.match(/^\s*/)[0];
  const rest = rawLine.slice(indent.length);

  if (indent !== "") parent.appendText(indent);
  if (rest === "") return;

  if (rest.startsWith("#")) {
    addSpan(parent, "comment", rest);
    return;
  }

  const header = rest.match(HEADER_RE);
  if (header) {
    const [, name, count, delimiter, fields, trailing] = header;

    if (name) addSpan(parent, "key", name);
    addSpan(parent, "punct", "[");
    addSpan(parent, "num", count);
    if (delimiter) addSpan(parent, "punct", delimiter);
    addSpan(parent, "punct", "]");

    if (fields) {
      addSpan(parent, "punct", "{");
      fields
        .slice(1, -1)
        .split(",")
        .forEach((field, i) => {
          if (i > 0) addSpan(parent, "punct", ",");
          addSpan(parent, "key", field);
        });
      addSpan(parent, "punct", "}");
    }

    addSpan(parent, "punct", ":");
    if (trailing) parent.appendText(trailing);
    return;
  }

  const colonIdx = findTopLevelChar(rest, ":");
  const commaIdx = findTopLevelChar(rest, ",");

  // Treat the line as "key: value" only when the colon comes before any
  // top-level comma. Otherwise it is a tabular data row, where ISO timestamps
  // carry colons of their own.
  const isKeyValue = colonIdx !== -1 && (commaIdx === -1 || colonIdx < commaIdx);

  if (isKeyValue) {
    addSpan(parent, "key", rest.slice(0, colonIdx));
    addSpan(parent, "punct", ":");

    // Hand the remainder over untouched; addToken keeps its own spacing, so
    // "total:42" never gains a space and "total:   42" never loses two.
    const after = rest.slice(colonIdx + 1);
    if (after === "") return;

    if (findTopLevelChar(after, ",") !== -1) addDataRow(parent, after, ",");
    else addToken(parent, after);
    return;
  }

  if (commaIdx !== -1) {
    addDataRow(parent, rest, ",");
    return;
  }

  addToken(parent, rest);
}

class ToonSyntaxSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl)
      .setName("Wrap long lines")
      .setDesc("Wrap block content instead of scrolling horizontally.")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.wrapLines).onChange(async (value) => {
          this.plugin.settings.wrapLines = value;
          await this.plugin.saveSettings();
        })
      );
  }
}

module.exports = class ToonSyntaxPlugin extends Plugin {
  async onload() {
    // Popout windows render into their own document, so the wrap class has to
    // be mirrored into each one rather than set on the main body alone.
    this.documents = new Set([document]);
    this.registerEvent(
      this.app.workspace.on("window-open", (workspaceWindow, win) => {
        this.documents.add(win.document);
        this.applyWrapClass();
      })
    );
    this.registerEvent(
      this.app.workspace.on("window-close", (workspaceWindow, win) => {
        this.documents.delete(win.document);
      })
    );

    await this.loadSettings();
    this.applyWrapClass();
    this.addSettingTab(new ToonSyntaxSettingTab(this.app, this));

    this.registerMarkdownCodeBlockProcessor("toon", (source, el) => {
      // The inner <code> must NOT carry a "language-toon" class. Obsidian finds
      // unprocessed code blocks with findAll("code.language-<lang>"), so that
      // class makes it re-claim this element on the next post-process pass:
      // it replaces the <pre>, strips the rendered spans back to textContent
      // and re-runs this handler on the plain text.
      const pre = el.createEl("pre", { cls: "toon-block" });
      const code = pre.createEl("code", { cls: "toon-code" });

      const lines = source.replace(/\n$/, "").split("\n");
      lines.forEach((line, i) => {
        if (i > 0) code.appendText("\n");
        renderLine(code, line);
      });
    });
  }

  onunload() {
    for (const doc of this.documents ?? [document]) {
      doc.body.classList.remove(WRAP_CLASS);
    }
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
    this.applyWrapClass();
  }

  applyWrapClass() {
    for (const doc of this.documents) {
      doc.body.classList.toggle(WRAP_CLASS, this.settings.wrapLines);
    }
  }
};
