# Chart Advanced Utilities

The **Chart Advanced Utilities** module provides high-level utility logic that enhances advanced chart rendering and behavior within the Charts Components subsystem. Built on top of Chart.js v4.3.3, this module exposes advanced helper functionality used by complex visualizations, animation orchestration, interaction handling, and plugin-level extensions.

It acts as a refinement layer above core and advanced chart logic, enabling:

- Advanced animation orchestration
- Plugin lifecycle coordination
- Layout and rendering utilities
- Tooltip, legend, and title extensions
- Dataset decimation and color utilities

This module is part of the **Chart Advanced Components** layer and works closely with:

- [Chart Advanced Visualization](../chart-advanced-visualization/chart-advanced-visualization.md)
- [Chart Advanced Logic](../chart-advanced-logic/chart-advanced-logic.md)

---

## Core Components

The module is primarily composed of two bundled Chart.js exports:

- `meshcentral.public.scripts.charts.ws`
- `meshcentral.public.scripts.charts.ya`

These correspond to the bundled UMD build of Chart.js and expose:

- Core `Chart` class
- Animation engine
- Scale system
- Controller registry
- Plugin system
- Layout manager
- Rendering primitives

---

## Architectural Position

```mermaid
flowchart TD
    UI["UI Components"] --> AV["Chart Advanced Visualization"]
    AV --> AL["Chart Advanced Logic"]
    AL --> AU["Chart Advanced Utilities"]
    AU --> CORE["Chart.js Core Engine"]
```

The Chart Advanced Utilities module sits directly above the Chart.js engine and provides reusable orchestration logic consumed by advanced visualization and logic modules.

---

## Internal Architecture Overview

```mermaid
flowchart LR
    Chart["Chart Class"] --> Animator["Animator Engine"]
    Chart --> Registry["Controller & Element Registry"]
    Chart --> Layout["Layout Manager"]
    Chart --> Plugins["Plugin Service"]

    Animator --> Animations["Animation Instances"]
    Registry --> Controllers["Dataset Controllers"]
    Registry --> Elements["Visual Elements"]
    Plugins --> Tooltip["Tooltip Plugin"]
    Plugins --> Legend["Legend Plugin"]
    Plugins --> Title["Title & Subtitle"]
    Plugins --> Filler["Area Filler"]
    Plugins --> Decimation["Dataset Decimation"]
    Plugins --> Colors["Color Utilities"]
```

### Key Subsystems

#### 1. Animation Engine

- `Animation` and `Animations` classes
- Central animator singleton
- Easing functions and interpolation helpers
- Property-level animation orchestration

This enables smooth transitions for:

- Dataset updates
- Tooltip movement
- Axis range changes
- Layout resizing

---

#### 2. Registry System

The registry dynamically manages:

- Dataset controllers (Bar, Line, Scatter, Doughnut, etc.)
- Visual elements (Arc, Line, Point, Bar)
- Scales (Linear, Logarithmic, Time, Radial)
- Plugins

This allows runtime extension and custom chart type registration.

---

#### 3. Layout and Box Model

The layout system coordinates:

- Legend placement
- Title and subtitle blocks
- Axis sizing
- Chart area calculation

```mermaid
flowchart TD
    ChartArea["Chart Area"]
    Title["Title Block"]
    Legend["Legend Box"]
    Scales["Scales"]

    Title --> LayoutEngine["Layout Manager"]
    Legend --> LayoutEngine
    Scales --> LayoutEngine
    LayoutEngine --> ChartArea
```

---

#### 4. Plugin Lifecycle

The plugin service provides hook-based extension points:

- `beforeInit`
- `beforeUpdate`
- `afterDraw`
- `afterEvent`
- `beforeDatasetDraw`
- `afterTooltipDraw`

Plugins included in this module:

- **Tooltip**
- **Legend**
- **Title**
- **Subtitle**
- **Filler** (area fills)
- **Decimation** (data reduction)
- **Colors** (automatic color assignment)

```mermaid
sequenceDiagram
    participant Chart
    participant PluginService
    participant Tooltip

    Chart->>PluginService: beforeEvent()
    PluginService->>Tooltip: handleEvent()
    Tooltip-->>PluginService: update state
    PluginService-->>Chart: request re-render
```

---

## Data Flow Through Utilities

```mermaid
flowchart TD
    Data["Dataset Input"] --> Controller["Dataset Controller"]
    Controller --> Parser["Data Parsing"]
    Parser --> Animator["Animation Engine"]
    Animator --> Elements["Visual Elements"]
    Elements --> Renderer["Canvas Rendering"]
    Renderer --> Tooltip["Tooltip & Interaction"]
```

Utilities enhance:

- Parsing normalization
- Stacking logic
- Coordinate transformation
- Hover state resolution
- Interaction mode evaluation

---

## Interaction and Hit Detection

Advanced utilities provide:

- Nearest-point detection
- Index-based selection
- Dataset-level interaction modes
- Radial and Cartesian hit testing

These interaction modes are used by higher-level modules to enable:

- Hover highlighting
- Click-driven filtering
- Dynamic tooltip positioning

---

## Animation Orchestration Flow

```mermaid
flowchart TD
    Update["Chart.update()"] --> Resolve["Resolve Animations"]
    Resolve --> Queue["Animation Queue"]
    Queue --> RAF["requestAnimationFrame Loop"]
    RAF --> Tick["Animation.tick()"]
    Tick --> Draw["Chart.draw()"]
```

The animator singleton ensures coordinated multi-property animation with proper easing and cancellation support.

---

## Tooltip Rendering Lifecycle

```mermaid
flowchart TD
    Event["Mouse Event"] --> Active["Resolve Active Elements"]
    Active --> Items["Build Tooltip Items"]
    Items --> Layout["Measure & Position Tooltip"]
    Layout --> Render["Draw Background & Text"]
```

Advanced utilities manage:

- Smart alignment (`xAlign`, `yAlign`)
- Caret placement
- Label color extraction
- Text measurement and wrapping

---

## Dataset Decimation

For large datasets, the Decimation plugin supports:

- Min/Max sampling
- LTTB (Largest Triangle Three Buckets)

This reduces rendering cost while preserving visual fidelity.

---

## Responsibilities Within the System

The Chart Advanced Utilities module is responsible for:

- Providing the runtime chart engine
- Managing rendering lifecycle
- Orchestrating animations
- Coordinating plugins
- Supporting interaction logic
- Optimizing performance via decimation

It does **not** define application-specific chart configurations — those belong to:

- [Chart Advanced Logic](../chart-advanced-logic/chart-advanced-logic.md)
- [Chart Advanced Visualization](../chart-advanced-visualization/chart-advanced-visualization.md)

---

## Summary

The **Chart Advanced Utilities** module is the execution backbone of advanced charting within the MeshCentral UI layer. It wraps and exposes the full Chart.js engine, augmented with plugin orchestration, animation management, and performance utilities.

Higher-level modules depend on it for:

- Declarative chart configuration
- Dynamic data updates
- Interactive visual behavior
- Optimized large dataset rendering

Without this layer, advanced chart components would lack animation control, plugin extensibility, and coordinated layout behavior.