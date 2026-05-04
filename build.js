/**
 * MyStudyDocs build script (Node.js)
 * Converts .docx study documents into a browsable static HTML site.
 *
 * First run:  npm install
 * Build:      node build.js
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// ---------------------------------------------------------------------------
// Auto-install mammoth if needed
// ---------------------------------------------------------------------------
function ensureMammoth() {
  try {
    require.resolve('mammoth');
  } catch {
    console.log('Installing mammoth...');
    execSync('npm install mammoth', { stdio: 'inherit' });
  }
}

function ensureAdmZip() {
  try {
    require.resolve('adm-zip');
  } catch {
    console.log('Installing adm-zip...');
    execSync('npm install adm-zip', { stdio: 'inherit' });
  }
}

ensureMammoth();
ensureAdmZip();
const mammoth = require('mammoth');
const AdmZip = require('adm-zip');

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------
const SOURCE_DIR = String.raw`C:\Users\roman\Work\pohovor\study\Claude`;
const OUTPUT_DIR = path.join(__dirname, 'docs');

const FOLDER_ORDER = ['Angular', 'Java', 'React', 'RxJS', 'Questions', 'Others', 'Pictures'];

const BOOKMARKS_FILE = path.join(SOURCE_DIR, 'bookmarks.html');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function slugify(name) {
  // Normalize unicode (remove diacritics like č→c, ě→e, etc.)
  const normalized = name.normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
  return normalized
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'document';
}

function stripHtml(html) {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function fixExternalLinks(html) {
  // Add target="_blank" rel="noopener" to all http/https links
  return html.replace(
    /(<a\s[^>]*href=["']https?:\/\/[^>]*)(>)/gi,
    function (match, before, close) {
      if (/target=/i.test(before)) {
        return before.replace(/target=["'][^"']*["']/i, 'target="_blank"') +
               (!/rel=/i.test(before) ? ' rel="noopener noreferrer"' : '') +
               close;
      }
      return before + ' target="_blank" rel="noopener noreferrer"' + close;
    }
  );
}

function linkifyUrls(html) {
  // Wrap plain-text http(s) URLs (not already inside a tag attribute) with <a> tags.
  // Strategy: alternate match between HTML tags and bare URLs — tags are passed through
  // unchanged, bare URLs get wrapped.
  return html.replace(
    /(<[^>]*>)|(https?:\/\/[^\s<>"')\]]+)/gi,
    function (match, tag, url) {
      if (tag) return tag; // HTML tag — leave untouched
      // Strip trailing punctuation that likely isn't part of the URL
      var trailing = '';
      url = url.replace(/[.,;:!?)\]]+$/, function (m) { trailing = m; return ''; });
      return '<a href="' + url + '" target="_blank" rel="noopener noreferrer">' + url + '</a>' + trailing;
    }
  );
}

function uniqueSlug(slug, used) {
  let candidate = slug;
  let counter = 2;
  while (used.has(candidate)) {
    candidate = `${slug}_${counter++}`;
  }
  used.add(candidate);
  return candidate;
}

function isCodeLine(plain) {
  const t = plain.trim();
  if (!t) return false;
  // Leading indentation — strongest signal in Word-authored code
  if (/^ {2,}/.test(plain)) return true;
  // Starts with common code keywords (JS/TS and Java)
  if (/^(export |import |const |let |var |function |class |interface |type |enum |return\b|if\s*\(|for\s*\(|while\s*\(|async |await |@\w+|\/\/|\/\*|\.\w+[\s(]|System\.|new |public |private |protected |static |final |void |throw\b|try\b|catch\s*\()/.test(t)) return true;
  // Arrow function (JS/TS => or Java -> / HTML-encoded -&gt;)
  // Exclude lines ending with '.' to avoid matching prose descriptions of -> syntax
  if (/=>|-&gt;/.test(t) && !/\.\s*$/.test(t)) return true;
  // Java/JS method reference (::)
  if (/::/.test(t)) return true;
  // Strip HTML entities (e.g. &lt; &gt; contain ';') before semicolon check
  const tStripped = t.replace(/&[a-z]+;/gi, '');
  // Ends with semicolon, or semicolon before comment (Java/JS/TS statement terminator)
  // Require the semicolon to appear near the end (not mid-sentence prose)
  if (/;\s*(\/[/*].*)?$/.test(tStripped)) return true;
  // Ends with {
  if (/\{$/.test(tStripped)) return true;
  // Starts with closing brace/bracket
  if (/^[})\]]/.test(t)) return true;
  // Java generic type declaration with assignment (e.g. List<String> result = ...)
  if (/&lt;/.test(t) && /=/.test(tStripped)) return true;
  // Ends with open parenthesis — method call continuation across lines
  if (/\($/.test(t)) return true;
  // Starts with identifier (possibly dotted) followed by '(' — direct or chained method call
  // e.g. findUserName(42), client.sendAsync(...)
  if (/^\w[\w.]*\(/.test(t)) return true;
  // String literal immediately followed by method call — e.g. "text".lines()
  if (/^"[^"]*"\.\w+/.test(t)) return true;
  return false;
}

/**
 * Parse a .docx file and return the plain-text content of every paragraph
 * that has a background colour applied at paragraph level (w:pPr/w:shd).
 * Also catches paragraphs whose named style carries such shading.
 * Returns a Set<string> (decoded, trimmed text) used as the primary code
 * signal in wrapCodeBlocks().
 */
