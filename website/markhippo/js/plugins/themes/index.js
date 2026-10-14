/*
 * Copyright 2026 Jason Figge
 *
 * This file is part of MarkHippo.
 *
 * MarkHippo is free software: you can redistribute it and/or modify it under
 * the terms of the GNU General Public License as published by the Free
 * Software Foundation, either version 3 of the License, or (at your option)
 * any later version.
 *
 * MarkHippo is distributed in the hope that it will be useful, but WITHOUT
 * ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or
 * FITNESS FOR A PARTICULAR PURPOSE. See the GNU General Public License for
 * more details.
 *
 * You should have received a copy of the GNU General Public License along
 * with MarkHippo. If not, see <https://www.gnu.org/licenses/>.
 */

/*
 * The themes plugin: named palettes beyond MarkHippo's own, registered
 * through `api.theme` like any third party's would be. Each has a light and
 * a dark mode; Light / Dark / System picks between them.
 *
 * Every text colour is at least 4.5:1 (WCAG AA) on what it is read against
 * — test/themes.test.js checks it — so where a palette's canonical colour
 * fell short on its own background (Catppuccin Latte's yellows and teals,
 * say) it has been deepened just enough.
 */

const CATPPUCCIN = {
  id: "catppuccin",
  name: "Catppuccin",
  description: "Latte by day, Mocha by night",
  light: {
    "--bg": "#eff1f5",
    "--mantle": "#e6e9ef",
    "--crust": "#dce0e8",
    "--surface-0": "#ccd0da",
    "--surface-1": "#bcc0cc",
    "--surface-2": "#acb0be",
    "--code-bg": "#e6e9ef",
    "--text": "#4c4f69",
    "--subtext": "#5c5f77",
    "--muted": "#686b80",
    "--accent": "#8839ef",
    "--selection": "#dcd0f5",
    "--quote-bar": "#c5a8f2",
    "--error": "#d20f39",
    "--md-code": "#127277",
    "--tk-keyword": "#8538ea",
    "--tk-string": "#2f7620",
    "--tk-number": "#af4508",
    "--tk-comment": "#646777",
    "--tk-function": "#1c5ee1",
    "--tk-type": "#915c13",
    "--tk-property": "#127277",
    "--tk-tag": "#ce0f38",
    "--tk-attr": "#ba3843",
    "--tk-variable": "#984d84",
    "--tk-meta": "#5261b6",
  },
  dark: {
    "--bg": "#1e1e2e",
    "--mantle": "#181825",
    "--crust": "#11111b",
    "--surface-0": "#313244",
    "--surface-1": "#45475a",
    "--surface-2": "#585b70",
    "--code-bg": "#181825",
    "--text": "#cdd6f4",
    "--subtext": "#a6adc8",
    "--muted": "#9399b2",
    "--accent": "#cba6f7",
    "--selection": "#45385f",
    "--quote-bar": "#6c5a9a",
    "--error": "#f38ba8",
    "--md-code": "#94e2d5",
    "--tk-keyword": "#cba6f7",
    "--tk-string": "#a6e3a1",
    "--tk-number": "#fab387",
    "--tk-comment": "#9399b2",
    "--tk-function": "#89b4fa",
    "--tk-type": "#f9e2af",
    "--tk-property": "#94e2d5",
    "--tk-tag": "#f38ba8",
    "--tk-attr": "#eba0ac",
    "--tk-variable": "#f5c2e7",
    "--tk-meta": "#b4befe",
  },
};

