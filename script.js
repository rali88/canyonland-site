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
    };
    s.onerror = () => {
      demoLoad.disabled = false;
      demoLoad.textContent = 'Load the demo';
      const hint = document.querySelector('#demo-hint');
      if (hint) hint.textContent = 'The demo failed to load. Reload the page and try again.';
    };
    document.head.appendChild(s);
  });
}
