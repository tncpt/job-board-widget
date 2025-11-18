# Job Board Widget — Embed and Test Instructions

## Overview

- This repository contains a self-contained job-board widget intended to be embedded into a 3rd-party platform by copying the head (styles) and body (markup + script) fragments.
- Methods used made for safe embedding:
  - All DOM and CSS namespaced under `#jbw-root` and prefixed IDs (`jbw-...`).
  - JS wrapped in an immediately invoked function expression (a.k.a. "IIFE") to avoid global pollution.
  - JSONP uses a unique per-instance callback name with cleanup and a 10s timeout.
  - Defensive validation and escaping for returned data.
  - Fallback handling for platforms that block script injection using cross site protection (a.k.a. "CSP").

## What to copy into the 3rd-party platform

1. Head (styles)
   - Copy the entire `<style>...</style>` block from `index.html` into the platform's head section.
   - Optionally prefix or scope further if the platform modifies CSS.

2. Body (markup)
   - Copy the `<div id="jbw-root">...</div>` block (the widget markup including inputs and `jbw-job-list`) into the location where you want the widget to appear.

3. Script (logic)
   - Copy the `<script>...</script>` IIFE at the bottom of `index.html` into the body immediately after the `jbw-root` markup.
   - If the platform strips or disallows `<script>` tags, see "If scripts are blocked" below.

## Quick test checklist

1. Paste the head and body pieces into the platform and save.
2. Open the page, open Developer Tools → Console and Network.
3. Expectation:
   - A network request to `script.google.com/macros/s/.../exec?callback=handleJobData_jbw_<random>` should appear.
   - If successful, the widget should populate job cards.
   - If not, inspect Console for an error message rendered into the widget area (user-visible) and check Network response.

## Debug tips

- Network response must be JSONP-wrapped: e.g. `handleJobData_jbw_xxx([ {...}, {...} ])`.
  - If your Apps Script returns plain JSON, it will not work as JSONP. You can modify the Apps Script to wrap the output with the `callback` parameter.

- To verify server response: in DevTools → Network → click the request → Response. You should see the callback wrapper with your data.

## If scripts are blocked (CSP / platform restrictions)

- Many platforms block adding remote scripts or script tags. Options:
  1. Ask the platform to allow `https://script.google.com` or allow inline script insertion for this page.
  2. Enable CORS on your server/AppScript and use the platform's allowed `fetch()`/AJAX mechanism instead of JSONP. (This requires the platform to allow network calls from widget-hosted JS.)
  3. Host a single allowed embed script on an approved origin (a single `<script src="...">`) that then loads data from other endpoints server-side.

## Apps Script -> JSONP notes

- Your Apps Script endpoint reads the `callback` query parameter and returns a JavaScript response that calls that callback with the data:

  // pseudo Apps Script response
  const callback = e.parameter.callback || 'handleJobData';
  const payload = JSON.stringify(jobsArray);
  return ContentService.createTextOutput(`${callback}(${payload});`).setMimeType(ContentService.MimeType.JAVASCRIPT);
