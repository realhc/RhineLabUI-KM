# Archive directory wheel — 2026-09-30

Only the desktop library's left document directory changed. The editor, header, scene, web page, storage and document operations retain their existing implementation.

The fixed spine tapers at both ends and widens at its center. Document ticks and labels change scale with vertical position. Scroll or drag to browse, click to select; use the dedicated ⋮⋮ handle to reorder in manual mode. Arrow keys, Home/End and Page Up/Down move focus.

Validation: TypeScript, desktop build and Electron package passed. Run node scripts/check-desktop-directory.mjs from a clean packaged build (without RhineLabData) to reproduce wheel, drag, click, dirty-guard, keyboard single-step, persisted-order isolation, reorder-handle and empty-search checks. Light and dark/small-window screenshots were inspected. Existing scripts/check-desktop-alignment.mjs passed original scene geometry, CRUD/search, trash restore, offline operation and restart persistence (regression.json).

Delivery: resources/app.asar and all runtime assets at E:\CodexSandbox\Projects\RhineLabUI-main\release\packages\RhineLab-win32-x64 match the tested package. The running version 1.1.1 Electron launcher was retained because Windows locks it; restart the client to load the new resources. User data was preserved.
