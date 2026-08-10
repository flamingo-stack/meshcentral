# Xterm Addon Image Utilities

The **Xterm Addon Image Utilities** module provides the shared utility layer that powers image decoding, validation, protocol handling, and memory management for terminal-rendered graphics inside MeshCentral’s Xterm integration.

It sits between the **Xterm Addon Image Core** and the specialized utility layers:

- **Xterm Addon Image Core Utilities**
- **Xterm Addon Image Advanced Utilities**

This module orchestrates image processing pipelines such as SIXEL and Inline Image Protocol (IIP), enforces safety limits, and exposes reusable decoding helpers to the rendering and storage subsystems.

---

## Purpose of the Module

The **Xterm Addon Image Utilities** module is responsible for:

- Coordinating SIXEL and OSC 1337 image handling
- Providing shared decoding helpers and parsing logic
- Enforcing pixel, size, palette, and memory limits
- Normalizing image buffers for renderer consumption
- Acting as a bridge between the Xterm parser and image storage

It ensures that terminal-embedded images are processed safely, efficiently, and consistently before rendering.

---

## Repository Structure

**Path:** `public/scripts`  
**Namespace:** `meshcentral.public.scripts.xterm-addon-image`

### Primary Utility Components

- `meshcentral.public.scripts.xterm-addon-image.h`
- `meshcentral.public.scripts.xterm-addon-image.n`
- `meshcentral.public.scripts.xterm-addon-image.o`
- `meshcentral.public.scripts.xterm-addon-image.r`
- `meshcentral.public.scripts.xterm-addon-image.u`

### Submodules

```text
xterm-addon-image-utilities/
├── xterm-addon-image-core-utilities/
│   ├── h
│   ├── n
│   └── o
└── xterm-addon-image-advanced-utilities/
    ├── r
    └── u
```

### Submodule Documentation

- **Xterm Addon Image Core Utilities**  
  Provides low-level decoding, header parsing, and pixel buffer generation.

- **Xterm Addon Image Advanced Utilities**  
  Implements protocol-aware handlers (SIXEL, OSC 1337) and streaming decoders.

---

# Architectural Position

The module acts as a coordination layer between terminal parsing and rendering/storage.

```mermaid
flowchart TD
    Terminal["Xterm Terminal"] --> Parser["Escape Sequence Parser"]
    Parser --> Utilities["Xterm Addon Image Utilities"]

    Utilities --> CoreUtils["Core Utilities"]
    Utilities --> AdvancedUtils["Advanced Utilities"]

    CoreUtils --> Storage["Image Storage"]
    AdvancedUtils --> Storage

    Storage --> Renderer["Image Renderer"]
```

---

# Internal Layered Architecture

The utilities module is divided into two functional layers:

```mermaid
flowchart LR
    Utilities["Xterm Addon Image Utilities"] --> CoreLayer["Core Utilities Layer"]
    Utilities --> AdvancedLayer["Advanced Utilities Layer"]

    CoreLayer --> Decode["Low-Level Decode"]
    CoreLayer --> Parse["Header Parsing"]
    CoreLayer --> Buffers["Pixel Buffers"]

    AdvancedLayer --> IIP["OSC 1337 Handler"]
    AdvancedLayer --> Sixel["SIXEL Handler"]
    AdvancedLayer --> WASM["WASM Streaming Decoders"]
```

---

# Processing Pipelines

## 1. Inline Image Protocol (OSC 1337)

```mermaid
flowchart TD
    Start["OSC 1337 Received"] --> Header["Parse Header"]
    Header --> Validate{"Valid?"}
    Validate -->|No| Abort["Abort"]
    Validate -->|Yes| Decode["Base64 Decode"]
    Decode --> Detect["Detect Image Type"]
    Detect --> Normalize["Normalize Buffer"]
    Normalize --> Store["Store Image"]
```

### Responsibilities

- Validate `inline=1`
- Enforce `iipSizeLimit`
- Detect PNG/JPEG/GIF signatures
- Apply resizing rules
- Pass decoded image to storage

---

## 2. SIXEL Image Handling

```mermaid
sequenceDiagram
    participant Terminal as Xterm
    participant Parser as DCS Parser
    participant Utilities as Image Utilities
    participant Decoder as WASM Decoder
    participant Storage as Image Storage

    Terminal->>Parser: DCS q Sequence
    Parser->>Utilities: hook()
    Utilities->>Decoder: init()
    Parser->>Utilities: put(data)
    Utilities->>Decoder: decode(chunk)
    Parser->>Utilities: unhook()
    Utilities->>Storage: addImage()
```

### SIXEL Features

- Streaming decode support
- Palette limit enforcement
- Pixel area checks
- Memory guardrails
- Decoder reuse and release strategy

---

# Core Responsibilities

| Area | Responsibility |
|------|---------------|
| Protocol Handling | Manage OSC 1337 and DCS q sequences |
| Decoding | WASM-backed SIXEL and Base64 decoding |
| Validation | Enforce size, pixel, and storage limits |
| Normalization | Convert decoded output into RGBA buffers |
| Integration | Pass images to storage and renderer |

---

# Memory and Safety Controls

The module enforces configurable limits inherited from the parent addon:

- `pixelLimit`
- `sixelSizeLimit`
- `sixelPaletteLimit`
- `iipSizeLimit`
- `storageLimit`
- `showPlaceholder`

### Memory Enforcement Flow

```mermaid
flowchart TD
    Incoming["Incoming Image"] --> CheckSize["Check Size Limits"]
    CheckSize --> CheckPixels["Check Pixel Limit"]
    CheckPixels --> Decode["Decode Image"]
    Decode --> MemoryCheck{"Within Storage Limit?"}
    MemoryCheck -->|No| Evict["Evict Old Images"]
    MemoryCheck -->|Yes| Store["Store Image"]
```

These checks prevent resource exhaustion and protect terminal responsiveness.

---

# Interaction with Related Modules

The **Xterm Addon Image Utilities** module integrates with:

- **Xterm Core Parser** — receives escape sequence hooks
- **Image Storage Layer** — manages tile mapping and lifecycle
- **Image Renderer** — draws overlays on the terminal viewport

```mermaid
flowchart LR
    Parser["Xterm Parser"] --> Utilities["Image Utilities"]
    Utilities --> Storage["Image Storage"]
    Storage --> Renderer["Image Renderer"]
    Renderer --> Viewport["Terminal Viewport"]
```

---

# Lifecycle Overview

```mermaid
flowchart TD
    Activate["Addon Activated"] --> Register["Register Handlers"]
    Register --> Receive["Receive Image Sequence"]
    Receive --> Process["Utilities Process Image"]
    Process --> Store["Store Image"]
    Store --> Render["Render to Viewport"]
    Render --> Resize["Handle Resize"]
    Resize --> Render
```

---

# Summary

The **Xterm Addon Image Utilities** module is the coordination and processing backbone of terminal image support within MeshCentral’s Xterm integration.

It:

- Bridges escape sequence parsing and rendering
- Delegates low-level work to Core Utilities
- Handles protocol logic through Advanced Utilities
- Enforces strict safety and memory constraints
- Normalizes decoded image buffers for efficient rendering

By cleanly separating decoding, protocol handling, and storage integration, the module maintains a modular, maintainable, and secure architecture for terminal image rendering.

---

## Related Documentation

- **Xterm Addon Image Core Utilities**
- **Xterm Addon Image Advanced Utilities**
- **Xterm Addon Image (Root Module)**

These modules together form the complete image rendering pipeline for terminal sessions.