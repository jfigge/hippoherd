/*
 * Copyright 2026 Jason Figge
 *
 * This file is part of JsonHippo.
 *
 * JsonHippo is free software: you can redistribute it and/or modify it under
 * the terms of the GNU General Public License as published by the Free
 * Software Foundation, either version 3 of the License, or (at your option)
 * any later version.
 *
 * JsonHippo is distributed in the hope that it will be useful, but WITHOUT
 * ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or
 * FITNESS FOR A PARTICULAR PURPOSE. See the GNU General Public License for
 * more details.
 *
 * You should have received a copy of the GNU General Public License along
 * with JsonHippo. If not, see <https://www.gnu.org/licenses/>.
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
  lint: "1", // "1" | "0" — warnings for valid but suspect JSON
  schemaDraft: "2020-12", // "2020-12" | "07"
  schemaRequired: "1", // "1" | "0" — list the keys every sample has as required
});

const ALLOWED = Object.freeze({
  indent: ["2", "4", "tab"],
  autoUnescape: ["1", "0"],
  theme: ["system", "light", "dark"],
  lint: ["1", "0"],
  schemaDraft: ["2020-12", "07"],
  schemaRequired: ["1", "0"],
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

  get lint() {
    return this.get("lint") === "1";
  }

  set lint(on) {
    this.set("lint", on ? "1" : "0");
  }

  get schemaDraft() {
    return this.get("schemaDraft");
  }

  set schemaDraft(value) {
    this.set("schemaDraft", value);
  }

  get schemaRequired() {
    return this.get("schemaRequired") === "1";
  }

  set schemaRequired(on) {
    this.set("schemaRequired", on ? "1" : "0");
  }
}

function safeStorage() {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}
