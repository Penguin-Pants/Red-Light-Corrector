# Phase 1 feasibility report

Status as of 23 November 2026. Phase 1 is in progress. The required target is Chrome on Windows 11. Linux Chromium over loopback supplies supplemental evidence.

| Gate | Evidence | Remaining validation |
| --- | --- | --- |
| F1 launch | User reported a passing Chrome direct-file smoke test including marker persistence. Firefox also passed as supplemental evidence. Linux Chromium smoke passed over loopback. Managed Linux Chromium blocked direct-file navigation by policy. | Record Chrome version and disconnected network status. Run the integrated package through the full direct-file workflow on Windows. |
| F2 HEIC | Playwright on Linux Chromium 156.0.8078.79 verified local bundled decode, primary image selection, a bounded preview, failure for damaged input and rejection of an altered bundle. ImageMagick confirmed the synthetic fixture dimensions. | Run on Windows Chrome against the representative corpus. Verify container and EXIF transforms, profile values, bit depth and HDR independently. The probe identifies profile type and emits 8-bit RGBA. |
| F3 correction | Pending. | Finish F7 identity checks, then evaluate candidates and confidence with the user’s local blind review. |
| F4 metadata | [Independent field expectations drafted](../../feasibility/fixtures/metadata-expectations.md). | Generate the fixtures, resolve capture-time precedence, compare writers and verify synthetic EXIF, GPS and related metadata round trips. |
| F5 files | Linux Chromium verified nested file selection with synthetic inputs. Simulated picker cases covered granted access, cancellation and unavailable API. | Exercise the real Windows picker, build the direct and ZIP output probes, and verify collision, partial failure and recovery behavior. |
| F6 resources | Pending. | Measure the integrated package under the required batch, export and repeat-run workloads. |
| F7 color | Linux Chromium passed a two-patch Display P3 and sRGB Canvas check for PNG and JPEG. The probe recorded profile signaling and decoded sample values. | Test the actual HEIC path, independent color fixtures and precise tolerances on Windows Chrome. Include HDR, transparency and resizing. |
| F8 privacy | Automated Linux checks observed no requests outside the loopback origin. The initial HEIC probe clears its preview and does not write files. | Run the integrated package offline and monitor app traffic and storage for the full workflow. |

## Candidate and scope

The probe uses the embedded WASM classic artifact from libheif-js 1.23.5. The harness validates the exact bytes and does not distribute the decoder. A runtime choice, source and redistribution review and HEVC dependency approval remain pending. The probe’s 64 MiB input and 50 megapixel limits are experimental. They are not approved product limits.

## Color smoke measurements

The PNG exports decoded to red `255,0,0` and neutral `124,124,124` in their target spaces. The JPEG exports decoded to red `254,0,0` with the same neutral. The P3 PNG had iCCP. Both JPEG files had ICC APP2. The sRGB PNG had no dedicated profile chunk. These results describe the browser-generated chart and do not establish source HEIC profile fidelity.

The Windows results for the new probes and the complete phase diff review are pending. Phases 2–6 remain gated by the Phase 1 evidence and approval. No out-of-scope fixes are proposed.
