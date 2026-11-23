# Red LED Photo Corrector

**Specification:** v1.0 (frozen)  
**Approved:** 2026-11-23  
**Status:** Approved planning baseline. Implementation and feasibility testing are not authorized.  
**Repository:** https://github.com/Penguin-Pants/Red-Light-Corrector  
**Target:** Windows 11, Chrome and Edge, offline local HTML application

## 1. Purpose and scope

Build a private, fully offline tool that improves iPhone photos taken under strong red LED lighting. The objective is the best practical natural-looking correction, even if processing is slower. Red-only illumination may destroy or fail to capture color information, so true original colors cannot always be reconstructed. The app must not claim otherwise.

Support HEIC, JPEG and PNG inputs, recursive folder import, batches of up to 100 images and JPEG/PNG export. Process locally without uploading or transmitting photos. Do not retain imported images between sessions.

### Non-goals for v1

- Cloud processing or external APIs.
- Mandatory local AI models. Architecture should allow optional local AI enhancement later.
- Guaranteed recovery of colors absent from the source image.
- Editing or replacing original input files.

## 2. Launch and packaging

- Prefer launching by double-clicking `index.html` in Chrome or Edge (`file://`).
- A local folder with HTML, JavaScript, CSS and bundled libraries is acceptable. No CDN or network dependencies.
- A small local launcher is acceptable **only if feasibility tests demonstrate that direct HTML launch cannot reliably satisfy critical requirements**. Document the failed test and minimum launcher functionality before adopting it.
- The application must run without internet access. No remote telemetry, analytics or image transfer.
- Check browser restrictions around file access, local module loading, Web Workers, WASM and File System Access API. Do not assume that APIs available under `http://localhost` also work under `file://`.

## 3. Input and file handling

- Accept HEIC, JPEG and PNG. Test representative iPhone HEIC images, orientation and embedded color profiles.
- Select a folder and recursively include files from subfolders. Handle mixed formats, unsupported files and duplicates without stopping the batch.
- Maximum supported batch: 100 photos.
- Maintain original files unchanged.
- Display imported file names and per-file status. Importing photos must not persist them between sessions.

## 4. Correction engine

### Automatic correction

- Analyze each photo independently by default.
- Generate multiple correction candidates using suitable approaches such as channel gain/white balance, color transforms, tone adjustments and channel-aware restoration. These are candidate approaches, not a mandated algorithm.
- Automatically compare candidates and select the best estimated natural-looking result.
- Favor realistic skin and neutral colors where evidence supports them, without assuming that all images contain skin or neutral reference objects.
- Detect dominant red illumination, missing or clipped channels, amplified noise, color casts and unreliable recovery.
- Prioritize correction quality over speed, while keeping processing responsive and memory bounded.

### Modes

- **Natural:** conservative, natural-looking correction and artifact avoidance.
- **Balanced:** moderate recovery with controlled enhancement.
- **Aggressive:** stronger correction, with clear indication of possible artifacts or invented-looking colors.
- Allow selection of export versions during export. A user can export one or more selected modes where implemented, with clear filenames.

### Manual adjustments

- Provide simple controls by default, with advanced controls in an expandable area.
- Allow manual adjustments to a single photo.
- Allow shared settings to apply to selected photos or the entire batch.
- Preserve the distinction between an image's automatic result, its mode and manual overrides.

### Confidence and review

- Give each result a confidence indicator and a plain-language explanation of detected problems.
- Flag low-confidence images for manual review.
- Confidence is a heuristic estimate of correction reliability, not a probability that original colors were recovered.
- Explain severe channel clipping, noise amplification or weak color evidence when detected.
- Permit filtering the gallery to low-confidence photos.

## 5. User interface and workflow

1. Import a folder including subfolders.
2. Analyze all eligible images, showing progress and failures.
3. Review results in a thumbnail gallery with a large selected-image preview.
4. Show original and corrected images side by side, with adjustable controls.
5. Filter low-confidence results and manually review or adjust them.
6. Select output mode(s), format, resolution and destination, then export.

### Interface requirements

- Thumbnail gallery plus large preview for the selected image.
- Side-by-side original/corrected comparison.
- Clear status and confidence for each image.
- Progress for long batches, cancellation and retry of failed images.
- Continue processing remaining photos after individual failures; record actionable errors.
- Responsive interface during long processing.

## 6. Export and metadata

- Export selectable JPEG or PNG.
- Preserve full source resolution by default; offer optional resizing.
- Put all output files into one output folder, regardless of input subfolders.
- Add `_corrected` or a mode suffix to filenames. Resolve collisions automatically with numeric suffixes. Avoid overwriting inputs or existing outputs.
- Prefer direct output-folder selection where supported. Otherwise provide a ZIP download.
- Preserve all technically compatible EXIF and related metadata, including GPS, when possible.
- Account for orientation, color profiles, dates and other available metadata. JPEG and PNG have different metadata capabilities: explicitly report any metadata that cannot be preserved rather than silently losing it.
- Never imply that metadata preservation is perfect before round-trip tests establish it.
- Ensure that output images are viewable with the intended orientation and color appearance.

## 7. Presets and persistence

- Create, name and save custom correction presets.
- Persist user preferences and presets locally.
- Do **not** persist imported photos, thumbnails or source image contents between sessions.
- Document browser storage limits and behavior if local storage is cleared.

## 8. Proposed modular architecture (subject to feasibility)

