# MC Planner

A browser-based Minecraft build planner inspired by the workflow of MC Base Planner, but using real Minecraft block textures instead of flat colors.

## Features
- Real vanilla 16×16 block textures sourced at runtime from [PixiGeko/Minecraft-default-assets](https://github.com/PixiGeko/Minecraft-default-assets)
- Block catalogue generated from Minecraft blockstates
- Brush, eraser, fill, picker, line, rectangle, circle, oval, triangle, polygon, and curve tools
- X / Y / XY symmetry
- Adjustable brush size
- Layers with visibility, rename, add, and delete
- Block key / recent palette
- Automatic block counts, stacks, and chest totals
- Normal grid + 16×16 chunk grid
- Pan and zoom
- Undo / redo
- Local autosave
- .mcplan save/import
- PNG and PDF export
- Transparent image reference/hologram overlay
- Static site: works on GitHub Pages

## GitHub Pages
Repository Settings → Pages → Build and deployment → Deploy from a branch → `main` / `/ (root)`.

Then open: https://ryanehinkle.github.io/mc-planner/

## Controls
- Left click: active tool
- Right click: erase
- Middle click or Space: pan
- Mouse wheel: zoom
- Ctrl/Cmd+Z: undo
- Ctrl/Cmd+Y: redo
- Escape: cancel preview


Pages source: GitHub Actions