function getCodeParagraphTexts(docxPath) {
  try {
    const zip = new AdmZip(docxPath);

    // ---- 1. Find style IDs whose paragraph definition includes shading ----
    const codeStyleIds = new Set();
    const stylesEntry = zip.getEntry('word/styles.xml');
    if (stylesEntry) {
      const stylesXml = zip.readAsText(stylesEntry);
      const styleRe = /<w:style\b[^>]*>([\s\S]*?)<\/w:style>/g;
      let sm;
      while ((sm = styleRe.exec(stylesXml)) !== null) {
        const s = sm[0];
        const pPrM = s.match(/<w:pPr>([\s\S]*?)<\/w:pPr>/);
        if (pPrM && /<w:shd\b/.test(pPrM[1])) {
          const idM = s.match(/w:styleId="([^"]+)"/);
          if (idM) codeStyleIds.add(idM[1]);
        }
      }
    }

    // ---- 2. Scan document.xml for paragraphs with direct shading or code style ----
    const docXml = zip.readAsText('word/document.xml');
    const codeTexts = new Set();

    const paraRe = /<w:p[\s>]([\s\S]*?)<\/w:p>/g;
    let pm;
    while ((pm = paraRe.exec(docXml)) !== null) {
      const para = pm[0];
      const pPrM = para.match(/<w:pPr>([\s\S]*?)<\/w:pPr>/);
      let isCode = false;
      if (pPrM) {
        const pPr = pPrM[1];
        // Direct paragraph background shading
        if (/<w:shd\b/.test(pPr)) isCode = true;
        // Paragraph uses a style that has shading
        if (!isCode && codeStyleIds.size > 0) {
          const styleM = pPr.match(/<w:pStyle\b[^>]*w:val="([^"]+)"/);
          if (styleM && codeStyleIds.has(styleM[1])) isCode = true;
        }
      }
      if (!isCode) continue;

      // Extract text, preserving <w:br/> as newline
      const parts = [];
      const tokRe = /<w:t[^>]*>([^<]*)<\/w:t>|<w:br\b/g;
      let tm;
      while ((tm = tokRe.exec(para)) !== null) {
        parts.push(tm[0].startsWith('<w:br') ? '\n' : tm[1]);
      }
      const text = decodeHtml(parts.join('').trim());
      if (text) codeTexts.add(text);
    }
    return codeTexts;
  } catch (e) {
    console.warn(`  [warn] could not parse docx XML for ${path.basename(docxPath)}: ${e.message}`);
    return new Set();
  }
}

function isMultiLineCodeParagraph(plain) {
  if (!plain.includes('\n')) return false;
  const lines = plain.split('\n').filter(l => l.trim());
  if (lines.length < 2) return false;
  const codeCount = lines.filter(isCodeLine).length;
  return codeCount >= Math.ceil(lines.length * 0.5);
}

