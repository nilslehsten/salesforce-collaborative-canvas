# SF-Collab Installation Guide

**Author:** Nils Lehsten
**Version:** 1.1
**Last Updated:** December 2024

---

## Prerequisites

Before installing SF-Collab, ensure you have:

- [ ] **Salesforce CLI** installed (`sf --version` to verify)
- [ ] **Salesforce Org** (Developer Edition, Sandbox, or Scratch Org)
- [ ] **Platform Cache** capacity available (minimum 1 MB)

---

## Installation Steps

### Step 1: Download the Package

Download or clone the repository:

```bash
git clone https://github.com/nilslehsten/salesforce-collaborative-canvas.git
cd salesforce-collaborative-canvas
```

Or download the ZIP from GitHub and extract it.

### Step 2: Authenticate with Your Org

```bash
sf org login web --alias my-canvas-org
```

This opens a browser for Salesforce authentication.

### Step 3: Deploy Metadata (Two-Phase Deployment)

Due to component dependencies, deployment must occur in two phases.

#### Phase 1 - Deploy Base Components

Using manifest file:

```bash
sf project deploy start --manifest manifest/package-stage1.xml --target-org my-canvas-org
```

Or using multiple source directories:

```bash
sf project deploy start \
  --source-dir force-app/main/default/objects \
  --source-dir force-app/main/default/classes \
  --source-dir force-app/main/default/lwc \
  --source-dir force-app/main/default/permissionsets \
  --target-org my-canvas-org
```

**Components deployed:**
- Custom Objects (`collab_Canvas_State__c`)
- Platform Event (`collab_Collaboration_Event__e`)
- Apex Classes (4 classes including tests)
- Lightning Web Components (3 components)
- Permission Sets (2 permission sets)

#### Phase 2 - Deploy Quick Actions

```bash
sf project deploy start --manifest manifest/package-stage2.xml --target-org my-canvas-org
```

Or directly:

```bash
sf project deploy start --source-dir force-app/main/default/quickActions --target-org my-canvas-org
```

**Components deployed:**
- Account Quick Action (`Account.collab_Launch_Canvas`)

> **Why separate?** The QuickAction references the LWC component, which must exist in the org first.

### Step 4: Configure Platform Cache

1. Navigate to **Setup** > **Platform Cache**
2. Click **New Platform Cache Partition**
3. Configure:
   - **Label:** `CollabCanvas`
   - **Name:** `CollabCanvas`
   - **Org Cache Allocation → Provider Free:** `1` MB
   - **Session Cache Allocation:** `0` (not needed)
4. Click **Save**

> **Note:** Developer Edition orgs have 2 MB free "Provider Free" capacity. No purchase required.

### Step 5: Assign Permission Set

```bash
sf org assign permset --name collab_CanvasUser --target-org my-canvas-org
```

Or manually: Setup > Permission Sets > `collab_CanvasUser` > Manage Assignments

---

## Manifest Files

### package-stage1.xml (Base Components)

```xml
<?xml version="1.0" encoding="UTF-8"?>
<Package xmlns="http://soap.sforce.com/2006/04/metadata">
    <version>62.0</version>
    <types>
        <members>collab_Canvas_State__c</members>
        <name>CustomObject</name>
    </types>
    <types>
        <members>collab_Collaboration_Event__e</members>
        <name>CustomObject</name>
    </types>
    <types>
        <members>collab_CollaborationController</members>
        <members>collab_CollaborationController_Test</members>
        <members>collab_CursorCacheController</members>
        <members>collab_CursorCacheController_Test</members>
        <name>ApexClass</name>
    </types>
    <types>
        <members>collab_canvasDrawingUtils</members>
        <members>collab_canvasViewerOnly</members>
        <members>collab_collaborativeCanvas</members>
        <name>LightningComponentBundle</name>
    </types>
    <types>
        <members>collab_CanvasAdmin</members>
        <members>collab_CanvasUser</members>
        <name>PermissionSet</name>
    </types>
</Package>
```

