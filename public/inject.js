// Добавляет пункт «Экстрактор ссылок» в боковое меню панели Remnawave.
// Подключается в index.html панели через sub_filter (nginx) или replace-response (Caddy).
(function () {
  var BASE = '__BASE__';
  var LABEL = 'Экстрактор ссылок';
  var ANCHORS = ['Быстрый переход', 'Статистика HTTP', 'Обозреватель сессий', 'Инспектор HWID', 'Quick jump', 'HTTP statistics', 'HWID Inspector'];
  var ICON = '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/></svg>';

  function textOf(el) { return (el.textContent || '').replace(/\s+/g, ' ').trim(); }

  function findAnchor() {
    var links = document.querySelectorAll('nav a, nav button, aside a, aside button, [class*="Navbar"] a, [class*="navbar"] a, a[class*="NavLink"], button[class*="NavLink"]');
    var byLabel = {};
    for (var i = 0; i < links.length; i++) byLabel[textOf(links[i])] = links[i];
    for (var j = 0; j < ANCHORS.length; j++) if (byLabel[ANCHORS[j]]) return byLabel[ANCHORS[j]];
    return null;
  }

  function replaceLabel(el) {
    // Меняем самый глубокий текстовый узел с названием пункта
    var walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    var node; var target = null;
    while ((node = walker.nextNode())) if (node.nodeValue.trim()) { target = node; break; }
    if (target) target.nodeValue = LABEL; else el.appendChild(document.createTextNode(LABEL));
    // Убираем возможный текст справа (бейджи/счётчики)
    walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    while ((node = walker.nextNode())) if (node !== target && node.nodeValue.trim()) node.nodeValue = '';
  }

  function inject() {
    if (document.querySelector('[data-link-extractor]')) return;
    var anchor = findAnchor();
    if (!anchor) return;
    var item = anchor.cloneNode(true);
    item.setAttribute('data-link-extractor', '1');
    item.setAttribute('href', BASE + '/');
    item.removeAttribute('data-active');
    item.removeAttribute('aria-current');
    var svg = item.querySelector('svg');
    if (svg) {
      var tmp = document.createElement('div'); tmp.innerHTML = ICON;
      var ns = tmp.firstChild;
      var w = svg.getAttribute('width'); var h = svg.getAttribute('height');
      if (w) ns.setAttribute('width', w); if (h) ns.setAttribute('height', h);
      if (svg.getAttribute('class')) ns.setAttribute('class', svg.getAttribute('class'));
      svg.parentNode.replaceChild(ns, svg);
    }
    replaceLabel(item);
    // Скрываем стрелку подменю, если она была у исходного пункта
    var chev = item.querySelectorAll('[class*="chevron"], [class*="Chevron"], [class*="rightSection"]');
    for (var k = 0; k < chev.length; k++) chev[k].style.display = 'none';
    item.addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); window.location.href = BASE + '/'; }, true);
    anchor.parentNode.insertBefore(item, anchor.nextSibling);
  }

  var scheduled = false;
  var obs = new MutationObserver(function () {
    if (scheduled) return; scheduled = true;
    requestAnimationFrame(function () { scheduled = false; inject(); });
  });
  function start() { inject(); obs.observe(document.body, { childList: true, subtree: true }); }
  if (document.body) start(); else document.addEventListener('DOMContentLoaded', start);
})();