// Rest Hippo's greys, so the two apps can look alike.
const GREY = {
  id: "grey",
  name: "Grey",
  description: "Rest Hippo's neutral greys",
  light: {
    "--bg": "#f4f4f4",
    "--mantle": "#ebebeb",
    "--crust": "#dedede",
    "--surface-0": "#d2d2d2",
    "--surface-1": "#c2c2c2",
    "--surface-2": "#aeaeae",
    "--code-bg": "#ebebeb",
    "--text": "#1e1e1e",
    "--subtext": "#484848",
    "--muted": "#686868",
    "--accent": "#383838",
    "--selection": "#d8d8d8",
    "--quote-bar": "#aeaeae",
    "--error": "#b82020",
    "--md-code": "#1870a0",
    "--tk-keyword": "#6820b0",
    "--tk-string": "#297829",
    "--tk-number": "#8e6000",
    "--tk-comment": "#686868",
    "--tk-function": "#2050c0",
    "--tk-type": "#ab4e10",
    "--tk-property": "#1870a0",
    "--tk-tag": "#b82020",
    "--tk-attr": "#8a5a00",
    "--tk-variable": "#2060b8",
    "--tk-meta": "#606060",
  },
  dark: {
    "--bg": "#1c1c1c",
    "--mantle": "#161616",
    "--crust": "#101010",
    "--surface-0": "#2a2a2a",
    "--surface-1": "#383838",
    "--surface-2": "#484848",
    "--code-bg": "#242424",
    "--text": "#e8e8e8",
    "--subtext": "#b0b0b0",
    "--muted": "#8a8a8a",
    "--accent": "#d0d0d0",
    "--selection": "#3a3a3a",
    "--quote-bar": "#585858",
    "--error": "#e07070",
    "--md-code": "#70b8d0",
    "--tk-keyword": "#a880c0",
    "--tk-string": "#80c080",
    "--tk-number": "#d4b060",
    "--tk-comment": "#8d8d8d",
    "--tk-function": "#8090d0",
    "--tk-type": "#d09060",
    "--tk-property": "#70b8d0",
    "--tk-tag": "#e07070",
    "--tk-attr": "#c8a060",
    "--tk-variable": "#6aa6e0",
    "--tk-meta": "#a0a0a0",
  },
};

const HIGH_CONTRAST = {
  id: "high-contrast",
  name: "High contrast",
  description: "Black and white, with strong colours",
  light: {
    "--bg": "#ffffff",
    "--mantle": "#ffffff",
    "--crust": "#f0f0f0",
    "--surface-0": "#e0e0e0",
    "--surface-1": "#4a4a4a",
    "--surface-2": "#000000",
    "--code-bg": "#f2f2f2",
    "--text": "#000000",
    "--subtext": "#1a1a1a",
    "--muted": "#3d3d3d",
    "--accent": "#003cb3",
    "--selection": "#ffe066",
    "--quote-bar": "#000000",
    "--error": "#b00000",
    "--md-code": "#005a5a",
    "--tk-keyword": "#6a00b8",
    "--tk-string": "#005c00",
    "--tk-number": "#a33a00",
    "--tk-comment": "#4a4a4a",
    "--tk-function": "#0039a6",
    "--tk-type": "#7a4a00",
    "--tk-property": "#005a73",
    "--tk-tag": "#a3001b",
    "--tk-attr": "#6b4000",
    "--tk-variable": "#8a0060",
    "--tk-meta": "#3d3db0",
  },
  dark: {
    "--bg": "#000000",
    "--mantle": "#0a0a0a",
    "--crust": "#000000",
    "--surface-0": "#262626",
    "--surface-1": "#8a8a8a",
    "--surface-2": "#ffffff",
    "--code-bg": "#121212",
    "--text": "#ffffff",
    "--subtext": "#e6e6e6",
    "--muted": "#c8c8c8",
    "--accent": "#ffd23f",
    "--selection": "#5a4a00",
    "--quote-bar": "#ffffff",
    "--error": "#ff8a80",
    "--md-code": "#7fffd4",
    "--tk-keyword": "#e0b0ff",
    "--tk-string": "#9dff9d",
    "--tk-number": "#ffc580",
    "--tk-comment": "#c0c0c0",
    "--tk-function": "#9ecbff",
    "--tk-type": "#fff099",
    "--tk-property": "#8ff0ff",
    "--tk-tag": "#ff9eb5",
    "--tk-attr": "#ffcf9e",
    "--tk-variable": "#ffb3e6",
    "--tk-meta": "#c8c8ff",
  },
};

export const PALETTES = [CATPPUCCIN, GREY, HIGH_CONTRAST];

export default {
  id: "themes",
  name: "Themes",
  version: "1.0.0",
  description: "Named colour palettes, each with a light and a dark mode: Catppuccin, Grey and High contrast.",
  setup(api) {
    for (const palette of PALETTES) api.theme(palette);
  },
};
