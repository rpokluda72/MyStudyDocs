(function () {
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
