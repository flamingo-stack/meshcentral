# Xterm Addon Image

The **Xterm Addon Image** module enables graphical image rendering inside terminal sessions in MeshCentral. It extends the Xterm.js terminal engine to support:

- ✅ SIXEL graphics (`DCS q`)
- ✅ Inline Image Protocol (OSC 1337)
- ✅ Canvas-based overlay rendering
- ✅ Terminal buffer–aware image storage
- ✅ Memory-safe and size-limited decoding

This module integrates tightly with the Xterm parser, rendering pipeline, and buffer system to allow terminal applications to display raster graphics directly inside terminal cells.

**Repository Path:** `public/scripts`  
**Namespace:** `meshcentral.public.scripts.xterm-addon-image`

---

# 1. Purpose of the Module

The **Xterm Addon Image** module provides the complete image rendering pipeline for terminal sessions:

| Layer | Responsibility |
|-------|----------------|
| Protocol Handling | Parse SIXEL and OSC 1337 sequences |
| Decoding | Convert encoded image data into pixel buffers |
| Storage | Map images to terminal buffer cells |
| Rendering | Draw image tiles aligned to terminal grid |
| Safety Controls | Enforce pixel, memory, and size limits |

It transforms raw escape sequences into safely rendered canvas graphics inside the terminal viewport.

---

# 2. Repository Structure

```
public/scripts/
└── xterm-addon-image
    ├── Core Components
    │   ├── B
    │   ├── Q
    │   ├── _
    │   └── a
    └── Utilities
        ├── h
        ├── n
        ├── o
        ├── r
        └── u
```

## 2.1 Primary Components

### Core Layer
- `meshcentral.public.scripts.xterm-addon-image.B`
- `meshcentral.public.scripts.xterm-addon-image.Q`
- `meshcentral.public.scripts.xterm-addon-image._`
- `meshcentral.public.scripts.xterm-addon-image.a`

### Utilities Layer
- `meshcentral.public.scripts.xterm-addon-image.h`
- `meshcentral.public.scripts.xterm-addon-image.n`
- `meshcentral.public.scripts.xterm-addon-image.o`
- `meshcentral.public.scripts.xterm-addon-image.r`
- `meshcentral.public.scripts.xterm-addon-image.u`

---

# 3. High-Level Architecture

```mermaid
flowchart TD
    Terminal["Xterm Terminal"] --> Parser["Escape Sequence Parser"]

    Parser -->|DCS q| Sixel["SIXEL Handler"]
    Parser -->|OSC 1337| IIP["Inline Image Handler"]

    Sixel --> Decoder["WASM Decoder"]
    IIP --> Base64["Base64 Decoder"]

    Decoder --> Storage["Image Storage"]
    Base64 --> Storage

    Storage --> Renderer["Image Renderer"]
    Renderer --> Canvas["Canvas Overlay Layer"]
```

The module is composed of four architectural layers:

1. **Protocol Layer** – Escape sequence registration and parsing  
2. **Decoding Layer** – SIXEL (WASM) and IIP decoding  
3. **Storage Layer** – Terminal buffer cell mapping and lifecycle control  
4. **Rendering Layer** – Canvas overlay rendering aligned to cell grid  

---

# 4. Internal Module Composition

```mermaid
flowchart LR
    Addon["ImageAddon"] --> Core["Core Components"]
    Addon --> Utilities["Utilities Layer"]

    Core --> Renderer["ImageRenderer"]
    Core --> Storage["ImageStorage"]

    Utilities --> CoreUtils["Core Utilities"]
    Utilities --> AdvancedUtils["Advanced Utilities"]
```

## Responsibilities by Submodule

### Xterm Addon Image Core
- Image decoding orchestration
- Storage lifecycle
- Renderer integration
- Memory enforcement

📄 See: **Xterm Addon Image Core**

---

### Xterm Addon Image Utilities
- SIXEL streaming helpers
- OSC 1337 parsing
- Header validation
- Buffer normalization
- Pixel limit checks

📄 See: **Xterm Addon Image Utilities**

---

# 5. Image Processing Flow

## 5.1 SIXEL Processing

```mermaid
sequenceDiagram
    participant App as Remote App
    participant Terminal as Xterm
    participant Addon as ImageAddon
    participant Decoder as WASM Decoder
    participant Storage as ImageStorage
    participant Renderer as ImageRenderer

    App->>Terminal: DCS q (SIXEL)
    Terminal->>Addon: Hook handler
    Addon->>Decoder: Decode stream
    Decoder-->>Addon: RGBA buffer
    Addon->>Storage: addImage()
    Terminal->>Renderer: onRender()
    Renderer->>Storage: render visible region
```

