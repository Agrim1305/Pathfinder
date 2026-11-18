/*
 * Light and dark theme for every page. Load it in <head> so the right theme
 * is set before the page paints. It follows the system setting until you
 * press a [data-theme-toggle] button; then it remembers your choice in
 * localStorage and in the URL hash (theme=light or theme=dark).
 *
 * Pages listen with PathfinderTheme.onChange(fn), where fn(theme, fade) gets
 * "light" or "dark" and whether to fade (false under reduced motion).
 */
(function () {
  "use strict";
  const KEY = "pathfinder-theme";
  const html = document.documentElement;
  const system = matchMedia("(prefers-color-scheme: dark)");
  const reduce = matchMedia("(prefers-reduced-motion: reduce)");
  const valid = (t) => (t === "light" || t === "dark" ? t : null);
  let saved = null;
  try {
    saved = valid(localStorage.getItem(KEY));
  } catch (e) {
    // storage can be blocked; the theme then lasts for this visit only
  }
  let choice = valid(new URLSearchParams(location.hash.slice(1)).get("theme")) || saved;
  const listeners = [];
  let fadeTimer = 0;

  const current = () => choice || (system.matches ? "dark" : "light");

  function apply(fade) {
    fade = fade && !reduce.matches;
    if (fade) {
      html.classList.add("theme-fade");
      clearTimeout(fadeTimer);
      fadeTimer = setTimeout(() => html.classList.remove("theme-fade"), 320);
    }
    html.dataset.theme = current();
    for (const b of document.querySelectorAll("[data-theme-toggle]")) {
      b.setAttribute("aria-pressed", String(current() === "dark"));
    }
    for (const fn of listeners) fn(current(), fade);
  }

  function toggle() {
    choice = current() === "dark" ? "light" : "dark";
    try {
      localStorage.setItem(KEY, choice);
    } catch (e) {
      // see above
    }
    const p = new URLSearchParams(location.hash.slice(1));
    p.set("theme", choice);
    history.replaceState(null, "", "#" + p);
    apply(true);
  }

  apply(false);
  system.addEventListener("change", () => {
    if (!choice) apply(true);
  });
  document.addEventListener("DOMContentLoaded", () => apply(false));
  // a link to this page with a different theme in its hash
  addEventListener("hashchange", () => {
    const t = valid(new URLSearchParams(location.hash.slice(1)).get("theme"));
    if (t && t !== current()) {
      choice = t;
      apply(true);
    }
  });
  document.addEventListener("click", (e) => {
    if (e.target.closest("[data-theme-toggle]")) toggle();
  });

  window.PathfinderTheme = { current, onChange: (fn) => listeners.push(fn) };
})();
