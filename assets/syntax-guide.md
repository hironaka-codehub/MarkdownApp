# Markdown Syntax Guide

Each section shows what you type, followed by how it looks.

- [Headings](#headings)
- [Emphasis](#emphasis)
- [Lists](#lists)
- [Task lists](#task-lists)
- [Links](#links)
- [Images](#images)
- [Code](#code)
- [Blockquotes](#blockquotes)
- [Tables](#tables)
- [Horizontal rule](#horizontal-rule)
- [Line breaks and paragraphs](#line-breaks-and-paragraphs)
- [Escaping characters](#escaping-characters)
- [HTML](#html)

---

## Headings

```markdown
# Heading 1
## Heading 2
### Heading 3
#### Heading 4
```

#### Heading 4

Start a line with 1–6 `#` characters followed by a space. Headings get anchors, so you can
link to them with `[text](#heading-name)`: lowercase, spaces replaced with `-`, punctuation removed.

## Emphasis

```markdown
*italic* or _italic_
**bold** or __bold__
***bold italic***
~~strikethrough~~
```

*italic* or _italic_ · **bold** or __bold__ · ***bold italic*** · ~~strikethrough~~

Shortcuts: **Ctrl+B** bold, **Ctrl+I** italic.

## Lists

```markdown
- Item
- Another item
  - Nested item (indent two spaces)

1. First
2. Second
3. Third
```

- Item
- Another item
  - Nested item (indent two spaces)

1. First
2. Second
3. Third

Use `-`, `*` or `+` for bullets. Numbered lists may all start with `1.`; they are renumbered.

## Task lists

```markdown
- [x] Done
- [ ] Not done
```

- [x] Done
- [ ] Not done

## Links

```markdown
[Link text](https://example.com)
[Link with title](https://example.com "Hover text")
<https://example.com>
[Another file](notes.md)
[Section in this file](#tables)
```

[Section in this file](#tables) · <https://example.com>

- Web links open in your browser.
- Links to other `.md` files (relative to the current file) open in MarkdownApp.
- Shortcut: **Ctrl+K** inserts a link.

## Images

```markdown
![Alt text](picture.png)
![Alt text](images/diagram.png "Optional title")
```

Paths are relative to the folder of the open file. Save a new document first so relative
images can be found.

## Code

````markdown
Inline `code` in a sentence.

```js
function greet(name) {
  return `Hello, ${name}`;
}
```
````

Inline `code` in a sentence.

```js
function greet(name) {
  return `Hello, ${name}`;
}
```

Shortcut: **Ctrl+`** wraps the selection in backticks. Indenting a line by four spaces also
makes a code block.

## Blockquotes

```markdown
> A quote.
>
> > A nested quote.
```

> A quote.
>
> > A nested quote.

## Tables

```markdown
| Left | Center | Right |
|:-----|:------:|------:|
| a    |   b    |     c |
| 1    |   2    |     3 |
```

| Left | Center | Right |
|:-----|:------:|------:|
| a    |   b    |     c |
| 1    |   2    |     3 |

The colons in the second row set the column alignment. Columns don't need to line up.

## Horizontal rule

```markdown
---
```

---

Three or more `-`, `*` or `_` on a line of their own.

## Line breaks and paragraphs

```markdown
First paragraph.

Second paragraph.
A line ending with two spaces··
starts a new line in the same paragraph.
```

Leave a blank line between paragraphs. A single line break is joined into the same line, unless
the line ends with two spaces (shown as `··` above) or a backslash `\`.

## Escaping characters

```markdown
\*not italic\*  \# not a heading  1\. not a list
```

\*not italic\* · \# not a heading · 1\. not a list

Put a backslash before any of these to show them literally: `` \ ` * _ { } [ ] ( ) # + - . ! | ``

## HTML

Basic HTML such as `<kbd>`, `<sub>`, `<sup>` and `<details>` works:

```markdown
Press <kbd>Ctrl</kbd>+<kbd>S</kbd>. H<sub>2</sub>O, x<sup>2</sup>

<details>
<summary>Click to expand</summary>

Hidden content.

</details>
```

Press <kbd>Ctrl</kbd>+<kbd>S</kbd>. H<sub>2</sub>O, x<sup>2</sup>

<details>
<summary>Click to expand</summary>

Hidden content.

</details>

Scripts and event handlers are removed for safety.