function wrapCodeBlocks(html, codeTexts = null) {
  const segments = [];
  let lastIndex = 0;
  const pRegex = /<p[^>]*>([\s\S]*?)<\/p>/gi;
  let m;

  while ((m = pRegex.exec(html)) !== null) {
    if (m.index > lastIndex) {
      segments.push({ type: 'raw', text: html.slice(lastIndex, m.index) });
    }
    // Convert <br> to newline so multi-line paragraphs render correctly in <pre>
    const inner = m[1].replace(/<br\s*\/?>/gi, '\n');
    const plain = inner.replace(/<[^>]+>/g, '');
    segments.push({ type: 'p', inner, plain, full: m[0] });
    lastIndex = m.index + m[0].length;
  }
  if (lastIndex < html.length) {
    segments.push({ type: 'raw', text: html.slice(lastIndex) });
  }

  let result = '';
  let buf = [];

  function flush() {
    if (!buf.length) return;
    result += '<pre><code>' + buf.join('\n') + '</code></pre>\n';
    buf = [];
  }

  for (const seg of segments) {
    if (seg.type === 'raw') {
      flush();
      result += seg.text;
    } else if (isCodeLine(seg.plain) || isMultiLineCodeParagraph(seg.plain) || (codeTexts && codeTexts.has(decodeHtml(seg.plain.trim())))) {
      buf.push(seg.inner);
    } else {
      flush();
      result += seg.full;
    }
  }
  flush();
  return result;
}

function rmrf(dir) {
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function writeFile(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
}

// ---------------------------------------------------------------------------
// Bookmark parsing
// ---------------------------------------------------------------------------

function decodeHtml(str) {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

function parseBookmarks(filePath) {
  let html = fs.readFileSync(filePath, 'utf8');
  // Strip huge base64 ICON data
  html = html.replace(/\s+ICON(?:_URI)?="[^"]*"/gi, '');

  const root = { name: 'root', children: [] };
  const stack = [root];

  for (const line of html.split('\n')) {
    const t = line.trim();

    const h3 = t.match(/<H3[^>]*>([^<]*)<\/H3>/i);
    if (h3) {
      const folder = { name: decodeHtml(h3[1].trim()), children: [] };
      stack[stack.length - 1].children.push(folder);
      stack.push(folder);
      continue;
    }

    const a = t.match(/<A\s+HREF="([^"]*)"[^>]*>([^<]*)<\/A>/i);
    if (a) {
      stack[stack.length - 1].children.push({ href: a[1], title: decodeHtml(a[2].trim()) });
      continue;
    }

    if (/<\/DL>/i.test(t) && stack.length > 1) {
      stack.pop();
    }
  }

  // The file starts with the IT folder — return its children as top-level items
  const itFolder = root.children[0];
  return itFolder ? itFolder.children : root.children;
}

function renderBookmarkItems(items) {
  let html = '';
  for (const item of items) {
    if (item.children) {
      const inner = renderBookmarkItems(item.children);
      html += `<details>\n  <summary>${item.name}</summary>\n  <div class="bm-folder-body">${inner}</div>\n</details>\n`;
    } else {
      let domain = '';
      try { domain = new URL(item.href).hostname.replace(/^www\./, ''); } catch {}
      const label = (item.title || item.href) + (domain ? ` <span class="bm-domain">— ${domain}</span>` : '');
      html += `<div class="bm-link"><a href="${item.href}" target="_blank" rel="noopener noreferrer">${label}</a></div>\n`;
    }
  }
  return html;
}

function linksPage(bodyHtml) {
  return `<!DOCTYPE html>
<html lang="cs">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Links</title>
  <link rel="stylesheet" href="../assets/content.css">
  <style>
    details { margin: 6px 0; border-radius: 6px; overflow: hidden; }
    details > summary {
      font-weight: 600;
      font-size: 15px;
      cursor: pointer;
      padding: 7px 12px;
      list-style: none;
      display: flex;
      align-items: center;
      gap: 6px;
    }
    details > summary::before { content: "\\25BC"; font-size: 10px; color: #555; transition: transform .2s; flex-shrink: 0; }
    details:not([open]) > summary::before { transform: rotate(-90deg); }
    details > summary::-webkit-details-marker { display: none; }
    /* Cycle through soft background colours for top-level folders */
    details:nth-child(7n+1) > summary { background: #e8f0fe; }
    details:nth-child(7n+2) > summary { background: #e6f4ea; }
    details:nth-child(7n+3) > summary { background: #fef3e2; }
    details:nth-child(7n+4) > summary { background: #fce8e6; }
    details:nth-child(7n+5) > summary { background: #f3e8fd; }
    details:nth-child(7n+6) > summary { background: #e8f8f5; }
    details:nth-child(7n+7) > summary { background: #fff3e0; }
    details > summary:hover { filter: brightness(0.95); }
    .bm-folder-body { padding: 6px 0 8px 16px; }
    .bm-link { padding: 3px 0; }
    .bm-link a { color: #2563eb; text-decoration: none; font-size: 14px; }
    .bm-link a:hover { text-decoration: underline; }
    .bm-domain { color: #888; font-size: 12px; font-weight: normal; }
  </style>
</head>
<body>
  <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px;">
    <h1 style="margin:0;">Links</h1>
    <button id="collapse-links" style="padding:4px 10px;border:1px solid #bbb;border-radius:4px;background:#fff;cursor:pointer;font-size:12px;">Collapse All</button>
  </div>
  ${bodyHtml}
  <script>
    document.getElementById('collapse-links').addEventListener('click', function () {
      document.querySelectorAll('details').forEach(function (d) { d.removeAttribute('open'); });
    });
  <\/script>
  <script>${IN_PAGE_SEARCH_JS}<\/script>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// CSS / JS assets
// ---------------------------------------------------------------------------
const STYLE_CSS = `*, *::before, *::after { box-sizing: border-box; }

body {
    display: flex;
    height: 100vh;
    margin: 0;
    font-family: system-ui, -apple-system, sans-serif;
    overflow: hidden;
}

/* ---- Sidebar ---- */
#sidebar {
    width: 280px;
    min-width: 220px;
    max-width: 400px;
    display: flex;
    flex-direction: column;
    border-right: 1px solid #d0d0d0;
    background: #f5f5f5;
    overflow: hidden;
}

#sidebar-toolbar {
    display: flex;
    padding: 7px 12px 7px 8px;
    border-bottom: 1px solid #d0d0d0;
    flex-shrink: 0;
    align-items: center;
    box-sizing: border-box;
    width: 100%;
}

