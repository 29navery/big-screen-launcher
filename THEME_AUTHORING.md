# Big Screen Launcher Theme Authoring

Themes can be imported as either plain `.css` files or managed `.bslt` packages from Settings > Theme.

Plain CSS themes are copied into `Documents\Big Screen Launcher\Themes` and loaded after the built-in styles, so your rules can override the default look. Importing a new file replaces the active theme.

BSLT theme packages are extracted into `Documents\Big Screen Launcher\Themes\Packages`. They can include the CSS theme plus package-owned assets such as a locked background image and custom app icon.

## Safe starting point

Use variables first. They are less likely to break controller navigation than heavy absolute positioning.

```css
:root {
  --bsl-theme-name: "My Theme";
  --bsl-accent: #46c2ff;
  --bsl-bg: #11151d;
  --bsl-bg-2: #1b2028;
  --bsl-titlebar-bg: rgba(13,18,25,.92);
  --bsl-rail-bg: rgba(6,9,13,.72);
  --bsl-card-bg: rgba(255,255,255,.08);
  --bsl-surface: rgba(255,255,255,.08);
  --bsl-panel-bg: rgba(35,45,53,.78);
  --bsl-control-bg: rgba(255,255,255,.1);
  --bsl-input-bg: rgba(0,0,0,.24);
  --bsl-text: #f7fbff;
  --bsl-text-soft: #dce7f5;
  --bsl-muted: #9da9b8;
  --bsl-border: rgba(255,255,255,.12);
  --bsl-danger: #f06a6a;
  --bsl-success: #63d471;
  --bsl-warning: #ffd166;
  --bsl-radius: 8px;
  --bsl-radius-lg: 10px;
  --bsl-rail-width: 76px;
  --bsl-tile-min: 170px;
}
```

## Theme name

Put a theme name in your CSS with this custom property:

```css
:root {
  --bsl-theme-name: "Purple Night";
}
```

The launcher reads that value during import and shows it in Settings > Themes. If it is missing, the launcher uses the CSS filename.

For compatibility with simple header comments, these are also accepted:

```css
/* Name: Purple Night */
/* Name="Purple Night" */
```

## BSLT Theme Packages

A BSLT package can contain:

- `theme.css` or another CSS file.
- `manifest.json` or `theme.json`.
- A background image: `.jpg`, `.jpeg`, `.png`, `.webp`, `.gif`, or `.bmp`.
- An app icon: `.ico`, `.png`, `.jpg`, `.jpeg`, or `.webp`.

Recommended structure:

```text
MyTheme.bslt
  manifest.json
  theme.css
  background.png
  icon.png
```

Example `manifest.json`:

```json
{
  "name": "Arcade Sunset",
  "css": "theme.css",
  "background": "background.png",
  "lockedBackground": true,
  "icon": "icon.png"
}
```

Manifest fields:

- `name`: display name shown in Settings.
- `css`: path to the package CSS file.
- `background`: path to the package background image.
- `lockedBackground`: when `true`, the app uses the package background and disables the user's separate background picker until the package theme is removed or replaced.
- `allowBackgroundOverride`: set this to `true` if the package includes a background but still lets the user override it.
- `icon`: path to the package app icon. This updates the in-app titlebar mark, tray icon, window icon where supported, and notification icon. It does not rewrite the Windows `.exe` file icon.

If there is no manifest, the launcher uses the first CSS file it finds and the first supported image as a background. Package icons are only used when `icon` or `appIcon` is set in the manifest, so a background image will not become the app icon by accident.

## Full-app variables

These variables are wired into the app shell, titlebar, rail, settings panels, dialogs, downloads, game details, focus outlines, and common controls:

- `--bsl-theme-name`
- `--bsl-accent`
- `--bsl-bg`
- `--bsl-bg-2`
- `--bsl-titlebar-bg`
- `--bsl-rail-bg`
- `--bsl-card-bg`
- `--bsl-panel-bg`
- `--bsl-control-bg`
- `--bsl-input-bg`
- `--bsl-text`
- `--bsl-text-soft`
- `--bsl-muted`
- `--bsl-border`
- `--bsl-danger`
- `--bsl-success`
- `--bsl-warning`
- `--bsl-radius`
- `--bsl-radius-lg`
- `--bsl-rail-width`
- `--bsl-tile-min`

Advanced themes can also override:

- `--bsl-app-bg`
- `--bsl-ambient-bg`
- `--bsl-modal-bg`
- `--bsl-hero-bg`
- `--bsl-hero-shade`
- `--bsl-launch-bg`
- `--bsl-launch-text`

## Main objects

- `.custom-titlebar`: top app titlebar.
- `.app`: main two-column shell.
- `.rail`: left sidebar navigation.
- `.rail button`: sidebar icon buttons.
- `.surface`: scrollable page area.
- `.topbar`: page title/status header.
- `.grid`: library game grid.
- `.tile`: library game button.
- `.art`: game tile artwork frame.
- `.download-grid`: downloads page grid.
- `.download-card`: downloads page game card.
- `.download-pills`, `.download-pill`: DLC/controller/update badges.
- `.download-queue`: active/queued download area.
- `.install-progress`: progress bar container.
- `.settings`: settings page wrapper.
- `.panel`: settings/info panels.
- `.nevko-details`: game details page shell.
- `.details-hero`: game page banner/hero area.
- `.game-logo-wrap`, `.game-logo`: SteamGridDB logo area.
- `.launch-hero`: main launch/stop button.
- `.controller-hint`: bottom-right controller hint display.
- `.morph-focus`: Switch-like gamepad focus outline.

## Layout examples

Move the rail to the right:

```css
.app { grid-template-columns: 1fr var(--bsl-rail-width); }
.rail { grid-column: 2; grid-row: 1; border-left: 1px solid rgba(255,255,255,.08); border-right: 0; }
.surface { grid-column: 1; grid-row: 1; }
```

Make library tiles larger:

```css
.grid { grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); }
.art { border-radius: 14px; }
```

Make a compact downloads list:

```css
.download-grid { grid-template-columns: 1fr; }
.download-card { min-height: 120px; display: grid; grid-template-columns: 180px 1fr; align-items: end; }
.download-image-wrap { width: 180px; height: 100%; }
```

## Warnings

CSS can move elements visually, but keyboard and controller focus still follow the app's DOM order. Avoid using `position: fixed` or huge negative margins for core controls unless you test with keyboard/controller navigation. If a theme breaks the UI, go to Settings > Themes > Remove theme.
