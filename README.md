# Red Light Corrector

Correct photos taken under strong red lighting in Chrome on Windows 11. The app imports photos locally, previews the correction, and exports JPEG or PNG without a server or an account.

## Prepare and test

Install Node.js 22 or later, open a terminal in the extracted repository, and run:

```text
node packaging/build.mjs
```

The packaging command downloads and verifies the HEIC decoder once. Open `dist/red-light-corrector/index.html` in Chrome. After packaging, the application runs offline and does not need Node.js.

See the [user guide](docs/user-guide.md) for import, corrections, presets, export and privacy. See [release validation](docs/planning/release-validation-v1.0.md) for the checks already run and the Windows test checklist.

## Planning

- [v1.0 specification](docs/planning/red-light-corrector-spec-v1.0.md)
- [Implementation plan](docs/planning/implementation-plan-v1.0.md)
- [Feasibility report](docs/planning/feasibility-report-v1.0.md)