#search {
    flex: 1;
    padding: 5px 8px;
    border: 1px solid #bbb;
    border-radius: 4px;
    font-size: 13px;
    height: 28px;
    margin-right: 6px;
}

#collapse-all {
    border: 1px solid #bbb;
    border-radius: 4px;
    background: #fff;
    cursor: pointer;
    font-size: 12px;
    white-space: nowrap;
    height: 28px;
}

#collapse-all:hover { background: #e8e8e8; }

#menu, #search-results {
    flex: 1;
    overflow-y: auto;
    padding: 4px 0;
}

/* ---- Folder groups ---- */
.folder-header {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 7px 12px;
    cursor: pointer;
    font-weight: 600;
    font-size: 13px;
    color: #333;
    user-select: none;
}

.folder-header:hover { background: #e8e8e8; }

.folder-arrow {
    display: inline-block;
    transition: transform 0.2s;
    font-size: 10px;
    color: #666;
}

.folder.collapsed .folder-arrow { transform: rotate(-90deg); }

.folder-items {
    overflow: hidden;
    max-height: 2000px;
    transition: max-height 0.25s ease;
}

.folder.collapsed .folder-items { max-height: 0; }

.folder-items a {
    display: block;
    padding: 5px 12px 5px 28px;
    font-size: 13px;
    color: #2563eb;
    text-decoration: none;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}

.folder-items a:hover { background: #dde8ff; }
.folder-items a.active { background: #dde8ff; font-weight: 600; }

/* ---- Search results ---- */
#search-results { display: none; }

.search-result {
    display: block;
    padding: 6px 12px;
    font-size: 13px;
    color: #2563eb;
    text-decoration: none;
    border-bottom: 1px solid #e8e8e8;
}

.search-result:hover { background: #dde8ff; }

.search-result-folder {
    font-size: 11px;
    color: #888;
    margin-bottom: 1px;
}

.no-results {
    padding: 12px;
    font-size: 13px;
    color: #888;
}

/* ---- Content area ---- */
#content-area {
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: hidden;
}

#content-toolbar {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 6px;
    padding: 7px 10px 7px 8px;
    border-bottom: 1px solid #d0d0d0;
    background: #f9f9f9;
    flex-shrink: 0;
}

#content-search {
    padding: 5px 8px;
    border: 1px solid #bbb;
    border-radius: 4px;
    font-size: 13px;
    width: 220px;
    height: 28px;
}

#content-search-count {
    font-size: 12px;
    color: #666;
    min-width: 60px;
    text-align: right;
}