| Module | Responsibility |
|---|---|
| Image loader | Decode inputs, orientation and color profile handling |
| Image analyzer | Detect red cast, channel clipping, noise and color evidence |
| Correction engine | Generate, score and select candidates and modes |
| Quality analyzer | Confidence heuristics and problem explanations |
| Preview manager | Thumbnails and side-by-side views |
| Batch processor | Job scheduling, progress, cancel, failures and retries |
| Export manager | Encoding, metadata preservation, naming and destination/ZIP |
| Preset manager | Local preferences and named presets |
| AI adapter | Optional future offline AI enhancement without redesigning the UI |

Initial technology candidates: HTML, CSS, vanilla JavaScript, Canvas 2D and optionally WebGL or WASM if benchmarking justifies them. Investigate bundled offline HEIC decoding, metadata read/write and ZIP libraries. No library is approved until feasibility, license and packaging checks.

## 9. Technical feasibility gates

**Phase 1 must produce evidence and recommendations, not automatically authorize the build.**

| Gate | Test | Pass criteria |
|---|---|---|
| F1 | `file://` launch in Chrome and Edge | Core workflows and required bundled libraries work fully offline, or a documented minimum local launcher is justified |
| F2 | HEIC decode | Representative iPhone HEIC files decode correctly, including orientation and color handling |
| F3 | Correction quality | Representative red-LED photos show useful improvement without unacceptable artifacts; known impossible cases are flagged |
| F4 | Metadata round trip | Compatible EXIF/GPS and other target fields survive tested JPEG/PNG exports, with documented exceptions |
| F5 | Recursive import and saving | Recursive import works; output folder saving works where supported or ZIP fallback succeeds |
| F6 | Performance and memory | A 100-photo representative batch finishes without crashes or unbounded memory growth; measure duration and peak usage |
| F7 | Color management | Representative Display P3 and sRGB images avoid unintended shifts in preview and export |
| F8 | Privacy/offline | No network dependency or photo transmission; imported images are not persisted |

For each gate record: browser/version, sample type, procedure, observed result, limitations, pass/fail and recommendation. Avoid using sensitive or explicit photos as committed test fixtures. Use synthetic or consent-cleared images.

## 10. Phased implementation plan (approved sequence, not execution authorization)

### Phase 1: Technical feasibility proof of concept

Validate launch mode, decoding, metadata, file access, color management, correction feasibility and performance. **Deliverable:** feasibility report, selected library candidates and architecture decision. **Gate:** user approval before Phase 2.

### Phase 2: Correction engine

Implement candidate generation, Natural/Balanced/Aggressive modes, selection logic and confidence explanations. **Deliverable:** correction engine with sample comparisons. **Gate:** user approval of image quality.

### Phase 3: Interface

Build gallery, selected-image preview, side-by-side comparison, manual controls and review filters. **Deliverable:** usable single-image workflow. **Gate:** interface review.

### Phase 4: Batch and export

Add recursive import, 100-photo batch processing, cancellation, failure logs, retries, output naming, resizing, metadata handling and direct/ZIP export. **Deliverable:** complete batch workflow. **Gate:** end-to-end validation.

### Phase 5: Presets and optimization

Add persistent presets and preferences, improve performance and strengthen error handling. **Deliverable:** release candidate. **Gate:** reliability testing.

### Phase 6: Validation and packaging

Verify offline operation, image quality, privacy, cross-browser behavior and documentation. **Deliverable:** portable application and test results. **Gate:** final release approval.

## 11. Acceptance criteria

- Offline operation in supported launch mode on Windows 11 with Chrome and Edge.
- HEIC, JPEG and PNG inputs and recursive folder import of up to 100 images.
- Automatic per-image analysis, best-candidate selection and three modes.
- Individual and shared adjustments, with simple and advanced controls.
- Gallery, side-by-side comparison, confidence explanations and low-confidence filtering.
- Progress, cancellation, per-file failure logging and retry, without losing successful results.
- JPEG/PNG output, default full resolution, optional resize, flat output folder and collision-safe names.
- Direct destination where technically available, ZIP fallback otherwise.
- Metadata preservation to the extent technically possible, with explicit reporting of losses.
- Local saved presets and preferences, with no persisted imported photos.
- Architecture allows future optional local AI without requiring it for v1.
- No claims of recovering original colors when source channels contain insufficient information.

## 12. Risks and open technical decisions

1. **Lost color information:** monochromatic red LED illumination may leave insufficient green/blue signal. Confidence and realistic expectations are essential.
2. **HEIC in local browser:** browser native support is inconsistent. Bundled decoders and their licensing, WASM requirements and memory use need testing.
3. **`file://` restrictions:** module loading, workers, WASM and folder saving may require alternative packaging. Use a launcher only if evidence justifies it.
4. **Metadata:** preserving EXIF, GPS, ICC profiles and other fields across HEIC/JPEG/PNG requires format-specific handling and verification.
5. **Color management:** iPhone Display P3/HDR and wide-gamut conversions can cause shifts. HDR support boundaries must be documented.
6. **Batch memory:** 100 full-resolution images must be processed with bounded concurrency and resource release.
7. **Quality scoring:** no-reference quality metrics can prefer unnatural colors. Evaluate against human-reviewed examples and conservative failure flags.
8. **Privacy:** explicit images may be processed, but must remain on device. Do not upload, log image contents or commit private samples.

## 13. Governance and change control

This document is the **frozen v1.0 requirements baseline**. Changes require a documented proposed revision and user approval. A build plan may refine implementation details but may not silently change requirements or treat unverified feasibility assumptions as facts.

**Authorization status:** The user approved the specification and phased plan, then froze implementation. Creating, committing and merging planning documentation and drafting a build plan are allowed when explicitly requested. No application code, feasibility experiments, dependency installation or implementation work is authorized by that documentation request.
