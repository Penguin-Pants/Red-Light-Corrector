# v1.0 release candidate validation

Status on 23 November 2026. The implementation candidate is ready for owner testing. The owner asked to implement all phases without interim approval pauses and plans to test on Windows 11 Chrome. No release approval or Windows integrated pass is recorded.

## Implemented phases

| Phase | Implementation and available evidence | Still open |
| --- | --- | --- |
| 1 · Feasibility | Direct-file Chrome smoke reported by the owner. Supplementary Linux probes for HEIC, color and folder selection. Pinned browser decoder and offline package assembled. | All integrated target-OS results, representative HEIC corpus, private quality review and source/codec redistribution review. |
| 2 · Correction | Per-image analysis, candidate ranking, three modes, low-confidence reasons and channel clipping diagnostics. Synthetic tests cover neutral, recoverable and severely limited channels. | Blinded representative quality ranking and difficult mixed-light cases. |
| 3 · Interface | Gallery, comparison, selected and batch overrides, low-confidence filter and accessible controls. Package browser test covers selection, correction and persistence. | Windows review and display-specific accessibility checks. |
| 4 · Batch and export | Recursive mixed input, bounded worker jobs, cancellation and independent retries, resized or full-size output, dedicated folder writing and numbered ZIPs. Linux tested a resulting ZIP with independent readers and exercised the folder writer against an instrumented picker. | Native Chrome folder picker and failure cases on Windows, multi-volume stress and broader metadata combinations. |
| 5 · Presets and resources | Settings-only storage, preview thumbnails, a single decode/render job at a time and bounded ZIP volumes. Linux Chromium analyzed a synthetic set of 100 12 MP JPEGs with cancel and retry. | Representative five-batch memory, timing and temporary disk study and presets persistence under Windows direct launch. |
| 6 · Packaging | Builder verifies dependency hashes, makes a portable offline folder and ZIP and records output checksums. Packaged artifact passed Linux Chromium loopback tests. | Direct launch from an extracted Windows folder and release decision. |

## Repeatable development checks

- Run `node tests/correction.cjs` and `node tests/metadata.cjs`.
- Run `node packaging/build.mjs`. A local copy of the pinned dependency archive can be passed as an argument.
- Serve only `dist/red-light-corrector` on `127.0.0.1:18748` and run `node tests/app.cjs` with Playwright available. Set `RLC_CHROMIUM_PATH` for a system Chromium. Set `RLC_FULL_RES_TEST=1` for 100 synthetic 12 MP photos. Set `RLC_TEST_ZIP` to a temporary path to retain the synthetic ZIPs for inspection.
- The Playwright suite checks remote requests, nested imports, invalid input, modes and adjustments, ZIP handoff, mock folder writes, cancel/retry, limits, settings reload and clearing in-memory photo state.
- An independent Pillow reader inspected the downloaded synthetic HEIC-derived JPEG and PNG. Dimensions, make, GPS hemisphere references and output ICC were present. ZIP integrity checks passed. A separate test covers basic XMP and JPEG IPTC. PNG IPTC remapping, extended XMP, offset-dependent MakerNotes and HEIC HDR preservation are not established.

## Windows acceptance checklist

1. Prepare the package while online, then disconnect. Open `dist/red-light-corrector/index.html` directly. Record Chrome version. Import JPEG, PNG and representative iPhone HEIC files. Compare orientation and color with a trusted viewer.
2. Review red-lit and normal photos independently of each other. Compare all modes, flags and manual scopes. Test P3, alpha, HDR/unsupported color warnings and restart persistence.
3. Export JPEG and PNG to a dedicated subfolder and to ZIP with the folder picker denied. Test resize, duplicate basenames, GPS, dates, geometry and metadata warnings. Confirm old files and originals are unchanged. Extract every numbered ZIP into one folder.
4. Import 100 representative full-resolution photos, attempt overflow, cancel and retry. Export one and three modes. Measure duration, browser and GPU memory and disk use. Repeat to check retention.
5. Clear and restart. Confirm photos are gone and chosen preferences remain. When online, verify the app makes no remote requests.

Do not publish private photos or derived results. A sanitized pass, fail or issue summary is enough.

## Two-pass review and disposition

The first pass found three concrete issues in the candidate: preview jobs included the HEIC bundle for JPEG and PNG, export retry could be masked by a failed import, and the bundled API’s high-level profile accessor did not consistently match the low-level handle for the ICC fixture. The second pass reproduced the ICC disagreement and traced the retry control flow and worker startup. The fixes use separate worker sources, a distinct export retry control and the verified low-level profile accessor. Unit and browser checks were repeated.

Possible risks remain for Windows direct launch, representative image quality, full-load resources, HEIC transform and HDR combinations and metadata fields outside the verified set. Keep these open for target testing. No release publication or unrelated changes were made.
