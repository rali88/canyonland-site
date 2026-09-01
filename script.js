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
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    history.pushState(null, '', '#' + id);
    el.setAttribute('tabindex', '-1');
    el.focus({ preventScroll: true });
  });
});
