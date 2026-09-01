// Footer year
const yearEl = document.querySelector('#year');
if (yearEl) yearEl.textContent = new Date().getFullYear();

// Mobile nav
const toggle = document.querySelector('.menu-btn');
const nav = document.querySelector('.menu');
if (toggle && nav) {
  toggle.addEventListener('click', () => {
    const open = nav.classList.toggle('open');
    toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
  });
  // Close the menu when a link inside it is chosen
  nav.addEventListener('click', e => {
    if (e.target.tagName === 'A') {
      nav.classList.remove('open');
      toggle.setAttribute('aria-expanded', 'false');
    }
  });
}

// Same-page anchors: let CSS scroll-behavior + scroll-margin-top do the work,
// but keep the URL hash so links remain shareable and focus moves for a11y.
document.querySelectorAll('a[href^="#"]').forEach(a => {
  a.addEventListener('click', e => {
    const id = a.getAttribute('href').slice(1);
    if (!id) return;
    const el = document.getElementById(id);
    if (!el) return;
    e.preventDefault();
    // styles.css sets scroll-behavior:auto under prefers-reduced-motion, but a
    // scrollIntoView behavior of 'smooth' overrides it, so the stylesheet's
    // intent has to be honoured here too. Checked per click so a visitor
    // changing the setting is respected without a reload.
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    el.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
    history.pushState(null, '', '#' + id);
    el.setAttribute('tabindex', '-1');
    el.focus({ preventScroll: true });
  });
});

// Portfolio demo: the extractor is ~20KB and most visitors never open it, so
// it is fetched on request rather than with the page.
const demoLoad = document.querySelector('#demo-load');
if (demoLoad) {
  demoLoad.addEventListener('click', () => {
    const root = document.querySelector('#demo-root');
    demoLoad.disabled = true;
    demoLoad.textContent = 'Loading…';
    const s = document.createElement('script');
    s.src = '/estatemap-demo.js';
    s.onload = () => {
      root.innerHTML = '';
      window.EstatemapDemo.mount(root);
      // Mounting inserts the editors and their output, so whatever the browser
      // had scrolled to is no longer where it was. Re-anchor on the section
      // when the visitor came for it, or a badge click lands them mid-page.
      if (location.hash === '#try') {
        const target = document.getElementById('try');
        if (target) {
          const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
          target.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
        }
      }
    };
    s.onerror = () => {
      demoLoad.disabled = false;
      demoLoad.textContent = 'Load the demo';
      const hint = document.querySelector('#demo-hint');
      if (hint) hint.textContent = 'The demo failed to load. Reload the page and try again.';
    };
    document.head.appendChild(s);
  });

  // Arriving at the demo deliberately is a request to run it, so skip the
  // second click. The repository's README badge links to #try, and so does this
  // page's own "Run it in your browser" button, whose label promises exactly
  // that. Visitors who never ask still pay nothing for the download.
  // demoLoad is disabled the moment loading starts, so this cannot double-fire.
  const loadDemoOnRequest = () => { if (!demoLoad.disabled) demoLoad.click(); };
  if (location.hash === '#try') loadDemoOnRequest();
  window.addEventListener('hashchange', () => {
    if (location.hash === '#try') loadDemoOnRequest();
  });
  document.querySelectorAll('a[href="#try"]').forEach(a => {
    a.addEventListener('click', loadDemoOnRequest);
  });
}
