# Phase 1 launch smoke test

This is the first part of F1. It uses a synthetic color patch and has no photo input.

## Run on Windows 11

1. Keep the four runtime files together. Extract the ZIP first if using an archive.
2. Disconnect from the internet. Open `index.html` in Chrome with normal security settings. Confirm that its address starts with `file:///`.
3. Select **Run smoke test**. Record the browser version and result of each check. A blocked separate module is an expected result. The harness runs from a classic script.
4. Close the browser. Reopen the same file with the same browser profile. Select **Check saved marker** and record the result.
5. Repeat in Edge. Share the check labels, outcomes and browser versions. If a check fails, include its error text without any private file paths.

The local marker contains only the value `1`. Clear site data to remove it. The smoke checks cover a Blob worker, byte-initialized WASM, generated JPEG and PNG decoding and local storage. They leave HEIC, actual photo quality, metadata, picker behavior, batch resources and the full privacy gate for the integrated harness.

## Development check

Run `node feasibility/harness/tests/smoke.cjs` with Playwright available. Set `RLC_CHROMIUM_PATH` to a Chromium executable if needed. For a supplemental loopback check, serve this folder on a local static server and set `RLC_SMOKE_URL` to the local `index.html` URL. The loopback check supplies no direct-file evidence and does not select a launcher for the project.
