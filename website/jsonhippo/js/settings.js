/*
 * Copyright 2026 Jason Figge
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * settings.js — the few preferences JsonHippo remembers, in localStorage.
 *
 * One plain string per key (no JSON round trip), and every access guarded:
 * storage can be blocked outright, and the app must still work with the
 * defaults when it is.
 */

const PREFIX = "jsonhippo.";

const DEFAULTS = Object.freeze({
  indent: "2", // "2" | "4" | "tab"
  autoUnescape: "1", // "1" | "0"
  theme: "system", // "system" | "light" | "dark"
});

const ALLOWED = Object.freeze({
  indent: ["2", "4", "tab"],
  autoUnescape: ["1", "0"],
  theme: ["system", "light", "dark"],
});

export class Settings {
  constructor(storage = safeStorage()) {
    this.storage = storage;
  }

  get(name) {
    const value = this.read(PREFIX + name);
    return ALLOWED[name].includes(value) ? value : DEFAULTS[name];
  }

  read(key) {
    try {
      return this.storage?.getItem(key) ?? null;
    } catch {
      return null;
    }
  }

  set(name, value) {
    if (!ALLOWED[name].includes(value)) return;
    try {
      this.storage?.setItem(PREFIX + name, value);
    } catch {
      // Not persisted; the choice still applies for this visit.
    }
  }

  get indent() {
    return this.get("indent");
  }

  set indent(value) {
    this.set("indent", value);
  }

  get autoUnescape() {
    return this.get("autoUnescape") === "1";
  }

  set autoUnescape(on) {
    this.set("autoUnescape", on ? "1" : "0");
  }

  get theme() {
    return this.get("theme");
  }

  set theme(value) {
    this.set("theme", value);
  }
}

function safeStorage() {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}
