/*
 * Copyright 2026 Jason Figge
 *
 * This file is part of Hippo Herd.
 *
 * Hippo Herd is free software: you can redistribute it and/or modify it under
 * the terms of the GNU General Public License as published by the Free
 * Software Foundation, either version 3 of the License, or (at your option)
 * any later version.
 *
 * Hippo Herd is distributed in the hope that it will be useful, but WITHOUT
 * ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or
 * FITNESS FOR A PARTICULAR PURPOSE. See the GNU General Public License for
 * more details.
 *
 * You should have received a copy of the GNU General Public License along
 * with Hippo Herd. If not, see <https://www.gnu.org/licenses/>.
 */

/* Hippo Herd — dismissing the nav dropdown.
 *
 * The "The Hippos" menu is a native <details>, which is what keeps it working
 * with JS off and inside the page's script-src 'self' CSP. What <details> does
 * NOT do is close: it has no light-dismiss and no Escape handling, so once
 * opened the card stays over the page until the summary is clicked again —
 * click somewhere else, scroll, tab away, and it follows you down.
 *
 * That is the whole job here. This file adds no behaviour the markup does not
 * already have; it only lets go of what the markup cannot. With this script
 * blocked the menu still opens and still closes on its own summary, which is
 * why the dismissal lives here rather than the menu itself.
 *
 * Lifted, deliberately unchanged in behaviour, from chiphippo.com/nav.js — the
 * same menu on seven sites should not close three different ways. */
(function () {
  "use strict";

  var menus = [].slice.call(document.querySelectorAll(".nav-dropdown"));
  if (!menus.length) return;

  function closeAll(except) {
    for (var i = 0; i < menus.length; i++) {
      if (menus[i] !== except) menus[i].open = false;
    }
  }

  // Light dismiss. Listens on the document in the CAPTURE phase so a click
  // that something else stops from bubbling still dismisses the menu — a menu
  // that outlives the click that should have closed it is the bug being fixed.
  document.addEventListener(
    "click",
    function (e) {
      for (var i = 0; i < menus.length; i++) {
        // A click INSIDE an open menu is the visitor using it; leave that to
        // the link (which navigates) and to the summary (which toggles).
        if (menus[i].contains(e.target)) return closeAll(menus[i]);
      }
      closeAll(null);
    },
    true,
  );

  // Escape closes the open menu and puts focus back where it came from, so a
  // keyboard visitor is not left at the top of the document.
  document.addEventListener("keydown", function (e) {
    if (e.key !== "Escape") return;
    for (var i = 0; i < menus.length; i++) {
      if (!menus[i].open) continue;
      menus[i].open = false;
      var summary = menus[i].querySelector("summary");
      if (summary) summary.focus();
    }
  });

  // Tabbing out of the card is the same intent as clicking away from it.
  // Guarded on relatedTarget, since focusout also fires on the way to a child.
  for (var i = 0; i < menus.length; i++) {
    (function (menu) {
      menu.addEventListener("focusout", function (e) {
        if (!e.relatedTarget || !menu.contains(e.relatedTarget)) {
          menu.open = false;
        }
      });
    })(menus[i]);
  }
})();