.csearch-btn {
    padding: 5px 8px;
    border: 1px solid #bbb;
    border-radius: 4px;
    background: #fff;
    cursor: pointer;
    font-size: 12px;
    height: 28px;
    line-height: 1;
}

.csearch-btn:hover { background: #e8e8e8; }
.csearch-btn:disabled { opacity: 0.4; cursor: default; }

#content-frame {
    flex: 1;
    border: none;
    min-height: 0;
}
`;

const CONTENT_CSS = `body {
    font-family: system-ui, -apple-system, sans-serif;
    font-size: 15px;
    line-height: 1.65;
    color: #1a1a1a;
    max-width: 900px;
    margin: 0 auto;
    padding: 24px 32px 48px;
}

h1 { font-size: 1.6em; border-bottom: 2px solid #e0e0e0; padding-bottom: 8px; margin-top: 0; }
h2 { font-size: 1.3em; margin-top: 1.8em; }
h3 { font-size: 1.1em; margin-top: 1.4em; }

p { margin: 0.6em 0; }

pre, code {
    font-family: "Cascadia Code", "Fira Code", Consolas, monospace;
    border-radius: 4px;
}

code {
    background: #f0f0f0;
    padding: 1px 4px;
    font-size: 0.9em;
}

pre {
    overflow-x: auto;
    /* no background/border/padding — hljs atom-one-dark handles that */
    background: none;
    border: none;
    padding: 0;
    margin: 0.8em 0;
}

/* hljs overrides for sizing */
pre code.hljs {
    font-size: 13.5px;
    line-height: 1.5;
    padding: 14px 16px !important;
    border-radius: 5px;
}

/* inline code should not inherit hljs dark bg */
:not(pre) > code { background: #f0f0f0; color: inherit; }

table {
    border-collapse: collapse;
    width: 100%;
    margin: 1em 0;
    font-size: 14px;
}

th, td {
    border: 1px solid #ccc;
    padding: 6px 10px;
    text-align: left;
    vertical-align: top;
}

th { background: #f0f0f0; font-weight: 600; }
tr:nth-child(even) { background: #fafafa; }

img { max-width: 100%; height: auto; display: block; margin: 1em 0; }

ul, ol { padding-left: 1.5em; }
li { margin: 0.25em 0; }

blockquote {
    border-left: 4px solid #ccc;
    margin: 1em 0;
    padding: 4px 16px;
    color: #555;
}
`;

const MAIN_JS = `(function () {
    'use strict';

    // ---- Sidebar folder toggle ----
    document.querySelectorAll('.folder-header').forEach(function (header) {
        header.addEventListener('click', function () {
            header.closest('.folder').classList.toggle('collapsed');
        });
    });

    // ---- Collapse All ----
    document.getElementById('collapse-all').addEventListener('click', function () {
        document.querySelectorAll('.folder').forEach(function (f) {
            f.classList.add('collapsed');
        });
    });

    // ---- Active link tracking ----
    document.querySelectorAll('.folder-items a').forEach(function (a) {
        a.addEventListener('click', function () {
            document.querySelectorAll('.folder-items a').forEach(function (x) {
                x.classList.remove('active');
            });
            a.classList.add('active');
        });
    });

    // ---- Sidebar search ----
    var searchInput = document.getElementById('search');
    var menu = document.getElementById('menu');
    var resultsEl = document.getElementById('search-results');
    var sidebarDebounce;

    searchInput.addEventListener('input', function () {
        clearTimeout(sidebarDebounce);
        sidebarDebounce = setTimeout(doSidebarSearch, 300);
    });

    function doSidebarSearch() {
        var query = searchInput.value.trim().toLowerCase();

        if (!query) {
            menu.style.display = '';
            resultsEl.style.display = 'none';
            resultsEl.innerHTML = '';
            return;
        }

        menu.style.display = 'none';
        resultsEl.style.display = 'block';

        var index = window.SEARCH_INDEX || [];
        var matches = index.filter(function (entry) {
            return entry.text.toLowerCase().includes(query) ||
                   entry.title.toLowerCase().includes(query);
        });

        if (matches.length === 0) {
            resultsEl.innerHTML = '<div class="no-results">No results found.</div>';
            return;
        }

        var html = '';
        matches.forEach(function (entry) {
            html += '<a class="search-result" href="' + entry.href + '" target="content">' +
                    '<div class="search-result-folder">' + entry.folder + '</div>' +
                    entry.title +
                    '</a>';
        });
        resultsEl.innerHTML = html;
    }

    // ---- In-document search (postMessage to iframe) ----
    var contentSearch = document.getElementById('content-search');
    var contentCount  = document.getElementById('content-search-count');
    var btnPrev       = document.getElementById('content-search-prev');
    var btnNext       = document.getElementById('content-search-next');
    var btnClear      = document.getElementById('content-search-clear');
    var contentFrame  = document.getElementById('content-frame');

    var docCount = 0;
    var docIndex = -1;

    function sendToFrame(msg) {
        if (contentFrame.contentWindow) {
            contentFrame.contentWindow.postMessage(msg, '*');
        }
    }

    function updateCount() {
        contentCount.textContent = docCount
            ? (docIndex + 1) + ' / ' + docCount
            : (contentSearch.value.trim() ? 'No results' : '');
    }

    window.addEventListener('message', function (e) {
        if (e.data && e.data.type === 'searchResult') {
            docCount = e.data.count;
            docIndex = e.data.current;
            updateCount();
        }
    });

    contentSearch.addEventListener('input', function () {
        sendToFrame({ type: 'search', query: contentSearch.value.trim() });
        if (!contentSearch.value.trim()) contentCount.textContent = '';
    });

    btnPrev.addEventListener('click', function () {
        sendToFrame({ type: 'searchNav', dir: 'prev' });
    });

    btnNext.addEventListener('click', function () {
        sendToFrame({ type: 'searchNav', dir: 'next' });
    });

    btnClear.addEventListener('click', function () {
        contentSearch.value = '';
        sendToFrame({ type: 'searchClear' });
        contentCount.textContent = '';
    });

    // Copy sidebar query to content search when clicking a search result
    resultsEl.addEventListener('click', function (e) {
        var link = e.target.closest('.search-result');
        if (!link) return;
        var sidebarQuery = searchInput.value.trim();
        if (sidebarQuery && contentSearch.value.trim() !== sidebarQuery) {
            contentSearch.value = sidebarQuery;
        }
    });

    // Re-apply search when iframe navigates to a new page
    contentFrame.addEventListener('load', function () {
        docCount = 0;
        docIndex = -1;
        var q = contentSearch.value.trim();
        if (q) {
            setTimeout(function () { sendToFrame({ type: 'search', query: q }); }, 80);
        } else {
            contentCount.textContent = '';
        }
    });
})();
`;

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------
const IN_PAGE_SEARCH_JS = `(function () {
    var marks = [];
    var idx = -1;

    function clearMarks() {
        marks.forEach(function (m) {
            var p = m.parentNode;
            if (p) { p.replaceChild(document.createTextNode(m.textContent), m); p.normalize(); }
        });
        marks = [];
        idx = -1;
    }

    function markText(query) {
        var results = [];
        var lower = query.toLowerCase();
        var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null);
        var nodes = [];
        var n;
        while ((n = walker.nextNode())) {
            if (n.nodeValue.toLowerCase().includes(lower)) nodes.push(n);
        }
        nodes.forEach(function (textNode) {
            var text  = textNode.nodeValue;
            var ltext = text.toLowerCase();
            var par   = textNode.parentNode;
            if (!par) return;
            var frag = document.createDocumentFragment();
            var last = 0, i;
            while ((i = ltext.indexOf(lower, last)) !== -1) {
                if (i > last) frag.appendChild(document.createTextNode(text.slice(last, i)));
                var m = document.createElement('mark');
                m.className = 'dsm';
                m.style.cssText = 'background:#ffe066;color:inherit;border-radius:2px;';
                m.textContent = text.slice(i, i + query.length);
                frag.appendChild(m);
                results.push(m);
                last = i + query.length;
            }
            if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
            par.replaceChild(frag, textNode);
        });
        return results;
    }

    function highlight() {
        marks.forEach(function (m, i) {
            m.style.background = i === idx ? '#ff9900' : '#ffe066';
            m.style.outline    = i === idx ? '2px solid #e65c00' : 'none';
        });
        if (marks[idx]) marks[idx].scrollIntoView({ block: 'center' });
    }

    function reply(src) {
        src.postMessage({ type: 'searchResult', count: marks.length, current: idx }, '*');
    }

    window.addEventListener('message', function (e) {
        var d = e.data;
        if (!d || !d.type) return;
        if (d.type === 'search') {
            clearMarks();
            if (d.query) {
                marks = markText(d.query);
                if (marks.length) idx = 0;
                highlight();
            }
            reply(e.source);
        } else if (d.type === 'searchNav') {
            if (!marks.length) return;
            idx = d.dir === 'next'
                ? (idx + 1) % marks.length
                : (idx - 1 + marks.length) % marks.length;
            highlight();
            reply(e.source);
        } else if (d.type === 'searchClear') {
            clearMarks();
        }
    });
})();`;

function contentPage(title, body, lang = null) {
  const addLangClass = lang
    ? `document.querySelectorAll('pre code').forEach(function(el){if(!el.className)el.classList.add('language-${lang}');});`
    : '';
  return `<!DOCTYPE html>
<html lang="cs">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title}</title>
  <link rel="stylesheet" href="../assets/content.css">
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/atom-one-dark.min.css">
</head>
<body>
  <h1>${title}</h1>
  ${body}
  <script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/highlight.min.js"><\/script>
  <script>
    ${addLangClass}
    document.querySelectorAll('pre code').forEach(function(el){ hljs.highlightElement(el); });
  <\/script>
  <script>${IN_PAGE_SEARCH_JS}<\/script>
</body>
</html>`;
}

function picturePage(title, pngFilename) {
  return `<!DOCTYPE html>
<html lang="cs">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title}</title>
  <link rel="stylesheet" href="../assets/content.css">
</head>
<body>
  <h1>${title}</h1>
  <img src="${pngFilename}" alt="${title}" style="max-width:100%; height:auto;">
  <script>${IN_PAGE_SEARCH_JS}<\/script>
</body>
</html>`;
}

function indexPage(navHtml, defaultSrc) {
  return `<!DOCTYPE html>
<html lang="cs">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>MyStudyDocs</title>
  <link rel="stylesheet" href="assets/style.css">
</head>
<body>
  <div id="sidebar">
    <div id="sidebar-toolbar">
      <input id="search" type="search" placeholder="Search..." autocomplete="off">
      <button id="collapse-all">Collapse All</button>
    </div>
    <nav id="menu">
${navHtml}
    </nav>
    <div id="search-results"></div>
  </div>
  <div id="content-area">
    <div id="content-toolbar">
      <input id="content-search" type="search" placeholder="Search in document..." autocomplete="off">
      <span id="content-search-count"></span>
      <button class="csearch-btn" id="content-search-prev" title="Previous">&#9650;</button>
      <button class="csearch-btn" id="content-search-next" title="Next">&#9660;</button>
      <button class="csearch-btn" id="content-search-clear" title="Clear">&#10005;</button>
    </div>
    <iframe id="content-frame" name="content" src="${defaultSrc}"></iframe>
  </div>
  <script src="assets/search_index.js"></script>
  <script src="assets/main.js"></script>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------
async function build() {
  console.log('Building MyStudyDocs...\n');

  rmrf(OUTPUT_DIR);
  fs.mkdirSync(path.join(OUTPUT_DIR, 'assets'), { recursive: true });

  const searchIndex = [];
  const navParts = [];
  let defaultSrc = null;

  for (const folderName of FOLDER_ORDER) {
    const folderSrc = path.join(SOURCE_DIR, folderName);
    if (!fs.existsSync(folderSrc)) {
      console.log(`  [skip] ${folderName} — not found in source`);
      continue;
    }

    const folderOut = path.join(OUTPUT_DIR, folderName);
    fs.mkdirSync(folderOut, { recursive: true });

    const usedSlugs = new Set();
    const itemLinks = [];

    if (folderName === 'Pictures') {
      const pngs = fs.readdirSync(folderSrc)
        .filter(f => f.toLowerCase().endsWith('.png'))
        .sort();

      for (const pngFile of pngs) {
        const stem = path.basename(pngFile, '.png');
        const slug = uniqueSlug(slugify(stem), usedSlugs);
        const pngDest = slug + '.png';
        const htmlFile = slug + '.html';

        fs.copyFileSync(path.join(folderSrc, pngFile), path.join(folderOut, pngDest));
        writeFile(path.join(folderOut, htmlFile), picturePage(stem, pngDest));

        const href = `${folderName}/${htmlFile}`;
        itemLinks.push({ title: stem, href });
        if (!defaultSrc) defaultSrc = href;
      }
    } else {
      const docxFiles = fs.readdirSync(folderSrc)
        .filter(f => f.toLowerCase().endsWith('.docx') && !f.startsWith('~$'))
        .sort();

      for (const docxFile of docxFiles) {
        const stem = path.basename(docxFile, '.docx');
        const slug = uniqueSlug(slugify(stem), usedSlugs);
        const htmlFile = slug + '.html';

        console.log(`  Converting: ${folderName}/${docxFile}`);

        const result = await mammoth.convertToHtml(
          { path: path.join(folderSrc, docxFile) },
          { convertImage: mammoth.images.dataUri }
        );

        const lang = { Java: 'java', Angular: 'typescript', React: 'typescript', RxJS: 'typescript' }[folderName] || null;
        const codeTexts = getCodeParagraphTexts(path.join(folderSrc, docxFile));
        writeFile(path.join(folderOut, htmlFile), contentPage(stem, fixExternalLinks(linkifyUrls(wrapCodeBlocks(result.value, codeTexts))), lang));

        const href = `${folderName}/${htmlFile}`;
        searchIndex.push({
          folder: folderName,
          title: stem,
          href,
          text: stripHtml(result.value),
        });
        itemLinks.push({ title: stem, href });
        if (!defaultSrc) defaultSrc = href;
      }
    }

    // Build nav block for this folder
    const linksHtml = itemLinks
      .map(({ title, href }) =>
        `      <a href="${href}" target="content">${title}</a>`)
      .join('\n');

    navParts.push(
      `      <div class="folder collapsed">\n` +
      `        <div class="folder-header"><span class="folder-arrow">&#9660;</span> ${folderName}</div>\n` +
      `        <div class="folder-items">\n` +
      `${linksHtml}\n` +
      `        </div>\n` +
      `      </div>`
    );
  }

  // ---- Links (bookmarks) page ----
  if (fs.existsSync(BOOKMARKS_FILE)) {
    console.log('  Processing bookmarks...');
    const bookmarkItems = parseBookmarks(BOOKMARKS_FILE);
    const bodyHtml = renderBookmarkItems(bookmarkItems);
    const linksDir = path.join(OUTPUT_DIR, 'Links');
    fs.mkdirSync(linksDir, { recursive: true });
    writeFile(path.join(linksDir, 'links.html'), linksPage(bodyHtml));

    const linksHref = 'Links/links.html';
    if (!defaultSrc) defaultSrc = linksHref;
    navParts.push(
      `      <div class="folder collapsed">\n` +
      `        <div class="folder-header"><span class="folder-arrow">&#9660;</span> Links</div>\n` +
      `        <div class="folder-items">\n` +
      `      <a href="${linksHref}" target="content">All Bookmarks</a>\n` +
      `        </div>\n` +
      `      </div>`
    );
  } else {
    console.log(`  [skip] Bookmarks file not found: ${BOOKMARKS_FILE}`);
  }

  // Write assets
  writeFile(path.join(OUTPUT_DIR, 'assets', 'style.css'), STYLE_CSS);
  writeFile(path.join(OUTPUT_DIR, 'assets', 'content.css'), CONTENT_CSS);
  writeFile(path.join(OUTPUT_DIR, 'assets', 'main.js'), MAIN_JS);
  writeFile(
    path.join(OUTPUT_DIR, 'assets', 'search_index.js'),
    'window.SEARCH_INDEX = ' + JSON.stringify(searchIndex) + ';\n'
  );

  // Write index.html
  writeFile(
    path.join(OUTPUT_DIR, 'index.html'),
    indexPage(navParts.join('\n'), defaultSrc || '')
  );

  console.log(`\nDone! Open: ${path.join(OUTPUT_DIR, 'index.html')}`);
  console.log(`  Documents converted: ${searchIndex.length}`);
}

build().catch(err => {
  console.error('Build failed:', err);
  process.exit(1);
});
