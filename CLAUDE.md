# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**MyStudyDocs** is a static HTML documentation site that converts study documents (`.docx` files and `.png` images) into a browsable static website. The site must work entirely via HTML links — no server required.

## Source Materials

Source documents are located at `C:\Users\roman\Work\pohovor\study\Claude\` and organized into topic folders:

- `Angular/` — 5 `.docx` files
- `Java/` — 4 `.docx` files
- `React/` — 5 `.docx` files
- `RxJS/` — 3 `.docx` files
- `Questions/` — 3 `.docx` files
- `Others/` — 18 `.docx` files (Bootstrap, Docker, Kubernetes, Spring, SQL, Vite, etc.)
- `Pictures/` — 9 `.png` images (diagrams, reference sheets)

## Planned Architecture

The output is a static HTML site with:

- **Left menu panel** — two-level hierarchy: topic folders as collapsible group items, individual documents/images as sub-items
- **Main content panel** — renders the selected document's content
- **Search** — full-text search across all content
- **Collapse All** button — collapses all menu groups at once

Navigation is HTML-link-only (no JavaScript routing frameworks required, though JS for interactivity is fine).

## Build

```bash
npm install      # first time only (installs mammoth)
node build.js    # generates docs/
```

Then open `docs/index.html` in a browser.

The build script auto-installs `mammoth` if missing. Every run is a clean build (deletes and recreates `docs/`).

## IDE Configuration

IntelliJ IDEA is configured with JDK 25 and output directory `/out`. The actual build toolchain is Node.js.
