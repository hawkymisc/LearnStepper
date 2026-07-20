import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("renderer redesign declares a blue-led, color-diversity-safe semantic palette", async () => {
  const css = await source("app/globals.css");
  for (const token of [
    "--ls-primary: #0b3a67",
    "--ls-action: #146eb4",
    "--ls-success: #007c78",
    "--ls-warning: #9a5b00",
    "--ls-danger: #a63d63",
    "--ls-space-1: 4px",
    "--ls-radius-1: 6px",
    "--ls-shadow-1:",
    "--ls-motion-fast:",
  ]) assert.match(css, new RegExp(token, "i"));
  assert.match(css, /\.renderer-onboarding,[\s\S]*\.renderer-loading[\s\S]*--renderer-primary:/);
  assert.match(css, /\.renderer-error[\s\S]*border-left:/);
  assert.match(css, /\.renderer-success[\s\S]*border-left:/);
  assert.match(css, /\.renderer-banner-warning[\s\S]*border-left:/);
});

test("renderer redesign preserves focused operation at narrow widths and reduced motion", async () => {
  const css = await source("app/globals.css");
  assert.match(css, /@media \(max-width: 760px\)[\s\S]*\.renderer-sidebar/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)[\s\S]*\.renderer-app/);
  assert.match(css, /\.renderer-sidebar nav button:focus-visible/);
});

test("acceptance evidence includes every renderer area and review checklist category", async () => {
  const acceptance = await source("docs/FRONTEND_REDESIGN_ACCEPTANCE.md");
  for (const required of ["Startup", "Home", "Project setup", "Learning", "Learning tools", "Supporting views", "Product and hierarchy", "Visual system", "Interaction and states", "Responsive behavior", "Accessibility", "Performance and resilience"]) {
    assert.match(acceptance, new RegExp(required));
  }
});
