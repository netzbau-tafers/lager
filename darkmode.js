(function () {
  const STORAGE_KEY = 'lager-theme';
  const DARK_CLASS = 'darkmode';
  const root = document.documentElement;
  const themeMeta = document.querySelector('meta[name="theme-color"]');

  function getSavedTheme() {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved === 'dark' || saved === 'light' ? saved : null;
  }

  function resolveTheme() {
    return getSavedTheme() || 'light';
  }

  function syncThemeColor(theme) {
    if (!themeMeta) return;
    themeMeta.setAttribute('content', theme === 'dark' ? '#0f172a' : '#e6eaef');
  }

  function applyTheme(theme) {
    root.classList.toggle(DARK_CLASS, theme === 'dark');
    root.style.colorScheme = theme;
    syncThemeColor(theme);
    const toggle = document.querySelector('.theme-toggle');
    if (toggle) {
      toggle.setAttribute('aria-label', theme === 'dark' ? 'Zu Light Mode wechseln' : 'Zu Dark Mode wechseln');
      toggle.textContent = theme === 'dark' ? '☀️' : '🌙';
    }
  }

  applyTheme(resolveTheme());

  function setupToggle() {
    const existing = document.querySelector('.theme-toggle');
    if (existing) return;

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'theme-toggle';
    btn.title = 'Dark Mode umschalten';

    btn.addEventListener('click', function () {
      const next = root.classList.contains(DARK_CLASS) ? 'light' : 'dark';
      localStorage.setItem(STORAGE_KEY, next);
      applyTheme(next);
    });

    document.body.appendChild(btn);
    applyTheme(resolveTheme());
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setupToggle);
  } else {
    setupToggle();
  }

})();
