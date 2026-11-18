/*
 * Small page controls shared by the pages: a search box with a list (the
 * ARIA combobox pattern), popovers, "?" toggletips and the timeline bar.
 * Styles are in theme.css.
 *
 * Plain script: sets window.UI.
 */
(function () {
  "use strict";

  // ---------- combobox: a text box that filters a list as you type ----------
  // o.search(text) returns entries ({ label, hint }); o.pick(entry) is called
  // with the one chosen. status is a live region for the number of matches.
  // Returns set(text) to show a value chosen some other way.
  function combobox(input, list, o) {
    let items = [], active = -1, value = input.value;
    const setActive = (i) => {
      active = i;
      [...list.children].forEach((li, j) => li.setAttribute("aria-selected", String(j === i)));
      if (i < 0) return input.removeAttribute("aria-activedescendant");
      input.setAttribute("aria-activedescendant", list.children[i].id);
      list.children[i].scrollIntoView({ block: "nearest" });
    };
    const open = (on) => {
      list.hidden = !on;
      input.setAttribute("aria-expanded", String(on));
      if (!on) setActive(-1);
    };
    const render = () => {
      // the box still shows the chosen value: list everything, not just that
      items = o.search(input.value === value ? "" : input.value);
      list.replaceChildren(...items.map((e, i) => {
        const li = document.createElement("li"), name = document.createElement("span"), hint = document.createElement("span");
        li.id = `${list.id}-${i}`;
        li.setAttribute("role", "option");
        li.setAttribute("aria-selected", "false");
        name.textContent = e.label;
        hint.textContent = e.hint || "";
        hint.className = "hint";
        li.append(name, hint);
        return li;
      }));
      open(items.length > 0);
      if (o.status) o.status.textContent = items.length ? `${items.length} ${items.length === 1 ? "match" : "matches"}. Use the up and down arrows to choose.` : "No matches.";
    };
    const choose = (i) => {
      const e = items[i];
      if (!e) return;
      value = input.value = e.label;
      open(false);
      o.pick(e);
    };
    const revert = () => {
      input.value = value;
      open(false);
    };
    input.addEventListener("input", render);
    input.addEventListener("click", () => {
      input.select();
      if (list.hidden) render();
    });
    input.addEventListener("keydown", (e) => {
      const n = items.length;
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        if (list.hidden) return render();
        if (n) setActive(e.key === "ArrowDown" ? (active + 1) % n : active <= 0 ? n - 1 : active - 1);
      } else if (e.key === "Enter" && !list.hidden && n) {
        e.preventDefault();
        choose(Math.max(0, active));
      } else if (e.key === "Escape" && (!list.hidden || input.value !== value)) {
        e.preventDefault();
        e.stopPropagation();
        revert();
      }
    });
    // leaving the box puts back the chosen value, but switching windows keeps what you typed
    input.addEventListener("blur", () => document.hasFocus() && revert());
    list.addEventListener("pointerdown", (e) => e.preventDefault()); // keep focus in the box
    list.addEventListener("click", (e) => {
      const li = e.target.closest("[role=option]");
      if (li) choose([...list.children].indexOf(li));
    });
    return (text) => {
      value = input.value = text;
    };
  }

  // ---------- popovers: a button that shows and hides a panel ----------
  const pops = [];
  function popover(button, panel, onToggle) {
    const set = (on) => {
      if (on) pops.forEach((p) => p !== set && p(false)); // one at a time
      panel.hidden = !on;
      button.setAttribute("aria-expanded", String(on));
      if (onToggle) onToggle(on);
    };
    set.button = button;
    set.panel = panel;
    pops.push(set);
    button.addEventListener("click", () => set(panel.hidden));
    set(false);
    return set;
  }
  document.addEventListener("pointerdown", (e) => {
    for (const p of pops) if (!p.panel.hidden && !p.panel.contains(e.target) && !p.button.contains(e.target)) p(false);
  });
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    const p = pops.find((q) => !q.panel.hidden);
    if (!p) return;
    p(false);
    p.button.focus();
    e.stopImmediatePropagation();
  });

  // ---------- "?" toggletips ----------
  // A button with data-tip shows that text in a bubble: on click (it stays
  // until a second click, Escape or a click elsewhere) or while the mouse is
  // over it. The bubble is a live region, so screen readers read it out.
  const bubble = document.createElement("div");
  bubble.className = "qtip-bubble";
  bubble.setAttribute("role", "status");
  let owner = null, pinned = false;
  const hideTip = () => {
    owner = null;
    pinned = false;
    bubble.textContent = "";
  };
  const showTip = (b, pin) => {
    owner = b;
    pinned = pin;
    bubble.textContent = b.dataset.tip;
    const r = b.getBoundingClientRect(), w = Math.min(280, innerWidth - 24);
    bubble.style.width = w + "px";
    bubble.style.left = Math.max(12, Math.min(innerWidth - w - 12, r.left + r.width / 2 - w / 2)) + "px";
    const below = r.bottom + 8, h = bubble.offsetHeight;
    bubble.style.top = (below + h < innerHeight - 8 ? below : r.top - 8 - h) + "px";
  };
  document.addEventListener("DOMContentLoaded", () => document.body.appendChild(bubble));
  document.addEventListener("click", (e) => {
    const b = e.target.closest("[data-tip]");
    if (b) return owner === b && pinned ? hideTip() : showTip(b, true);
    if (owner && !bubble.contains(e.target)) hideTip();
  });
  document.addEventListener("pointerover", (e) => {
    const b = e.pointerType === "mouse" && e.target.closest("[data-tip]");
    if (b && !pinned) showTip(b, false);
  });
  document.addEventListener("pointerout", (e) => {
    const b = e.target.closest("[data-tip]");
    if (b && b === owner && !pinned && !b.contains(e.relatedTarget)) hideTip();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && owner) {
      hideTip();
      e.stopImmediatePropagation();
    }
  });
  document.addEventListener("scroll", () => owner && hideTip(), true);

  // ---------- timeline: play or pause, a scrubber and "Step k of N" ----------
  // root holds .tl-play, .tl-scrub and .tl-label. o.toggle() plays or pauses;
  // o.seek(k) jumps to step k. Returns render(k, N, state, text), where
  // state is "playing", "paused" or "done".
  function timeline(root, o) {
    const play = root.querySelector(".tl-play"), scrub = root.querySelector(".tl-scrub"), label = root.querySelector(".tl-label");
    play.addEventListener("click", () => o.toggle());
    scrub.addEventListener("input", () => o.seek(Number(scrub.value)));
    let shown = "";
    return (k, N, state, text) => {
      const key = [k, N, state, text].join("|");
      if (key === shown) return;
      shown = key;
      scrub.max = N;
      scrub.value = k;
      scrub.setAttribute("aria-valuetext", text);
      label.textContent = text;
      play.dataset.state = state;
      play.setAttribute("aria-label", state === "playing" ? "Pause" : state === "done" ? "Play again" : "Play");
    };
  }

  window.UI = { combobox, popover, timeline };
})();