### package-stage2.xml (Quick Actions)

```xml
<?xml version="1.0" encoding="UTF-8"?>
<Package xmlns="http://soap.sforce.com/2006/04/metadata">
    <version>62.0</version>
    <types>
        <members>Account.collab_Launch_Canvas</members>
        <name>QuickAction</name>
    </types>
</Package>
```

---

## Dependency Chain

```
QuickAction ─depends on─> LWC Component
     │                         │
     │                         └── Stage 1
     └── Stage 2
```

**Deployment Order:**
1. Objects, Classes, LWCs, Permission Sets (no dependencies)
2. Quick Actions (depends on LWC)

---

## Troubleshooting

### Deployment Fails with QuickAction Error

**Error:** `Unable to retrieve lightning web component by namespace/developer name`

**Solution:** Deploy base components (Stage 1) first. The QuickAction references an LWC that must exist in the org.

### Platform Cache Error

**Error:** `Cache partition not found` or `Platform Cache not available`

**Solution:** Create the Platform Cache partition named `CollabCanvas` with 1 MB allocated to **Org Cache → Provider Free**.

### Permission Set Assignment Error

**Error:** `Permission set is assigned to users`

**Solution:** Before uninstalling, remove permission set assignments from all users first.

### CLI Locale Error (False Positive)

**Error:** `Missing message metadata.transfer:Finalizing for locale en_US`

**Solution:** This is a CLI display bug. Check actual deployment status with:

```bash
sf project deploy report --job-id <JOB_ID> --target-org my-canvas-org
```

The deployment likely succeeded despite the error message.

### Source Files Deleted After Uninstall

**Warning:** Running `sf project delete source` deletes BOTH org metadata AND local source files!

**Solution:** Keep a backup of your source files or re-download from the repository before redeploying.

---

## Uninstallation

To remove all SF-Collab metadata from your org:

1. **Remove Permission Set Assignments:**
   - Setup > Permission Sets > `collab_CanvasUser` > Manage Assignments
   - Remove all user assignments

2. **Delete Quick Actions first:**
   ```bash
   sf project delete source --source-dir force-app/main/default/quickActions --target-org my-canvas-org --no-prompt
   ```

3. **Delete remaining components:**
   ```bash
   sf project delete source --source-dir force-app --target-org my-canvas-org --no-prompt
   ```

4. **Remove Platform Cache Partition** (optional):
   - Setup > Platform Cache > Delete the `collab_CollabCanvas` partition

> **Important:** Uninstall in reverse dependency order (QuickActions > Base Components)

---

## Component Summary

| Type | Name | Description | Stage |
|------|------|-------------|-------|
| Custom Object | `collab_Canvas_State__c` | Stores canvas state data | 1 |
| Platform Event | `collab_Collaboration_Event__e` | Real-time collaboration events | 1 |
| Apex Class | `collab_CollaborationController` | Canvas CRUD operations | 1 |
| Apex Class | `collab_CursorCacheController` | Cursor sync via Platform Cache | 1 |
| LWC | `collab_collaborativeCanvas` | Main canvas component | 1 |
| LWC | `collab_canvasViewerOnly` | Read-only canvas viewer | 1 |
| LWC | `collab_canvasDrawingUtils` | Drawing utility module | 1 |
| Permission Set | `collab_CanvasUser` | Standard user access | 1 |
| Permission Set | `collab_CanvasAdmin` | Admin access | 1 |
| Quick Action | `Account.collab_Launch_Canvas` | Launch canvas from Account | 2 |

---

## Verification Checklist

After installation, verify:

- [ ] All 22 components deployed successfully (21 base + 1 QuickAction)
- [ ] Platform Cache partition created with 1MB+ Org Cache
- [ ] Permission set assigned to test user(s)
- [ ] Launch Canvas button available on Account records

---

## Support

For issues or questions, visit: https://github.com/nilslehsten/salesforce-collaborative-canvas/issues

---

*SF-Collab by Nils Lehsten | Real-Time Collaborative Canvas for Salesforce*
