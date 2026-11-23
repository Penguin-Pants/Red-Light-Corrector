# Red Light Corrector

## Prepare the app

Download and extract the repository. Install Node.js 22 or later for the packaging step. Run `node packaging/build.mjs` from the extracted repository while online. The builder downloads and verifies the HEIC decoder once. For offline preparation, pass the path to the [pinned decoder archive](https://registry.npmjs.org/libheif-js/-/libheif-js-1.23.5.tgz) to the same command.

Open `dist/red-light-corrector/index.html` in Chrome on Windows 11. You can copy the full `red-light-corrector` folder or extract `dist/red-light-corrector.zip` elsewhere. The packaged app runs without Node.js or an internet connection.

## Correct and export

1. Drop image files anywhere on the page, choose files with **Import files**, or use **Import folder** to include subfolders. The app accepts up to 100 JPEG, PNG or HEIC candidates. Failed images remain in the list so you can retry or clear the batch.
2. Select a photo and compare the previews. Select a mode. Use **Low confidence only** to find cases that need review.
3. Change the controls and select **Apply adjustments** to use them for exports. Choose this photo, checked photos or the whole batch. Save a named preset to reuse the controls later.
4. Select the photos, modes and format to export. For **Checked photos**, use **Select all** or **Select none** in the gallery to check or clear every imported photo, including photos hidden by the filter. Only ready photos are exported. Choose **Original size** to retain the full dimensions. **Save to folder** creates a new dedicated subfolder. If the picker is unavailable or denied, select **Export ZIP**.
5. For ZIP export, click each numbered download button when it appears. If there is more than one archive, extract all parts into the same folder. Names are coordinated across parts. The browser controls completion of the download. The app only reports the handoff.

## Correct videos

1. Prepare the app as above. Install a full [Windows FFmpeg build](https://ffmpeg.org/download.html#build-windows) with `ffmpeg`, `ffprobe`, libx264, zscale and tonemap. Put both executables on PATH, or set `RLC_FFMPEG_PATH` and `RLC_FFPROBE_PATH` to their full paths before launching.
2. In the packaged app folder, run `node launch.mjs`. Open the printed local address in Chrome. Use the **Photos** and **Video** tabs to switch modes. The photo app still opens directly from its HTML file.
3. Drop MOV or MP4 clips onto the Video page. Pick a representative clip, set a start time and select **Preview 8 seconds**. Compare the original color and corrected versions. Tune the **Shared preset** once, or select **This video** to make an override.
4. Check the clips to export. Choose **Save to a folder** for a batch in one new subfolder, or **Prepare downloads** for individual download links. The run continues after an individual file fails. You can cancel the current run or uncheck the successful clips before trying again.
5. Finish downloads before closing the launcher. **Clear videos** removes prepared results for the current page. Press Ctrl+C in the launcher to shut it down and remove its session directory.

The launcher listens only on `127.0.0.1`, on port 18749 by default. Set `RLC_VIDEO_PORT` if that port is in use. Photo preferences saved through the launcher belong to that address. Photo preferences saved from the HTML file belong to its file location. The launcher reads the browser-selected file into a local temporary directory, removes the temporary input after processing and keeps prepared files there until cleared or the launcher closes. A forced process kill can leave a `red-light-video-*` directory in the system temporary folder. No files are sent off the computer.

Video exports use H.264 MP4 and SDR Rec. 709. Supported HDR base layers are tone-mapped to SDR. HDR and Dolby Vision metadata are not retained. Dolby Vision Profile 5 is rejected. Audio streams compatible with MP4 are copied. Other audio streams are encoded as AAC. The export keeps source frame timing without forcing a constant frame rate. It keeps source resolution apart from orientation normalization and up to one pixel of padding for odd dimensions. Metadata, chapters, subtitles and auxiliary tracks are omitted. The original files are unchanged.

The app processes one video at a time. It accepts up to 100 files, with a limit of 8 GiB per file. Prepared results share a 32 GiB session limit. Use folder export to release temporary outputs as the batch runs. RGB settings stay fixed through each clip to avoid frame-to-frame color shifts. Severe red illumination can still leave color missing.

## Photo privacy and limits

The app processes images in memory with a local worker. It has no upload endpoint, telemetry or remote services. Original files are opened for reading only. Saved exports can include GPS. Browser-managed temporary files and downloads follow Chrome and Windows behavior.

Only preferences and up to 50 presets are kept in local storage. Moving the app folder, changing profiles or clearing browser data can remove access to them. If storage is blocked, preferences last for the session.

JPEG export flattens transparency onto white. PNG retains alpha. Exports use the color space supplied by Display P3 Canvas. The app uses HEIC ICC profiles when Chrome can apply them and recognizes SDR sRGB and Display P3 NCLX profiles. Other HEIC color and HDR cases can shift in color and are reported. Review output before relying on color or metadata. The app can preserve ordinary EXIF and GPS, but reports omissions including extended or incompatible XMP, IPTC without a verified PNG mapping, embedded previews, MakerNotes or incompatible blocks. Basic XMP can be preserved when it has no stale geometry, capture fields or previews. The probe and development tests do not establish support for all iPhone cameras and metadata variants.

Images above 50 megapixels or 128 MiB are rejected by this build. ZIP volumes are limited to 256 MiB. A single encoded file above that limit needs the folder destination or a smaller export. Natural, Balanced and Aggressive use different correction strengths. Confidence is a heuristic. Missing color information may be unrecoverable.
