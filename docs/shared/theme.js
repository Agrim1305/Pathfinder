/*
 * Light and dark theme for every page. Load it in <head> so the right theme
 * is set before the page paints. A [data-theme-toggle] button cycles
 * System, Light and Dark; System follows the operating system setting. The
 * choice is saved in localStorage and in the URL hash (theme=system, light
 * or dark).
 *
 * <html> gets data-theme (the theme shown, light or dark) and
 * data-theme-choice (system, light or dark). Pages listen with
 * PathfinderTheme.onChange(fn), where fn(theme, fade) gets "light" or
 * "dark" and whether to fade (false under reduced motion).
 */
(function () {
  "use strict";
  const KEY = "pathfinder-theme";
  const ORDER = ["system", "light", "dark"];
  const NAMES = { system: "System", light: "Light", dark: "Dark" };
  const html = document.documentElement;
  const system = matchMedia("(prefers-color-scheme: dark)");
  const reduce = matchMedia("(prefers-reduced-motion: reduce)");
  const valid = (t) => (ORDER.includes(t) ? t : null);
  const fromHash = () => valid(new URLSearchParams(location.hash.slice(1)).get("theme"));
  let saved = null;
  try {
    saved = valid(localStorage.getItem(KEY));
  } catch (e) {
    // storage can be blocked; the choice then lasts for this visit only
  }
  let choice = fromHash() || saved || "system";
  const listeners = [];
  let fadeTimer = 0;

  const current = () => (choice === "system" ? (system.matches ? "dark" : "light") : choice);

  function apply(fade) {
    fade = fade && !reduce.matches;
    if (fade) {
      html.classList.add("theme-fade");
      clearTimeout(fadeTimer);
      fadeTimer = setTimeout(() => html.classList.remove("theme-fade"), 320);
    }
    html.dataset.theme = current();
    html.dataset.themeChoice = choice;
    const name = choice === "system" ? `System (${current()})` : NAMES[choice];
    for (const b of document.querySelectorAll("[data-theme-toggle]")) {
      b.setAttribute("aria-label", `Theme: ${name}`);
      const text = b.querySelector("[data-theme-name]");
      if (text) text.textContent = NAMES[choice];
    }
    for (const fn of listeners) fn(current(), fade);
  }

  function cycle() {
    choice = ORDER[(ORDER.indexOf(choice) + 1) % ORDER.length];
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
    if (choice === "system") apply(true);
  });
  document.addEventListener("DOMContentLoaded", () => apply(false));
  document.addEventListener("click", (e) => {
    if (e.target.closest("[data-theme-toggle]")) cycle();
  });
  // a link to this page with a different theme in its hash
  addEventListener("hashchange", () => {
    const t = fromHash();
    if (t && t !== choice) {
      choice = t;
      apply(true);
    }
  });

  window.PathfinderTheme = { current, choice: () => choice, onChange: (fn) => listeners.push(fn) };
})();
