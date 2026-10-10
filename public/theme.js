/*
 * Theme bootstrap — loaded synchronously in <head> so the correct theme is applied
 * before first paint (no flash of the wrong theme). CSP-safe: external file, no inline.
 * Preference: localStorage 'ti_theme' -> OS prefers-color-scheme -> dark.
 */
(function () {
  function pick() {
    try {
      var stored = localStorage.getItem('ti_theme');
      if (stored === 'light' || stored === 'dark') return stored;
    } catch (e) { /* storage blocked */ }
    try {
      return window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
    } catch (e) {
      return 'dark';
    }
  }
  var theme = pick();
  document.documentElement.setAttribute('data-theme', theme);

  window.tiTheme = {
    current: function () {
      return document.documentElement.getAttribute('data-theme') || 'dark';
    },
    set: function (next) {
      var t = next === 'light' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', t);
      try {
        localStorage.setItem('ti_theme', t);
      } catch (e) { /* ignore */ }
      document.dispatchEvent(new CustomEvent('ti:theme', { detail: { theme: t } }));
      return t;
    },
    toggle: function () {
      return window.tiTheme.set(window.tiTheme.current() === 'dark' ? 'light' : 'dark');
    },
  };
})();