### Features
- Streaming decode
- Palette limit enforcement
- Pixel area guardrails
- Configurable size limits

---

## 5.2 Inline Image Protocol (OSC 1337)

```mermaid
flowchart TD
    Start["OSC 1337"] --> Parse["Parse Header"]
    Parse --> Valid{"Valid Header?"}
    Valid -->|No| Abort["Abort"]
    Valid -->|Yes| Decode["Base64 Decode"]
    Decode --> Detect["Detect Image Type"]
    Detect --> Normalize["Normalize Buffer"]
    Normalize --> Store["Store Image"]
```

Supported formats:
- PNG
- JPEG
- GIF

Security constraints:
- `iipSizeLimit`
- `pixelLimit`
- `storageLimit`

---

# 6. Storage Model

The module maps decoded images into terminal buffer cells.

```mermaid
flowchart TD
    Image["Decoded Image"] --> TileSplit["Split Into Tiles"]
    TileSplit --> CellMap["Map to Buffer Cells"]
    CellMap --> Attrs["Extended Attributes"]
    Attrs --> Render["Render Visible Rows"]
```

### Storage Responsibilities

- Assign unique image IDs
- Track tile positions per cell
- Evict old images when memory exceeded
- Handle alternate buffer cleanup
- Respond to terminal resize events

---

# 7. Rendering Strategy

The renderer maintains a dedicated canvas overlay.

```mermaid
flowchart TD
    RenderEvent["Render Event"] --> Dirty["Clear Dirty Rows"]
    Dirty --> Scan["Scan Visible Cells"]
    Scan --> Draw["Draw Image Tiles"]
    Draw --> Canvas["Canvas Overlay"]
```

### Rendering Features

- Tile-based drawing
- Cell-aligned positioning
- Font-size aware scaling
- Dirty row optimization
- Optional placeholder patterns

---

# 8. Memory & Safety Controls

The module protects terminal performance using strict limits.

```mermaid
flowchart TD
    Incoming["Incoming Image"] --> SizeCheck["Check Size Limit"]
    SizeCheck --> PixelCheck["Check Pixel Limit"]
    PixelCheck --> Decode["Decode"]
    Decode --> StorageCheck{"Within Storage Limit?"}
    StorageCheck -->|No| Evict["Evict Oldest"]
    StorageCheck -->|Yes| Store["Store Image"]
```

Configurable defaults:

```text
pixelLimit: 16777216
sixelSupport: true
sixelScrolling: true
sixelPaletteLimit: 256
sixelSizeLimit: 25e6
storageLimit: 128 MB
showPlaceholder: true
iipSupport: true
iipSizeLimit: 20e6
```

These limits prevent memory exhaustion from untrusted terminal streams.

---

# 9. Integration with Xterm Core

```mermaid
flowchart TD
    ImageAddon --> ParserHooks["Parser Hooks"]
    ImageAddon --> RenderHook["Render Hook"]
    ImageAddon --> ResizeHook["Resize Hook"]
    ImageAddon --> BufferHook["Buffer Hook"]

    ParserHooks --> Handlers["Image Handlers"]
    Handlers --> Storage
    Storage --> Renderer
```

Integration points:

- Escape sequence handler registration
- Render cycle hooks
- Resize observers
- Buffer lifecycle notifications

---

# 10. Relationship to Other Modules

The **Xterm Addon Image** module works alongside:

- **Xterm Core** – Terminal engine and parser
- **Xterm Addon Image Core** – Decoding and rendering backbone
- **Xterm Addon Image Utilities** – Protocol and decoding helpers

The Core and Utilities modules together form the internal processing pipeline of the Xterm Addon Image system.

---

# 11. Summary

The **Xterm Addon Image** module enables high-performance, memory-safe image rendering inside MeshCentral terminal sessions.

It:

- Implements SIXEL and OSC 1337 support  
- Uses WebAssembly for efficient decoding  
- Maps images to terminal cells  
- Renders through a dedicated canvas overlay  
- Enforces strict memory and pixel constraints  

By separating protocol handling, decoding, storage, and rendering, the module maintains a modular and secure architecture while delivering full graphical support within terminal environments.