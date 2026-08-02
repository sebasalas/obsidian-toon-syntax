# TOON Syntax Highlight

Syntax highlighting for [TOON](https://github.com/toon-format/toon) (Token-Oriented Object Notation) in fenced code blocks, so tabular dumps stay readable inside your notes.

Colors come from Obsidian's own `--code-*` variables, so the highlighting adapts to whatever theme you use, in both light and dark mode.

## Usage

Tag a fenced code block with `toon`:

````markdown
```toon
# inventory snapshot
warehouse: north
items[3]{sku,name,qty,price,note}:
  1001,Keyboard,42,29.99,null
  1002,Monitor,7,189.50,"Restock by: 2025-06-30"
  1003,Mouse,0,12.00,null
```
````

Works in **Reading View** and **Live Preview**. Source mode shows plain text, since it is a rendered-markdown post processor and Source mode renders no HTML.

## What gets highlighted

| Token | Matches | Obsidian variable |
|-------|---------|-------------------|
| Key | table name and header fields | `--code-property` |
| String | double-quoted text | `--code-string` |
| Number | integers and decimals, incl. exponents | `--code-value` |
| Keyword | `null`, `true`, `false` | `--code-keyword` |
| Punctuation | `[ ] { } , :` | `--code-punctuation` |
| Comment | lines starting with `#` | `--code-comment` |
| Plain | everything else | `--code-normal` |

Quoted values are parsed properly: a colon inside `"Restock by: 2025-06-30"` does not turn the row into a `key: value` line, and `""` / `\"` escapes are respected.

## Settings

| Setting | Default | Effect |
|---------|---------|--------|
| Wrap long lines | Off | Wraps block content instead of scrolling horizontally |

Wrapping uses `overflow-wrap: anywhere` because TOON rows are comma-separated with no spaces — plain `pre-wrap` finds no break opportunity in a line of UUIDs and timestamps.

## Installation

### From the community plugin store

Settings → Community plugins → Browse → search for **TOON Syntax Highlight**.

### Manual

1. Download `main.js`, `manifest.json` and `styles.css` from the [latest release](../../releases/latest).
2. Put them in `<vault>/.obsidian/plugins/toon-syntax/`.
3. Reload Obsidian and enable the plugin in Settings → Community plugins.

## Development

Plain JavaScript, no build step. Clone into your vault's plugins folder and reload:

```bash
git clone https://github.com/sebasalas/obsidian-toon-syntax.git \
  <vault>/.obsidian/plugins/toon-syntax
```

Releases are automated: push a tag matching the `manifest.json` version and the workflow in `.github/workflows/release.yml` drafts a release with the three required assets.

```bash
git tag 1.0.1 && git push origin 1.0.1
```

## License

[MIT](LICENSE)
