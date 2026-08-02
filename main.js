const { Plugin, PluginSettingTab, Setting } = require("obsidian");

const KEYWORDS = new Set(["null", "true", "false"]);
const NUMBER_RE = /^-?\d+(\.\d+)?([eE][+-]?\d+)?$/;
const HEADER_RE = /^([A-Za-z_][\w.]*)?\[(\d+)([|,\t])?\](\{[^}]*\})?:\s*$/;

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

// Splits a data row on the delimiter while respecting double quotes,
// handling both \" escapes and "" doubling.
function splitRespectingQuotes(line, delimiter) {
  const tokens = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const c = line[i];

    if (inQuotes) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
          current += c;
        }
      } else if (c === "\\" && line[i + 1] === '"') {
        current += '\\"';
        i++;
      } else {
        current += c;
      }
    } else if (c === '"') {
      inQuotes = true;
      current += c;
    } else if (c === delimiter) {
      tokens.push(current);
      current = "";
    } else {
      current += c;
    }
  }

  tokens.push(current);
  return tokens;
}

function tokenClass(value) {
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) return "string";
  if (KEYWORDS.has(value)) return "keyword";
  if (NUMBER_RE.test(value)) return "num";
  return "plain";
}

function addToken(parent, token) {
  const value = token.trim();
  addSpan(parent, value === "" ? "plain" : tokenClass(value), value);
}

function addDataRow(parent, line, delimiter) {
  const tokens = splitRespectingQuotes(line, delimiter);
  tokens.forEach((token, i) => {
    if (i > 0) addSpan(parent, "punct", delimiter);
    addToken(parent, token);
  });
}

// Index of the first occurrence of target outside double quotes, or -1.
function findTopLevelChar(line, target) {
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') inQuotes = !inQuotes;
    else if (c === target && !inQuotes) return i;
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
    const [, name, count, delimiter, fields] = header;

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

    const value = rest.slice(colonIdx + 1).trim();
    if (value !== "") {
      parent.appendText(" ");
      if (findTopLevelChar(value, ",") !== -1) addDataRow(parent, value, ",");
      else addToken(parent, value);
    }
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
    document.body.classList.remove(WRAP_CLASS);
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
    this.applyWrapClass();
  }

  applyWrapClass() {
    document.body.classList.toggle(WRAP_CLASS, this.settings.wrapLines);
  }
};
