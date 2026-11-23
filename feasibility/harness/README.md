# Phase 1 browser probes

The harness runs in Chrome on Windows 11. Keep its files together. Download the optional decoder before disconnecting, then open `index.html` directly with normal browser settings. Check that the address begins with `file:///`.

## F1 launch smoke test

1. Select **Run smoke test**. Record the Chrome version and results. A blocked separate module is expected. The harness uses a classic script.
2. Close Chrome. Reopen the same file with the same Chrome profile and select **Check saved marker**.

The local marker contains only the value `1`. Clear site data to remove it.

## F2 HEIC decode

Download the [pinned libheif-js 1.23.5 package](https://registry.npmjs.org/libheif-js/-/libheif-js-1.23.5.tgz). Extract the archive with Windows tar or an archive tool. Select `package/libheif-wasm/libheif-bundle.js` in **Decoder bundle**. The probe checks its SHA-256 before running it.

Select a HEIC image and click **Decode HEIC**. Start with the [synthetic fixtures](../fixtures/README.md), then use your own images locally if desired. Compare the preview and dimensions with an independent viewer. Record native and bundled results. The preview uses 8-bit RGBA and displays the detected profile type. Its colors are preliminary. Select **Clear photo** to clear the input and preview. No images are saved by the probe.

## F5 and F7 checks

- **F5 folder access.** Select a test folder with nested JPEG, PNG or HEIC files. Check the counts. Open the output folder picker with an empty test folder and record whether it opens and grants write access. Repeat with cancel. The probe writes no files.
- **F7 color round trip.** Select **Check color round trip**. Record the four rows. This checks two generated patches and the presence of encoded profile signaling through Canvas. The larger F7 test will use independent fixtures and cover HEIC color, HDR, resize and transparency.

Share the Chrome version, offline status and check outcomes. Keep private images, screenshots, paths and metadata on your computer.

## Development checks

Run `node feasibility/harness/tests/smoke.cjs` and `node feasibility/harness/tests/photos.cjs` with Playwright available. Set `RLC_HEIC_DECODER` to the extracted bundle for the photo checks. Set `RLC_CHROMIUM_PATH` to a Chromium executable if needed. For a supplemental loopback check, serve this folder on a local static server and set `RLC_SMOKE_URL` to its `index.html` URL. Loopback results do not establish direct-file compatibility.
