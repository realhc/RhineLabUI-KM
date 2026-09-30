# Full-screen library glass workspace — 2026-09-30

The desktop library opens over the original array with a full-screen translucent blurred backdrop, then displays three separate regions: a transparent directory on the left, document controls at the upper right and the largest content region below. The directory spine spans the entire client height and has no panel background. Existing control and document nodes are regrouped; storage, scene and webpage code are unchanged.

Validation: TypeScript, Vite desktop build and Electron packaging passed. Existing directory interaction and desktop alignment suites passed drag/wheel, selection, sorting, dirty protection, save/search/trash and restart persistence. glass-layout.json verifies full-screen bounds, a transparent directory, full-height spine, separated controls/content and a blurred translucent backdrop. Light and dark 1000×680 screenshots were visually inspected. The backdrop retains the explicitly requested glass appearance even when the host reports reduced transparency; reduced motion still disables the entrance animation.

Delivered app.asar matches the tested package. The existing version 1.1.1 Electron launcher is retained. Restart the client to load the new layout. User data hashes verified unchanged.
