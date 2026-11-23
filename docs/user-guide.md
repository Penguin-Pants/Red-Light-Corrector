# Red Light Corrector

## Prepare the app

Download and extract the repository. Install Node.js 22 or later for the packaging step. Run `node packaging/build.mjs` from the extracted repository while online. The builder downloads and verifies the HEIC decoder once. For offline preparation, pass the path to the [pinned decoder archive](https://registry.npmjs.org/libheif-js/-/libheif-js-1.23.5.tgz) to the same command.

Open `dist/red-light-corrector/index.html` in Chrome on Windows 11. You can copy the full `red-light-corrector` folder or extract `dist/red-light-corrector.zip` elsewhere. The packaged app runs without Node.js or an internet connection.

## Correct and export

1. Import a folder or choose files. Folder import includes subfolders. The app accepts up to 100 JPEG, PNG or HEIC candidates. Failed images remain in the list so you can retry or clear the batch.
2. Select a photo and compare the previews. Select a mode. Use **Low confidence only** to find cases that need review.
3. Change the controls and select **Apply adjustments** to use them for exports. Choose this photo, checked photos or the whole batch. Save a named preset to reuse the controls later.
4. Select the photos, modes and format to export. Choose **Original size** to retain the full dimensions. **Save to folder** creates a new dedicated subfolder. If the picker is unavailable or denied, select **Export ZIP**.
5. For ZIP export, click each numbered download button when it appears. If there is more than one archive, extract all parts into the same folder. Names are coordinated across parts. The browser controls completion of the download. The app only reports the handoff.

## Privacy and limits

The app processes images in memory with a local worker. It has no upload endpoint, telemetry or remote services. Original files are opened for reading only. Saved exports can include GPS. Browser-managed temporary files and downloads follow Chrome and Windows behavior.

Only preferences and up to 50 presets are kept in local storage. Moving the app folder, changing profiles or clearing browser data can remove access to them. If storage is blocked, preferences last for the session.

JPEG export flattens transparency onto white. PNG retains alpha. Exports use the color space supplied by Display P3 Canvas. The app uses HEIC ICC profiles when Chrome can apply them and recognizes SDR sRGB and Display P3 NCLX profiles. Other HEIC color and HDR cases can shift in color and are reported. Review output before relying on color or metadata. The app can preserve ordinary EXIF and GPS, but reports omissions including extended or incompatible XMP, IPTC without a verified PNG mapping, embedded previews, MakerNotes or incompatible blocks. Basic XMP can be preserved when it has no stale geometry, capture fields or previews. The probe and development tests do not establish support for all iPhone cameras and metadata variants.

Images above 50 megapixels or 128 MiB are rejected by this build. ZIP volumes are limited to 256 MiB. A single encoded file above that limit needs the folder destination or a smaller export. Natural, Balanced and Aggressive use different correction strengths. Confidence is a heuristic. Missing color information may be unrecoverable.
