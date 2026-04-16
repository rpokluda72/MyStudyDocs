# MyStudyDocs

Converts study documents (`.docx` files and `.png` images) into a browsable static HTML site that works directly in the browser — no server required.

## Features

- Two-panel layout: collapsible sidebar menu + content area
- Two-level menu: topic folders → individual documents
- Full-text search across all documents
- Collapse All button for the sidebar
- Works via `file://` — just open `docs/index.html` in any browser

## Source Documents

Documents are read from `C:\Users\roman\Work\pohovor\study\Claude\` organized into topic folders:

| Folder | Content |
|--------|---------|
| Angular | Angular project setup, pipes, components, DI |
| Java | Java core, servlets, functional interfaces, J2EE |
| React | React, hooks, Next.js, routing |
| RxJS | RxJS operators, observables, usage examples |
| Questions | Interview Q&A for Java and Node.js |
| Others | Docker, Kubernetes, Spring, SQL, Kotlin, TypeScript, and more |
| Pictures | Reference diagrams and cheat sheets |

## Usage

**First time:**
```bash
npm install
```

**Build the site:**
```bash
node build.js
```

Then open `docs/index.html` in your browser.

Every build is clean — `docs/` is deleted and fully regenerated each run.

## How It Works

1. `build.js` scans the source folder and converts each `.docx` to HTML using [mammoth](https://github.com/mwilliamson/mammoth.js)
2. Embedded images in `.docx` files are inlined as base64 data URIs (no separate image files needed)
3. Standalone `.png` files get simple image viewer pages
4. A full-text search index is generated as `docs/assets/search_index.js`
5. `docs/index.html` is generated with the sidebar and an iframe for content

## Output Structure

```
docs/
├── index.html
├── assets/
│   ├── style.css
│   ├── content.css
│   ├── main.js
│   └── search_index.js
├── Angular/
├── Java/
├── React/
├── RxJS/
├── Questions/
├── Others/
└── Pictures/
```
