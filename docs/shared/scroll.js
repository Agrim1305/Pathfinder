/*
 * Rows marked .scroll-x scroll sideways when they don't fit. This marks the
 * edge (or edges) with more to see, data-more="left right", and the CSS
 * fades that edge out so the cut-off reads as "scroll for more".
 */
(function () {
  "use strict";
  function update(el) {
    const more = [];
    if (el.scrollLeft > 1) more.push("left");
    if (el.scrollLeft + el.clientWidth < el.scrollWidth - 1) more.push("right");
    el.dataset.more = more.join(" ");
  }
  function init() {
    const rows = [...document.querySelectorAll(".scroll-x")];
    const ro = new ResizeObserver((entries) => entries.forEach((e) => update(e.target)));
    for (const el of rows) {
      el.addEventListener("scroll", () => update(el), { passive: true });
      ro.observe(el);
      update(el);
    }
    // web fonts change how wide the content is without resizing the row
    if (document.fonts) document.fonts.ready.then(() => rows.forEach(update));
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
