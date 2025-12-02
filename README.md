# SF-Collab: Real-Time Collaborative Canvas for Salesforce

**Real-time multi-user collaboration, 100% native Salesforce.**

[![Salesforce](https://img.shields.io/badge/Salesforce-00A1E0?style=flat&logo=salesforce&logoColor=white)](https://salesforce.com)
[![LWC](https://img.shields.io/badge/LWC-Lightning%20Web%20Components-blue)](https://developer.salesforce.com/docs/component-library/documentation/en/lwc)
[![Platform Events](https://img.shields.io/badge/Platform-Events-purple)](https://developer.salesforce.com/docs/atlas.en-us.platform_events.meta/platform_events/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

> Multiple users see each other's cursors moving in real-time, collaborate on sticky notes and shapes, draw together, and everything syncs instantly across all connected clients.

<img width="1868" height="936" alt="Screenshot 2025-12-02 115258" src="https://github.com/user-attachments/assets/2764864e-cdaa-4426-af52-ff82072f8b03" />



![SF-Collab Demo](docs/demo-placeholder.gif)

---

## Why This Exists

**The Challenge:** Real-time collaboration typically requires WebSockets, external servers, and complex infrastructure. Salesforce doesn't natively support WebSockets.

**The Solution:** This project proves Salesforce CAN deliver real-time collaboration using a hybrid architecture:
- **Platform Cache** for high-frequency cursor updates (no event limits)
- **Platform Events** for reliable object synchronization
- **Client-side interpolation** for smooth 60fps cursor movement

No external services. No webhooks. No middleware. **100% native Salesforce.**

---

## Features

| Feature | Description |
|---------|-------------|
| **Live Cursors** | See other users' cursors moving in real-time with names and colors |
| **Sticky Notes** | 6 colors, resizable, with text editing and alignment options |
| **Shapes** | 10 types: Rectangle, Circle, Triangle, Diamond, Hexagon, and more |
| **Connectors** | 4 types: Arrow, Line, Elbow, Curved with draggable endpoints and labels |
| **Freehand Drawing** | Multiple users can draw simultaneously |
| **Selection Tools** | Click, marquee select, Ctrl+click, multi-select movement |
| **Grouping** | Group/ungroup objects with G key |
| **Z-Ordering** | Bring to front, send to back layer controls |
| **Record Cards** | Drag Contacts, Opportunities, Leads, Users onto canvas |
| **Activity Cards** | Add Tasks, Events, Emails with related record info |
| **Undo/Redo** | Ctrl+Z / Ctrl+Y with 50-step history |
| **Copy/Paste** | Ctrl+C / Ctrl+V / Ctrl+X with smart offset |
| **Persistence** | Everything saved to Salesforce records |
| **Keyboard Shortcuts** | V (Select), D (Draw), E (Eraser), S (Sticky), M (Pan), and more |

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         USER BROWSERS                           │
│    ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐          │
│    │ User A  │  │ User B  │  │ User C  │  │ User D  │          │
│    │  (LWC)  │  │  (LWC)  │  │  (LWC)  │  │  (LWC)  │          │
│    └────┬────┘  └────┬────┘  └────┬────┘  └────┬────┘          │
└─────────┼────────────┼────────────┼────────────┼────────────────┘
          │            │            │            │
          ▼            ▼            ▼            ▼
┌─────────────────────────────────────────────────────────────────┐
│                    SALESFORCE PLATFORM                          │
│                                                                 │
│  ┌───────────────────────────────────────────────────────────┐ │
│  │              CURSOR SYSTEM (High Frequency)                │ │
│  │                                                            │ │
│  │   • Platform Cache (Org) with 300s TTL                    │ │
│  │   • Poll every 50ms (20/sec)                              │ │
│  │   • Delta compression (only send changes >10px)           │ │
│  │   • Client-side interpolation for smooth 60fps movement   │ │
│  └───────────────────────────────────────────────────────────┘ │
│                                                                 │
│  ┌───────────────────────────────────────────────────────────┐ │
│  │              OBJECT SYSTEM (Reliable Sync)                 │ │
│  │                                                            │ │
│  │   • Platform Events (HighVolume)                          │ │
│  │   • EMP API subscription in browser                       │ │
│  │   • Event types: add, move, resize, style, delete         │ │
│  └───────────────────────────────────────────────────────────┘ │
│                                                                 │
│  ┌───────────────────────────────────────────────────────────┐ │
│  │              PERSISTENCE LAYER                             │ │
│  │                                                            │ │
│  │   • collab_Canvas_State__c (JSON storage)                 │ │
│  │   • Auto-save on changes                                  │ │
│  └───────────────────────────────────────────────────────────┘ │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Why This Architecture?

| Approach | Cursors/Hour (5 users) | Limit | Verdict |
|----------|------------------------|-------|---------|
| Platform Events only | 360,000 | 100,000/hour | Over limit |
| **Platform Cache + Events** | **~500** | 100,000/hour | **Safe** |

Platform Cache handles the high-frequency cursor updates (99.9% of traffic), while Platform Events handle the occasional object changes that need guaranteed delivery.

---

## Installation

### Prerequisites

- Salesforce org (Developer Edition, Sandbox, or Scratch Org)
- Salesforce CLI installed (`sf --version` to verify)
- Platform Cache capacity available (minimum 1 MB)

### Quick Deploy

```bash
# Clone the repository
git clone https://github.com/nilslehsten/salesforce-collaborative-canvas.git
cd salesforce-collaborative-canvas

# Authenticate to your org
sf org login web --alias my-org

# Deploy all metadata (two phases due to dependencies)
sf project deploy start --source-dir force-app --target-org my-org

# Assign permission set
sf org assign permset --name collab_CanvasUser --target-org my-org
```

### Configure Platform Cache

1. **Setup** → **Platform Cache** → **New Platform Cache Partition**
2. **Label:** `CollabCanvas`
3. **Org Cache Allocation:** Set **Provider Free** to **1** (uses free trial capacity)
4. Click **Save**

> **Note:** Developer Edition orgs have 2 MB free Provider capacity. No purchase required.

### Add to Lightning Page

1. Open any record page in Lightning App Builder
2. Add the `collab_collaborativeCanvas` component
3. Or use the pre-built Quick Action on Account records

---

## Package Components

| Type | Name | Description |
|------|------|-------------|
| Custom Object | `collab_Canvas_State__c` | Stores canvas state as JSON |
| Platform Event | `collab_Collaboration_Event__e` | Real-time sync events |
| Apex Class | `collab_CollaborationController` | Canvas CRUD operations |
| Apex Class | `collab_CursorCacheController` | Cursor sync via Platform Cache |
| LWC | `collab_collaborativeCanvas` | Main interactive canvas |
| LWC | `collab_canvasViewerOnly` | Read-only canvas preview |
| LWC | `collab_canvasDrawingUtils` | Shared drawing utilities |
| Permission Set | `collab_CanvasUser` | Standard user access |
| Permission Set | `collab_CanvasAdmin` | Admin access |
| Quick Action | `Account.collab_Launch_Canvas` | Launch canvas from Account |

### Troubleshooting

**Platform Cache Error:** Create cache partition named `CollabCanvas` with 1 MB allocated under **Org Cache → Provider Free**.

**CLI "Finalizing" Error:** This is a display bug. Check actual status with:
```bash
sf project deploy report --job-id <JOB_ID> --target-org my-org
```

See [Installation Guide](docs/Installation_Guide.md) for detailed instructions and troubleshooting

---

## Usage

### Canvas Tools

| Key | Tool | Description |
|-----|------|-------------|
| `V` | Select | Click to select, drag to move, marquee select |
| `D` | Draw | Freehand drawing with color/width options |
| `E` | Eraser | Click to delete objects or strokes |
| `S` | Sticky | Add yellow sticky note |
| `R` | Rectangle | Add rectangle shape |
| `O` | Circle | Add circle shape |
| `C` | Connector | Add arrow connector |
| `G` | Group | Group/ungroup selected objects |
| `?` | Help | Show all keyboard shortcuts |
| `Delete` | Delete | Remove selected objects |
| `Escape` | Deselect | Clear selection |

### Context Toolbar

When an object is selected:
- **Fill Color** - Change background color
- **Border Color** - Change border (shapes only)
- **Layer Controls** - Bring to front, send to back
- **Text Alignment** - Top, middle, bottom (sticky notes/shapes)
- **Delete** - Remove object

---

## Technical Highlights

### Cursor Sync Performance

```javascript
// High-frequency cursor tracking
const CURSOR_UPDATE_THROTTLE = 50;  // ms between updates
const CURSOR_POLL_INTERVAL = 50;    // ms between polling
const DELTA_THRESHOLD = 10;         // pixels - only send if moved >10px
const INTERPOLATION_FACTOR = 0.25;  // Smoothing (25% per frame)
const STALE_THRESHOLD = 60000;      // ms - user disappears after 60s

// Client-side interpolation for smooth 60fps movement
function interpolateCursor(current, target, factor = 0.25) {
    return {
        x: current.x + (target.x - current.x) * factor,
        y: current.y + (target.y - current.y) * factor
    };
}
```

### Platform Event Types

| Event Type | Trigger | Payload |
|------------|---------|---------|
| `object_add` | New object created | Full object data |
| `object_move` | Object dragged | ID, x, y position |
| `object_resize` | Object resized | ID, width, height |
| `object_style` | Color changed | ID, color, borderColor |
| `object_delete` | Object removed | ID |
| `connector_add` | New connector | Start/end anchors |
| `connector_update` | Connector modified | Endpoints, waypoints |
| `draw_stroke` | Drawing completed | Points array |
| `group_create` | Objects grouped | Group ID, child IDs |

### Governor Limits Awareness

| Resource | Limit | Our Usage | Margin |
|----------|-------|-----------|--------|
| Platform Events/hour | 100,000 | ~100 | 99.9% |
| Platform Cache (Org) | 10MB | ~100KB | 99% |
| Apex CPU Time | 10,000ms | <50ms | 99.5% |

---

## Use Cases

### 1. Sprint Planning Boards
Teams collaborate on sprint planning in real-time. Drag sticky notes to organize user stories. See who's working on what via live cursors.

### 2. Case Collaboration Diagrams
Support teams diagram complex cases together. Draw flowcharts, add annotations, link canvas to Case records.

### 3. Customer Journey Mapping
Sales/Success teams map customer journeys. Collaborative whiteboarding tied to Account records.

---

## Project Structure

```
force-app/main/default/
├── classes/
│   ├── collab_CollaborationController.cls    # Object CRUD, Platform Events
│   ├── collab_CursorCacheController.cls      # Platform Cache operations
│   └── *_Test.cls                            # Test classes (100% coverage)
├── lwc/
│   ├── collab_collaborativeCanvas/           # Main canvas component (~6000 lines)
│   ├── collab_canvasViewerOnly/              # Read-only preview component
│   └── collab_canvasDrawingUtils/            # Shared drawing utilities
├── objects/
│   ├── collab_Canvas_State__c/               # Persistence object
│   └── collab_Collaboration_Event__e/        # Platform Event definition
├── cachePartitions/
│   └── CollabCanvas.cachePartition-meta.xml  # Platform Cache partition
├── permissionsets/
│   ├── collab_CanvasAdmin.permissionset-meta.xml
│   └── collab_CanvasUser.permissionset-meta.xml
└── quickActions/
    └── Account.collab_Launch_Canvas.quickAction-meta.xml
```

---

## Roadmap

- [x] Undo/Redo history (Ctrl+Z / Ctrl+Y) - 50-step history
- [x] Copy/Paste/Cut (Ctrl+C / Ctrl+V / Ctrl+X)
- [x] Activity cards (Tasks, Events, Emails)
- [x] Connector labels with color picker
- [ ] State conflict prevention (optimistic locking)
- [ ] Export to PNG/PDF
- [ ] Templates (pre-built layouts)
- [ ] Mobile touch support
- [ ] Comments/annotations on objects

---

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

---

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

---

## Author

**Nils Lehsten**

- LinkedIn: [Connect with me](https://www.linkedin.com/in/nils-lehsten/)
- GitHub: [@nilslehsten](https://github.com/nilslehsten)

---

## Acknowledgments

- Inspired by modern collaborative whiteboard tools
- Built with Salesforce Lightning Web Components
- Uses Salesforce Platform Events and Platform Cache

---

*"Proving that Salesforce can do things people think are impossible."*
