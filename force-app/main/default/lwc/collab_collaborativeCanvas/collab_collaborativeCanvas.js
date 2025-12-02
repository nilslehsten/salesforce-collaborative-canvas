/**
 * @description Real-time collaborative canvas LWC component.
 * Supports live cursor tracking, object collaboration, and freehand drawing.
 *
 * @author Nils Lehsten
 * @date 2025-11-26
 */
import { LightningElement, api, track } from 'lwc';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import { subscribe, unsubscribe, onError } from 'lightning/empApi';
import { CloseActionScreenEvent } from 'lightning/actions';
import { notifyRecordUpdateAvailable } from 'lightning/uiRecordApi';
import { NavigationMixin } from 'lightning/navigation';

// Shared drawing utilities
import {
    drawSticky,
    drawRectangle,
    drawCircle,
    drawDiamond,
    drawTriangle,
    drawHexagon,
    drawParallelogram,
    drawCylinder,
    drawCloud,
    drawRoundedRectangle,
    drawDocument,
    drawRecord,
    drawActivity,
    drawGroupIndicator,
    drawSingleStroke,
    drawShapeText,
    drawArrowhead,
    drawElbowPath,
    drawCurvedPath,
    getAnchorPoint,
    wrapText,
    darkenColor,
    lightenColor,
    getContrastColor,
    calculateFitToContent,
    drawConnectorLabel,
    getConnectorLabelBounds,
    findClosestPositionOnConnector,
    ICON_COLORS,
    ACTIVITY_ICON_COLORS
} from 'c/collab_canvasDrawingUtils';

// Apex controllers
import updateCursor from '@salesforce/apex/collab_CursorCacheController.updateCursor';
import getAllCursors from '@salesforce/apex/collab_CursorCacheController.getAllCursors';
import removeCursor from '@salesforce/apex/collab_CursorCacheController.removeCursor';
import heartbeat from '@salesforce/apex/collab_CursorCacheController.heartbeat';
import publishEvent from '@salesforce/apex/collab_CollaborationController.publishEvent';
import saveCanvasState from '@salesforce/apex/collab_CollaborationController.saveCanvasState';
import loadCanvasState from '@salesforce/apex/collab_CollaborationController.loadCanvasState';
import getRelatedContacts from '@salesforce/apex/collab_CollaborationController.getRelatedContacts';
import getRelatedOpportunities from '@salesforce/apex/collab_CollaborationController.getRelatedOpportunities';
import searchLeads from '@salesforce/apex/collab_CollaborationController.searchLeads';
import searchUsers from '@salesforce/apex/collab_CollaborationController.searchUsers';
import getRelatedTasks from '@salesforce/apex/collab_CollaborationController.getRelatedTasks';
import getRelatedEvents from '@salesforce/apex/collab_CollaborationController.getRelatedEvents';
import getRelatedEmails from '@salesforce/apex/collab_CollaborationController.getRelatedEmails';

import userId from '@salesforce/user/Id';

// Constants
const CURSOR_UPDATE_THROTTLE = 50; // ms
const CURSOR_POLL_INTERVAL = 50; // ms
const HEARTBEAT_INTERVAL = 5000; // ms
const DELTA_THRESHOLD = 10; // pixels
const INTERPOLATION_FACTOR = 0.25; // Smoothing factor (0.25 = 25% per frame)
const STALE_THRESHOLD = 60000; // ms - users disappear after 60s of no heartbeat
const GRID_SIZE = 20;
const CANVAS_WORLD_WIDTH = 3200;  // Total canvas working area
const CANVAS_WORLD_HEIGHT = 1800;
const PLATFORM_EVENT_CHANNEL = '/event/collab_Collaboration_Event__e';
const DEBUG_PREFIX = '[CollabCanvas]';
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 2.0;
const ZOOM_STEP = 0.1;
const CONNECTOR_HIT_RADIUS = 10; // px - hit area around connector line
const SNAP_RADIUS = 15; // px - anchor point snap distance
const ARROWHEAD_SIZE = 12; // px - size of arrowhead
const CONTROL_POINT_RADIUS = 6; // px - bezier control point handle size
const ELBOW_MARGIN = 30; // px - minimum distance from objects for elbow routing

// Resize constants
const HANDLE_SIZE = 8; // px - resize handle size
const HANDLE_TOLERANCE = 4; // px - extra hit area around handles
const MAX_ELEMENT_SIZE = 800; // px - maximum element dimension
const MIN_SIZES = {
    sticky: { width: 60, height: 60 },
    rectangle: { width: 40, height: 40 },
    circle: { width: 30, height: 30 },
    record: { width: 120, height: 40 },
    diamond: { width: 40, height: 40 },
    triangle: { width: 40, height: 35 },
    hexagon: { width: 50, height: 44 },
    parallelogram: { width: 50, height: 30 },
    cylinder: { width: 30, height: 40 },
    cloud: { width: 60, height: 40 },
    rounded_rectangle: { width: 50, height: 30 },
    document: { width: 40, height: 50 }
};

// Color palette for color picker
const COLOR_PALETTE = [
    // Row 1 - Warm colors
    { name: 'Red', value: '#e53935' },
    { name: 'Orange', value: '#fb8c00' },
    { name: 'Yellow', value: '#fdd835' },
    { name: 'Green', value: '#43a047' },
    // Row 2 - Cool colors
    { name: 'Teal', value: '#00acc1' },
    { name: 'Blue', value: '#1e88e5' },
    { name: 'Purple', value: '#8e24aa' },
    { name: 'Pink', value: '#d81b60' },
    // Row 3 - Neutrals
    { name: 'Gray', value: '#757575' },
    { name: 'Brown', value: '#6d4c41' },
    { name: 'Black', value: '#212121' },
    { name: 'White', value: '#fafafa' }
];

const STROKE_WIDTHS = [2, 4, 8, 16];

export default class Collab_collaborativeCanvas extends NavigationMixin(LightningElement) {
    @api recordId;
    @api width = 1600;
    @api height = 900;

    // Track if we've loaded state with the correct recordId
    _stateLoadedForRecordId = null;

    @track connectedUsers = [];
    @track currentTool = 'select';
    @track isLoading = true;
    @track errorMessage = '';
    @track zoomLevel = 1.0;
    @track isEditingText = false;
    @track editingText = '';
    @track editingObject = null;

    // Record Selector Modal State
    @track isRecordModalOpen = false;
    @track recordModalTab = 'contacts'; // 'contacts', 'opportunities', 'leads'
    @track recordSearchTerm = '';
    @track availableRecords = [];
    @track selectedRecordIds = []; // Use array for reactivity
    @track isLoadingRecords = false;

    // Activity Modal State
    @track isActivityModalOpen = false;
    @track activityModalTab = 'tasks'; // 'tasks', 'events', 'emails'
    @track activitySearchTerm = '';
    @track availableActivities = [];
    @track selectedActivityIds = [];
    @track isLoadingActivities = false;

    // Color & Styling State
    @track showFillColorPicker = false;
    @track showBorderColorPicker = false;
    @track showDrawColorPicker = false;
    @track customColorValue = '';
    @track drawColor = '#333333';
    @track drawStrokeWidth = 3;

    // Shape Palette State
    @track showShapePalette = false;

    // Sticky & Connector Palette State
    @track showStickyPalette = false;
    @track showConnectorPalette = false;

    // Text Control Dropdown State
    @track showTextOverflowPicker = false;
    @track showFontSizePicker = false;

    // Help Modal State
    @track showHelpModal = false;

    // Canvas state
    objects = [];
    strokes = [];
    connectors = [];
    selectedObject = null;
    selectedConnector = null;

    // SLDS Icon images (preloaded for canvas drawing)
    iconImages = {};
    iconsLoaded = false;
    isDragging = false;
    isDrawing = false;
    isConnecting = false;
    isResizing = false;
    activeResizeHandle = null; // 'nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'
    resizeStartState = null; // { x, y, width, height } - original dims for aspect ratio
    hoveredHandle = null; // For cursor feedback
    currentStroke = null;
    currentConnector = null;
    connectorType = 'arrow'; // 'arrow', 'line', 'elbow', 'curved'
    hoveredStroke = null; // For eraser hover preview
    hoveredObject = null; // For eraser hover preview on objects
    hoveredConnector = null; // For eraser hover preview on connectors
    dragOffset = { x: 0, y: 0 };
    isDraggingControlPoint = false;
    activeControlPoint = null; // 'cp1', 'cp2', or waypoint index for elbow
    nearestAnchor = null; // For showing snap indicator

    // Marquee selection state
    selectedObjects = []; // Array for multi-selection of objects
    selectedConnectors = []; // Array for multi-selection of connectors
    isMarqueeSelecting = false;
    marqueeStart = { x: 0, y: 0 };
    marqueeEnd = { x: 0, y: 0 };

    // Multi-selection drag state
    isDraggingMultiple = false;
    lastDragPosition = { x: 0, y: 0 };

    // Endpoint drag state
    isDraggingEndpoint = false;
    draggingEndpoint = null;      // 'start' or 'end'
    draggingConnector = null;     // The connector being edited
    potentialDropTarget = null;   // Object under cursor during endpoint drag

    // Connector label drag state
    isDraggingLabel = false;
    draggingLabelConnector = null; // Connector whose label is being dragged
    editingConnectorLabel = null;  // Connector being label-edited (for text input)

    // Pan state
    panOffsetX = 0;
    panOffsetY = 0;
    isPanning = false;
    panStartX = 0;
    panStartY = 0;
    isShiftPanning = false;       // Temporary pan via Shift+click
    previousTool = null;          // Tool to restore after space-pan

    // Undo/Redo state
    undoStack = [];  // Max 5 items
    redoStack = [];  // Cleared on new action
    dragStartState = null;  // Capture object state at drag start for undo
    previousTextValue = '';  // Capture text before editing for undo

    // Clipboard state
    clipboard = {
        objects: [],      // Copied objects
        connectors: [],   // Copied connectors
        pasteCount: 0     // For offset stacking
    };

    // Cursor state
    localCursor = { x: 0, y: 0 };
    lastSentCursor = { x: 0, y: 0 };
    lastCursorSendTime = 0;
    remoteCursors = {};
    targetCursors = {};

    // Canvas context
    canvas = null;
    ctx = null;
    animationFrameId = null;
    isInitialized = false;

    // Intervals
    cursorPollInterval = null;
    heartbeatInterval = null;

    // Platform Event subscription
    subscription = null;

    /**
     * @description Canvas ID - uses recordId if available, falls back to default
     */
    get canvasId() {
        return this.recordId || 'default-canvas';
    }

    get canvasWrapperStyle() {
        return `width: ${this.width}px; height: ${this.height}px;`;
    }

    get selectVariant() {
        return this.currentTool === 'select' ? 'brand' : 'neutral';
    }

    get selectButtonClass() {
        return this.currentTool === 'select' ? 'toolbar-tool-button active' : 'toolbar-tool-button';
    }

    get panButtonClass() {
        return this.currentTool === 'pan' ? 'toolbar-tool-button active' : 'toolbar-tool-button';
    }

    // Undo/Redo button state getters
    get undoDisabled() {
        return this.undoStack.length === 0;
    }

    get redoDisabled() {
        return this.redoStack.length === 0;
    }

    get undoButtonClass() {
        return this.undoDisabled ? 'toolbar-history-button disabled' : 'toolbar-history-button';
    }

    get redoButtonClass() {
        return this.redoDisabled ? 'toolbar-history-button disabled' : 'toolbar-history-button';
    }

    get drawVariant() {
        return this.currentTool === 'draw' ? 'brand' : 'neutral';
    }

    get eraserVariant() {
        return this.currentTool === 'eraser' ? 'brand' : 'neutral';
    }

    get arrowVariant() {
        return this.currentTool === 'connector' && this.connectorType === 'arrow' ? 'brand' : 'neutral';
    }

    get lineVariant() {
        return this.currentTool === 'connector' && this.connectorType === 'line' ? 'brand' : 'neutral';
    }

    get elbowVariant() {
        return this.currentTool === 'connector' && this.connectorType === 'elbow' ? 'brand' : 'neutral';
    }

    get curvedVariant() {
        return this.currentTool === 'connector' && this.connectorType === 'curved' ? 'brand' : 'neutral';
    }

    get isConnectorToolActive() {
        return this.currentTool === 'connector';
    }

    get connectedCount() {
        return this.connectedUsers.length + 1; // +1 for self
    }

    get hasError() {
        return !!this.errorMessage;
    }

    get isReady() {
        return !this.isLoading && !this.hasError;
    }

    get canvasWrapperClass() {
        return this.isReady ? 'canvas-wrapper' : 'canvas-wrapper hidden';
    }

    get zoomPercentage() {
        return Math.round(this.zoomLevel * 100);
    }

    get textEditorStyle() {
        // Handle connector label editing (2 lines tall)
        if (this.editingConnectorLabel) {
            const connector = this.editingConnectorLabel;
            const start = this.resolveConnectorPoint(connector, 'start');
            const end = this.resolveConnectorPoint(connector, 'end');
            if (!start || !end) return '';

            // Get label bounds for positioning
            const bounds = getConnectorLabelBounds(connector, start, end);
            const pos = bounds || { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };

            // Position editor at label location (account for pan offset and zoom)
            // Height of 52px supports 2 lines of text
            const editorWidth = 200;
            const editorHeight = 52;
            const x = (pos.x + this.panOffsetX) * this.zoomLevel - editorWidth / 2;
            const y = (pos.y + this.panOffsetY) * this.zoomLevel - editorHeight / 2;
            return `left: ${x}px; top: ${y}px; width: ${editorWidth}px; height: ${editorHeight}px;`;
        }

        if (!this.editingObject) return '';
        const obj = this.editingObject;
        // Account for pan offset
        const x = (obj.x + this.panOffsetX) * this.zoomLevel;
        const y = (obj.y + this.panOffsetY) * this.zoomLevel;
        const width = obj.width * this.zoomLevel;
        const height = obj.height * this.zoomLevel;
        return `left: ${x}px; top: ${y}px; width: ${width}px; height: ${height}px;`;
    }

    // Record Modal Getters
    get isContactsTab() {
        return this.recordModalTab === 'contacts';
    }
    get isOpportunitiesTab() {
        return this.recordModalTab === 'opportunities';
    }
    get isLeadsTab() {
        return this.recordModalTab === 'leads';
    }
    get isUsersTab() {
        return this.recordModalTab === 'users';
    }
    get contactsTabClass() {
        return this.isContactsTab ? 'slds-tabs_default__item slds-is-active' : 'slds-tabs_default__item';
    }
    get opportunitiesTabClass() {
        return this.isOpportunitiesTab ? 'slds-tabs_default__item slds-is-active' : 'slds-tabs_default__item';
    }
    get leadsTabClass() {
        return this.isLeadsTab ? 'slds-tabs_default__item slds-is-active' : 'slds-tabs_default__item';
    }
    get usersTabClass() {
        return this.isUsersTab ? 'slds-tabs_default__item slds-is-active' : 'slds-tabs_default__item';
    }
    get hasSelectedRecords() {
        return this.selectedRecordIds.length > 0;
    }
    get selectedCount() {
        return this.selectedRecordIds.length;
    }
    get recordsWithSelection() {
        return this.availableRecords.map(rec => ({
            ...rec,
            isSelected: this.selectedRecordIds.includes(rec.recordId),
            itemClass: this.selectedRecordIds.includes(rec.recordId)
                ? 'record-item selected'
                : 'record-item'
        }));
    }
    get searchPlaceholder() {
        if (this.isLeadsTab) {
            return 'Type at least 2 characters to search leads...';
        } else if (this.isUsersTab) {
            return 'Type at least 2 characters to search users...';
        }
        return 'Search records...';
    }
    get requiresSearch() {
        return this.isLeadsTab || this.isUsersTab;
    }
    get noSearchRequired() {
        return !this.isLeadsTab && !this.isUsersTab;
    }
    get addRecordsButtonLabel() {
        return this.hasSelectedRecords
            ? `Add ${this.selectedRecordIds.length} Record(s)`
            : 'Add Records';
    }
    get noSelectedRecords() {
        return this.selectedRecordIds.length === 0;
    }
    get hasRecords() {
        return this.availableRecords.length > 0;
    }
    get noRecords() {
        return this.availableRecords.length === 0;
    }
    get isNotLoadingRecords() {
        return !this.isLoadingRecords;
    }

    // Activity Modal Getters
    get isTasksTab() {
        return this.activityModalTab === 'tasks';
    }
    get isEventsTab() {
        return this.activityModalTab === 'events';
    }
    get isEmailsTab() {
        return this.activityModalTab === 'emails';
    }
    get tasksTabClass() {
        return this.isTasksTab ? 'slds-tabs_default__item slds-is-active' : 'slds-tabs_default__item';
    }
    get eventsTabClass() {
        return this.isEventsTab ? 'slds-tabs_default__item slds-is-active' : 'slds-tabs_default__item';
    }
    get emailsTabClass() {
        return this.isEmailsTab ? 'slds-tabs_default__item slds-is-active' : 'slds-tabs_default__item';
    }
    get activitySearchPlaceholder() {
        return `Search ${this.activityModalTab}...`;
    }
    get activitiesWithSelection() {
        return this.availableActivities.map(act => ({
            ...act,
            isSelected: this.selectedActivityIds.includes(act.recordId),
            itemClass: this.selectedActivityIds.includes(act.recordId)
                ? 'record-item selected'
                : 'record-item',
            fullIconName: `standard:${act.iconName}`
        }));
    }
    get hasActivities() {
        return this.availableActivities.length > 0;
    }
    get noActivities() {
        return this.availableActivities.length === 0;
    }
    get hasSelectedActivities() {
        return this.selectedActivityIds.length > 0;
    }
    get selectedActivityCount() {
        return this.selectedActivityIds.length;
    }
    get noSelectedActivities() {
        return this.selectedActivityIds.length === 0;
    }
    get addActivitiesButtonLabel() {
        return this.hasSelectedActivities
            ? `Add ${this.selectedActivityIds.length} ${this.selectedActivityIds.length === 1 ? 'Activity' : 'Activities'}`
            : 'Add Activities';
    }
    get isNotLoadingActivities() {
        return !this.isLoadingActivities;
    }

    // Color & Styling Getters
    get showContextToolbar() {
        // Hide context toolbar during endpoint/label dragging and when editing text
        return (this.selectedObject || this.selectedConnector) && this.currentTool === 'select' && !this.isResizing && !this.isDragging && !this.isDraggingEndpoint && !this.isDraggingLabel && !this.isEditingText;
    }
    get contextToolbarStyle() {
        const selected = this.selectedObject || this.selectedConnector;
        if (!selected) return '';

        const toolbarWidth = 280; // Increased for layer controls
        const margin = 12;
        let x, y;

        if (this.selectedConnector) {
            // For connectors, position based on midpoint
            const conn = this.selectedConnector;
            const start = this.resolveConnectorPoint(conn, 'start');
            const end = this.resolveConnectorPoint(conn, 'end');
            const midX = (start.x + end.x) / 2;
            const midY = Math.min(start.y, end.y);
            x = (midX - toolbarWidth / 2) * this.zoomLevel;
            y = (midY - margin - 36) * this.zoomLevel;
        } else {
            // For objects, position above centered
            const obj = this.selectedObject;
            x = (obj.x + obj.width / 2 - toolbarWidth / 2) * this.zoomLevel;
            y = (obj.y - margin - 36) * this.zoomLevel;
            // If not enough space above, position below
            if (y < 50) {
                y = (obj.y + obj.height + margin) * this.zoomLevel;
            }
        }

        // Keep within canvas bounds
        x = Math.max(10, Math.min(x, this.width * this.zoomLevel - toolbarWidth - 10));
        if (y < 50) y = 60;

        return `left: ${x}px; top: ${y}px;`;
    }
    get fillColorStyle() {
        // Also support connector color
        if (this.selectedConnector) {
            const color = this.selectedConnector.color || '#333333';
            return `background-color: ${color};`;
        }
        const color = this.selectedObject?.color || '#e0e0e0';
        return `background-color: ${color};`;
    }
    // Show label button for connectors
    get showConnectorLabelButton() {
        return !!this.selectedConnector;
    }
    get borderColorStyle() {
        const color = this.selectedObject?.borderColor || '#999999';
        return `background-color: ${color};`;
    }
    get showBorderOption() {
        return this.selectedObject && (this.selectedObject.type === 'rectangle' || this.selectedObject.type === 'circle');
    }

    // Text Alignment Getters
    get showAlignmentButtons() {
        if (!this.selectedObject) return false;
        // Show for sticky notes and all shape types
        return this.selectedObject.type === 'sticky' || this.isShapeType(this.selectedObject.type);
    }
    get currentTextAlign() {
        if (!this.selectedObject) return 'top';
        // Default: 'top' for stickies, 'middle' for shapes
        if (this.selectedObject.textAlign) return this.selectedObject.textAlign;
        return this.selectedObject.type === 'sticky' ? 'top' : 'middle';
    }
    get alignTopClass() {
        return this.currentTextAlign === 'top' ? 'active' : '';
    }
    get alignMiddleClass() {
        return this.currentTextAlign === 'middle' ? 'active' : '';
    }
    get alignBottomClass() {
        return this.currentTextAlign === 'bottom' ? 'active' : '';
    }

    // Text Overflow Getters
    get showTextOverflowDropdown() {
        if (!this.selectedObject) return false;
        // Show for sticky notes and all shape types
        return this.selectedObject.type === 'sticky' || this.isShapeType(this.selectedObject.type);
    }
    get currentTextOverflow() {
        if (!this.selectedObject) return 'wrap';
        // Default: 'wrap' for stickies, 'clip' for shapes
        if (this.selectedObject.textOverflow) return this.selectedObject.textOverflow;
        return this.selectedObject.type === 'sticky' ? 'wrap' : 'clip';
    }
    get currentTextOverflowLabel() {
        return this.currentTextOverflow === 'wrap' ? 'Wrap' : 'Clip';
    }
    get textOverflowOptions() {
        const current = this.currentTextOverflow;
        return [
            { value: 'wrap', label: 'Wrap', class: current === 'wrap' ? 'active' : '' },
            { value: 'clip', label: 'Clip', class: current === 'clip' ? 'active' : '' }
        ];
    }

    // Font Size Getters
    get showFontSizeDropdown() {
        if (!this.selectedObject) return false;
        // Show for sticky notes and all shape types
        return this.selectedObject.type === 'sticky' || this.isShapeType(this.selectedObject.type);
    }
    get currentFontSize() {
        if (!this.selectedObject) return 12;
        // Default: 12 for stickies, 14 for shapes
        if (this.selectedObject.fontSize) return this.selectedObject.fontSize;
        return this.selectedObject.type === 'sticky' ? 12 : 14;
    }
    get currentFontSizeLabel() {
        return `${this.currentFontSize}px`;
    }
    get fontSizeOptions() {
        const current = this.currentFontSize;
        return [10, 12, 14, 16, 18, 24, 32, 48].map(size => ({
            value: size,
            label: `${size}px`,
            class: current === size ? 'active' : ''
        }));
    }

    get colorPalette() {
        return COLOR_PALETTE.map(c => ({
            ...c,
            style: `background-color: ${c.value};`
        }));
    }
    get isDrawToolActive() {
        return this.currentTool === 'draw';
    }
    get drawColorStyle() {
        return `background-color: ${this.drawColor};`;
    }
    get strokeWidthOptions() {
        return STROKE_WIDTHS.map(w => ({
            value: w,
            label: `${w}px`,
            selected: w === this.drawStrokeWidth
        }));
    }

    // Sticky Note Colors for Palette
    get stickyColors() {
        return [
            { name: 'Yellow', color: '#fff740', swatchStyle: 'background-color: #fff740;' },
            { name: 'Pink', color: '#ff7eb9', swatchStyle: 'background-color: #ff7eb9;' },
            { name: 'Blue', color: '#7afcff', swatchStyle: 'background-color: #7afcff;' },
            { name: 'Green', color: '#98ff98', swatchStyle: 'background-color: #98ff98;' },
            { name: 'Purple', color: '#cb99ff', swatchStyle: 'background-color: #cb99ff;' },
            { name: 'Orange', color: '#ffb347', swatchStyle: 'background-color: #ffb347;' }
        ];
    }

    // Layer Management Getters
    get isAtFront() {
        const selected = this.selectedObject || this.selectedConnector;
        if (!selected) return true;
        const allElements = [...this.objects, ...this.connectors];
        if (allElements.length <= 1) return true;
        const maxZ = Math.max(...allElements.map(e => e.zIndex || 0));
        return (selected.zIndex || 0) >= maxZ;
    }

    get isAtBack() {
        const selected = this.selectedObject || this.selectedConnector;
        if (!selected) return true;
        const allElements = [...this.objects, ...this.connectors];
        if (allElements.length <= 1) return true;
        const minZ = Math.min(...allElements.map(e => e.zIndex || 0));
        return (selected.zIndex || 0) <= minZ;
    }

    // Keyboard Shortcuts Data
    get keyboardShortcuts() {
        return [
            // Tools
            { category: 'Tools', key: 'V', description: 'Select tool' },
            { category: 'Tools', key: 'M', description: 'Pan/Move tool' },
            { category: 'Tools', key: 'Shift + Drag', description: 'Temporary pan (any tool)' },
            { category: 'Tools', key: 'D', description: 'Draw/Pen tool' },
            { category: 'Tools', key: 'E', description: 'Eraser tool' },
            { category: 'Tools', key: 'S', description: 'Add Sticky Note' },
            { category: 'Tools', key: 'R', description: 'Add Rectangle' },
            { category: 'Tools', key: 'O', description: 'Add Circle/Oval' },
            { category: 'Tools', key: 'C', description: 'Connector (Arrow)' },

            // Selection
            { category: 'Selection', key: 'Ctrl + Click', description: 'Toggle in/out of selection' },
            { category: 'Selection', key: 'Delete', description: 'Delete selected object' },
            { category: 'Selection', key: 'Backspace', description: 'Delete selected object' },
            { category: 'Selection', key: 'Escape', description: 'Deselect / Cancel' },

            // Groups
            { category: 'Groups', key: 'G', description: 'Group / Ungroup (toggle)' },

            // Edit (Undo/Redo/Copy/Paste)
            { category: 'Edit', key: 'Ctrl + Z', description: 'Undo last action' },
            { category: 'Edit', key: 'Ctrl + Y', description: 'Redo last undone action' },
            { category: 'Edit', key: 'Ctrl + Shift + Z', description: 'Redo (alternative)' },
            { category: 'Edit', key: 'Ctrl + C', description: 'Copy selected elements' },
            { category: 'Edit', key: 'Ctrl + V', description: 'Paste copied elements' },
            { category: 'Edit', key: 'Ctrl + X', description: 'Cut selected elements' },

            // Layers
            { category: 'Layers', key: 'Ctrl + ]', description: 'Bring Forward' },
            { category: 'Layers', key: 'Ctrl + [', description: 'Send Backward' },
            { category: 'Layers', key: 'Ctrl + Shift + ]', description: 'Bring to Front' },
            { category: 'Layers', key: 'Ctrl + Shift + [', description: 'Send to Back' },

            // Modifiers
            { category: 'Modifiers', key: 'Shift + Drag', description: 'Lock aspect ratio (resize)' },
            { category: 'Modifiers', key: 'Alt + Drag', description: 'Disable grid snap' },

            // Help
            { category: 'Help', key: '?', description: 'Open keyboard shortcuts' }
        ];
    }

    get groupedShortcuts() {
        const groups = {};
        this.keyboardShortcuts.forEach(shortcut => {
            if (!groups[shortcut.category]) {
                groups[shortcut.category] = [];
            }
            groups[shortcut.category].push(shortcut);
        });
        return Object.entries(groups).map(([category, items]) => ({
            category,
            items
        }));
    }

    // Connector Types for Palette
    get connectorTypesForPalette() {
        const types = [
            { type: 'arrow', name: 'Arrow', icon: '→', description: 'Straight with arrowhead' },
            { type: 'line', name: 'Line', icon: '─', description: 'Straight line' },
            { type: 'elbow', name: 'Elbow', icon: '⌐', description: 'Right-angle' },
            { type: 'curved', name: 'Curved', icon: '~', description: 'Bezier curve' }
        ];
        return types.map(t => ({
            ...t,
            isActive: this.currentTool === 'connector' && this.connectorType === t.type,
            itemClass: this.currentTool === 'connector' && this.connectorType === t.type ? 'dropdown-item active' : 'dropdown-item'
        }));
    }

    // ========== Lifecycle ==========

    connectedCallback() {
        console.log(DEBUG_PREFIX, '=== connectedCallback ===');
        console.log(DEBUG_PREFIX, 'recordId:', this.recordId);
        console.log(DEBUG_PREFIX, 'canvasId:', this.canvasId);

        try {
            // Resize Quick Action modal
            this.resizeQuickActionModal();

            // Preload SLDS icons for canvas drawing
            this.preloadSLDSIcons();

            this.setupErrorHandler();
            this.subscribeToPlatformEvents();
            this.startCursorPolling();
            this.startHeartbeat();

            // Add keyboard listeners
            this.boundKeydownHandler = this.handleKeydown.bind(this);
            this.boundKeyupHandler = this.handleKeyup.bind(this);
            window.addEventListener('keydown', this.boundKeydownHandler);
            window.addEventListener('keyup', this.boundKeyupHandler);

            console.log(DEBUG_PREFIX, 'connectedCallback completed successfully');
        } catch (error) {
            console.error(DEBUG_PREFIX, 'Canvas initialization error:', error);
            this.errorMessage = 'Failed to initialize canvas: ' + (error.message || error);
            this.isLoading = false;
        }
    }

    resizeQuickActionModal() {
        // Find the Quick Action modal container and resize it
        // This only affects this specific Quick Action, not others
        // eslint-disable-next-line @lwc/lwc/no-async-operation
        setTimeout(() => {
            try {
                // Method 1: Find via Quick Action wrapper
                const quickActionWrapper = document.querySelector(
                    '.runtime_platform_actionsQuickActionWrapper'
                );
                if (quickActionWrapper) {
                    let parent = quickActionWrapper.parentElement;
                    while (parent && !parent.classList.contains('modal-container')) {
                        parent = parent.parentElement;
                    }
                    if (parent) {
                        parent.style.cssText = 'width: 1600px !important; max-width: 95vw !important; min-width: 480px !important;';
                        console.log(DEBUG_PREFIX, 'Modal resized via Quick Action wrapper');
                        return;
                    }
                }

                // Method 2: Direct modal container query
                const modals = document.querySelectorAll('.slds-modal__container');
                if (modals.length > 0) {
                    const modal = modals[modals.length - 1]; // Get the most recent modal
                    modal.style.cssText = 'width: 1600px !important; max-width: 95vw !important; min-width: 480px !important;';
                    console.log(DEBUG_PREFIX, 'Modal resized via direct query');
                }
            } catch (e) {
                console.log(DEBUG_PREFIX, 'Could not resize modal:', e.message);
            }
        }, 100);
    }

    renderedCallback() {
        if (!this.isInitialized && this.refs.mainCanvas) {
            console.log(DEBUG_PREFIX, 'renderedCallback: initializing canvas');
            this.initializeCanvas();
            this.isInitialized = true;
        }

        // Check if recordId arrived after we loaded state - reload if needed
        if (this.isInitialized && this.recordId && this._stateLoadedForRecordId !== this.recordId) {
            console.log(DEBUG_PREFIX, 'recordId changed from', this._stateLoadedForRecordId, 'to', this.recordId, '- reloading state');
            this._stateLoadedForRecordId = this.recordId;
            this.loadState();
        }
    }

    disconnectedCallback() {
        console.log(DEBUG_PREFIX, '=== disconnectedCallback ===');
        this.cleanup();
    }

    // ========== Initialization ==========

    async initializeCanvas() {
        console.log(DEBUG_PREFIX, '=== initializeCanvas START ===');
        try {
            this.canvas = this.refs.mainCanvas;
            this.ctx = this.canvas.getContext('2d');

            // High-DPI support
            const dpr = window.devicePixelRatio || 1;
            this.canvas.width = this.width * dpr;
            this.canvas.height = this.height * dpr;
            this.canvas.style.width = this.width + 'px';
            this.canvas.style.height = this.height + 'px';
            this.ctx.scale(dpr, dpr);

            console.log(DEBUG_PREFIX, 'Canvas element ready, loading state...');

            // Load existing state
            await this.loadState();

            // Announce join
            this.announceJoin();

            // Start render loop
            this.startRenderLoop();

            // Mark as ready
            this.isLoading = false;
            console.log(DEBUG_PREFIX, '=== initializeCanvas END (success) ===');
        } catch (error) {
            console.error(DEBUG_PREFIX, 'Canvas initialization error:', error);
            this.errorMessage = 'Failed to initialize canvas: ' + (error.message || error);
            this.isLoading = false;
        }
    }

    setupErrorHandler() {
        onError((error) => {
            console.error(DEBUG_PREFIX, 'EMP API Error:', error);
        });
    }

    // ========== Platform Events ==========

    async subscribeToPlatformEvents() {
        console.log(DEBUG_PREFIX, 'Subscribing to platform events...');
        try {
            this.subscription = await subscribe(
                PLATFORM_EVENT_CHANNEL,
                -1,
                (message) => this.handlePlatformEvent(message)
            );
            console.log(DEBUG_PREFIX, 'Platform event subscription successful');
        } catch (error) {
            console.error(DEBUG_PREFIX, 'Failed to subscribe to platform events:', error);
        }
    }

    handlePlatformEvent(message) {
        const data = message.data.payload;

        // Ignore own events
        if (data.collab_User_Id__c === userId) {
            return;
        }

        // Filter by canvas
        if (data.collab_Canvas_Id__c !== this.canvasId) {
            return;
        }

        const eventType = data.collab_Event_Type__c;
        const payload = JSON.parse(data.collab_Payload__c || '{}');
        const userName = data.collab_User_Name__c;

        console.log(DEBUG_PREFIX, 'Received platform event:', eventType, payload);

        switch (eventType) {
            case 'object_add':
                this.handleRemoteObjectAdd(payload);
                break;
            case 'object_move':
                this.handleRemoteObjectMove(payload);
                break;
            case 'object_resize':
                this.handleRemoteObjectResize(payload);
                break;
            case 'object_style':
                this.handleRemoteObjectStyle(payload);
                break;
            case 'object_delete':
                this.handleRemoteObjectDelete(payload);
                break;
            case 'draw_stroke':
                this.handleRemoteStroke(payload);
                break;
            case 'stroke_delete':
                this.handleRemoteStrokeDelete(payload);
                break;
            case 'connector_add':
                this.handleRemoteConnectorAdd(payload);
                break;
            case 'connector_update':
                this.handleRemoteConnectorUpdate(payload);
                break;
            case 'connector_delete':
                this.handleRemoteConnectorDelete(payload);
                break;
            case 'object_layer':
                this.handleRemoteLayerChange(payload);
                break;
            case 'connector_layer':
                this.handleRemoteConnectorLayerChange(payload);
                break;
            case 'group_create':
                this.handleRemoteGroupCreate(payload);
                break;
            case 'group_ungroup':
                this.handleRemoteGroupUngroup(payload);
                break;
            case 'user_join':
                this.showToast('User Joined', `${userName} joined the canvas`, 'info');
                // Auto-save so the joining user gets current state
                this.saveStateForNewUser();
                break;
            case 'user_leave':
                this.showToast('User Left', `${userName} left the canvas`, 'info');
                break;
            default:
                console.warn(DEBUG_PREFIX, 'Unknown event type:', eventType);
        }
    }

    // ========== Cursor System ==========

    startCursorPolling() {
        this.cursorPollInterval = setInterval(() => {
            this.pollCursors();
        }, CURSOR_POLL_INTERVAL);
    }

    startHeartbeat() {
        this.heartbeatInterval = setInterval(() => {
            heartbeat({ canvasId: this.canvasId }).catch(() => {});
        }, HEARTBEAT_INTERVAL);
    }

    async pollCursors() {
        try {
            const result = await getAllCursors({ canvasId: this.canvasId });
            const cursors = JSON.parse(result || '{}');

            const now = Date.now();
            const newConnectedUsers = [];

            // Update target positions for interpolation
            for (const [id, cursor] of Object.entries(cursors)) {
                this.targetCursors[id] = {
                    x: cursor.x,
                    y: cursor.y,
                    name: cursor.name,
                    color: cursor.color,
                    timestamp: cursor.timestamp
                };

                // Initialize current position if new
                if (!this.remoteCursors[id]) {
                    this.remoteCursors[id] = { ...this.targetCursors[id] };
                }

                // Track connected users
                if (now - cursor.timestamp < STALE_THRESHOLD) {
                    newConnectedUsers.push({
                        id: id,
                        name: cursor.name,
                        initials: this.getInitials(cursor.name),
                        style: `background-color: ${cursor.color};`
                    });
                }
            }

            // Remove stale cursors
            for (const id of Object.keys(this.remoteCursors)) {
                if (!cursors[id]) {
                    delete this.remoteCursors[id];
                    delete this.targetCursors[id];
                }
            }

            this.connectedUsers = newConnectedUsers;
        } catch (error) {
            // Fail silently - cache may not be available
        }
    }

    async sendCursorUpdate(x, y) {
        const now = Date.now();
        const dx = Math.abs(x - this.lastSentCursor.x);
        const dy = Math.abs(y - this.lastSentCursor.y);

        // Delta compression + throttling
        if (
            (dx > DELTA_THRESHOLD || dy > DELTA_THRESHOLD) &&
            now - this.lastCursorSendTime > CURSOR_UPDATE_THROTTLE
        ) {
            try {
                await updateCursor({ canvasId: this.canvasId, x: x, y: y });
                this.lastSentCursor = { x, y };
                this.lastCursorSendTime = now;
            } catch (error) {
                // Fail silently
            }
        }
    }

    getInitials(name) {
        if (!name) return '?';
        const parts = name.split(' ');
        if (parts.length >= 2) {
            return parts[0][0] + parts[parts.length - 1][0];
        }
        return name.substring(0, 2);
    }

    // ========== Render Loop ==========

    startRenderLoop() {
        const render = () => {
            this.interpolateCursors();
            this.draw();
            this.animationFrameId = requestAnimationFrame(render);
        };
        this.animationFrameId = requestAnimationFrame(render);
    }

    interpolateCursors() {
        for (const id of Object.keys(this.remoteCursors)) {
            const current = this.remoteCursors[id];
            const target = this.targetCursors[id];

            if (target) {
                current.x += (target.x - current.x) * INTERPOLATION_FACTOR;
                current.y += (target.y - current.y) * INTERPOLATION_FACTOR;
                current.name = target.name;
                current.color = target.color;
            }
        }
    }

    draw() {
        if (!this.ctx) return;

        const ctx = this.ctx;
        const dpr = window.devicePixelRatio || 1;

        // Clear entire canvas
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

        // Apply zoom and pan transform
        ctx.setTransform(dpr * this.zoomLevel, 0, 0, dpr * this.zoomLevel, 0, 0);
        ctx.translate(this.panOffsetX, this.panOffsetY);

        // Draw grid
        this.drawGrid(ctx);

        // Draw strokes
        this.drawStrokes(ctx);

        // Draw all elements (objects + connectors) in combined z-order
        this.drawAllElements(ctx);

        // Draw current connector being drawn (preview)
        if (this.currentConnector) {
            this.drawConnector(ctx, this.currentConnector, true);
        }

        // Draw resize handles on selected object
        if (this.selectedObject && this.currentTool === 'select') {
            this.drawResizeHandles(ctx, this.selectedObject);
            this.drawDimensionTooltip(ctx, this.selectedObject);
        }

        // Draw anchor points (when using connector tool)
        if (this.currentTool === 'connector') {
            this.drawAnchorPoints(ctx);
        }

        // Draw current stroke (if drawing)
        if (this.currentStroke && this.currentStroke.points.length > 1) {
            this.drawSingleStroke(ctx, this.currentStroke);
        }

        // Draw eraser hover highlight (red stroke overlay)
        if (this.currentTool === 'eraser' && this.hoveredStroke) {
            this.drawStrokeHighlight(ctx, this.hoveredStroke, '#ff4444', 4);
        }

        // Draw eraser hover highlight for objects (red overlay)
        if (this.currentTool === 'eraser' && this.hoveredObject) {
            this.drawEraserObjectHighlight(ctx, this.hoveredObject);
        }

        // Draw eraser hover highlight for connectors (red line)
        if (this.currentTool === 'eraser' && this.hoveredConnector) {
            this.drawEraserConnectorHighlight(ctx, this.hoveredConnector);
        }

        // Draw drop target highlight during endpoint drag
        if (this.isDraggingEndpoint && this.potentialDropTarget) {
            this.drawDropTargetHighlight(ctx, this.potentialDropTarget);
        }

        // Draw multi-selection handles (includes connectors)
        if ((this.selectedObjects.length > 0 || this.selectedConnectors.length > 0) && this.currentTool === 'select') {
            this.drawMultiSelectionHandles(ctx);
        }

        // Draw marquee selection rectangle
        this.drawMarquee(ctx);

        // Draw remote cursors
        this.drawRemoteCursors(ctx);
    }

    drawGrid(ctx) {
        ctx.strokeStyle = '#e5e5e5';
        ctx.lineWidth = 1;

        // Calculate visible area in canvas coordinates (accounting for pan and zoom)
        const viewportWidth = this.canvas.width / this.zoomLevel;
        const viewportHeight = this.canvas.height / this.zoomLevel;
        const visibleLeft = -this.panOffsetX;
        const visibleTop = -this.panOffsetY;
        const visibleRight = visibleLeft + viewportWidth;
        const visibleBottom = visibleTop + viewportHeight;

        // Clamp to canvas world bounds and align to grid
        const drawLeft = Math.max(0, Math.floor(visibleLeft / GRID_SIZE) * GRID_SIZE);
        const drawTop = Math.max(0, Math.floor(visibleTop / GRID_SIZE) * GRID_SIZE);
        const drawRight = Math.min(CANVAS_WORLD_WIDTH, Math.ceil(visibleRight / GRID_SIZE) * GRID_SIZE);
        const drawBottom = Math.min(CANVAS_WORLD_HEIGHT, Math.ceil(visibleBottom / GRID_SIZE) * GRID_SIZE);

        // Draw vertical lines
        for (let x = drawLeft; x <= drawRight; x += GRID_SIZE) {
            ctx.beginPath();
            ctx.moveTo(x, drawTop);
            ctx.lineTo(x, drawBottom);
            ctx.stroke();
        }

        // Draw horizontal lines
        for (let y = drawTop; y <= drawBottom; y += GRID_SIZE) {
            ctx.beginPath();
            ctx.moveTo(drawLeft, y);
            ctx.lineTo(drawRight, y);
            ctx.stroke();
        }
    }

    /**
     * @description Draw all elements (objects + connectors) in combined z-order
     * This ensures proper layering where connectors can appear above or below objects
     */
    drawAllElements(ctx) {
        // Combine objects and connectors with type markers
        const allElements = [
            ...this.objects.map(o => ({ element: o, isConnector: false })),
            ...this.connectors.map(c => ({ element: c, isConnector: true }))
        ];

        // Sort by zIndex (lowest first, so highest renders on top)
        allElements.sort((a, b) => (a.element.zIndex || 0) - (b.element.zIndex || 0));

        // Draw in sorted order
        for (const { element, isConnector } of allElements) {
            if (isConnector) {
                const isSelected = element === this.selectedConnector;
                this.drawConnector(ctx, element, false, isSelected);
            } else {
                this.drawSingleObject(ctx, element);
            }
        }
    }

    /**
     * @description Draw a single object based on its type (uses shared drawing utils)
     */
    drawSingleObject(ctx, obj) {
        // Use shared drawing utilities for all object types
        switch (obj.type) {
            case 'sticky':
                drawSticky(ctx, obj);
                break;
            case 'rectangle':
                drawRectangle(ctx, obj);
                break;
            case 'circle':
                drawCircle(ctx, obj);
                break;
            case 'record':
                drawRecord(ctx, obj, this.iconImages);
                break;
            case 'activity':
                drawActivity(ctx, obj, this.iconImages);
                break;
            case 'diamond':
                drawDiamond(ctx, obj);
                break;
            case 'triangle':
                drawTriangle(ctx, obj);
                break;
            case 'hexagon':
                drawHexagon(ctx, obj);
                break;
            case 'parallelogram':
                drawParallelogram(ctx, obj);
                break;
            case 'cylinder':
                drawCylinder(ctx, obj);
                break;
            case 'cloud':
                drawCloud(ctx, obj);
                break;
            case 'rounded_rectangle':
                drawRoundedRectangle(ctx, obj);
                break;
            case 'document':
                drawDocument(ctx, obj);
                break;
            case 'group':
                // Groups use shared util with isSelected flag
                drawGroupIndicator(ctx, obj, this.selectedObject === obj);
                break;
            default:
                break;
        }

        // Draw selection border (component-specific, not in shared utils)
        this.drawSelectionBorder(ctx, obj);
    }

    /**
     * @description Draw selection border around an object (component-specific)
     */
    drawSelectionBorder(ctx, obj) {
        if (obj !== this.selectedObject) return;
        if (obj.type === 'group') return; // Groups handle their own selection in shared util

        ctx.strokeStyle = '#0176d3';
        ctx.lineWidth = 2;

        if (obj.type === 'record') {
            // Rounded selection border for records
            const radius = 6;
            ctx.beginPath();
            ctx.moveTo(obj.x + radius, obj.y - 2);
            ctx.lineTo(obj.x + obj.width - radius, obj.y - 2);
            ctx.quadraticCurveTo(obj.x + obj.width + 2, obj.y - 2, obj.x + obj.width + 2, obj.y + radius);
            ctx.lineTo(obj.x + obj.width + 2, obj.y + obj.height - radius);
            ctx.quadraticCurveTo(obj.x + obj.width + 2, obj.y + obj.height + 2, obj.x + obj.width - radius, obj.y + obj.height + 2);
            ctx.lineTo(obj.x + radius, obj.y + obj.height + 2);
            ctx.quadraticCurveTo(obj.x - 2, obj.y + obj.height + 2, obj.x - 2, obj.y + obj.height - radius);
            ctx.lineTo(obj.x - 2, obj.y + radius);
            ctx.quadraticCurveTo(obj.x - 2, obj.y - 2, obj.x + radius, obj.y - 2);
            ctx.closePath();
            ctx.stroke();
        } else {
            // Standard rectangular selection border
            ctx.strokeRect(obj.x - 2, obj.y - 2, obj.width + 4, obj.height + 4);
        }
    }

    drawObjects(ctx) {
        // Sort by zIndex (lowest first, so highest renders on top)
        const sortedObjects = [...this.objects].sort((a, b) => (a.zIndex || 0) - (b.zIndex || 0));
        for (const obj of sortedObjects) {
            this.drawSingleObject(ctx, obj);
        }
    }

    // ========== Stroke Drawing (kept in component) ==========

    drawStrokes(ctx) {
        for (const stroke of this.strokes) {
            this.drawSingleStroke(ctx, stroke);
        }
    }

    drawSingleStroke(ctx, stroke) {
        if (stroke.points.length < 2) return;

        ctx.beginPath();
        ctx.strokeStyle = stroke.color;
        ctx.lineWidth = stroke.width || 3;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';

        ctx.moveTo(stroke.points[0].x, stroke.points[0].y);
        for (let i = 1; i < stroke.points.length; i++) {
            ctx.lineTo(stroke.points[i].x, stroke.points[i].y);
        }
        ctx.stroke();
    }

    /**
     * @description Draw a highlight overlay on a stroke (used by eraser hover)
     * @param {CanvasRenderingContext2D} ctx - Canvas context
     * @param {Object} stroke - Stroke to highlight
     * @param {string} color - Highlight color
     * @param {number} extraWidth - Extra width to add to stroke
     */
    drawStrokeHighlight(ctx, stroke, color = '#ff4444', extraWidth = 4) {
        if (!stroke || !stroke.points || stroke.points.length < 2) return;

        ctx.beginPath();
        ctx.strokeStyle = color;
        ctx.lineWidth = (stroke.width || 3) + extraWidth;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.globalAlpha = 0.5;

        ctx.moveTo(stroke.points[0].x, stroke.points[0].y);
        for (let i = 1; i < stroke.points.length; i++) {
            ctx.lineTo(stroke.points[i].x, stroke.points[i].y);
        }
        ctx.stroke();
        ctx.globalAlpha = 1.0;
    }

    /**
     * @description Draw a red overlay highlight on an object (used by eraser hover)
     * @param {CanvasRenderingContext2D} ctx - Canvas context
     * @param {Object} obj - Object to highlight
     */
    drawEraserObjectHighlight(ctx, obj) {
        if (!obj) return;

        ctx.save();
        ctx.globalAlpha = 0.3;
        ctx.fillStyle = '#ff4444';
        ctx.strokeStyle = '#ff0000';
        ctx.lineWidth = 3;

        const { x, y, width, height, type } = obj;

        switch (type) {
            case 'sticky':
            case 'rectangle':
            case 'record':
                ctx.fillRect(x, y, width, height);
                ctx.strokeRect(x, y, width, height);
                break;
            case 'circle':
                ctx.beginPath();
                ctx.ellipse(x + width / 2, y + height / 2, width / 2, height / 2, 0, 0, Math.PI * 2);
                ctx.fill();
                ctx.stroke();
                break;
            case 'diamond':
                ctx.beginPath();
                ctx.moveTo(x + width / 2, y);
                ctx.lineTo(x + width, y + height / 2);
                ctx.lineTo(x + width / 2, y + height);
                ctx.lineTo(x, y + height / 2);
                ctx.closePath();
                ctx.fill();
                ctx.stroke();
                break;
            case 'triangle':
                ctx.beginPath();
                ctx.moveTo(x + width / 2, y);
                ctx.lineTo(x + width, y + height);
                ctx.lineTo(x, y + height);
                ctx.closePath();
                ctx.fill();
                ctx.stroke();
                break;
            case 'hexagon':
                ctx.beginPath();
                const hx = x + width / 2;
                const hy = y + height / 2;
                const hr = Math.min(width, height) / 2;
                for (let i = 0; i < 6; i++) {
                    const angle = (Math.PI / 3) * i - Math.PI / 2;
                    const px = hx + hr * Math.cos(angle);
                    const py = hy + hr * Math.sin(angle);
                    if (i === 0) ctx.moveTo(px, py);
                    else ctx.lineTo(px, py);
                }
                ctx.closePath();
                ctx.fill();
                ctx.stroke();
                break;
            default:
                // Fallback: draw a rectangle around unknown shape types
                ctx.fillRect(x, y, width, height);
                ctx.strokeRect(x, y, width, height);
        }

        ctx.restore();
    }

    /**
     * @description Draw a red highlight on a connector (used by eraser hover)
     * @param {CanvasRenderingContext2D} ctx - Canvas context
     * @param {Object} connector - Connector to highlight
     */
    drawEraserConnectorHighlight(ctx, connector) {
        if (!connector) return;

        const start = this.resolveConnectorPoint(connector, 'start');
        const end = this.resolveConnectorPoint(connector, 'end');

        if (!start || !end) return;

        ctx.save();
        ctx.strokeStyle = '#ff0000';
        ctx.lineWidth = (connector.lineWidth || 2) + 4;
        ctx.globalAlpha = 0.6;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';

        ctx.beginPath();

        if (connector.connectorType === 'elbow' && connector.waypoints) {
            // Draw elbow connector
            ctx.moveTo(start.x, start.y);
            for (const wp of connector.waypoints) {
                ctx.lineTo(wp.x, wp.y);
            }
            ctx.lineTo(end.x, end.y);
        } else if (connector.connectorType === 'curved' && connector.controlPoint1 && connector.controlPoint2) {
            // Draw curved connector
            ctx.moveTo(start.x, start.y);
            ctx.bezierCurveTo(
                connector.controlPoint1.x, connector.controlPoint1.y,
                connector.controlPoint2.x, connector.controlPoint2.y,
                end.x, end.y
            );
        } else {
            // Draw straight connector
            ctx.moveTo(start.x, start.y);
            ctx.lineTo(end.x, end.y);
        }

        ctx.stroke();
        ctx.restore();
    }

    /**
     * @description Draw highlight on potential drop target during endpoint drag
     * @param {CanvasRenderingContext2D} ctx - Canvas context
     * @param {Object} obj - Object to highlight
     */
    drawDropTargetHighlight(ctx, obj) {
        if (!obj) return;

        ctx.save();
        ctx.strokeStyle = '#2ecc71'; // Green highlight
        ctx.lineWidth = 3;
        ctx.setLineDash([5, 3]);

        // Draw highlight border around the object
        ctx.strokeRect(
            obj.x - 4,
            obj.y - 4,
            obj.width + 8,
            obj.height + 8
        );

        ctx.restore();
    }

    drawRemoteCursors(ctx) {
        for (const cursor of Object.values(this.remoteCursors)) {
            // Cursor dot
            ctx.beginPath();
            ctx.arc(cursor.x, cursor.y, 6, 0, Math.PI * 2);
            ctx.fillStyle = cursor.color;
            ctx.fill();
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 2;
            ctx.stroke();

            // Name label
            ctx.fillStyle = cursor.color;
            ctx.font = 'bold 12px sans-serif';
            ctx.fillText(cursor.name || 'User', cursor.x + 12, cursor.y + 4);
        }
    }

    // ========== Connector Drawing ==========

    drawConnectors(ctx) {
        // Sort connectors by zIndex (lowest first, so highest renders on top)
        const sortedConnectors = [...this.connectors].sort((a, b) => (a.zIndex || 0) - (b.zIndex || 0));
        for (const connector of sortedConnectors) {
            const isSelected = connector === this.selectedConnector;
            this.drawConnector(ctx, connector, false, isSelected);
        }
    }

    drawConnector(ctx, connector, isPreview = false, isSelected = false) {
        // Resolve start and end points (handle anchored vs free-floating)
        const start = this.resolveConnectorPoint(connector, 'start');
        const end = this.resolveConnectorPoint(connector, 'end');

        if (!start || !end) return;

        // Line style
        ctx.strokeStyle = isSelected ? '#0176d3' : (connector.color || '#333333');
        ctx.lineWidth = isSelected ? 3 : (connector.lineWidth || 2);

        if (isPreview) {
            ctx.setLineDash([5, 5]);
        } else {
            ctx.setLineDash([]);
        }

        // Draw based on connector type
        if (connector.connectorType === 'elbow') {
            this.drawElbowConnector(ctx, connector, start, end, isPreview);
        } else if (connector.connectorType === 'curved') {
            this.drawCurvedConnector(ctx, connector, start, end, isPreview);
        } else {
            // Straight line (arrow, line, bidirectional)
            ctx.beginPath();
            ctx.moveTo(start.x, start.y);
            ctx.lineTo(end.x, end.y);
            ctx.stroke();
        }
        ctx.setLineDash([]);

        // Draw arrowhead(s)
        const color = isSelected ? '#0176d3' : (connector.color || '#333333');
        if (connector.connectorType === 'arrow' || connector.connectorType === 'elbow' || connector.connectorType === 'curved') {
            // For elbow, calculate angle from last segment
            if (connector.connectorType === 'elbow' && connector.waypoints && connector.waypoints.length > 0) {
                const lastWaypoint = connector.waypoints[connector.waypoints.length - 1];
                drawArrowhead(ctx, lastWaypoint, end, color);
            } else if (connector.connectorType === 'curved' && connector.controlPoint2) {
                // For curved, use control point 2 as direction reference
                drawArrowhead(ctx, connector.controlPoint2, end, color);
            } else {
                drawArrowhead(ctx, start, end, color);
            }
        }
        if (connector.connectorType === 'bidirectional') {
            drawArrowhead(ctx, start, end, color);
            drawArrowhead(ctx, end, start, color);
        }

        // Draw connector label if present
        if (connector.label && !isPreview) {
            drawConnectorLabel(ctx, connector, start, end);
        }

        // Draw selection handles when selected
        if (isSelected) {
            this.drawConnectorHandles(ctx, connector, start, end);
            // Draw control point handles for advanced connectors
            if (connector.connectorType === 'curved') {
                this.drawCurveControlPoints(ctx, connector, start, end);
            } else if (connector.connectorType === 'elbow' && connector.waypoints) {
                this.drawElbowWaypoints(ctx, connector);
            }
        }
    }

    /**
     * @description Draw elbow (orthogonal) connector with waypoints
     */
    drawElbowConnector(ctx, connector, start, end, isPreview) {
        const waypoints = connector.waypoints || [];

        ctx.beginPath();
        ctx.moveTo(start.x, start.y);

        // Draw through waypoints
        for (const wp of waypoints) {
            ctx.lineTo(wp.x, wp.y);
        }

        // Draw to end
        ctx.lineTo(end.x, end.y);
        ctx.stroke();
    }

    /**
     * @description Draw curved (bezier) connector
     */
    drawCurvedConnector(ctx, connector, start, end, isPreview) {
        const cp1 = connector.controlPoint1 || { x: start.x + (end.x - start.x) * 0.25, y: start.y };
        const cp2 = connector.controlPoint2 || { x: end.x - (end.x - start.x) * 0.25, y: end.y };

        ctx.beginPath();
        ctx.moveTo(start.x, start.y);
        ctx.bezierCurveTo(cp1.x, cp1.y, cp2.x, cp2.y, end.x, end.y);
        ctx.stroke();
    }

    /**
     * @description Draw bezier control point handles when curved connector is selected
     */
    drawCurveControlPoints(ctx, connector, start, end) {
        const cp1 = connector.controlPoint1;
        const cp2 = connector.controlPoint2;

        if (!cp1 || !cp2) return;

        // Draw control lines (dashed)
        ctx.save();
        ctx.setLineDash([4, 4]);
        ctx.strokeStyle = '#0176d3';
        ctx.lineWidth = 1;

        // Line from start to cp1
        ctx.beginPath();
        ctx.moveTo(start.x, start.y);
        ctx.lineTo(cp1.x, cp1.y);
        ctx.stroke();

        // Line from end to cp2
        ctx.beginPath();
        ctx.moveTo(end.x, end.y);
        ctx.lineTo(cp2.x, cp2.y);
        ctx.stroke();

        ctx.setLineDash([]);
        ctx.restore();

        // Draw control point handles (circles)
        [cp1, cp2].forEach(cp => {
            ctx.beginPath();
            ctx.arc(cp.x, cp.y, CONTROL_POINT_RADIUS, 0, Math.PI * 2);
            ctx.fillStyle = '#ffffff';
            ctx.fill();
            ctx.strokeStyle = '#0176d3';
            ctx.lineWidth = 2;
            ctx.stroke();
        });
    }

    /**
     * @description Draw elbow waypoint handles when selected
     */
    drawElbowWaypoints(ctx, connector) {
        const waypoints = connector.waypoints || [];

        for (const wp of waypoints) {
            ctx.beginPath();
            ctx.rect(wp.x - 4, wp.y - 4, 8, 8);
            ctx.fillStyle = '#ffffff';
            ctx.fill();
            ctx.strokeStyle = '#0176d3';
            ctx.lineWidth = 2;
            ctx.stroke();
        }
    }

    drawArrowhead(ctx, from, to, color) {
        const angle = Math.atan2(to.y - from.y, to.x - from.x);

        ctx.beginPath();
        ctx.fillStyle = color || '#333333';
        ctx.moveTo(to.x, to.y);
        ctx.lineTo(
            to.x - ARROWHEAD_SIZE * Math.cos(angle - Math.PI / 6),
            to.y - ARROWHEAD_SIZE * Math.sin(angle - Math.PI / 6)
        );
        ctx.lineTo(
            to.x - ARROWHEAD_SIZE * Math.cos(angle + Math.PI / 6),
            to.y - ARROWHEAD_SIZE * Math.sin(angle + Math.PI / 6)
        );
        ctx.closePath();
        ctx.fill();
    }

    /**
     * @description Draw connector endpoint handles (filled=attached, hollow=floating)
     * @param {CanvasRenderingContext2D} ctx - Canvas context
     * @param {Object} connector - The connector
     * @param {Object} start - Start position {x, y}
     * @param {Object} end - End position {x, y}
     */
    drawConnectorHandles(ctx, connector, start, end) {
        const handleRadius = 8; // Slightly larger for easier clicking

        // Check attachment status
        const startAttached = connector.startAnchor && connector.startAnchor.objectId;
        const endAttached = connector.endAnchor && connector.endAnchor.objectId;

        // Start handle - filled if attached, hollow if floating
        ctx.beginPath();
        ctx.arc(start.x, start.y, handleRadius, 0, Math.PI * 2);
        if (startAttached) {
            // Attached: filled blue circle
            ctx.fillStyle = '#0176d3';
            ctx.fill();
        } else {
            // Floating: hollow circle (white fill with blue border)
            ctx.fillStyle = '#ffffff';
            ctx.fill();
        }
        ctx.strokeStyle = '#0176d3';
        ctx.lineWidth = 2;
        ctx.stroke();

        // End handle - filled if attached, hollow if floating
        ctx.beginPath();
        ctx.arc(end.x, end.y, handleRadius, 0, Math.PI * 2);
        if (endAttached) {
            // Attached: filled blue circle
            ctx.fillStyle = '#0176d3';
            ctx.fill();
        } else {
            // Floating: hollow circle (white fill with blue border)
            ctx.fillStyle = '#ffffff';
            ctx.fill();
        }
        ctx.strokeStyle = '#0176d3';
        ctx.lineWidth = 2;
        ctx.stroke();
    }

    resolveConnectorPoint(connector, pointType) {
        const anchor = pointType === 'start' ? connector.startAnchor : connector.endAnchor;
        const x = pointType === 'start' ? connector.startX : connector.endX;
        const y = pointType === 'start' ? connector.startY : connector.endY;

        // If anchored to an object, calculate position from that object
        if (anchor && anchor.objectId) {
            const obj = this.objects.find(o => o.id === anchor.objectId);
            if (obj) {
                return getAnchorPoint(obj, anchor.position);
            }
        }

        // Return absolute position
        return { x, y };
    }

    // getAnchorPoint() moved to collab_canvasDrawingUtils

    drawAnchorPoints(ctx) {
        // Only show anchor points when connector tool is active
        for (const obj of this.objects) {
            const anchors = this.getAllAnchorPoints(obj);
            for (const anchor of Object.values(anchors)) {
                // Highlight if this is the nearest anchor during connection
                const isNearest = this.nearestAnchor &&
                    this.nearestAnchor.objectId === obj.id &&
                    this.nearestAnchor.x === anchor.x &&
                    this.nearestAnchor.y === anchor.y;

                ctx.beginPath();
                ctx.arc(anchor.x, anchor.y, isNearest ? 6 : 4, 0, Math.PI * 2);
                ctx.fillStyle = isNearest ? '#0176d3' : 'rgba(1, 118, 211, 0.3)';
                ctx.fill();

                if (isNearest) {
                    ctx.strokeStyle = '#0176d3';
                    ctx.lineWidth = 2;
                    ctx.stroke();
                }
            }
        }
    }

    getAllAnchorPoints(obj) {
        return {
            top: getAnchorPoint(obj, 'top'),
            bottom: getAnchorPoint(obj, 'bottom'),
            left: getAnchorPoint(obj, 'left'),
            right: getAnchorPoint(obj, 'right')
        };
    }

    findNearestAnchor(x, y) {
        let nearest = null;
        let minDistance = SNAP_RADIUS;

        for (const obj of this.objects) {
            const anchors = this.getAllAnchorPoints(obj);
            for (const [position, point] of Object.entries(anchors)) {
                const distance = Math.sqrt((x - point.x) ** 2 + (y - point.y) ** 2);
                if (distance < minDistance) {
                    minDistance = distance;
                    nearest = {
                        objectId: obj.id,
                        position: position,
                        x: point.x,
                        y: point.y
                    };
                }
            }
        }

        return nearest;
    }

    // ========== Resize Handles ==========

    /**
     * @description Get positions of all 8 resize handles for an object
     */
    getResizeHandles(obj) {
        const half = HANDLE_SIZE / 2;
        return {
            nw: { x: obj.x - half, y: obj.y - half, cursor: 'nwse-resize' },
            n:  { x: obj.x + obj.width / 2 - half, y: obj.y - half, cursor: 'ns-resize' },
            ne: { x: obj.x + obj.width - half, y: obj.y - half, cursor: 'nesw-resize' },
            e:  { x: obj.x + obj.width - half, y: obj.y + obj.height / 2 - half, cursor: 'ew-resize' },
            se: { x: obj.x + obj.width - half, y: obj.y + obj.height - half, cursor: 'nwse-resize' },
            s:  { x: obj.x + obj.width / 2 - half, y: obj.y + obj.height - half, cursor: 'ns-resize' },
            sw: { x: obj.x - half, y: obj.y + obj.height - half, cursor: 'nesw-resize' },
            w:  { x: obj.x - half, y: obj.y + obj.height / 2 - half, cursor: 'ew-resize' }
        };
    }

    /**
     * @description Draw resize handles for the selected object
     */
    drawResizeHandles(ctx, obj) {
        // Don't show handles for connectors
        if (obj.type === 'connector') return;

        const handles = this.getResizeHandles(obj);

        ctx.fillStyle = '#ffffff';
        ctx.strokeStyle = '#0176d3';
        ctx.lineWidth = 1.5;

        for (const handle of Object.values(handles)) {
            ctx.fillRect(handle.x, handle.y, HANDLE_SIZE, HANDLE_SIZE);
            ctx.strokeRect(handle.x, handle.y, HANDLE_SIZE, HANDLE_SIZE);
        }
    }

    /**
     * @description Check if a point is on a resize handle, return handle position or null
     */
    getHandleAtPoint(x, y, obj) {
        if (!obj || obj.type === 'connector') return null;

        const handles = this.getResizeHandles(obj);

        for (const [position, handle] of Object.entries(handles)) {
            if (x >= handle.x - HANDLE_TOLERANCE &&
                x <= handle.x + HANDLE_SIZE + HANDLE_TOLERANCE &&
                y >= handle.y - HANDLE_TOLERANCE &&
                y <= handle.y + HANDLE_SIZE + HANDLE_TOLERANCE) {
                return position;
            }
        }
        return null;
    }

    /**
     * @description Get the cursor style for a resize handle position
     */
    getHandleCursor(handlePosition) {
        const cursorMap = {
            nw: 'nwse-resize',
            n: 'ns-resize',
            ne: 'nesw-resize',
            e: 'ew-resize',
            se: 'nwse-resize',
            s: 'ns-resize',
            sw: 'nesw-resize',
            w: 'ew-resize'
        };
        return cursorMap[handlePosition] || 'default';
    }

    /**
     * @description Get minimum size for an element type
     */
    getMinSize(type) {
        return MIN_SIZES[type] || { width: 40, height: 40 };
    }

    /**
     * @description Snap value to grid (20px)
     */
    snapToGrid(value) {
        return Math.round(value / GRID_SIZE) * GRID_SIZE;
    }

    /**
     * @description Draw dimension tooltip during resize
     */
    drawDimensionTooltip(ctx, obj) {
        if (!this.isResizing || !obj) return;

        const text = `${Math.round(obj.width)} × ${Math.round(obj.height)}`;
        const padding = 4;

        ctx.font = '11px sans-serif';
        const textWidth = ctx.measureText(text).width;

        // Position below the object
        const tooltipX = obj.x + obj.width / 2 - textWidth / 2 - padding;
        const tooltipY = obj.y + obj.height + 12;

        // Background
        ctx.fillStyle = 'rgba(0, 0, 0, 0.75)';
        ctx.fillRect(tooltipX, tooltipY, textWidth + padding * 2, 18);

        // Text
        ctx.fillStyle = '#ffffff';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(text, tooltipX + padding, tooltipY + 9);
    }

    // ========== Mouse Events ==========

    handleMouseMove(event) {
        const rect = this.canvas.getBoundingClientRect();
        const rawX = event.clientX - rect.left;
        const rawY = event.clientY - rect.top;
        // Convert to screen coordinates (account for zoom)
        const screenX = rawX / this.zoomLevel;
        const screenY = rawY / this.zoomLevel;

        // Handle panning
        if (this.isPanning) {
            const dx = screenX - this.panStartX;
            const dy = screenY - this.panStartY;
            this.panOffsetX += dx;
            this.panOffsetY += dy;
            this.clampPanOffset(); // Enforce canvas bounds
            this.panStartX = screenX;
            this.panStartY = screenY;
            return; // Don't process other interactions while panning
        }

        // Convert screen to canvas coordinates (accounting for pan offset)
        const x = screenX - this.panOffsetX;
        const y = screenY - this.panOffsetY;

        this.localCursor = { x, y };
        this.sendCursorUpdate(x, y);

        // Handle resizing
        if (this.isResizing && this.selectedObject && this.activeResizeHandle) {
            this.performResize(x, y, event.shiftKey, event.altKey);
            return; // Don't process other interactions while resizing
        }

        // Handle control point dragging (curved/elbow connectors)
        if (this.isDraggingControlPoint && this.selectedConnector && this.activeControlPoint) {
            this.performControlPointDrag(x, y);
            return; // Don't process other interactions while dragging control points
        }

        // Handle connector endpoint dragging
        if (this.isDraggingEndpoint && this.draggingConnector) {
            this.performEndpointDrag(x, y);
            return; // Don't process other interactions while dragging endpoint
        }

        // Handle connector label dragging
        if (this.isDraggingLabel && this.draggingLabelConnector) {
            this.performLabelDrag(x, y);
            return; // Don't process other interactions while dragging label
        }

        // Handle marquee selection
        if (this.isMarqueeSelecting) {
            this.marqueeEnd = { x, y };
            return; // Don't process other interactions while marquee selecting
        }

        // Handle multi-selection drag
        if (this.isDraggingMultiple && this.selectedObjects.length > 1) {
            const dx = x - this.lastDragPosition.x;
            const dy = y - this.lastDragPosition.y;

            // Move all selected objects by the same delta
            for (const obj of this.selectedObjects) {
                obj.x += dx;
                obj.y += dy;

                // If it's a group, also move all children
                if (obj.type === 'group') {
                    this.moveGroupChildren(obj, dx, dy);
                }
            }

            this.lastDragPosition = { x, y };
            return; // Don't process other interactions while multi-dragging
        }

        // Handle object dragging (including groups)
        if (this.isDragging && this.selectedObject) {
            const newX = x - this.dragOffset.x;
            const newY = y - this.dragOffset.y;
            const dx = newX - this.selectedObject.x;
            const dy = newY - this.selectedObject.y;

            // Move the selected object
            this.selectedObject.x = newX;
            this.selectedObject.y = newY;

            // If it's a group, also move all children
            if (this.selectedObject.type === 'group') {
                this.moveGroupChildren(this.selectedObject, dx, dy);
            }
        }

        // Handle freehand drawing
        if (this.isDrawing && this.currentStroke) {
            this.currentStroke.points.push({ x, y });
        }

        // Handle connector drawing
        if (this.isConnecting && this.currentConnector) {
            // Find nearest anchor point for snapping
            const nearestAnchor = this.findNearestAnchor(x, y);
            this.nearestAnchor = nearestAnchor;

            if (nearestAnchor) {
                this.currentConnector.endX = nearestAnchor.x;
                this.currentConnector.endY = nearestAnchor.y;
                this.currentConnector.endAnchor = {
                    objectId: nearestAnchor.objectId,
                    position: nearestAnchor.position
                };
            } else {
                this.currentConnector.endX = x;
                this.currentConnector.endY = y;
                this.currentConnector.endAnchor = null;
            }
        }

        // Update nearest anchor for connector tool (hover feedback)
        if (this.currentTool === 'connector' && !this.isConnecting) {
            this.nearestAnchor = this.findNearestAnchor(x, y);
        }

        // Update cursor based on handle hover (select tool only)
        if (this.currentTool === 'select' && this.selectedObject && !this.isDragging) {
            const handle = this.getHandleAtPoint(x, y, this.selectedObject);
            if (handle !== this.hoveredHandle) {
                this.hoveredHandle = handle;
                if (handle) {
                    this.canvas.style.cursor = this.getHandleCursor(handle);
                } else if (this.isPointInObject(x, y, this.selectedObject)) {
                    this.canvas.style.cursor = 'move';
                } else {
                    this.canvas.style.cursor = 'default';
                }
            }
        } else if (!this.isResizing) {
            // Reset cursor if not in select mode or no selected object
            if (this.canvas.style.cursor !== 'default' && this.canvas.style.cursor !== 'crosshair') {
                this.canvas.style.cursor = this.currentTool === 'draw' ? 'crosshair' : 'default';
            }
        }

        // Eraser tool - detect element under cursor for hover highlight
        if (this.currentTool === 'eraser') {
            // Check strokes first
            const stroke = this.findStrokeAtPoint(x, y);
            this.hoveredStroke = stroke;

            // Check objects if no stroke found
            if (!stroke) {
                this.hoveredObject = this.findObjectAt(x, y);
            } else {
                this.hoveredObject = null;
            }

            // Check connectors if no stroke or object found
            if (!stroke && !this.hoveredObject) {
                this.hoveredConnector = this.findConnectorAt(x, y);
            } else {
                this.hoveredConnector = null;
            }

            // Update cursor based on what's hovered
            const hasHoveredElement = stroke || this.hoveredObject || this.hoveredConnector;
            this.canvas.style.cursor = hasHoveredElement ? 'pointer' : 'crosshair';
        } else {
            // Clear hovered elements when not using eraser
            this.hoveredStroke = null;
            this.hoveredObject = null;
            this.hoveredConnector = null;
        }
    }

    handleMouseDown(event) {
        // Close all dropdowns when clicking on canvas
        this.closeAllDropdowns();

        const rect = this.canvas.getBoundingClientRect();
        const screenX = (event.clientX - rect.left) / this.zoomLevel;
        const screenY = (event.clientY - rect.top) / this.zoomLevel;

        // Pan tool - start panning
        if (this.currentTool === 'pan') {
            this.isPanning = true;
            this.panStartX = screenX;
            this.panStartY = screenY;
            this.canvas.style.cursor = 'grabbing';
            return;
        }

        // Shift+click for temporary pan (works with any tool except when editing text)
        if (event.shiftKey && !this.isEditingText && this.currentTool !== 'draw') {
            this.isShiftPanning = true;
            this.isPanning = true;
            this.panStartX = screenX;
            this.panStartY = screenY;
            this.canvas.style.cursor = 'grabbing';
            return;
        }

        // Convert screen coordinates to canvas coordinates (accounting for pan offset)
        const x = screenX - this.panOffsetX;
        const y = screenY - this.panOffsetY;

        // Eraser tool - delete element on click
        if (this.currentTool === 'eraser') {
            // Try to delete stroke first
            if (this.hoveredStroke) {
                this.deleteStroke(this.hoveredStroke);
                return;
            }

            // Try to delete object
            if (this.hoveredObject) {
                this.deleteObjectWithEraser(this.hoveredObject);
                return;
            }

            // Try to delete connector
            if (this.hoveredConnector) {
                this.deleteConnectorWithEraser(this.hoveredConnector);
                return;
            }
            return;
        }

        if (this.currentTool === 'draw') {
            this.startDrawing(x, y);
        } else if (this.currentTool === 'connector') {
            this.startConnector(x, y);
        } else {
            // Check if clicking on a connector endpoint handle FIRST
            if (this.selectedConnector && this.currentTool === 'select') {
                const endpoint = this.getClickedEndpoint(this.selectedConnector, x, y);
                if (endpoint) {
                    this.startEndpointDrag(endpoint);
                    return;
                }
            }
            // Check if clicking on a control point (curved/elbow connectors)
            if (this.selectedConnector && this.currentTool === 'select') {
                const controlPoint = this.getControlPointAtPosition(x, y, this.selectedConnector);
                if (controlPoint) {
                    this.startControlPointDrag(controlPoint, x, y);
                    return;
                }
            }
            // Check if clicking on a resize handle (before checking for object selection)
            if (this.selectedObject && this.currentTool === 'select') {
                const handle = this.getHandleAtPoint(x, y, this.selectedObject);
                if (handle) {
                    this.startResize(handle, x, y);
                    return;
                }
            }
            this.handleSelection(x, y, event);
        }
    }

    handleMouseUp() {
        // Stop panning
        if (this.isPanning) {
            this.isPanning = false;
            // Restore cursor based on tool or shift-pan state
            if (this.isShiftPanning) {
                this.isShiftPanning = false;
                this.updateCursorForTool();
            } else if (this.currentTool === 'pan') {
                this.canvas.style.cursor = 'grab';
            } else {
                this.updateCursorForTool();
            }
            return;
        }

        if (this.isDragging && this.selectedObject) {
            // Record move if position changed
            if (this.dragStartState &&
                (this.dragStartState.x !== this.selectedObject.x ||
                 this.dragStartState.y !== this.selectedObject.y)) {
                this.recordAction('object_move', {
                    objectId: this.selectedObject.id,
                    previousX: this.dragStartState.x,
                    previousY: this.dragStartState.y
                });
            }
            this.dragStartState = null;

            // Publish move for the selected object
            this.publishObjectMove(this.selectedObject);

            // If it's a group, also publish moves for all children
            if (this.selectedObject.type === 'group') {
                for (const childId of (this.selectedObject.children || [])) {
                    const child = this.objects.find(o => o.id === childId);
                    if (child) {
                        this.publishObjectMove(child);
                    }
                }
            }
        }
        this.isDragging = false;

        // Finish multi-selection drag and publish moves
        if (this.isDraggingMultiple && this.selectedObjects.length > 0) {
            for (const obj of this.selectedObjects) {
                this.publishObjectMove(obj);

                // If it's a group, also publish moves for all children
                if (obj.type === 'group') {
                    for (const childId of (obj.children || [])) {
                        const child = this.objects.find(o => o.id === childId);
                        if (child) {
                            this.publishObjectMove(child);
                        }
                    }
                }
            }
        }
        this.isDraggingMultiple = false;

        if (this.isDrawing && this.currentStroke) {
            this.finishDrawing();
        }

        if (this.isConnecting && this.currentConnector) {
            this.finishConnector();
        }

        if (this.isResizing && this.selectedObject) {
            this.finishResize();
        }

        if (this.isDraggingControlPoint && this.selectedConnector) {
            this.finishControlPointDrag();
        }

        // Finish endpoint drag
        if (this.isDraggingEndpoint && this.draggingConnector) {
            this.finishEndpointDrag();
        }

        // Finish label drag
        if (this.isDraggingLabel && this.draggingLabelConnector) {
            this.finishLabelDrag();
        }

        // Finish marquee selection
        if (this.isMarqueeSelecting) {
            this.finishMarqueeSelection();
        }
    }

    handleMouseLeave() {
        this.handleMouseUp();
    }

    // ========== Double-Click (Text Editing) ==========

    handleDoubleClick(event) {
        const rect = this.canvas.getBoundingClientRect();
        const x = (event.clientX - rect.left) / this.zoomLevel - this.panOffsetX;
        const y = (event.clientY - rect.top) / this.zoomLevel - this.panOffsetY;

        // Find object at click position - search from highest zIndex to lowest
        const sortedByZ = [...this.objects].sort((a, b) => (b.zIndex || 0) - (a.zIndex || 0));
        for (const obj of sortedByZ) {
            if (this.isPointInObject(x, y, obj)) {
                if (obj.type === 'sticky') {
                    this.startTextEditing(obj);
                    return;
                }
                // Handle shape text editing
                if (this.isShapeType(obj.type)) {
                    this.startShapeTextEditing(obj);
                    return;
                }
                // Note: Record navigation removed from launcher - use Preview for navigation
            }
        }

        // Check for connector double-click (label editing)
        const connector = this.findConnectorAt(x, y);
        if (connector) {
            this.startConnectorLabelEditing(connector);
            return;
        }
    }

    // Start editing a connector label
    startConnectorLabelEditing(connector) {
        console.log(DEBUG_PREFIX, 'Starting connector label edit for:', connector.id);
        this.editingConnectorLabel = connector;
        this.editingText = connector.label || '';
        this.isEditingText = true;

        // Focus the textarea after render
        // eslint-disable-next-line @lwc/lwc/no-async-operation
        setTimeout(() => {
            const textarea = this.refs.textEditor;
            if (textarea) {
                // Explicitly set value to ensure text is pre-loaded
                textarea.value = this.editingText;
                textarea.focus();
                textarea.select();
            }
        }, 50);
    }

    // Check if object type is a shape that supports text
    isShapeType(type) {
        const shapeTypes = [
            'rectangle', 'circle', 'triangle', 'diamond',
            'hexagon', 'parallelogram', 'cylinder', 'cloud',
            'roundedRectangle', 'document'
        ];
        return shapeTypes.includes(type);
    }

    // Start text editing for shapes
    startShapeTextEditing(obj) {
        console.log(DEBUG_PREFIX, 'Starting shape text edit for:', obj.id);
        this.editingObject = obj;
        this.editingText = obj.text || '';
        this.previousTextValue = obj.text || ''; // Capture for undo
        this.isEditingText = true;

        // Focus the textarea after render
        // eslint-disable-next-line @lwc/lwc/no-async-operation
        setTimeout(() => {
            const textarea = this.refs.textEditor;
            if (textarea) {
                // Explicitly set value to ensure text is pre-loaded
                textarea.value = this.editingText;
                textarea.focus();
                textarea.select();
            }
        }, 50);
    }

    navigateToRecord(recordId, objectApiName) {
        console.log(DEBUG_PREFIX, 'Navigating to record:', recordId, objectApiName);
        this[NavigationMixin.Navigate]({
            type: 'standard__recordPage',
            attributes: {
                recordId: recordId,
                objectApiName: objectApiName,
                actionName: 'view'
            }
        });
    }

    startTextEditing(obj) {
        console.log(DEBUG_PREFIX, 'Starting text edit for object:', obj.id);
        this.editingObject = obj;
        this.editingText = obj.text === 'Double-click to edit' ? '' : obj.text;
        this.previousTextValue = obj.text; // Capture for undo
        this.isEditingText = true;

        // Focus the textarea after render
        // eslint-disable-next-line @lwc/lwc/no-async-operation
        setTimeout(() => {
            const textarea = this.refs.textEditor;
            if (textarea) {
                // Explicitly set value to ensure text is pre-loaded
                textarea.value = this.editingText;
                textarea.focus();
                textarea.select();
            }
        }, 50);
    }

    handleTextEditorBlur() {
        this.finishTextEditing();
    }

    handleTextEditorKeydown(event) {
        // Escape to cancel
        if (event.key === 'Escape') {
            this.cancelTextEditing();
            return;
        }
        // Enter (without shift) to confirm
        if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            this.finishTextEditing();
        }
    }

    finishTextEditing() {
        // Handle connector label editing
        if (this.editingConnectorLabel) {
            const newText = this.refs.textEditor?.value || this.editingText;
            const trimmedText = newText.trim();

            // Update connector label (empty text removes the label)
            this.editingConnectorLabel.label = trimmedText || '';
            // Set default position if not set
            if (trimmedText && this.editingConnectorLabel.labelPosition === undefined) {
                this.editingConnectorLabel.labelPosition = 0.5;
            }

            // Publish connector update
            this.publishConnectorUpdate(this.editingConnectorLabel);

            // Reset state
            this.isEditingText = false;
            this.editingConnectorLabel = null;
            this.editingText = '';

            console.log(DEBUG_PREFIX, 'Connector label editing finished');
            return;
        }

        if (!this.editingObject) return;

        const newText = this.refs.textEditor?.value || this.editingText;
        const trimmedText = newText.trim();
        const previousText = this.previousTextValue;

        // Update object text - shapes can have empty text, sticky notes get default
        if (this.editingObject.type === 'sticky') {
            this.editingObject.text = trimmedText || 'Double-click to edit';
        } else {
            // Shapes can have empty text (no default placeholder)
            this.editingObject.text = trimmedText;
            // Auto-calculate contrast color for shapes
            if (trimmedText && !this.editingObject.textColor) {
                this.editingObject.textColor = getContrastColor(this.editingObject.color || '#E8E8E8');
            }
        }

        // Record text change for undo if text changed
        if (this.editingObject.text !== previousText) {
            this.recordAction('object_text', {
                objectId: this.editingObject.id,
                previousText: previousText
            });
        }

        // Publish text update
        this.publishObjectUpdate(this.editingObject);

        // Reset state
        this.isEditingText = false;
        this.editingObject = null;
        this.editingText = '';
        this.previousTextValue = '';

        console.log(DEBUG_PREFIX, 'Text editing finished');
    }

    cancelTextEditing() {
        this.isEditingText = false;
        this.editingObject = null;
        this.editingConnectorLabel = null;        this.editingText = '';
        console.log(DEBUG_PREFIX, 'Text editing cancelled');
    }

    async publishObjectUpdate(obj) {
        try {
            await publishEvent({
                canvasId: this.canvasId,
                eventType: 'object_move', // Reuse move event for updates
                payload: JSON.stringify(obj)
            });
        } catch (error) {
            console.error(DEBUG_PREFIX, 'Failed to publish object update:', error);
        }
    }

    // ========== Zoom Controls ==========

    handleZoomIn() {
        this.setZoom(this.zoomLevel + ZOOM_STEP);
    }

    handleZoomOut() {
        this.setZoom(this.zoomLevel - ZOOM_STEP);
    }

    handleFitToContent() {
        // Use shared calculateFitToContent utility
        if (!this.canvas) return;

        const result = calculateFitToContent(
            this.objects,
            this.strokes,
            this.connectors,
            this.canvas.width,
            this.canvas.height,
            {
                padding: 50,
                minZoom: MIN_ZOOM,
                maxZoom: MAX_ZOOM,
                resolveConnectorPoint: (connector, pointType) => this.resolveConnectorPoint(connector, pointType)
            }
        );

        // Apply the calculated zoom and pan
        this.zoomLevel = result.zoomLevel;
        this.panOffsetX = result.panOffsetX;
        this.panOffsetY = result.panOffsetY;

        // Clamp pan to canvas bounds
        this.clampPanOffset();

        // Redraw with new view
        this.draw();

        console.log(DEBUG_PREFIX, 'Fit to content:', result);
    }

    // getContentBounds() removed - now using shared calculateFitToContent

    setZoom(newZoom) {
        const oldZoom = this.zoomLevel;
        this.zoomLevel = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, newZoom));
        // Round to nearest 10% for clean display
        this.zoomLevel = Math.round(this.zoomLevel * 10) / 10;
        // Re-clamp pan offset since viewport size changed
        this.clampPanOffset();
        console.log(DEBUG_PREFIX, 'Zoom changed from', oldZoom, 'to', this.zoomLevel);
        // Redraw happens automatically in render loop
    }

    // ========== Tool Handlers ==========

    handleSelectTool() {
        this.currentTool = 'select';
    }

    handlePanTool() {
        this.currentTool = 'pan';
        this.selectedObject = null;
        this.selectedConnector = null;
        this.selectedObjects = [];
        this.selectedConnectors = [];    }

    handleDrawTool() {
        this.currentTool = 'draw';
        this.selectedObject = null;
        this.selectedConnector = null;
        this.selectedObjects = [];
        this.selectedConnectors = [];    }

    handleEraserTool() {
        this.currentTool = 'eraser';
        this.selectedObject = null;
        this.selectedConnector = null;
        this.selectedObjects = [];
        this.selectedConnectors = [];        this.hoveredStroke = null;
        this.hoveredObject = null;
        this.hoveredConnector = null;
    }

    handleSelection(x, y, event = null) {
        // Check for Ctrl/Cmd key for multi-select toggle
        const isCtrlClick = event && (event.ctrlKey || event.metaKey);

        // First, check if clicking on a connector label (for dragging)
        const labelConnector = this.findConnectorLabelAt(x, y);
        if (labelConnector) {
            this.isDraggingLabel = true;
            this.draggingLabelConnector = labelConnector;
            this.selectedConnector = labelConnector;
            this.selectedObject = null;
            this.selectedObjects = [];
            this.selectedConnectors = [];            return;
        }

        // Then, check if clicking on an object (search from highest zIndex to lowest)
        let foundObject = null;
        const sortedByZ = [...this.objects].sort((a, b) => (b.zIndex || 0) - (a.zIndex || 0));
        for (const obj of sortedByZ) {
            if (this.isPointInObject(x, y, obj)) {
                foundObject = obj;
                break;
            }
        }

        // Then, check if clicking on a connector
        let foundConnector = null;
        if (!foundObject) {
            for (let i = this.connectors.length - 1; i >= 0; i--) {
                const conn = this.connectors[i];
                if (this.isPointOnConnector(x, y, conn)) {
                    foundConnector = conn;
                    break;
                }
            }
        }

        if (foundObject) {
            // Ctrl+click toggles object in/out of multi-selection
            if (isCtrlClick) {
                const index = this.selectedObjects.findIndex(obj => obj.id === foundObject.id);
                if (index >= 0) {
                    // Remove from selection
                    this.selectedObjects.splice(index, 1);
                } else {
                    // Add to selection
                    this.selectedObjects.push(foundObject);
                }
                // Clear single selection state
                this.selectedObject = null;
                this.selectedConnector = null;
                // Don't start dragging on toggle - user needs to click again to drag
                return;
            }

            // Check if clicking on an already multi-selected object
            const isAlreadySelected = this.selectedObjects.some(obj => obj.id === foundObject.id);

            if (isAlreadySelected && this.selectedObjects.length > 1) {
                // Start multi-selection drag - don't clear selection
                this.isDraggingMultiple = true;
                this.lastDragPosition = { x, y };
                this.selectedObject = null; // Clear single selection
                this.selectedConnector = null;
            } else {
                // Single object selection (clears multi-selection)
                this.selectedObject = foundObject;
                this.selectedConnector = null;
                this.selectedObjects = []; // Clear multi-selection
                this.selectedConnectors = [];                this.isDragging = true;
                this.dragOffset = {
                    x: x - foundObject.x,
                    y: y - foundObject.y
                };
                // Capture start state for undo
                this.dragStartState = { x: foundObject.x, y: foundObject.y };
            }
        } else if (foundConnector) {
            this.selectedConnector = foundConnector;
            this.selectedObject = null;
            this.selectedObjects = []; // Clear multi-selection
            this.selectedConnectors = [];            this.isDragging = false;
        } else {
            // Start marquee selection on empty space (only with select tool)
            this.selectedObject = null;
            this.selectedConnector = null;
            this.selectedObjects = [];
            this.selectedConnectors = [];            if (this.currentTool === 'select') {
                this.isMarqueeSelecting = true;
                this.marqueeStart = { x, y };
                this.marqueeEnd = { x, y };
            }
        }
    }

    // ========== Marquee Selection Methods ==========

    /**
     * @description Finish marquee selection and select objects/connectors within the marquee
     */
    finishMarqueeSelection() {
        const rect = this.getMarqueeRect();
        this.isMarqueeSelecting = false;

        // Only select if marquee has meaningful size (more than 5px in both dimensions)
        if (rect.width < 5 && rect.height < 5) {
            // Just a click, not a drag - deselect all
            this.selectedObjects = [];
            this.selectedConnectors = [];            console.log(DEBUG_PREFIX, 'Marquee too small, deselecting all');
            return;
        }

        // Find all objects intersecting the marquee
        this.selectedObjects = this.objects.filter(obj => this.objectIntersectsRect(obj, rect));

        // Find all connectors intersecting the marquee
        this.selectedConnectors = this.connectors.filter(conn => this.connectorIntersectsRect(conn, rect));

        console.log(DEBUG_PREFIX, 'Marquee selection finished:',
            this.selectedObjects.length, 'objects,',
            this.selectedConnectors.length, 'connectors selected');
    }

    /**
     * @description Get normalized marquee rectangle (handles dragging in any direction)
     */
    getMarqueeRect() {
        return {
            x: Math.min(this.marqueeStart.x, this.marqueeEnd.x),
            y: Math.min(this.marqueeStart.y, this.marqueeEnd.y),
            width: Math.abs(this.marqueeEnd.x - this.marqueeStart.x),
            height: Math.abs(this.marqueeEnd.y - this.marqueeStart.y)
        };
    }

    /**
     * @description Check if object intersects with a rectangle (touch mode - partial overlap counts)
     */
    objectIntersectsRect(obj, rect) {
        // Simple bounding box intersection check
        return !(
            obj.x + obj.width < rect.x ||
            obj.x > rect.x + rect.width ||
            obj.y + obj.height < rect.y ||
            obj.y > rect.y + rect.height
        );
    }

    /**
     * @description Check if connector intersects with a rectangle
     * Checks endpoints, waypoints, and control points
     */
    connectorIntersectsRect(connector, rect) {
        // Get resolved start/end points
        const start = this.resolveConnectorPoint(connector, 'start');
        const end = this.resolveConnectorPoint(connector, 'end');
        if (!start || !end) return false;

        // Check if start or end point is in rect
        if (this.isPointInRect(start.x, start.y, rect)) return true;
        if (this.isPointInRect(end.x, end.y, rect)) return true;

        // Check waypoints for elbow connectors
        if (connector.waypoints) {
            for (const wp of connector.waypoints) {
                if (this.isPointInRect(wp.x, wp.y, rect)) return true;
            }
        }

        // Check control points for curved connectors
        if (connector.controlPoint1 && this.isPointInRect(connector.controlPoint1.x, connector.controlPoint1.y, rect)) return true;
        if (connector.controlPoint2 && this.isPointInRect(connector.controlPoint2.x, connector.controlPoint2.y, rect)) return true;

        // Check if connector line segment intersects rect (for simple arrow/line connectors)
        if (this.lineIntersectsRect(start.x, start.y, end.x, end.y, rect)) return true;

        return false;
    }

    /**
     * @description Check if a point is inside a rectangle
     */
    isPointInRect(px, py, rect) {
        return px >= rect.x && px <= rect.x + rect.width &&
               py >= rect.y && py <= rect.y + rect.height;
    }

    /**
     * @description Check if a line segment intersects a rectangle
     */
    lineIntersectsRect(x1, y1, x2, y2, rect) {
        // Check if either endpoint is inside
        if (this.isPointInRect(x1, y1, rect) || this.isPointInRect(x2, y2, rect)) return true;

        // Check if line intersects any of the four rect edges
        const left = rect.x;
        const right = rect.x + rect.width;
        const top = rect.y;
        const bottom = rect.y + rect.height;

        // Check intersection with each edge
        if (this.lineSegmentsIntersect(x1, y1, x2, y2, left, top, right, top)) return true;     // Top
        if (this.lineSegmentsIntersect(x1, y1, x2, y2, left, bottom, right, bottom)) return true; // Bottom
        if (this.lineSegmentsIntersect(x1, y1, x2, y2, left, top, left, bottom)) return true;   // Left
        if (this.lineSegmentsIntersect(x1, y1, x2, y2, right, top, right, bottom)) return true; // Right

        return false;
    }

    /**
     * @description Check if two line segments intersect
     */
    lineSegmentsIntersect(x1, y1, x2, y2, x3, y3, x4, y4) {
        const denom = (y4 - y3) * (x2 - x1) - (x4 - x3) * (y2 - y1);
        if (Math.abs(denom) < 0.0001) return false; // Parallel lines

        const ua = ((x4 - x3) * (y1 - y3) - (y4 - y3) * (x1 - x3)) / denom;
        const ub = ((x2 - x1) * (y1 - y3) - (y2 - y1) * (x1 - x3)) / denom;

        return ua >= 0 && ua <= 1 && ub >= 0 && ub <= 1;
    }

    /**
     * @description Draw the marquee selection rectangle
     */
    drawMarquee(ctx) {
        if (!this.isMarqueeSelecting) return;

        const rect = this.getMarqueeRect();

        ctx.save();

        // Blue dashed border (SLDS brand blue)
        ctx.strokeStyle = '#0176d3';
        ctx.lineWidth = 1;
        ctx.setLineDash([5, 5]);

        // Light blue fill
        ctx.fillStyle = 'rgba(1, 118, 211, 0.1)';

        ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
        ctx.strokeRect(rect.x, rect.y, rect.width, rect.height);

        ctx.restore();
    }

    /**
     * @description Draw selection handles for multiple selected objects and connectors
     */
    drawMultiSelectionHandles(ctx) {
        // Draw selected objects
        for (const obj of this.selectedObjects) {
            // Draw selection border (no resize handles for multi-select)
            ctx.save();
            ctx.strokeStyle = '#0176d3';
            ctx.lineWidth = 2;
            ctx.setLineDash([4, 4]);
            ctx.strokeRect(obj.x - 2, obj.y - 2, obj.width + 4, obj.height + 4);
            ctx.restore();
        }

        // Draw selected connectors with highlight
        for (const connector of this.selectedConnectors) {
            const start = this.resolveConnectorPoint(connector, 'start');
            const end = this.resolveConnectorPoint(connector, 'end');
            if (!start || !end) continue;

            ctx.save();
            ctx.strokeStyle = '#0176d3';
            ctx.lineWidth = 4;
            ctx.setLineDash([6, 4]);
            ctx.globalAlpha = 0.5;

            ctx.beginPath();
            if (connector.connectorType === 'elbow' && connector.waypoints) {
                ctx.moveTo(start.x, start.y);
                for (const wp of connector.waypoints) {
                    ctx.lineTo(wp.x, wp.y);
                }
                ctx.lineTo(end.x, end.y);
            } else if (connector.connectorType === 'curved' && connector.controlPoint1 && connector.controlPoint2) {
                ctx.moveTo(start.x, start.y);
                ctx.bezierCurveTo(
                    connector.controlPoint1.x, connector.controlPoint1.y,
                    connector.controlPoint2.x, connector.controlPoint2.y,
                    end.x, end.y
                );
            } else {
                ctx.moveTo(start.x, start.y);
                ctx.lineTo(end.x, end.y);
            }
            ctx.stroke();
            ctx.restore();

            // Draw small circles at endpoints for visual feedback
            ctx.save();
            ctx.fillStyle = '#0176d3';
            ctx.globalAlpha = 0.8;
            ctx.beginPath();
            ctx.arc(start.x, start.y, 5, 0, Math.PI * 2);
            ctx.fill();
            ctx.beginPath();
            ctx.arc(end.x, end.y, 5, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
        }
    }

    isPointOnConnector(x, y, connector) {
        const start = this.resolveConnectorPoint(connector, 'start');
        const end = this.resolveConnectorPoint(connector, 'end');

        if (!start || !end) return false;

        // Handle different connector types
        if (connector.connectorType === 'elbow') {
            return this.isPointOnElbowConnector(x, y, connector, start, end);
        } else if (connector.connectorType === 'curved') {
            return this.isPointOnCurvedConnector(x, y, connector, start, end);
        }

        // Straight line connector
        const distance = this.pointToLineDistance(x, y, start.x, start.y, end.x, end.y);
        return distance <= CONNECTOR_HIT_RADIUS;
    }

    /**
     * @description Check if point is on an elbow connector (check each segment)
     */
    isPointOnElbowConnector(x, y, connector, start, end) {
        const waypoints = connector.waypoints || [];
        const allPoints = [start, ...waypoints, end];

        // Check each segment
        for (let i = 0; i < allPoints.length - 1; i++) {
            const p1 = allPoints[i];
            const p2 = allPoints[i + 1];
            const distance = this.pointToLineDistance(x, y, p1.x, p1.y, p2.x, p2.y);
            if (distance <= CONNECTOR_HIT_RADIUS) {
                return true;
            }
        }
        return false;
    }

    /**
     * @description Check if point is on a curved connector (sample bezier curve)
     */
    isPointOnCurvedConnector(x, y, connector, start, end) {
        const cp1 = connector.controlPoint1 || start;
        const cp2 = connector.controlPoint2 || end;

        // Sample points along the bezier curve
        const samples = 20;
        for (let i = 0; i <= samples; i++) {
            const t = i / samples;
            const point = this.getBezierPoint(t, start, cp1, cp2, end);
            const distance = Math.sqrt((x - point.x) ** 2 + (y - point.y) ** 2);
            if (distance <= CONNECTOR_HIT_RADIUS) {
                return true;
            }
        }
        return false;
    }

    /**
     * @description Get point on cubic bezier curve at parameter t (0-1)
     */
    getBezierPoint(t, p0, p1, p2, p3) {
        const mt = 1 - t;
        const mt2 = mt * mt;
        const mt3 = mt2 * mt;
        const t2 = t * t;
        const t3 = t2 * t;

        return {
            x: mt3 * p0.x + 3 * mt2 * t * p1.x + 3 * mt * t2 * p2.x + t3 * p3.x,
            y: mt3 * p0.y + 3 * mt2 * t * p1.y + 3 * mt * t2 * p2.y + t3 * p3.y
        };
    }

    pointToLineDistance(px, py, x1, y1, x2, y2) {
        const A = px - x1;
        const B = py - y1;
        const C = x2 - x1;
        const D = y2 - y1;

        const dot = A * C + B * D;
        const lenSq = C * C + D * D;
        let param = -1;

        if (lenSq !== 0) param = dot / lenSq;

        let xx, yy;
        if (param < 0) {
            xx = x1;
            yy = y1;
        } else if (param > 1) {
            xx = x2;
            yy = y2;
        } else {
            xx = x1 + param * C;
            yy = y1 + param * D;
        }

        return Math.sqrt((px - xx) ** 2 + (py - yy) ** 2);
    }

    handleKeydown(event) {
        // Don't intercept keys when editing text
        if (this.isEditingText) return;

        // Don't intercept keys when any modal is open (user may be typing in inputs)
        if (this.isRecordModalOpen || this.isActivityModalOpen || this.showColorPicker) return;

        const ctrl = event.ctrlKey || event.metaKey;
        const shift = event.shiftKey;
        const key = event.key.toLowerCase();

        // Help modal toggle with ? key
        if (event.key === '?' || (shift && event.key === '/')) {
            event.preventDefault();
            this.showHelpModal = !this.showHelpModal;
            return;
        }

        // Close help modal with Escape
        if (event.key === 'Escape' && this.showHelpModal) {
            this.showHelpModal = false;
            return;
        }

        // Don't process other shortcuts if help modal is open
        if (this.showHelpModal) return;

        // Tool shortcuts (single letter keys, no modifiers)
        if (!ctrl && !shift && !event.altKey) {
            switch (key) {
                case 'v':
                    this.currentTool = 'select';
                    return;
                case 'm':
                    this.currentTool = 'pan';
                    this.selectedObject = null;
                    this.selectedConnector = null;
                    this.selectedObjects = [];
                    this.selectedConnectors = [];                    return;
                case 'd':
                    this.currentTool = 'draw';
                    return;
                case 'e':
                    this.currentTool = 'eraser';
                    return;
                case 's':
                    this.addSticky('#fff740'); // Yellow sticky
                    return;
                case 'r':
                    this.handleAddRectangle();
                    return;
                case 'o':
                    this.handleAddCircle();
                    return;
                case 'c':
                    this.currentTool = 'connector';
                    this.connectorType = 'arrow';
                    return;
            }
        }

        // Layer shortcuts (when object or connector is selected)
        if (ctrl && (this.selectedObject || this.selectedConnector)) {
            if (shift && event.key === ']') {
                // Ctrl+Shift+] = Bring to Front
                event.preventDefault();
                this.handleBringToFront();
                return;
            } else if (event.key === ']') {
                // Ctrl+] = Bring Forward
                event.preventDefault();
                this.handleBringForward();
                return;
            } else if (shift && event.key === '[') {
                // Ctrl+Shift+[ = Send to Back
                event.preventDefault();
                this.handleSendToBack();
                return;
            } else if (event.key === '[') {
                // Ctrl+[ = Send Backward
                event.preventDefault();
                this.handleSendBackward();
                return;
            }
        }

        // Undo/Redo keyboard shortcuts
        if (ctrl) {
            if (key === 'z' && !shift) {
                // Ctrl+Z = Undo
                event.preventDefault();
                this.undo();
                return;
            } else if (key === 'y' || (key === 'z' && shift)) {
                // Ctrl+Y or Ctrl+Shift+Z = Redo
                event.preventDefault();
                this.redo();
                return;
            }
        }

        // Copy/Paste/Cut keyboard shortcuts
        if (ctrl) {
            if (key === 'c' && !shift) {
                // Ctrl+C = Copy
                event.preventDefault();
                this.handleCopy();
                return;
            } else if (key === 'v' && !shift) {
                // Ctrl+V = Paste
                event.preventDefault();
                this.handlePaste();
                return;
            } else if (key === 'x' && !shift) {
                // Ctrl+X = Cut (copy + delete)
                event.preventDefault();
                this.handleCut();
                return;
            }
        }

        // Group/Ungroup toggle (G key)
        // G = Group selected objects OR Ungroup if a group is selected
        if (key === 'g' && !ctrl && !shift && !event.altKey) {
            // If a group is selected, ungroup it
            if (this.selectedObject && this.selectedObject.type === 'group') {
                event.preventDefault();
                this.ungroupSelection();
                return;
            }
            // If multiple items selected (objects and/or connectors), group them
            const totalSelected = this.selectedObjects.length + this.selectedConnectors.length;
            if (totalSelected >= 2) {
                event.preventDefault();
                this.createGroupFromSelection();
                return;
            }
        }

        // Delete or Backspace to remove selected item(s)
        if (event.key === 'Delete' || event.key === 'Backspace') {
            // Check for any selected items including multi-selected connectors
            const hasSelection = this.selectedConnector || this.selectedObject ||
                                 this.selectedObjects.length > 0 || this.selectedConnectors.length > 0;
            if (hasSelection) {
                event.preventDefault();
            }

            // deleteSelectedObjects now handles both objects and connectors
            if (this.selectedObjects.length > 0 || this.selectedConnectors.length > 0) {
                this.deleteSelectedObjects();
            } else if (this.selectedConnector) {
                this.deleteSelectedConnector();
            } else if (this.selectedObject) {
                this.deleteSelectedObject();
            }
        }

        // Escape to deselect
        if (event.key === 'Escape') {
            this.selectedConnector = null;
            this.selectedObject = null;
            this.selectedObjects = [];
            this.selectedConnectors = [];        }
    }

    handleKeyup(event) {
        // Shift+click pan is handled in handleMouseUp, no keyup needed
        // Keep method for potential future use
    }

    updateCursorForTool() {
        if (!this.canvas) return;
        switch (this.currentTool) {
            case 'pan':
                this.canvas.style.cursor = 'grab';
                break;
            case 'draw':
                this.canvas.style.cursor = 'crosshair';
                break;
            case 'eraser':
                this.canvas.style.cursor = 'crosshair';
                break;
            default:
                this.canvas.style.cursor = 'default';
        }
    }

    /**
     * @description Clamp pan offset to keep viewport within canvas world bounds
     */
    clampPanOffset() {
        if (!this.canvas) return;

        const viewportWidth = this.canvas.width / this.zoomLevel;
        const viewportHeight = this.canvas.height / this.zoomLevel;

        // Pan offset is negative when viewing right/bottom of canvas
        // Clamp so viewport stays within 0 to CANVAS_WORLD_WIDTH/HEIGHT
        const minPanX = Math.min(0, -(CANVAS_WORLD_WIDTH - viewportWidth));
        const maxPanX = 0;
        const minPanY = Math.min(0, -(CANVAS_WORLD_HEIGHT - viewportHeight));
        const maxPanY = 0;

        this.panOffsetX = Math.max(minPanX, Math.min(maxPanX, this.panOffsetX));
        this.panOffsetY = Math.max(minPanY, Math.min(maxPanY, this.panOffsetY));
    }

    /**
     * @description Reset view to origin (0,0)
     */
    handleCenterView() {
        // Reset pan to show origin (0,0) at top-left
        this.panOffsetX = 0;
        this.panOffsetY = 0;
    }

    deleteSelectedConnector() {
        if (!this.selectedConnector) return;

        // Record for undo before delete
        const connectorCopy = JSON.parse(JSON.stringify(this.selectedConnector));
        this.recordAction('connector_delete', { connector: connectorCopy });

        const connectorId = this.selectedConnector.id;
        this.connectors = this.connectors.filter(c => c.id !== connectorId);
        this.publishConnectorDelete(connectorId);
        this.selectedConnector = null;
        console.log(DEBUG_PREFIX, 'Deleted connector:', connectorId);
    }

    deleteSelectedObject() {
        if (!this.selectedObject) return;

        // If it's a group, use the special group delete method
        if (this.selectedObject.type === 'group') {
            this.deleteGroup(this.selectedObject);
            this.selectedObject = null;
            return;
        }

        // Record for undo before delete
        const objectCopy = JSON.parse(JSON.stringify(this.selectedObject));
        this.recordAction('object_delete', { object: objectCopy });

        const objectId = this.selectedObject.id;

        // Also delete any connectors attached to this object
        const connectedConnectorIds = this.connectors
            .filter(c =>
                (c.startAnchor && c.startAnchor.objectId === objectId) ||
                (c.endAnchor && c.endAnchor.objectId === objectId)
            )
            .map(c => c.id);

        // Remove connected connectors
        for (const connId of connectedConnectorIds) {
            this.connectors = this.connectors.filter(c => c.id !== connId);
            this.publishConnectorDelete(connId);
        }

        // Remove the object
        this.objects = this.objects.filter(o => o.id !== objectId);
        this.publishObjectDelete(objectId);
        this.selectedObject = null;

        console.log(DEBUG_PREFIX, 'Deleted object:', objectId, 'and', connectedConnectorIds.length, 'connected connectors');
    }

    /**
     * @description Delete all objects and connectors in selection (multi-selection delete)
     */
    deleteSelectedObjects() {
        if (this.selectedObjects.length === 0 && this.selectedConnectors.length === 0) return;

        const objectIds = this.selectedObjects.map(obj => obj.id);
        let totalConnectorsDeleted = 0;

        // Delete selected connectors first
        for (const connector of this.selectedConnectors) {
            this.connectors = this.connectors.filter(c => c.id !== connector.id);
            this.publishConnectorDelete(connector.id);
            totalConnectorsDeleted++;
        }

        for (const objectId of objectIds) {
            // Delete any connectors attached to this object (that weren't already deleted)
            const connectedConnectorIds = this.connectors
                .filter(c =>
                    (c.startAnchor && c.startAnchor.objectId === objectId) ||
                    (c.endAnchor && c.endAnchor.objectId === objectId)
                )
                .map(c => c.id);

            // Remove connected connectors
            for (const connId of connectedConnectorIds) {
                this.connectors = this.connectors.filter(c => c.id !== connId);
                this.publishConnectorDelete(connId);
            }
            totalConnectorsDeleted += connectedConnectorIds.length;

            // Remove the object
            this.objects = this.objects.filter(o => o.id !== objectId);
            this.publishObjectDelete(objectId);
        }

        console.log(DEBUG_PREFIX, 'Deleted', objectIds.length, 'objects and', totalConnectorsDeleted, 'connectors');
        this.selectedObjects = [];
        this.selectedConnectors = [];    }

    // ========== Undo/Redo Feature ==========

    /**
     * @description Record an action for undo capability
     * @param {string} type - Action type (object_add, object_delete, object_move, etc.)
     * @param {Object} data - Action-specific data for undoing
     */
    recordAction(type, data) {
        // Add to undo stack
        this.undoStack.push({ type, data, timestamp: Date.now() });

        // Limit to 5 items
        if (this.undoStack.length > 5) {
            this.undoStack.shift();
        }

        // Clear redo stack (new action invalidates forward history)
        this.redoStack = [];

        console.log(DEBUG_PREFIX, 'Recorded action:', type, 'Undo stack size:', this.undoStack.length);
    }

    /**
     * @description Handle undo button click
     */
    handleUndo() {
        this.undo();
    }

    /**
     * @description Handle redo button click
     */
    handleRedo() {
        this.redo();
    }

    /**
     * @description Undo the last action
     */
    undo() {
        if (this.undoStack.length === 0) {
            console.log(DEBUG_PREFIX, 'Nothing to undo');
            return;
        }

        const action = this.undoStack.pop();
        const reverseData = this.executeUndo(action);

        if (reverseData) {
            // Push to redo stack
            this.redoStack.push({
                type: action.type,
                data: reverseData,
                timestamp: Date.now()
            });
        }

        console.log(DEBUG_PREFIX, 'Undo:', action.type, 'Redo stack size:', this.redoStack.length);
    }

    /**
     * @description Redo the last undone action
     */
    redo() {
        if (this.redoStack.length === 0) {
            console.log(DEBUG_PREFIX, 'Nothing to redo');
            return;
        }

        const action = this.redoStack.pop();
        const reverseData = this.executeRedo(action);

        if (reverseData) {
            // Push back to undo stack (without clearing redo)
            this.undoStack.push({
                type: action.type,
                data: reverseData,
                timestamp: Date.now()
            });
        }

        console.log(DEBUG_PREFIX, 'Redo:', action.type, 'Undo stack size:', this.undoStack.length);
    }

    /**
     * @description Execute undo for a specific action type
     * @returns {Object} Data needed for redo
     */
    executeUndo(action) {
        switch (action.type) {
            case 'object_add': {
                // Remove the added object
                const obj = this.objects.find(o => o.id === action.data.objectId);
                if (!obj) return null;
                this.objects = this.objects.filter(o => o.id !== action.data.objectId);
                this.publishObjectDelete(action.data.objectId);
                // Deselect if it was selected
                if (this.selectedObject?.id === action.data.objectId) {
                    this.selectedObject = null;
                }
                return { object: JSON.parse(JSON.stringify(obj)) }; // For redo
            }

            case 'object_delete': {
                // Restore the deleted object
                const obj = JSON.parse(JSON.stringify(action.data.object));
                this.objects.push(obj);
                this.publishObjectAdd(obj);
                return { objectId: obj.id }; // For redo
            }

            case 'object_move': {
                // Move back to previous position
                const obj = this.objects.find(o => o.id === action.data.objectId);
                if (!obj) return null;
                const currentPos = { x: obj.x, y: obj.y };
                obj.x = action.data.previousX;
                obj.y = action.data.previousY;
                this.publishObjectMove(obj);
                return { objectId: obj.id, previousX: currentPos.x, previousY: currentPos.y };
            }

            case 'object_resize': {
                // Restore previous size
                const obj = this.objects.find(o => o.id === action.data.objectId);
                if (!obj) return null;
                const currentState = { x: obj.x, y: obj.y, width: obj.width, height: obj.height };
                obj.x = action.data.previousX;
                obj.y = action.data.previousY;
                obj.width = action.data.previousWidth;
                obj.height = action.data.previousHeight;
                this.publishObjectResize(obj);
                return {
                    objectId: obj.id,
                    previousX: currentState.x,
                    previousY: currentState.y,
                    previousWidth: currentState.width,
                    previousHeight: currentState.height
                };
            }

            case 'object_style': {
                // Restore previous style
                const obj = this.objects.find(o => o.id === action.data.objectId);
                if (!obj) return null;
                const currentStyle = {
                    color: obj.color,
                    borderColor: obj.borderColor,
                    textAlign: obj.textAlign,
                    textOverflow: obj.textOverflow,
                    fontSize: obj.fontSize
                };
                // Restore previous values
                if (action.data.previousColor !== undefined) obj.color = action.data.previousColor;
                if (action.data.previousBorderColor !== undefined) obj.borderColor = action.data.previousBorderColor;
                if (action.data.previousTextAlign !== undefined) obj.textAlign = action.data.previousTextAlign;
                if (action.data.previousTextOverflow !== undefined) obj.textOverflow = action.data.previousTextOverflow;
                if (action.data.previousFontSize !== undefined) obj.fontSize = action.data.previousFontSize;
                this.publishObjectStyle(obj);
                return {
                    objectId: obj.id,
                    previousColor: currentStyle.color,
                    previousBorderColor: currentStyle.borderColor,
                    previousTextAlign: currentStyle.textAlign,
                    previousTextOverflow: currentStyle.textOverflow,
                    previousFontSize: currentStyle.fontSize
                };
            }

            case 'object_text': {
                // Restore previous text
                const obj = this.objects.find(o => o.id === action.data.objectId);
                if (!obj) return null;
                const currentText = obj.text;
                obj.text = action.data.previousText;
                this.publishObjectUpdate(obj);
                return { objectId: obj.id, previousText: currentText };
            }

            case 'connector_add': {
                // Remove the added connector
                const conn = this.connectors.find(c => c.id === action.data.connectorId);
                if (!conn) return null;
                this.connectors = this.connectors.filter(c => c.id !== action.data.connectorId);
                this.publishConnectorDelete(action.data.connectorId);
                if (this.selectedConnector?.id === action.data.connectorId) {
                    this.selectedConnector = null;
                }
                return { connector: JSON.parse(JSON.stringify(conn)) };
            }

            case 'connector_delete': {
                // Restore the deleted connector
                const conn = JSON.parse(JSON.stringify(action.data.connector));
                this.connectors.push(conn);
                this.publishConnectorAdd(conn);
                return { connectorId: conn.id };
            }

            case 'connector_update': {
                // Restore previous connector state
                const conn = this.connectors.find(c => c.id === action.data.connectorId);
                if (!conn) return null;
                const currentState = JSON.parse(JSON.stringify(conn));
                // Restore previous state
                Object.assign(conn, action.data.previousState);
                this.publishConnectorUpdate(conn);
                return { connectorId: conn.id, previousState: currentState };
            }

            case 'stroke_add': {
                // Remove the added stroke
                const stroke = this.strokes.find(s => s.id === action.data.strokeId);
                if (!stroke) return null;
                this.strokes = this.strokes.filter(s => s.id !== action.data.strokeId);
                this.publishStrokeDelete(action.data.strokeId);
                return { stroke: JSON.parse(JSON.stringify(stroke)) };
            }

            case 'stroke_delete': {
                // Restore the deleted stroke
                const stroke = JSON.parse(JSON.stringify(action.data.stroke));
                this.strokes.push(stroke);
                this.publishStroke(stroke);
                return { strokeId: stroke.id };
            }

            case 'group_create': {
                // Ungroup the group
                const group = this.objects.find(o => o.id === action.data.groupId);
                if (!group) return null;
                const childIds = group.children || [];
                this.objects = this.objects.filter(o => o.id !== group.id);
                this.publishGroupUngroup(group.id, childIds);
                if (this.selectedObject?.id === group.id) {
                    this.selectedObject = null;
                }
                return { group: JSON.parse(JSON.stringify(group)) };
            }

            case 'group_ungroup': {
                // Recreate the group
                const group = JSON.parse(JSON.stringify(action.data.group));
                this.objects.push(group);
                this.publishGroupCreate(group);
                return { groupId: group.id, childIds: group.children };
            }

            default:
                console.warn(DEBUG_PREFIX, 'Unknown undo action type:', action.type);
                return null;
        }
    }

    /**
     * @description Execute redo for a specific action type
     * @returns {Object} Data needed for undo
     */
    executeRedo(action) {
        switch (action.type) {
            case 'object_add': {
                // Re-add the object
                const obj = JSON.parse(JSON.stringify(action.data.object));
                this.objects.push(obj);
                this.publishObjectAdd(obj);
                return { objectId: obj.id };
            }

            case 'object_delete': {
                // Re-delete the object
                const obj = this.objects.find(o => o.id === action.data.objectId);
                if (!obj) return null;
                this.objects = this.objects.filter(o => o.id !== action.data.objectId);
                this.publishObjectDelete(action.data.objectId);
                return { object: JSON.parse(JSON.stringify(obj)) };
            }

            case 'object_move': {
                // Move to new position (same as undo, just reversed data)
                return this.executeUndo({ type: 'object_move', data: action.data });
            }

            case 'object_resize': {
                // Resize (same as undo, just reversed data)
                return this.executeUndo({ type: 'object_resize', data: action.data });
            }

            case 'object_style': {
                // Style (same as undo, just reversed data)
                return this.executeUndo({ type: 'object_style', data: action.data });
            }

            case 'object_text': {
                // Text (same as undo, just reversed data)
                return this.executeUndo({ type: 'object_text', data: action.data });
            }

            case 'connector_add': {
                // Re-add the connector
                const conn = JSON.parse(JSON.stringify(action.data.connector));
                this.connectors.push(conn);
                this.publishConnectorAdd(conn);
                return { connectorId: conn.id };
            }

            case 'connector_delete': {
                // Re-delete the connector
                const conn = this.connectors.find(c => c.id === action.data.connectorId);
                if (!conn) return null;
                this.connectors = this.connectors.filter(c => c.id !== action.data.connectorId);
                this.publishConnectorDelete(action.data.connectorId);
                return { connector: JSON.parse(JSON.stringify(conn)) };
            }

            case 'connector_update': {
                // Same as undo
                return this.executeUndo({ type: 'connector_update', data: action.data });
            }

            case 'stroke_add': {
                // Re-add the stroke
                const stroke = JSON.parse(JSON.stringify(action.data.stroke));
                this.strokes.push(stroke);
                this.publishStroke(stroke);
                return { strokeId: stroke.id };
            }

            case 'stroke_delete': {
                // Re-delete the stroke
                const stroke = this.strokes.find(s => s.id === action.data.strokeId);
                if (!stroke) return null;
                this.strokes = this.strokes.filter(s => s.id !== action.data.strokeId);
                this.publishStrokeDelete(action.data.strokeId);
                return { stroke: JSON.parse(JSON.stringify(stroke)) };
            }

            case 'group_create': {
                // Recreate the group
                const group = JSON.parse(JSON.stringify(action.data.group));
                this.objects.push(group);
                this.publishGroupCreate(group);
                return { groupId: group.id };
            }

            case 'group_ungroup': {
                // Ungroup again
                const group = this.objects.find(o => o.id === action.data.groupId);
                if (!group) return null;
                const childIds = group.children || [];
                this.objects = this.objects.filter(o => o.id !== action.data.groupId);
                this.publishGroupUngroup(action.data.groupId, childIds);
                return { group: JSON.parse(JSON.stringify(group)) };
            }

            default:
                console.warn(DEBUG_PREFIX, 'Unknown redo action type:', action.type);
                return null;
        }
    }

    // ========== Copy/Paste Feature ==========

    /**
     * @description Copy selected elements to clipboard
     */
    handleCopy() {
        // Determine what to copy
        const objectsToCopy = this.selectedObjects.length > 0
            ? this.selectedObjects
            : (this.selectedObject ? [this.selectedObject] : []);

        const connectorsToCopy = this.selectedConnectors.length > 0
            ? this.selectedConnectors
            : (this.selectedConnector ? [this.selectedConnector] : []);

        if (objectsToCopy.length === 0 && connectorsToCopy.length === 0) {
            console.log(DEBUG_PREFIX, 'Nothing to copy');
            return;
        }

        // Deep clone to clipboard
        this.clipboard = {
            objects: objectsToCopy.map(obj => JSON.parse(JSON.stringify(obj))),
            connectors: connectorsToCopy.map(conn => JSON.parse(JSON.stringify(conn))),
            pasteCount: 0
        };

        console.log(DEBUG_PREFIX, 'Copied:',
            this.clipboard.objects.length, 'objects,',
            this.clipboard.connectors.length, 'connectors');
    }

    /**
     * @description Paste elements from clipboard
     */
    handlePaste() {
        if (!this.clipboard ||
            (this.clipboard.objects.length === 0 && this.clipboard.connectors.length === 0)) {
            console.log(DEBUG_PREFIX, 'Nothing to paste');
            return;
        }

        this.clipboard.pasteCount++;
        const offset = this.clipboard.pasteCount * 20; // Stack offset

        // Clear current selection
        this.selectedObject = null;
        this.selectedConnector = null;
        this.selectedObjects = [];
        this.selectedConnectors = [];

        // Map old IDs to new IDs for connector reconnection
        const idMap = {};
        const pastedObjects = [];
        const pastedConnectors = [];

        // Paste objects first
        for (const obj of this.clipboard.objects) {
            const newObj = JSON.parse(JSON.stringify(obj));
            const oldId = newObj.id;
            newObj.id = this.generateId();
            newObj.x += offset;
            newObj.y += offset;
            newObj.zIndex = this.getNextZIndex();
            idMap[oldId] = newObj.id;

            // Handle groups - update child references
            if (newObj.type === 'group' && newObj.children) {
                // Children will be pasted separately, so update references
                newObj.children = newObj.children.map(childId => idMap[childId] || childId);
            }

            this.objects.push(newObj);
            pastedObjects.push(newObj);
            this.publishObjectAdd(newObj);
        }

        // Paste connectors
        for (const conn of this.clipboard.connectors) {
            const newConn = JSON.parse(JSON.stringify(conn));
            newConn.id = `connector_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            newConn.zIndex = this.getNextZIndex();

            // Update anchor references if connected objects were also copied
            if (newConn.startAnchor?.objectId && idMap[newConn.startAnchor.objectId]) {
                newConn.startAnchor.objectId = idMap[newConn.startAnchor.objectId];
            } else if (newConn.startAnchor && !idMap[newConn.startAnchor.objectId]) {
                // Convert to floating point if the anchor target wasn't copied
                const resolvedStart = this.resolveConnectorPointFromData(conn, 'start');
                if (resolvedStart) {
                    newConn.startPoint = { x: resolvedStart.x + offset, y: resolvedStart.y + offset };
                    newConn.startAnchor = null;
                }
            }

            if (newConn.endAnchor?.objectId && idMap[newConn.endAnchor.objectId]) {
                newConn.endAnchor.objectId = idMap[newConn.endAnchor.objectId];
            } else if (newConn.endAnchor && !idMap[newConn.endAnchor.objectId]) {
                // Convert to floating point if the anchor target wasn't copied
                const resolvedEnd = this.resolveConnectorPointFromData(conn, 'end');
                if (resolvedEnd) {
                    newConn.endPoint = { x: resolvedEnd.x + offset, y: resolvedEnd.y + offset };
                    newConn.endAnchor = null;
                }
            }

            // Move floating endpoints
            if (newConn.startPoint) {
                newConn.startPoint.x += offset;
                newConn.startPoint.y += offset;
            }
            if (newConn.endPoint) {
                newConn.endPoint.x += offset;
                newConn.endPoint.y += offset;
            }

            // Move waypoints (elbow connectors)
            if (newConn.waypoints) {
                newConn.waypoints = newConn.waypoints.map(wp => ({
                    x: wp.x + offset,
                    y: wp.y + offset
                }));
            }

            // Move control points (curved connectors)
            if (newConn.controlPoint1) {
                newConn.controlPoint1 = {
                    x: newConn.controlPoint1.x + offset,
                    y: newConn.controlPoint1.y + offset
                };
            }
            if (newConn.controlPoint2) {
                newConn.controlPoint2 = {
                    x: newConn.controlPoint2.x + offset,
                    y: newConn.controlPoint2.y + offset
                };
            }

            this.connectors.push(newConn);
            pastedConnectors.push(newConn);
            this.publishConnectorAdd(newConn);
        }

        // Auto-select pasted items
        this.selectedObjects = pastedObjects;
        this.selectedConnectors = pastedConnectors;

        console.log(DEBUG_PREFIX, 'Pasted:',
            pastedObjects.length, 'objects,',
            pastedConnectors.length, 'connectors at offset', offset);
    }

    /**
     * @description Cut selected elements (copy + delete)
     */
    handleCut() {
        this.handleCopy();

        // Delete the original elements
        if (this.selectedObjects.length > 0 || this.selectedConnectors.length > 0) {
            this.deleteSelectedObjects();
        } else if (this.selectedConnector) {
            this.deleteSelectedConnector();
        } else if (this.selectedObject) {
            this.deleteSelectedObject();
        }

        console.log(DEBUG_PREFIX, 'Cut complete');
    }

    /**
     * @description Helper to resolve connector point from clipboard data
     */
    resolveConnectorPointFromData(connector, endpoint) {
        const point = endpoint === 'start' ? connector.startPoint : connector.endPoint;
        const anchor = endpoint === 'start' ? connector.startAnchor : connector.endAnchor;

        if (point) {
            return { x: point.x, y: point.y };
        }

        if (anchor) {
            const obj = this.objects.find(o => o.id === anchor.objectId);
            if (obj) {
                return this.getAnchorPosition(obj, anchor.position);
            }
        }

        return null;
    }

    // ========== Group/Ungroup Feature ==========

    /**
     * @description Create a group from currently selected objects
     */
    createGroupFromSelection() {
        // Count total items (objects + connectors)
        const totalItems = this.selectedObjects.length + this.selectedConnectors.length;
        if (totalItems < 2) {
            console.log(DEBUG_PREFIX, 'Need at least 2 items to create a group');
            return;
        }

        // Get IDs of selected objects (skip any groups - flatten if needed)
        const childIds = [];
        for (const obj of this.selectedObjects) {
            if (obj.type === 'group') {
                // If selecting an existing group, include its children
                childIds.push(...(obj.children || []));
            } else {
                childIds.push(obj.id);
            }
        }

        // Get IDs of selected connectors
        const connectorIds = this.selectedConnectors.map(c => c.id);

        if (childIds.length < 1 && connectorIds.length < 2) {
            console.log(DEBUG_PREFIX, 'Need at least 2 items to create a group');
            return;
        }

        // Calculate bounding box for all children (objects only for now)
        const bounds = childIds.length > 0
            ? this.calculateBoundingBox(childIds)
            : this.calculateConnectorBounds(connectorIds);
        if (!bounds) {
            console.error(DEBUG_PREFIX, 'Could not calculate bounding box for group');
            return;
        }

        // Create group object
        const group = {
            id: this.generateId(),
            type: 'group',
            x: bounds.x,
            y: bounds.y,
            width: bounds.width,
            height: bounds.height,
            zIndex: this.getNextZIndex(),
            children: childIds,
            connectorIds: connectorIds, // Include connectors in group
            // Store relative positions and sizes for proportional resize
            childOffsets: childIds.map(id => {
                const child = this.objects.find(o => o.id === id);
                if (!child) return null;
                return {
                    id: id,
                    relX: (child.x - bounds.x) / bounds.width,
                    relY: (child.y - bounds.y) / bounds.height,
                    relWidth: child.width / bounds.width,
                    relHeight: child.height / bounds.height
                };
            }).filter(Boolean)
        };

        // Remove any existing groups that were selected (we've merged their children)
        this.objects = this.objects.filter(o =>
            o.type !== 'group' || !this.selectedObjects.some(sel => sel.id === o.id)
        );

        // Add group to objects
        this.objects.push(group);

        // Select the new group
        this.selectedObject = group;
        this.selectedObjects = [];
        this.selectedConnectors = [];
        // Publish group creation
        this.publishGroupCreate(group);

        // Record for undo
        this.recordAction('group_create', { groupId: group.id });

        console.log(DEBUG_PREFIX, 'Created group with', childIds.length, 'objects and', connectorIds.length, 'connectors:', group.id);
    }

    /**
     * @description Calculate bounding box for a list of object IDs
     */
    calculateBoundingBox(objectIds) {
        const objects = objectIds
            .map(id => this.objects.find(o => o.id === id))
            .filter(Boolean);

        if (objects.length === 0) return null;

        let minX = Infinity, minY = Infinity;
        let maxX = -Infinity, maxY = -Infinity;

        for (const obj of objects) {
            minX = Math.min(minX, obj.x);
            minY = Math.min(minY, obj.y);
            maxX = Math.max(maxX, obj.x + obj.width);
            maxY = Math.max(maxY, obj.y + obj.height);
        }

        return {
            x: minX,
            y: minY,
            width: maxX - minX,
            height: maxY - minY
        };
    }

    /**
     * @description Calculate bounding box for a list of connector IDs
     */
    calculateConnectorBounds(connectorIds) {
        if (connectorIds.length === 0) return null;

        let minX = Infinity, minY = Infinity;
        let maxX = -Infinity, maxY = -Infinity;

        for (const connId of connectorIds) {
            const connector = this.connectors.find(c => c.id === connId);
            if (!connector) continue;

            const start = this.resolveConnectorPoint(connector, 'start');
            const end = this.resolveConnectorPoint(connector, 'end');
            if (!start || !end) continue;

            minX = Math.min(minX, start.x, end.x);
            minY = Math.min(minY, start.y, end.y);
            maxX = Math.max(maxX, start.x, end.x);
            maxY = Math.max(maxY, start.y, end.y);

            // Include waypoints
            if (connector.waypoints) {
                for (const wp of connector.waypoints) {
                    minX = Math.min(minX, wp.x);
                    minY = Math.min(minY, wp.y);
                    maxX = Math.max(maxX, wp.x);
                    maxY = Math.max(maxY, wp.y);
                }
            }

            // Include control points
            if (connector.controlPoint1) {
                minX = Math.min(minX, connector.controlPoint1.x);
                minY = Math.min(minY, connector.controlPoint1.y);
                maxX = Math.max(maxX, connector.controlPoint1.x);
                maxY = Math.max(maxY, connector.controlPoint1.y);
            }
            if (connector.controlPoint2) {
                minX = Math.min(minX, connector.controlPoint2.x);
                minY = Math.min(minY, connector.controlPoint2.y);
                maxX = Math.max(maxX, connector.controlPoint2.x);
                maxY = Math.max(maxY, connector.controlPoint2.y);
            }
        }

        if (minX === Infinity) return null;

        // Add some padding
        const padding = 10;
        return {
            x: minX - padding,
            y: minY - padding,
            width: (maxX - minX) + padding * 2,
            height: (maxY - minY) + padding * 2
        };
    }

    /**
     * @description Ungroup the selected group back into individual objects
     */
    ungroupSelection() {
        if (!this.selectedObject || this.selectedObject.type !== 'group') {
            console.log(DEBUG_PREFIX, 'No group selected to ungroup');
            return;
        }

        const group = this.selectedObject;
        const childIds = group.children || [];
        const connectorIds = group.connectorIds || [];
        // Record for undo BEFORE removing
        const groupCopy = JSON.parse(JSON.stringify(group));
        this.recordAction('group_ungroup', { group: groupCopy });

        // Publish ungroup event first (before removing group)
        this.publishGroupUngroup(group.id, childIds);

        // Remove group from objects
        this.objects = this.objects.filter(o => o.id !== group.id);

        // Select the children (objects)
        this.selectedObject = null;
        this.selectedObjects = childIds
            .map(id => this.objects.find(o => o.id === id))
            .filter(Boolean);

        // Select the connectors from the group
        this.selectedConnectors = connectorIds
            .map(id => this.connectors.find(c => c.id === id))
            .filter(Boolean);

        console.log(DEBUG_PREFIX, 'Ungrouped', childIds.length, 'objects and', connectorIds.length, 'connectors from group:', group.id);
    }

    /**
     * @description Publish group creation event
     */
    async publishGroupCreate(group) {
        console.log(DEBUG_PREFIX, 'Publishing group_create:', group.id);
        try {
            await publishEvent({
                canvasId: this.canvasId,
                eventType: 'group_create',
                payload: JSON.stringify(group)
            });
        } catch (error) {
            console.error(DEBUG_PREFIX, 'Failed to publish group_create:', error);
        }
    }

    /**
     * @description Publish group ungroup event
     */
    async publishGroupUngroup(groupId, childIds) {
        console.log(DEBUG_PREFIX, 'Publishing group_ungroup:', groupId);
        try {
            await publishEvent({
                canvasId: this.canvasId,
                eventType: 'group_ungroup',
                payload: JSON.stringify({ groupId, childIds })
            });
        } catch (error) {
            console.error(DEBUG_PREFIX, 'Failed to publish group_ungroup:', error);
        }
    }

    /**
     * @description Handle remote group creation
     */
    handleRemoteGroupCreate(payload) {
        // Check if group already exists
        const existingIndex = this.objects.findIndex(o => o.id === payload.id);
        if (existingIndex >= 0) {
            // Update existing
            this.objects[existingIndex] = payload;
        } else {
            // Add new group
            this.objects.push(payload);
        }
        console.log(DEBUG_PREFIX, 'Remote group created:', payload.id);
    }

    /**
     * @description Handle remote group ungroup
     */
    handleRemoteGroupUngroup(payload) {
        const { groupId } = payload;
        // Remove the group from objects
        this.objects = this.objects.filter(o => o.id !== groupId);

        // Clear selection if the ungrouped group was selected
        if (this.selectedObject && this.selectedObject.id === groupId) {
            this.selectedObject = null;
        }

        console.log(DEBUG_PREFIX, 'Remote group ungrouped:', groupId);
    }

    /**
     * @description Move a group and all its children together
     */
    moveGroupChildren(group, dx, dy) {
        // Move each child object
        for (const childId of (group.children || [])) {
            const child = this.objects.find(o => o.id === childId);
            if (child) {
                child.x += dx;
                child.y += dy;
            }
        }

        // Move each connector in the group (including waypoints and control points)
        for (const connectorId of (group.connectorIds || [])) {
            const connector = this.connectors.find(c => c.id === connectorId);
            if (connector) {
                // Move floating start point (not attached to an object)
                if (connector.startPoint && !connector.startAnchor) {
                    connector.startPoint.x += dx;
                    connector.startPoint.y += dy;
                }

                // Move floating end point (not attached to an object)
                if (connector.endPoint && !connector.endAnchor) {
                    connector.endPoint.x += dx;
                    connector.endPoint.y += dy;
                }

                // Move waypoints (elbow connectors)
                if (connector.waypoints) {
                    for (const wp of connector.waypoints) {
                        wp.x += dx;
                        wp.y += dy;
                    }
                }

                // Move control points (curved connectors)
                if (connector.controlPoint1) {
                    connector.controlPoint1.x += dx;
                    connector.controlPoint1.y += dy;
                }
                if (connector.controlPoint2) {
                    connector.controlPoint2.x += dx;
                    connector.controlPoint2.y += dy;
                }
            }
        }
    }

    /**
     * @description Update group bounding box after children move
     */
    updateGroupBounds(group) {
        const bounds = this.calculateBoundingBox(group.children || []);
        if (bounds) {
            group.x = bounds.x;
            group.y = bounds.y;
            group.width = bounds.width;
            group.height = bounds.height;
        }
    }

    /**
     * @description Delete a group and all its children
     */
    deleteGroup(group) {
        const childIds = group.children || [];
        const groupConnectorIds = group.connectorIds || [];        let connectorsDeleted = 0;

        // Delete connectors that are part of the group first
        for (const connId of groupConnectorIds) {
            this.connectors = this.connectors.filter(c => c.id !== connId);
            this.publishConnectorDelete(connId);
            connectorsDeleted++;
        }

        // Delete all children
        for (const childId of childIds) {
            // Delete connected connectors (that aren't already deleted)
            const connectedConnectorIds = this.connectors
                .filter(c =>
                    (c.startAnchor && c.startAnchor.objectId === childId) ||
                    (c.endAnchor && c.endAnchor.objectId === childId)
                )
                .map(c => c.id);

            for (const connId of connectedConnectorIds) {
                this.connectors = this.connectors.filter(c => c.id !== connId);
                this.publishConnectorDelete(connId);
            }
            connectorsDeleted += connectedConnectorIds.length;

            // Delete the child object
            this.objects = this.objects.filter(o => o.id !== childId);
            this.publishObjectDelete(childId);
        }

        // Delete the group itself
        this.objects = this.objects.filter(o => o.id !== group.id);
        this.publishObjectDelete(group.id);

        console.log(DEBUG_PREFIX, 'Deleted group with', childIds.length, 'children and', connectorsDeleted, 'connectors');
    }

    async publishObjectDelete(objectId) {
        console.log(DEBUG_PREFIX, 'Publishing object_delete:', objectId);
        try {
            await publishEvent({
                canvasId: this.canvasId,
                eventType: 'object_delete',
                payload: JSON.stringify({ id: objectId })
            });
        } catch (error) {
            console.error(DEBUG_PREFIX, 'Failed to publish object_delete:', error);
        }
    }

    isPointInObject(x, y, obj) {
        if (obj.type === 'circle') {
            const centerX = obj.x + obj.width / 2;
            const centerY = obj.y + obj.height / 2;
            const radius = Math.min(obj.width, obj.height) / 2;
            const dx = x - centerX;
            const dy = y - centerY;
            return dx * dx + dy * dy <= radius * radius;
        }

        // Diamond - point must be within rotated square shape
        if (obj.type === 'diamond') {
            const cx = obj.x + obj.width / 2;
            const cy = obj.y + obj.height / 2;
            // Transform point to diamond coordinate system
            const relX = Math.abs(x - cx) / (obj.width / 2);
            const relY = Math.abs(y - cy) / (obj.height / 2);
            return relX + relY <= 1;
        }

        // Triangle - check if point is inside triangle using barycentric coordinates
        if (obj.type === 'triangle') {
            const ax = obj.x + obj.width / 2, ay = obj.y;
            const bx = obj.x + obj.width, by = obj.y + obj.height;
            const cx = obj.x, cy = obj.y + obj.height;
            return this.isPointInTriangle(x, y, ax, ay, bx, by, cx, cy);
        }

        // Hexagon - simplified bounding box (close enough)
        if (obj.type === 'hexagon') {
            const cx = obj.x + obj.width / 2;
            const cy = obj.y + obj.height / 2;
            const rx = obj.width / 2;
            const ry = obj.height / 2;
            // Use ellipse approximation
            const dx = (x - cx) / rx;
            const dy = (y - cy) / ry;
            return dx * dx + dy * dy <= 1;
        }

        // Parallelogram - use polygon hit test
        if (obj.type === 'parallelogram') {
            const skew = obj.width * 0.2;
            const ax = obj.x + skew, ay = obj.y;
            const bx = obj.x + obj.width, by = obj.y;
            const cx = obj.x + obj.width - skew, cy = obj.y + obj.height;
            const dx = obj.x, dy = obj.y + obj.height;
            return this.isPointInPolygon(x, y, [
                { x: ax, y: ay }, { x: bx, y: by },
                { x: cx, y: cy }, { x: dx, y: dy }
            ]);
        }

        // Default bounding box check for other shapes
        return (
            x >= obj.x &&
            x <= obj.x + obj.width &&
            y >= obj.y &&
            y <= obj.y + obj.height
        );
    }

    // Helper: Check if point is inside triangle using barycentric coordinates
    isPointInTriangle(px, py, ax, ay, bx, by, cx, cy) {
        const v0x = cx - ax, v0y = cy - ay;
        const v1x = bx - ax, v1y = by - ay;
        const v2x = px - ax, v2y = py - ay;
        const dot00 = v0x * v0x + v0y * v0y;
        const dot01 = v0x * v1x + v0y * v1y;
        const dot02 = v0x * v2x + v0y * v2y;
        const dot11 = v1x * v1x + v1y * v1y;
        const dot12 = v1x * v2x + v1y * v2y;
        const inv = 1 / (dot00 * dot11 - dot01 * dot01);
        const u = (dot11 * dot02 - dot01 * dot12) * inv;
        const v = (dot00 * dot12 - dot01 * dot02) * inv;
        return u >= 0 && v >= 0 && u + v <= 1;
    }

    // Helper: Check if point is inside arbitrary polygon using ray casting
    isPointInPolygon(px, py, vertices) {
        let inside = false;
        const n = vertices.length;
        for (let i = 0, j = n - 1; i < n; j = i++) {
            const xi = vertices[i].x, yi = vertices[i].y;
            const xj = vertices[j].x, yj = vertices[j].y;
            if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) {
                inside = !inside;
            }
        }
        return inside;
    }

    // ========== Stroke Detection (for Eraser) ==========

    /**
     * @description Find stroke at given point using point-to-line distance
     * @param {number} x - X coordinate
     * @param {number} y - Y coordinate
     * @param {number} tolerance - Hit detection tolerance in pixels
     * @returns {Object|null} - Stroke at point or null
     */
    findStrokeAtPoint(x, y, tolerance = 10) {
        // Search from newest to oldest stroke
        for (let i = this.strokes.length - 1; i >= 0; i--) {
            const stroke = this.strokes[i];
            if (this.isPointNearStroke(x, y, stroke, tolerance)) {
                return stroke;
            }
        }
        return null;
    }

    /**
     * @description Check if a point is near any segment of a stroke
     * @param {number} px - Point X coordinate
     * @param {number} py - Point Y coordinate
     * @param {Object} stroke - Stroke object with points array
     * @param {number} tolerance - Distance tolerance in pixels
     * @returns {boolean} - True if point is near stroke
     */
    isPointNearStroke(px, py, stroke, tolerance = 10) {
        if (!stroke.points || stroke.points.length < 2) {
            return false;
        }

        for (let i = 0; i < stroke.points.length - 1; i++) {
            const p1 = stroke.points[i];
            const p2 = stroke.points[i + 1];
            const dist = this.pointToLineDistance(px, py, p1.x, p1.y, p2.x, p2.y);
            if (dist <= tolerance + (stroke.width || 2) / 2) {
                return true;
            }
        }
        return false;
    }

    /**
     * @description Calculate distance from point to line segment
     * @param {number} px - Point X
     * @param {number} py - Point Y
     * @param {number} x1 - Line start X
     * @param {number} y1 - Line start Y
     * @param {number} x2 - Line end X
     * @param {number} y2 - Line end Y
     * @returns {number} - Distance from point to line segment
     */
    pointToLineDistance(px, py, x1, y1, x2, y2) {
        const A = px - x1;
        const B = py - y1;
        const C = x2 - x1;
        const D = y2 - y1;

        const dot = A * C + B * D;
        const lenSq = C * C + D * D;
        let param = -1;

        if (lenSq !== 0) {
            param = dot / lenSq;
        }

        let xx, yy;
        if (param < 0) {
            xx = x1;
            yy = y1;
        } else if (param > 1) {
            xx = x2;
            yy = y2;
        } else {
            xx = x1 + param * C;
            yy = y1 + param * D;
        }

        const dx = px - xx;
        const dy = py - yy;
        return Math.sqrt(dx * dx + dy * dy);
    }

    /**
     * @description Delete a stroke and publish the deletion event
     * @param {Object} stroke - Stroke to delete
     */
    deleteStroke(stroke) {
        if (!stroke) return;

        // Record for undo before delete
        const strokeCopy = JSON.parse(JSON.stringify(stroke));
        this.recordAction('stroke_delete', { stroke: strokeCopy });

        console.log(DEBUG_PREFIX, 'Deleting stroke:', stroke.id);
        this.strokes = this.strokes.filter(s => s.id !== stroke.id);
        this.hoveredStroke = null;
        this.publishStrokeDelete(stroke.id);
    }

    /**
     * @description Find an object at the given coordinates (for eraser hover)
     * @param {number} x - X coordinate
     * @param {number} y - Y coordinate
     * @returns {Object|null} - Object at the point, or null
     */
    findObjectAt(x, y) {
        // Search from highest zIndex to lowest (topmost first)
        const sortedByZ = [...this.objects].sort((a, b) => (b.zIndex || 0) - (a.zIndex || 0));
        for (const obj of sortedByZ) {
            if (this.isPointInObject(x, y, obj)) {
                return obj;
            }
        }
        return null;
    }

    /**
     * @description Find a connector at the given coordinates (for eraser hover)
     * @param {number} x - X coordinate
     * @param {number} y - Y coordinate
     * @returns {Object|null} - Connector at the point, or null
     */
    findConnectorAt(x, y) {
        // Search from end to beginning (most recently added first)
        for (let i = this.connectors.length - 1; i >= 0; i--) {
            const conn = this.connectors[i];
            if (this.isPointOnConnector(x, y, conn)) {
                return conn;
            }
        }
        return null;
    }

    /**
     * @description Find a connector whose label contains the given point
     * @param {number} x - X coordinate
     * @param {number} y - Y coordinate
     * @returns {Object|null} - Connector with label at the point, or null
     */
    findConnectorLabelAt(x, y) {
        for (const connector of this.connectors) {
            if (!connector.label) continue;

            const start = this.resolveConnectorPoint(connector, 'start');
            const end = this.resolveConnectorPoint(connector, 'end');
            if (!start || !end) continue;

            const bounds = getConnectorLabelBounds(connector, start, end);
            if (bounds && this.isPointInRect(x, y, bounds)) {
                return connector;
            }
        }
        return null;
    }

    /**
     * @description Check if a point is inside a rectangle
     * @param {number} x - Point X
     * @param {number} y - Point Y
     * @param {Object} rect - Rectangle {x, y, width, height}
     * @returns {boolean}
     */
    isPointInRect(x, y, rect) {
        return x >= rect.x && x <= rect.x + rect.width &&
               y >= rect.y && y <= rect.y + rect.height;
    }

    /**
     * @description Delete an object via eraser tool
     * @param {Object} obj - Object to delete
     */
    deleteObjectWithEraser(obj) {
        if (!obj) return;

        console.log(DEBUG_PREFIX, 'Eraser deleting object:', obj.id, obj.type);

        // Find and delete any connectors attached to this object
        const connectedConnectorIds = this.connectors
            .filter(c => c.startAnchor?.objectId === obj.id || c.endAnchor?.objectId === obj.id)
            .map(c => c.id);

        for (const connId of connectedConnectorIds) {
            const conn = this.connectors.find(c => c.id === connId);
            if (conn) {
                this.connectors = this.connectors.filter(c => c.id !== connId);
                this.publishConnectorDelete(connId);
            }
        }

        // Remove the object
        this.objects = this.objects.filter(o => o.id !== obj.id);
        this.publishObjectDelete(obj.id);
        this.hoveredObject = null;
    }

    /**
     * @description Delete a connector via eraser tool
     * @param {Object} connector - Connector to delete
     */
    deleteConnectorWithEraser(connector) {
        if (!connector) return;

        console.log(DEBUG_PREFIX, 'Eraser deleting connector:', connector.id);
        this.connectors = this.connectors.filter(c => c.id !== connector.id);
        this.publishConnectorDelete(connector.id);
        this.hoveredConnector = null;
    }

    // ========== Drawing ==========

    startDrawing(x, y) {
        this.isDrawing = true;
        this.currentStroke = {
            id: this.generateId(),
            type: 'stroke',
            color: this.drawColor,
            width: this.drawStrokeWidth,
            points: [{ x, y }]
        };
    }

    finishDrawing() {
        if (this.currentStroke && this.currentStroke.points.length > 1) {
            this.strokes.push(this.currentStroke);
            this.publishStroke(this.currentStroke);
            // Record for undo
            this.recordAction('stroke_add', { strokeId: this.currentStroke.id });
        }
        this.currentStroke = null;
        this.isDrawing = false;
    }

    // ========== Connector Creation ==========

    startConnector(x, y) {
        // Check if starting from an anchor point
        const nearestAnchor = this.findNearestAnchor(x, y);

        this.isConnecting = true;
        this.currentConnector = {
            id: this.generateId(),
            type: 'connector',
            connectorType: this.connectorType,
            startX: nearestAnchor ? nearestAnchor.x : x,
            startY: nearestAnchor ? nearestAnchor.y : y,
            startAnchor: nearestAnchor ? {
                objectId: nearestAnchor.objectId,
                position: nearestAnchor.position
            } : null,
            endX: x,
            endY: y,
            endAnchor: null,
            color: '#333333',
            lineWidth: 2,
            zIndex: this.getNextZIndex()
        };

        // Add type-specific properties
        if (this.connectorType === 'elbow') {
            this.currentConnector.waypoints = [];
        } else if (this.connectorType === 'curved') {
            this.currentConnector.controlPoint1 = null;
            this.currentConnector.controlPoint2 = null;
        }

        console.log(DEBUG_PREFIX, 'Started connector:', this.currentConnector);
    }

    finishConnector() {
        if (!this.currentConnector) return;

        // Calculate minimum length to be a valid connector
        const start = this.resolveConnectorPoint(this.currentConnector, 'start');
        const end = this.resolveConnectorPoint(this.currentConnector, 'end');
        const length = Math.sqrt((end.x - start.x) ** 2 + (end.y - start.y) ** 2);

        // Only add if connector has meaningful length (>20px)
        if (length > 20) {
            // Calculate routing/control points for advanced connectors
            if (this.currentConnector.connectorType === 'elbow') {
                this.currentConnector.waypoints = this.calculateElbowRoute(
                    start, end,
                    this.currentConnector.startAnchor?.position,
                    this.currentConnector.endAnchor?.position
                );
            } else if (this.currentConnector.connectorType === 'curved') {
                const controlPoints = this.calculateBezierControlPoints(
                    start, end,
                    this.currentConnector.startAnchor?.position,
                    this.currentConnector.endAnchor?.position
                );
                this.currentConnector.controlPoint1 = controlPoints.cp1;
                this.currentConnector.controlPoint2 = controlPoints.cp2;
            }

            this.connectors.push(this.currentConnector);
            this.publishConnectorAdd(this.currentConnector);
            // Record for undo
            this.recordAction('connector_add', { connectorId: this.currentConnector.id });
            console.log(DEBUG_PREFIX, 'Connector created:', this.currentConnector);
        } else {
            console.log(DEBUG_PREFIX, 'Connector too short, discarded');
        }

        this.currentConnector = null;
        this.isConnecting = false;
        this.nearestAnchor = null;
    }

    /**
     * @description Calculate elbow route waypoints between start and end points
     * Creates orthogonal (right-angle) routing with max 2 waypoints
     */
    calculateElbowRoute(start, end, startAnchorPos, endAnchorPos) {
        const waypoints = [];

        // Determine the preferred directions based on anchor positions
        const startDir = this.getAnchorDirection(startAnchorPos);
        const endDir = this.getAnchorDirection(endAnchorPos);

        // Calculate midpoints with margin
        const midX = (start.x + end.x) / 2;
        const midY = (start.y + end.y) / 2;

        // Simple L-shaped or Z-shaped routing based on directions
        if (startDir === 'horizontal' && endDir === 'horizontal') {
            // Both horizontal - use vertical middle segment
            waypoints.push({ x: midX, y: start.y });
            waypoints.push({ x: midX, y: end.y });
        } else if (startDir === 'vertical' && endDir === 'vertical') {
            // Both vertical - use horizontal middle segment
            waypoints.push({ x: start.x, y: midY });
            waypoints.push({ x: end.x, y: midY });
        } else if (startDir === 'horizontal' && endDir === 'vertical') {
            // Horizontal to vertical - single corner
            waypoints.push({ x: end.x, y: start.y });
        } else if (startDir === 'vertical' && endDir === 'horizontal') {
            // Vertical to horizontal - single corner
            waypoints.push({ x: start.x, y: end.y });
        } else {
            // Default: use midpoint routing
            if (Math.abs(end.x - start.x) > Math.abs(end.y - start.y)) {
                // More horizontal - go horizontal first
                waypoints.push({ x: midX, y: start.y });
                waypoints.push({ x: midX, y: end.y });
            } else {
                // More vertical - go vertical first
                waypoints.push({ x: start.x, y: midY });
                waypoints.push({ x: end.x, y: midY });
            }
        }

        return waypoints;
    }

    /**
     * @description Get direction (horizontal or vertical) based on anchor position
     */
    getAnchorDirection(anchorPosition) {
        if (anchorPosition === 'left' || anchorPosition === 'right') {
            return 'horizontal';
        } else if (anchorPosition === 'top' || anchorPosition === 'bottom') {
            return 'vertical';
        }
        return 'horizontal'; // default
    }

    /**
     * @description Calculate bezier control points for curved connectors
     */
    calculateBezierControlPoints(start, end, startAnchorPos, endAnchorPos) {
        const dx = end.x - start.x;
        const dy = end.y - start.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        const offset = Math.min(distance * 0.4, 100); // Control point offset

        let cp1, cp2;

        // Calculate control points based on anchor positions for smooth exit/entry
        switch (startAnchorPos) {
            case 'right':
                cp1 = { x: start.x + offset, y: start.y };
                break;
            case 'left':
                cp1 = { x: start.x - offset, y: start.y };
                break;
            case 'bottom':
                cp1 = { x: start.x, y: start.y + offset };
                break;
            case 'top':
                cp1 = { x: start.x, y: start.y - offset };
                break;
            default:
                // Default: offset in direction of end
                cp1 = { x: start.x + dx * 0.25, y: start.y + dy * 0.1 };
        }

        switch (endAnchorPos) {
            case 'left':
                cp2 = { x: end.x - offset, y: end.y };
                break;
            case 'right':
                cp2 = { x: end.x + offset, y: end.y };
                break;
            case 'top':
                cp2 = { x: end.x, y: end.y - offset };
                break;
            case 'bottom':
                cp2 = { x: end.x, y: end.y + offset };
                break;
            default:
                // Default: offset in direction of start
                cp2 = { x: end.x - dx * 0.25, y: end.y - dy * 0.1 };
        }

        return { cp1, cp2 };
    }

    /**
     * @description Recalculate connector routing when anchored objects move
     */
    updateConnectorRouting(connector) {
        const start = this.resolveConnectorPoint(connector, 'start');
        const end = this.resolveConnectorPoint(connector, 'end');

        if (connector.connectorType === 'elbow') {
            connector.waypoints = this.calculateElbowRoute(
                start, end,
                connector.startAnchor?.position,
                connector.endAnchor?.position
            );
        } else if (connector.connectorType === 'curved') {
            // Keep existing control points but adjust them proportionally
            if (connector.controlPoint1 && connector.controlPoint2) {
                // Recalculate with new positions
                const controlPoints = this.calculateBezierControlPoints(
                    start, end,
                    connector.startAnchor?.position,
                    connector.endAnchor?.position
                );
                connector.controlPoint1 = controlPoints.cp1;
                connector.controlPoint2 = controlPoints.cp2;
            }
        }
    }

    // ========== Control Point Operations ==========

    /**
     * @description Check if click is on a control point and return which one
     */
    getControlPointAtPosition(x, y, connector) {
        const hitRadius = CONTROL_POINT_RADIUS + 4; // Extra hit area

        if (connector.connectorType === 'curved') {
            const cp1 = connector.controlPoint1;
            const cp2 = connector.controlPoint2;

            if (cp1) {
                const dist1 = Math.sqrt((x - cp1.x) ** 2 + (y - cp1.y) ** 2);
                if (dist1 <= hitRadius) return 'cp1';
            }
            if (cp2) {
                const dist2 = Math.sqrt((x - cp2.x) ** 2 + (y - cp2.y) ** 2);
                if (dist2 <= hitRadius) return 'cp2';
            }
        } else if (connector.connectorType === 'elbow' && connector.waypoints) {
            // Check waypoints for elbow connector
            for (let i = 0; i < connector.waypoints.length; i++) {
                const wp = connector.waypoints[i];
                const dist = Math.sqrt((x - wp.x) ** 2 + (y - wp.y) ** 2);
                if (dist <= hitRadius) return `wp${i}`;
            }
        }

        return null;
    }

    /**
     * @description Start dragging a control point
     */
    startControlPointDrag(controlPoint, x, y) {
        this.isDraggingControlPoint = true;
        this.activeControlPoint = controlPoint;
        this.canvas.style.cursor = 'move';
        console.log(DEBUG_PREFIX, 'Started control point drag:', controlPoint);
    }

    /**
     * @description Update control point position during drag
     */
    performControlPointDrag(x, y) {
        if (!this.selectedConnector || !this.activeControlPoint) return;

        const connector = this.selectedConnector;

        if (connector.connectorType === 'curved') {
            if (this.activeControlPoint === 'cp1') {
                connector.controlPoint1 = { x, y };
            } else if (this.activeControlPoint === 'cp2') {
                connector.controlPoint2 = { x, y };
            }
        } else if (connector.connectorType === 'elbow') {
            // Parse waypoint index from 'wpN' format
            const match = this.activeControlPoint.match(/^wp(\d+)$/);
            if (match) {
                const index = parseInt(match[1], 10);
                if (connector.waypoints && connector.waypoints[index]) {
                    // For elbow connectors, maintain orthogonal angles
                    const wp = connector.waypoints[index];
                    const prevPoint = index === 0
                        ? this.resolveConnectorPoint(connector, 'start')
                        : connector.waypoints[index - 1];
                    const nextPoint = index === connector.waypoints.length - 1
                        ? this.resolveConnectorPoint(connector, 'end')
                        : connector.waypoints[index + 1];

                    // Determine if this segment is horizontal or vertical
                    if (Math.abs(prevPoint.y - wp.y) < Math.abs(prevPoint.x - wp.x)) {
                        // Previous segment is horizontal - move vertically
                        connector.waypoints[index] = { x: wp.x, y };
                    } else {
                        // Previous segment is vertical - move horizontally
                        connector.waypoints[index] = { x, y: wp.y };
                    }
                }
            }
        }
    }

    /**
     * @description Finish control point drag and publish update
     */
    finishControlPointDrag() {
        if (this.selectedConnector) {
            this.publishConnectorUpdate(this.selectedConnector);
            console.log(DEBUG_PREFIX, 'Finished control point drag');
        }
        this.isDraggingControlPoint = false;
        this.activeControlPoint = null;
        this.canvas.style.cursor = 'default';
    }

    // ========== Endpoint Drag Operations ==========

    /**
     * @description Check if click is on a connector endpoint handle
     * @param {Object} connector - The connector to check
     * @param {number} x - Click x coordinate
     * @param {number} y - Click y coordinate
     * @returns {string|null} 'start' or 'end' if on endpoint, null otherwise
     */
    getClickedEndpoint(connector, x, y) {
        const threshold = 15; // Click threshold in pixels

        // Get actual endpoint positions
        const startPos = this.resolveConnectorPoint(connector, 'start');
        const endPos = this.resolveConnectorPoint(connector, 'end');

        // Check start endpoint
        const startDist = Math.hypot(x - startPos.x, y - startPos.y);
        if (startDist <= threshold) return 'start';

        // Check end endpoint
        const endDist = Math.hypot(x - endPos.x, y - endPos.y);
        if (endDist <= threshold) return 'end';

        return null;
    }

    /**
     * @description Start dragging a connector endpoint
     * @param {string} endpoint - 'start' or 'end'
     */
    startEndpointDrag(endpoint) {
        this.isDraggingEndpoint = true;
        this.draggingEndpoint = endpoint;
        this.draggingConnector = this.selectedConnector;
        this.potentialDropTarget = null;
        this.canvas.style.cursor = 'grabbing';
        console.log(DEBUG_PREFIX, 'Starting endpoint drag:', endpoint);
    }

    /**
     * @description Perform endpoint drag - move endpoint to new position
     * @param {number} x - Mouse x coordinate
     * @param {number} y - Mouse y coordinate
     */
    performEndpointDrag(x, y) {
        const connector = this.draggingConnector;
        if (!connector) return;

        // Update the endpoint position (make it floating)
        if (this.draggingEndpoint === 'start') {
            connector.startX = x;
            connector.startY = y;
            connector.startAnchor = null; // Detach from object
        } else {
            connector.endX = x;
            connector.endY = y;
            connector.endAnchor = null; // Detach from object
        }

        // Check for potential drop target (object to attach to)
        this.potentialDropTarget = this.findConnectableObjectAt(x, y);

        // Update connector routing for elbow/curved
        this.updateConnectorRouting(connector);
    }

    /**
     * @description Finish endpoint drag - attach to object or leave floating
     */
    finishEndpointDrag() {
        const connector = this.draggingConnector;
        if (!connector) {
            this.resetEndpointDragState();
            return;
        }

        // If there's a valid drop target, attach to it
        if (this.potentialDropTarget) {
            const dropTarget = this.potentialDropTarget;

            // Calculate the nearest anchor position on the drop target
            const nearestAnchor = this.findNearestAnchorOnObject(
                dropTarget,
                this.draggingEndpoint === 'start' ? connector.startX : connector.endX,
                this.draggingEndpoint === 'start' ? connector.startY : connector.endY
            );

            if (this.draggingEndpoint === 'start') {
                connector.startAnchor = {
                    objectId: dropTarget.id,
                    position: nearestAnchor.position
                };
                // Update position to snap to anchor
                const anchorPos = getAnchorPoint(dropTarget, nearestAnchor.position);
                connector.startX = anchorPos.x;
                connector.startY = anchorPos.y;
            } else {
                connector.endAnchor = {
                    objectId: dropTarget.id,
                    position: nearestAnchor.position
                };
                // Update position to snap to anchor
                const anchorPos = getAnchorPoint(dropTarget, nearestAnchor.position);
                connector.endX = anchorPos.x;
                connector.endY = anchorPos.y;
            }

            console.log(DEBUG_PREFIX, 'Attached endpoint to object:', dropTarget.id);
        } else {
            console.log(DEBUG_PREFIX, 'Endpoint left floating');
        }

        // Update connector routing
        this.updateConnectorRouting(connector);

        // Publish the update
        this.publishConnectorUpdate(connector);

        // Reset state
        this.resetEndpointDragState();
    }

    /**
     * @description Reset endpoint drag state
     */
    resetEndpointDragState() {
        this.isDraggingEndpoint = false;
        this.draggingEndpoint = null;
        this.draggingConnector = null;
        this.potentialDropTarget = null;
        this.canvas.style.cursor = 'default';
    }

    // ========== Connector Label Drag Methods ==========

    /**
     * @description Perform label drag - update label position along connector path
     * @param {number} x - Mouse x coordinate
     * @param {number} y - Mouse y coordinate
     */
    performLabelDrag(x, y) {
        const connector = this.draggingLabelConnector;
        if (!connector) return;

        const start = this.resolveConnectorPoint(connector, 'start');
        const end = this.resolveConnectorPoint(connector, 'end');
        if (!start || !end) return;

        // Find closest position on connector path
        const newPosition = findClosestPositionOnConnector(connector, start, end, x, y);
        connector.labelPosition = newPosition;
    }

    /**
     * @description Finish label drag - publish update
     */
    finishLabelDrag() {
        const connector = this.draggingLabelConnector;
        if (connector) {
            console.log(DEBUG_PREFIX, 'Label drag finished, position:', connector.labelPosition);
            this.publishConnectorUpdate(connector);
        }
        this.resetLabelDragState();
    }

    /**
     * @description Reset label drag state
     */
    resetLabelDragState() {
        this.isDraggingLabel = false;
        this.draggingLabelConnector = null;
        this.canvas.style.cursor = 'default';
    }

    /**
     * @description Find an object at position that can receive connector endpoints
     * @param {number} x - X coordinate
     * @param {number} y - Y coordinate
     * @returns {Object|null} The connectable object or null
     */
    findConnectableObjectAt(x, y) {
        // Get the object ID at the other end of the connector (to prevent same-object connection)
        const otherEndObjectId = this.getOtherEndObjectId();

        // Find objects that can receive connector endpoints
        // Exclude: connectors, drawings, groups, and the object at the other end
        const sortedByZ = [...this.objects].sort((a, b) => (b.zIndex || 0) - (a.zIndex || 0));

        for (const obj of sortedByZ) {
            // Skip non-connectable types
            if (obj.type === 'connector' || obj.type === 'drawing' || obj.type === 'group') {
                continue;
            }

            // Skip the object connected to the other end
            if (obj.id === otherEndObjectId) {
                continue;
            }

            // Check if point is in object
            if (this.isPointInObject(x, y, obj)) {
                return obj;
            }
        }

        return null;
    }

    /**
     * @description Get the object ID connected to the other end of the dragging connector
     * @returns {string|null} Object ID or null
     */
    getOtherEndObjectId() {
        if (!this.draggingConnector) return null;

        if (this.draggingEndpoint === 'start') {
            return this.draggingConnector.endAnchor?.objectId || null;
        } else {
            return this.draggingConnector.startAnchor?.objectId || null;
        }
    }

    /**
     * @description Find the nearest anchor position on an object
     * @param {Object} obj - The object to check
     * @param {number} x - Point x coordinate
     * @param {number} y - Point y coordinate
     * @returns {Object} { position: 'top'|'bottom'|'left'|'right', x, y }
     */
    findNearestAnchorOnObject(obj, x, y) {
        const anchors = [
            { position: 'top', ...getAnchorPoint(obj, 'top') },
            { position: 'bottom', ...getAnchorPoint(obj, 'bottom') },
            { position: 'left', ...getAnchorPoint(obj, 'left') },
            { position: 'right', ...getAnchorPoint(obj, 'right') }
        ];

        let nearest = anchors[0];
        let minDist = Infinity;

        for (const anchor of anchors) {
            const dist = Math.hypot(x - anchor.x, y - anchor.y);
            if (dist < minDist) {
                minDist = dist;
                nearest = anchor;
            }
        }

        return nearest;
    }

    // ========== Resize Operations ==========

    /**
     * @description Start resizing an object from a handle
     */
    startResize(handle, x, y) {
        this.isResizing = true;
        this.activeResizeHandle = handle;
        this.resizeStartState = {
            x: this.selectedObject.x,
            y: this.selectedObject.y,
            width: this.selectedObject.width,
            height: this.selectedObject.height,
            mouseX: x,
            mouseY: y
        };
        console.log(DEBUG_PREFIX, 'Starting resize from handle:', handle);
    }

    /**
     * @description Perform resize operation based on mouse position
     */
    performResize(mouseX, mouseY, shiftKey, altKey) {
        if (!this.selectedObject || !this.resizeStartState) return;

        const obj = this.selectedObject;
        const start = this.resizeStartState;
        const minSize = this.getMinSize(obj.type);

        // Calculate deltas from starting mouse position
        let deltaX = mouseX - start.mouseX;
        let deltaY = mouseY - start.mouseY;

        // Grid snapping (unless Alt is held)
        if (!altKey) {
            deltaX = this.snapToGrid(deltaX);
            deltaY = this.snapToGrid(deltaY);
        }

        let newX = start.x;
        let newY = start.y;
        let newWidth = start.width;
        let newHeight = start.height;

        // Calculate new dimensions based on handle position
        switch (this.activeResizeHandle) {
            case 'se': // Bottom-right: width and height increase
                newWidth = Math.max(minSize.width, Math.min(MAX_ELEMENT_SIZE, start.width + deltaX));
                newHeight = Math.max(minSize.height, Math.min(MAX_ELEMENT_SIZE, start.height + deltaY));
                break;
            case 'sw': // Bottom-left: width decreases (x moves), height increases
                newWidth = Math.max(minSize.width, Math.min(MAX_ELEMENT_SIZE, start.width - deltaX));
                newHeight = Math.max(minSize.height, Math.min(MAX_ELEMENT_SIZE, start.height + deltaY));
                newX = start.x + start.width - newWidth;
                break;
            case 'ne': // Top-right: width increases, height decreases (y moves)
                newWidth = Math.max(minSize.width, Math.min(MAX_ELEMENT_SIZE, start.width + deltaX));
                newHeight = Math.max(minSize.height, Math.min(MAX_ELEMENT_SIZE, start.height - deltaY));
                newY = start.y + start.height - newHeight;
                break;
            case 'nw': // Top-left: both decrease, x and y move
                newWidth = Math.max(minSize.width, Math.min(MAX_ELEMENT_SIZE, start.width - deltaX));
                newHeight = Math.max(minSize.height, Math.min(MAX_ELEMENT_SIZE, start.height - deltaY));
                newX = start.x + start.width - newWidth;
                newY = start.y + start.height - newHeight;
                break;
            case 'n': // Top: only height decreases, y moves
                newHeight = Math.max(minSize.height, Math.min(MAX_ELEMENT_SIZE, start.height - deltaY));
                newY = start.y + start.height - newHeight;
                break;
            case 's': // Bottom: only height increases
                newHeight = Math.max(minSize.height, Math.min(MAX_ELEMENT_SIZE, start.height + deltaY));
                break;
            case 'e': // Right: only width increases
                newWidth = Math.max(minSize.width, Math.min(MAX_ELEMENT_SIZE, start.width + deltaX));
                break;
            case 'w': // Left: only width decreases, x moves
                newWidth = Math.max(minSize.width, Math.min(MAX_ELEMENT_SIZE, start.width - deltaX));
                newX = start.x + start.width - newWidth;
                break;
        }

        // Aspect ratio lock (Shift key + corner handles only)
        if (shiftKey && ['nw', 'ne', 'sw', 'se'].includes(this.activeResizeHandle)) {
            const originalRatio = start.width / start.height;
            const currentRatio = newWidth / newHeight;

            if (currentRatio > originalRatio) {
                // Width is proportionally larger, adjust height
                newHeight = newWidth / originalRatio;
                if (newHeight > MAX_ELEMENT_SIZE) {
                    newHeight = MAX_ELEMENT_SIZE;
                    newWidth = newHeight * originalRatio;
                }
            } else {
                // Height is proportionally larger, adjust width
                newWidth = newHeight * originalRatio;
                if (newWidth > MAX_ELEMENT_SIZE) {
                    newWidth = MAX_ELEMENT_SIZE;
                    newHeight = newWidth / originalRatio;
                }
            }

            // Recalculate position for handles that move the origin
            if (this.activeResizeHandle === 'nw') {
                newX = start.x + start.width - newWidth;
                newY = start.y + start.height - newHeight;
            } else if (this.activeResizeHandle === 'ne') {
                newY = start.y + start.height - newHeight;
            } else if (this.activeResizeHandle === 'sw') {
                newX = start.x + start.width - newWidth;
            }
            // se doesn't move origin
        }

        // Apply the new dimensions
        obj.x = newX;
        obj.y = newY;
        obj.width = newWidth;
        obj.height = newHeight;
    }

    /**
     * @description Finish resize operation and publish changes
     */
    finishResize() {
        if (this.selectedObject) {
            // Record resize if dimensions changed
            if (this.resizeStartState &&
                (this.resizeStartState.x !== this.selectedObject.x ||
                 this.resizeStartState.y !== this.selectedObject.y ||
                 this.resizeStartState.width !== this.selectedObject.width ||
                 this.resizeStartState.height !== this.selectedObject.height)) {
                this.recordAction('object_resize', {
                    objectId: this.selectedObject.id,
                    previousX: this.resizeStartState.x,
                    previousY: this.resizeStartState.y,
                    previousWidth: this.resizeStartState.width,
                    previousHeight: this.resizeStartState.height
                });
            }

            console.log(DEBUG_PREFIX, 'Resize finished:', {
                width: this.selectedObject.width,
                height: this.selectedObject.height
            });
            this.publishObjectResize(this.selectedObject);
        }

        this.isResizing = false;
        this.activeResizeHandle = null;
        this.resizeStartState = null;
        this.canvas.style.cursor = 'default';
    }

    // ========== Color & Styling ==========

    handleFillColorClick() {
        this.showFillColorPicker = !this.showFillColorPicker;
        this.showBorderColorPicker = false;
        this.showDrawColorPicker = false;
    }

    handleBorderColorClick() {
        this.showBorderColorPicker = !this.showBorderColorPicker;
        this.showFillColorPicker = false;
        this.showDrawColorPicker = false;
    }

    handleDrawColorClick() {
        this.showDrawColorPicker = !this.showDrawColorPicker;
        this.showFillColorPicker = false;
        this.showBorderColorPicker = false;
    }

    handleColorSelect(event) {
        const color = event.currentTarget.dataset.color;
        const target = event.currentTarget.dataset.target;

        if (target === 'fill') {
            // Handle connector color
            if (this.selectedConnector) {
                this.selectedConnector.color = color;
                this.publishConnectorUpdate(this.selectedConnector);
                this.showFillColorPicker = false;
            } else if (this.selectedObject) {
                this.selectedObject.color = color;
                this.publishObjectStyle(this.selectedObject);
                this.showFillColorPicker = false;
            }
        } else if (target === 'border' && this.selectedObject) {
            this.selectedObject.borderColor = color;
            this.publishObjectStyle(this.selectedObject);
            this.showBorderColorPicker = false;
        } else if (target === 'draw') {
            this.drawColor = color;
            this.showDrawColorPicker = false;
        }
    }

    handleCustomFillColor(event) {
        const color = event.target.value;
        if (/^#[0-9A-Fa-f]{6}$/.test(color)) {
            // Handle connector custom color
            if (this.selectedConnector) {
                this.selectedConnector.color = color;
                this.publishConnectorUpdate(this.selectedConnector);
                this.showFillColorPicker = false;
            } else if (this.selectedObject) {
                this.selectedObject.color = color;
                this.publishObjectStyle(this.selectedObject);
                this.showFillColorPicker = false;
            }
        }
    }

    // Handle connector label button click
    handleConnectorLabelClick() {
        if (this.selectedConnector) {
            this.startConnectorLabelEditing(this.selectedConnector);
        }
    }

    handleStrokeWidthChange(event) {
        this.drawStrokeWidth = parseInt(event.target.value, 10);
    }

    handleDeleteFromToolbar() {
        if (this.selectedObject) {
            this.deleteSelectedObject();
        }
    }

    // Text Alignment Handlers
    handleAlignTop() {
        this.setTextAlignment('top');
    }
    handleAlignMiddle() {
        this.setTextAlignment('middle');
    }
    handleAlignBottom() {
        this.setTextAlignment('bottom');
    }
    setTextAlignment(alignment) {
        if (!this.selectedObject) return;
        this.selectedObject.textAlign = alignment;
        this.publishObjectUpdate(this.selectedObject);
        this.draw();
    }

    // Text Overflow Handlers
    handleTextOverflowToggle() {
        // Close color pickers first (without closing text dropdowns)
        this.showFillColorPicker = false;
        this.showBorderColorPicker = false;
        this.showDrawColorPicker = false;
        // Toggle this dropdown, close the other text dropdown
        this.showFontSizePicker = false;
        this.showTextOverflowPicker = !this.showTextOverflowPicker;
    }
    handleTextOverflowChange(event) {
        if (!this.selectedObject) return;
        const value = event.currentTarget.dataset.value;
        this.selectedObject.textOverflow = value;
        this.showTextOverflowPicker = false;
        this.publishObjectUpdate(this.selectedObject);
        this.draw();
    }

    // Font Size Handlers
    handleFontSizeToggle() {
        // Close color pickers first (without closing text dropdowns)
        this.showFillColorPicker = false;
        this.showBorderColorPicker = false;
        this.showDrawColorPicker = false;
        // Toggle this dropdown, close the other text dropdown
        this.showTextOverflowPicker = false;
        this.showFontSizePicker = !this.showFontSizePicker;
    }
    handleFontSizeChange(event) {
        if (!this.selectedObject) return;
        const value = parseInt(event.currentTarget.dataset.value, 10);
        this.selectedObject.fontSize = value;
        this.showFontSizePicker = false;
        this.publishObjectUpdate(this.selectedObject);
        this.draw();
    }

    closeAllColorPickers() {
        this.showFillColorPicker = false;
        this.showBorderColorPicker = false;
        this.showDrawColorPicker = false;
        // Also close text control dropdowns
        this.showTextOverflowPicker = false;
        this.showFontSizePicker = false;
    }

    // ========== Layer Management ==========

    /**
     * @description Bring selected element (object or connector) to front (highest zIndex)
     */
    handleBringToFront() {
        const selected = this.selectedObject || this.selectedConnector;
        if (!selected || this.isAtFront) return;

        const allElements = [...this.objects, ...this.connectors];
        const maxZ = Math.max(...allElements.map(e => e.zIndex || 0));
        selected.zIndex = maxZ + 1;

        if (this.selectedConnector) {
            this.publishConnectorLayerChange(this.selectedConnector);
        } else {
            this.publishLayerChange(this.selectedObject);
        }
    }

    /**
     * @description Bring selected element forward one layer
     */
    handleBringForward() {
        const selected = this.selectedObject || this.selectedConnector;
        if (!selected || this.isAtFront) return;

        const currentZ = selected.zIndex || 0;
        const allElements = [...this.objects, ...this.connectors];

        // Find the element immediately above
        const above = allElements.find(e => (e.zIndex || 0) === currentZ + 1);
        if (above) {
            // Swap zIndex values
            above.zIndex = currentZ;
            selected.zIndex = currentZ + 1;
            // Publish changes for both elements
            if (above.type === 'connector') {
                this.publishConnectorLayerChange(above);
            } else {
                this.publishLayerChange(above);
            }
        } else {
            // No element immediately above, just increment
            selected.zIndex = currentZ + 1;
        }

        if (this.selectedConnector) {
            this.publishConnectorLayerChange(this.selectedConnector);
        } else {
            this.publishLayerChange(this.selectedObject);
        }
    }

    /**
     * @description Send selected element backward one layer
     */
    handleSendBackward() {
        const selected = this.selectedObject || this.selectedConnector;
        if (!selected || this.isAtBack) return;

        const currentZ = selected.zIndex || 0;
        if (currentZ <= 1) return;

        const allElements = [...this.objects, ...this.connectors];

        // Find the element immediately below
        const below = allElements.find(e => (e.zIndex || 0) === currentZ - 1);
        if (below) {
            // Swap zIndex values
            below.zIndex = currentZ;
            selected.zIndex = currentZ - 1;
            // Publish changes for both elements
            if (below.type === 'connector') {
                this.publishConnectorLayerChange(below);
            } else {
                this.publishLayerChange(below);
            }
        } else {
            // No element immediately below, just decrement
            selected.zIndex = currentZ - 1;
        }

        if (this.selectedConnector) {
            this.publishConnectorLayerChange(this.selectedConnector);
        } else {
            this.publishLayerChange(this.selectedObject);
        }
    }

    /**
     * @description Send selected element to back (lowest zIndex)
     */
    handleSendToBack() {
        const selected = this.selectedObject || this.selectedConnector;
        if (!selected || this.isAtBack) return;

        const currentZ = selected.zIndex || 0;
        const allElements = [...this.objects, ...this.connectors];

        // Shift all elements below current one up by 1
        allElements.forEach(e => {
            if (e !== selected && (e.zIndex || 0) < currentZ) {
                e.zIndex = (e.zIndex || 0) + 1;
                if (e.type === 'connector') {
                    this.publishConnectorLayerChange(e);
                } else {
                    this.publishLayerChange(e);
                }
            }
        });

        selected.zIndex = 1;
        if (this.selectedConnector) {
            this.publishConnectorLayerChange(this.selectedConnector);
        } else {
            this.publishLayerChange(this.selectedObject);
        }
    }

    /**
     * @description Publish layer change event for object sync
     */
    async publishLayerChange(obj) {
        try {
            await publishEvent({
                canvasId: this.canvasId,
                eventType: 'object_layer',
                payload: JSON.stringify({
                    id: obj.id,
                    zIndex: obj.zIndex
                })
            });
        } catch (error) {
            console.error(DEBUG_PREFIX, 'Failed to publish object_layer:', error);
        }
    }

    /**
     * @description Publish layer change event for connector sync
     */
    async publishConnectorLayerChange(connector) {
        try {
            await publishEvent({
                canvasId: this.canvasId,
                eventType: 'connector_layer',
                payload: JSON.stringify({
                    id: connector.id,
                    zIndex: connector.zIndex
                })
            });
        } catch (error) {
            console.error(DEBUG_PREFIX, 'Failed to publish connector_layer:', error);
        }
    }

    /**
     * @description Handle remote layer change event for objects
     */
    handleRemoteLayerChange(payload) {
        const obj = this.objects.find(o => o.id === payload.id);
        if (obj) {
            obj.zIndex = payload.zIndex;
        }
    }

    /**
     * @description Handle remote layer change event for connectors
     */
    handleRemoteConnectorLayerChange(payload) {
        const conn = this.connectors.find(c => c.id === payload.id);
        if (conn) {
            conn.zIndex = payload.zIndex;
        }
    }

    // ========== Object Creation ==========

    addSticky(color) {
        const obj = {
            id: this.generateId(),
            type: 'sticky',
            x: 100 + Math.random() * 200,
            y: 100 + Math.random() * 200,
            width: 150,
            height: 150,
            color: color,
            text: 'Double-click to edit',
            zIndex: this.getNextZIndex()
        };
        this.objects.push(obj);
        this.publishObjectAdd(obj);
        // Record for undo
        this.recordAction('object_add', { objectId: obj.id });
    }

    handleAddRectangle() {
        const obj = {
            id: this.generateId(),
            type: 'rectangle',
            x: 100 + Math.random() * 200,
            y: 100 + Math.random() * 200,
            width: 120,
            height: 80,
            color: '#E8E8E8',
            zIndex: this.getNextZIndex()
        };
        this.objects.push(obj);
        this.publishObjectAdd(obj);
        this.showShapePalette = false;
        // Record for undo
        this.recordAction('object_add', { objectId: obj.id });
    }

    handleAddCircle() {
        const obj = {
            id: this.generateId(),
            type: 'circle',
            x: 100 + Math.random() * 200,
            y: 100 + Math.random() * 200,
            width: 80,
            height: 80,
            color: '#E8E8E8',
            zIndex: this.getNextZIndex()
        };
        this.objects.push(obj);
        this.publishObjectAdd(obj);
        this.showShapePalette = false;
        // Record for undo
        this.recordAction('object_add', { objectId: obj.id });
    }

    handleAddDiamond() {
        this.addShape('diamond', 80, 80);
    }

    handleAddTriangle() {
        this.addShape('triangle', 80, 70);
    }

    handleAddHexagon() {
        this.addShape('hexagon', 100, 87);
    }

    handleAddParallelogram() {
        this.addShape('parallelogram', 100, 60);
    }

    handleAddCylinder() {
        this.addShape('cylinder', 60, 80);
    }

    handleAddCloud() {
        this.addShape('cloud', 120, 80);
    }

    handleAddRoundedRectangle() {
        this.addShape('rounded_rectangle', 100, 60);
    }

    handleAddDocument() {
        this.addShape('document', 80, 100);
    }

    // Generic shape adder
    addShape(type, width, height) {
        const obj = {
            id: this.generateId(),
            type: type,
            x: 100 + Math.random() * 200,
            y: 100 + Math.random() * 200,
            width: width,
            height: height,
            color: '#E8E8E8',
            zIndex: this.getNextZIndex()
        };
        this.objects.push(obj);
        this.publishObjectAdd(obj);
        this.showShapePalette = false;
        // Record for undo
        this.recordAction('object_add', { objectId: obj.id });
    }

    // Toggle shape palette dropdown
    handleToggleShapePalette() {
        this.showShapePalette = !this.showShapePalette;
        // Close other dropdowns
        this.showFillColorPicker = false;
        this.showBorderColorPicker = false;
        this.showDrawColorPicker = false;
        this.showStickyPalette = false;
        this.showConnectorPalette = false;
    }

    // Toggle sticky palette dropdown
    handleToggleStickyPalette() {
        this.showStickyPalette = !this.showStickyPalette;
        // Close other dropdowns
        this.showShapePalette = false;
        this.showConnectorPalette = false;
        this.showFillColorPicker = false;
        this.showBorderColorPicker = false;
        this.showDrawColorPicker = false;
    }

    // Add sticky note from palette
    handleAddStickyFromPalette(event) {
        const color = event.currentTarget.dataset.color;
        this.addSticky(color);
        this.showStickyPalette = false;
    }

    // Toggle connector palette dropdown
    handleToggleConnectorPalette() {
        this.showConnectorPalette = !this.showConnectorPalette;
        // Close other dropdowns
        this.showShapePalette = false;
        this.showStickyPalette = false;
        this.showFillColorPicker = false;
        this.showBorderColorPicker = false;
        this.showDrawColorPicker = false;
    }

    // Select connector type from palette
    handleSelectConnectorFromPalette(event) {
        const type = event.currentTarget.dataset.type;
        this.currentTool = 'connector';
        this.connectorType = type;
        this.selectedObject = null;
        this.selectedConnector = null;
        this.showConnectorPalette = false;
    }

    // Close all dropdown menus
    closeAllDropdowns() {
        this.showShapePalette = false;
        this.showStickyPalette = false;
        this.showConnectorPalette = false;
        this.showFillColorPicker = false;
        this.showBorderColorPicker = false;
        this.showDrawColorPicker = false;
    }

    // ========== Help Modal ==========

    handleOpenHelp() {
        this.showHelpModal = true;
    }

    handleCloseHelp() {
        this.showHelpModal = false;
    }

    handleHelpBackdropClick() {
        this.showHelpModal = false;
    }

    // ========== Remote Event Handlers ==========

    handleRemoteObjectAdd(payload) {
        // Check if object already exists
        const exists = this.objects.some((o) => o.id === payload.id);
        if (!exists) {
            this.objects.push(payload);
        }
    }

    handleRemoteObjectMove(payload) {
        const obj = this.objects.find((o) => o.id === payload.id);
        if (obj) {
            // Merge all properties from payload (position, text, styles, etc.)
            Object.assign(obj, payload);
        }
    }

    handleRemoteObjectResize(payload) {
        const obj = this.objects.find((o) => o.id === payload.id);
        if (obj) {
            obj.x = payload.x;
            obj.y = payload.y;
            obj.width = payload.width;
            obj.height = payload.height;
        }
    }

    handleRemoteObjectStyle(payload) {
        const obj = this.objects.find((o) => o.id === payload.id);
        if (obj) {
            if (payload.color) obj.color = payload.color;
            if (payload.borderColor) obj.borderColor = payload.borderColor;
            if (payload.borderWidth !== undefined) obj.borderWidth = payload.borderWidth;
        }
    }

    handleRemoteObjectDelete(payload) {
        this.objects = this.objects.filter((o) => o.id !== payload.id);
    }

    handleRemoteStroke(payload) {
        const exists = this.strokes.some((s) => s.id === payload.id);
        if (!exists) {
            this.strokes.push(payload);
        }
    }

    handleRemoteStrokeDelete(payload) {
        this.strokes = this.strokes.filter((s) => s.id !== payload.id);
        // Clear hovered stroke if it was the one deleted
        if (this.hoveredStroke && this.hoveredStroke.id === payload.id) {
            this.hoveredStroke = null;
        }
    }

    handleRemoteConnectorAdd(payload) {
        console.log(DEBUG_PREFIX, 'handleRemoteConnectorAdd received:', payload);
        const exists = this.connectors.some((c) => c.id === payload.id);
        if (!exists) {
            this.connectors.push(payload);
            console.log(DEBUG_PREFIX, 'Connector added, total connectors:', this.connectors.length);
        } else {
            console.log(DEBUG_PREFIX, 'Connector already exists, skipped');
        }
    }

    handleRemoteConnectorDelete(payload) {
        this.connectors = this.connectors.filter((c) => c.id !== payload.id);
        // Deselect if the deleted connector was selected
        if (this.selectedConnector && this.selectedConnector.id === payload.id) {
            this.selectedConnector = null;
        }
    }

    handleRemoteConnectorUpdate(payload) {
        const index = this.connectors.findIndex((c) => c.id === payload.id);
        if (index !== -1) {
            // Update the connector with new data
            this.connectors[index] = { ...this.connectors[index], ...payload };
            // Update selected connector reference if it's the one being updated
            if (this.selectedConnector && this.selectedConnector.id === payload.id) {
                this.selectedConnector = this.connectors[index];
            }
        }
    }

    // ========== Event Publishing ==========

    async publishObjectAdd(obj) {
        console.log(DEBUG_PREFIX, 'Publishing object_add:', obj);
        try {
            await publishEvent({
                canvasId: this.canvasId,
                eventType: 'object_add',
                payload: JSON.stringify(obj)
            });
        } catch (error) {
            console.error(DEBUG_PREFIX, 'Failed to publish object_add:', error);
        }
    }

    async publishObjectMove(obj) {
        try {
            await publishEvent({
                canvasId: this.canvasId,
                eventType: 'object_move',
                payload: JSON.stringify({ id: obj.id, x: obj.x, y: obj.y })
            });
        } catch (error) {
            console.error(DEBUG_PREFIX, 'Failed to publish object_move:', error);
        }
    }

    async publishObjectResize(obj) {
        console.log(DEBUG_PREFIX, 'Publishing object_resize:', obj.id);
        try {
            await publishEvent({
                canvasId: this.canvasId,
                eventType: 'object_resize',
                payload: JSON.stringify({
                    id: obj.id,
                    x: obj.x,
                    y: obj.y,
                    width: obj.width,
                    height: obj.height
                })
            });
        } catch (error) {
            console.error(DEBUG_PREFIX, 'Failed to publish object_resize:', error);
        }
    }

    async publishObjectStyle(obj) {
        console.log(DEBUG_PREFIX, 'Publishing object_style:', obj.id);
        try {
            await publishEvent({
                canvasId: this.canvasId,
                eventType: 'object_style',
                payload: JSON.stringify({
                    id: obj.id,
                    color: obj.color,
                    borderColor: obj.borderColor,
                    borderWidth: obj.borderWidth
                })
            });
        } catch (error) {
            console.error(DEBUG_PREFIX, 'Failed to publish object_style:', error);
        }
    }

    async publishStroke(stroke) {
        console.log(DEBUG_PREFIX, 'Publishing stroke');
        try {
            await publishEvent({
                canvasId: this.canvasId,
                eventType: 'draw_stroke',
                payload: JSON.stringify(stroke)
            });
        } catch (error) {
            console.error(DEBUG_PREFIX, 'Failed to publish draw_stroke:', error);
        }
    }

    async publishStrokeDelete(strokeId) {
        console.log(DEBUG_PREFIX, 'Publishing stroke_delete:', strokeId);
        try {
            await publishEvent({
                canvasId: this.canvasId,
                eventType: 'stroke_delete',
                payload: JSON.stringify({ id: strokeId })
            });
        } catch (error) {
            console.error(DEBUG_PREFIX, 'Failed to publish stroke_delete:', error);
        }
    }

    async publishConnectorAdd(connector) {
        console.log(DEBUG_PREFIX, 'Publishing connector_add:', connector);
        try {
            await publishEvent({
                canvasId: this.canvasId,
                eventType: 'connector_add',
                payload: JSON.stringify(connector)
            });
        } catch (error) {
            console.error(DEBUG_PREFIX, 'Failed to publish connector_add:', error);
        }
    }

    async publishConnectorDelete(connectorId) {
        console.log(DEBUG_PREFIX, 'Publishing connector_delete:', connectorId);
        try {
            await publishEvent({
                canvasId: this.canvasId,
                eventType: 'connector_delete',
                payload: JSON.stringify({ id: connectorId })
            });
        } catch (error) {
            console.error(DEBUG_PREFIX, 'Failed to publish connector_delete:', error);
        }
    }

    async publishConnectorUpdate(connector) {
        console.log(DEBUG_PREFIX, 'Publishing connector_update:', connector);
        try {
            await publishEvent({
                canvasId: this.canvasId,
                eventType: 'connector_update',
                payload: JSON.stringify(connector)
            });
        } catch (error) {
            console.error(DEBUG_PREFIX, 'Failed to publish connector_update:', error);
        }
    }

    async announceJoin() {
        console.log(DEBUG_PREFIX, 'Announcing join');
        try {
            await publishEvent({
                canvasId: this.canvasId,
                eventType: 'user_join',
                payload: JSON.stringify({ timestamp: Date.now() })
            });
            // Reload state after delay to get any unsaved changes from other users
            // Other users auto-save when they receive user_join event
            setTimeout(() => {
                console.log(DEBUG_PREFIX, 'Reloading state after join delay');
                this.loadState();
            }, 1000);
        } catch (error) {
            console.error(DEBUG_PREFIX, 'Failed to announce join:', error);
        }
    }

    async announceLeave() {
        console.log(DEBUG_PREFIX, 'Announcing leave');
        try {
            await publishEvent({
                canvasId: this.canvasId,
                eventType: 'user_leave',
                payload: JSON.stringify({ timestamp: Date.now() })
            });
        } catch (error) {
            // Ignore errors on disconnect
        }
    }

    // ========== Persistence ==========

    /**
     * Silent save triggered when a new user joins.
     * Ensures joining user loads the current canvas state.
     */
    async saveStateForNewUser() {
        try {
            const state = {
                objects: this.objects,
                strokes: this.strokes,
                connectors: this.connectors
            };
            await saveCanvasState({
                canvasId: this.canvasId,
                stateJson: JSON.stringify(state)
            });
            console.log(DEBUG_PREFIX, 'Auto-saved state for new user');
        } catch (error) {
            console.error(DEBUG_PREFIX, 'Auto-save for new user failed:', error);
        }
    }

    async handleSave() {
        console.log(DEBUG_PREFIX, '=== handleSave START ===');
        console.log(DEBUG_PREFIX, 'canvasId:', this.canvasId);
        console.log(DEBUG_PREFIX, 'objects count:', this.objects.length);
        console.log(DEBUG_PREFIX, 'strokes count:', this.strokes.length);
        console.log(DEBUG_PREFIX, 'connectors count:', this.connectors.length);

        try {
            const state = {
                objects: this.objects,
                strokes: this.strokes,
                connectors: this.connectors
            };
            console.log(DEBUG_PREFIX, 'State to save:', JSON.stringify(state, null, 2));

            await saveCanvasState({
                canvasId: this.canvasId,
                stateJson: JSON.stringify(state)
            });

            console.log(DEBUG_PREFIX, 'Save successful!');
            this.showToast('Success', 'Canvas saved successfully', 'success');
        } catch (error) {
            console.error(DEBUG_PREFIX, 'Save error:', error);
            console.error(DEBUG_PREFIX, 'Error body:', error.body);
            this.showToast('Error', 'Failed to save canvas', 'error');
        }
    }

    async loadState() {
        console.log(DEBUG_PREFIX, '=== loadState START ===');
        console.log(DEBUG_PREFIX, 'canvasId:', this.canvasId);
        console.log(DEBUG_PREFIX, 'recordId:', this.recordId);

        // Track which recordId we're loading for
        this._stateLoadedForRecordId = this.recordId;

        try {
            console.log(DEBUG_PREFIX, 'Calling Apex loadCanvasState...');
            const result = await loadCanvasState({ canvasId: this.canvasId });

            console.log(DEBUG_PREFIX, 'Apex raw result:', result);
            console.log(DEBUG_PREFIX, 'Result length:', result ? result.length : 0);

            const state = JSON.parse(result || '{}');
            console.log(DEBUG_PREFIX, 'Parsed state:', JSON.stringify(state, null, 2));

            if (state.objects) {
                console.log(DEBUG_PREFIX, 'Loading', state.objects.length, 'objects');
                this.objects = state.objects;
            }
            if (state.strokes) {
                console.log(DEBUG_PREFIX, 'Loading', state.strokes.length, 'strokes');
                this.strokes = state.strokes;
            }
            if (state.connectors) {
                console.log(DEBUG_PREFIX, 'Loading', state.connectors.length, 'connectors');
                this.connectors = state.connectors;
            }

            console.log(DEBUG_PREFIX, '=== loadState END (success) ===');
        } catch (error) {
            console.error(DEBUG_PREFIX, 'Failed to load state:', error);
            console.error(DEBUG_PREFIX, 'Error body:', error.body);
        }
    }

    // ========== Modal Actions ==========

    handleClose() {
        console.log(DEBUG_PREFIX, '=== handleClose START ===');
        console.log(DEBUG_PREFIX, 'recordId:', this.recordId);

        this.cleanup();

        // Refresh the record page so the viewer picks up new state
        console.log(DEBUG_PREFIX, 'Refreshing record page...');
        this.refreshRecordPage();

        // Close the modal
        console.log(DEBUG_PREFIX, 'Dispatching CloseActionScreenEvent');
        this.dispatchEvent(new CloseActionScreenEvent());

        console.log(DEBUG_PREFIX, '=== handleClose END ===');
    }

    refreshRecordPage() {
        // Method 1: Use notifyRecordUpdateAvailable (LWC standard)
        if (this.recordId) {
            console.log(DEBUG_PREFIX, 'Using notifyRecordUpdateAvailable for:', this.recordId);
            try {
                notifyRecordUpdateAvailable([{ recordId: this.recordId }]);
            } catch (e) {
                console.log(DEBUG_PREFIX, 'notifyRecordUpdateAvailable error:', e);
            }
        }

        // Method 2: Use Aura force:refreshView for broader refresh
        console.log(DEBUG_PREFIX, 'Attempting force:refreshView...');
        try {
            // eslint-disable-next-line no-eval
            eval("$A.get('e.force:refreshView').fire()");
            console.log(DEBUG_PREFIX, 'force:refreshView fired successfully');
        } catch (e) {
            console.log(DEBUG_PREFIX, 'force:refreshView not available:', e.message);
            // Method 3: Full page reload as last resort
            console.log(DEBUG_PREFIX, 'Triggering full page reload...');
            setTimeout(() => {
                window.location.reload();
            }, 100);
        }
    }

    // ========== Record Selector Modal ==========

    handleOpenRecordModal() {
        this.isRecordModalOpen = true;
        this.recordModalTab = 'contacts';
        this.recordSearchTerm = '';
        this.selectedRecordIds = [];
        this.loadRecordsForTab();
    }

    handleCloseRecordModal() {
        this.isRecordModalOpen = false;
        this.availableRecords = [];
        this.selectedRecordIds = [];
    }

    handleRecordTabClick(event) {
        const tab = event.currentTarget.dataset.tab;
        if (tab !== this.recordModalTab) {
            this.recordModalTab = tab;
            this.recordSearchTerm = '';
            this.loadRecordsForTab();
        }
    }

    handleRecordSearchChange(event) {
        this.recordSearchTerm = event.target.value;
        // Debounce search
        clearTimeout(this._searchTimeout);
        this._searchTimeout = setTimeout(() => {
            this.loadRecordsForTab();
        }, 300);
    }

    async loadRecordsForTab(showLoading = true) {
        // Only show loading spinner for initial tab load, not for search refinements
        if (showLoading && this.availableRecords.length === 0) {
            this.isLoadingRecords = true;
        }
        try {
            let records = [];
            if (this.recordModalTab === 'contacts') {
                records = await getRelatedContacts({
                    accountId: this.recordId,
                    searchTerm: this.recordSearchTerm || null
                });
            } else if (this.recordModalTab === 'opportunities') {
                records = await getRelatedOpportunities({
                    accountId: this.recordId,
                    searchTerm: this.recordSearchTerm || null
                });
            } else if (this.recordModalTab === 'leads') {
                if (this.recordSearchTerm && this.recordSearchTerm.length >= 2) {
                    records = await searchLeads({
                        searchTerm: this.recordSearchTerm
                    });
                } else {
                    records = [];
                }
            } else if (this.recordModalTab === 'users') {
                if (this.recordSearchTerm && this.recordSearchTerm.length >= 2) {
                    records = await searchUsers({
                        searchTerm: this.recordSearchTerm
                    });
                } else {
                    records = [];
                }
            }
            this.availableRecords = records;
        } catch (error) {
            console.error(DEBUG_PREFIX, 'Failed to load records:', error);
            this.availableRecords = [];
        }
        this.isLoadingRecords = false;
    }

    handleRecordItemClick(event) {
        const recordId = event.currentTarget.dataset.id;
        const index = this.selectedRecordIds.indexOf(recordId);
        if (index > -1) {
            // Remove from selection
            this.selectedRecordIds = this.selectedRecordIds.filter(id => id !== recordId);
        } else {
            // Add to selection
            this.selectedRecordIds = [...this.selectedRecordIds, recordId];
        }
    }

    handleAddSelectedRecords() {
        // Get selected records from availableRecords
        const selectedRecords = this.availableRecords.filter(rec =>
            this.selectedRecordIds.includes(rec.recordId)
        );

        // Add each as a record element on canvas
        let offsetX = 0;
        for (const rec of selectedRecords) {
            this.addRecordElement(rec, offsetX);
            offsetX += 30; // Stagger placement
        }

        // Close modal
        this.handleCloseRecordModal();
    }

    addRecordElement(record, offsetX = 0) {
        // Calculate width based on name length (min 150, max 300)
        const ctx = this.ctx;
        ctx.font = 'bold 13px sans-serif';
        const textWidth = ctx.measureText(record.name).width;
        const cardWidth = Math.max(150, Math.min(300, textWidth + 60)); // 60 for icon + padding

        const obj = {
            id: this.generateId(),
            type: 'record',
            recordId: record.recordId,
            objectApiName: record.objectApiName,
            name: record.name,
            subtitle: record.subtitle || '',
            iconName: record.iconName,
            x: 150 + offsetX + Math.random() * 100,
            y: 150 + offsetX + Math.random() * 100,
            width: cardWidth,
            height: 50,
            color: '#f4f6f9',
            zIndex: this.getNextZIndex()
        };

        this.objects.push(obj);
        this.publishObjectAdd(obj);
        // Record for undo
        this.recordAction('object_add', { objectId: obj.id });
    }

    // ========== Activity Selector Modal ==========

    handleOpenActivityModal() {
        this.isActivityModalOpen = true;
        this.activityModalTab = 'tasks';
        this.activitySearchTerm = '';
        this.selectedActivityIds = [];
        this.loadActivitiesForTab();
    }

    handleCloseActivityModal() {
        this.isActivityModalOpen = false;
        this.availableActivities = [];
        this.selectedActivityIds = [];
    }

    handleActivityTabClick(event) {
        const tab = event.currentTarget.dataset.tab;
        if (tab !== this.activityModalTab) {
            this.activityModalTab = tab;
            this.activitySearchTerm = '';
            this.loadActivitiesForTab();
        }
    }

    handleActivitySearchChange(event) {
        this.activitySearchTerm = event.target.value;
        // Debounce search
        clearTimeout(this._activitySearchTimeout);
        this._activitySearchTimeout = setTimeout(() => {
            this.loadActivitiesForTab();
        }, 300);
    }

    async loadActivitiesForTab(showLoading = true) {
        if (showLoading && this.availableActivities.length === 0) {
            this.isLoadingActivities = true;
        }
        try {
            let activities = [];
            const searchTerm = this.activitySearchTerm || null;

            if (this.activityModalTab === 'tasks') {
                activities = await getRelatedTasks({
                    recordId: this.recordId,
                    searchTerm: searchTerm
                });
            } else if (this.activityModalTab === 'events') {
                activities = await getRelatedEvents({
                    recordId: this.recordId,
                    searchTerm: searchTerm
                });
            } else if (this.activityModalTab === 'emails') {
                activities = await getRelatedEmails({
                    recordId: this.recordId,
                    searchTerm: searchTerm
                });
            }
            this.availableActivities = activities;
        } catch (error) {
            console.error(DEBUG_PREFIX, 'Failed to load activities:', error);
            this.availableActivities = [];
        }
        this.isLoadingActivities = false;
    }

    handleActivityItemClick(event) {
        const activityId = event.currentTarget.dataset.id;
        const index = this.selectedActivityIds.indexOf(activityId);
        if (index > -1) {
            this.selectedActivityIds = this.selectedActivityIds.filter(id => id !== activityId);
        } else {
            this.selectedActivityIds = [...this.selectedActivityIds, activityId];
        }
    }

    handleAddSelectedActivities() {
        const selectedActivities = this.availableActivities.filter(act =>
            this.selectedActivityIds.includes(act.recordId)
        );

        let offsetX = 0;
        for (const activity of selectedActivities) {
            this.addActivityElement(activity, offsetX);
            offsetX += 30;
        }

        this.handleCloseActivityModal();
    }

    addActivityElement(activity, offsetX = 0) {
        // Calculate width based on subject length
        const ctx = this.ctx;
        ctx.font = 'bold 13px sans-serif';
        const textWidth = ctx.measureText(activity.subject || 'No Subject').width;
        const cardWidth = Math.max(180, Math.min(300, textWidth + 60));

        // Calculate height based on whether related records exist
        const hasRelatedRecords = activity.whoName || activity.whatName;
        const cardHeight = hasRelatedRecords ? 70 : 50;

        const obj = {
            id: this.generateId(),
            type: 'activity',
            activityType: activity.activityType,
            recordId: activity.recordId,
            objectApiName: activity.objectApiName,
            subject: activity.subject || 'No Subject',
            subtitle: activity.subtitle || '',
            iconName: activity.iconName,
            // Related record data
            whoId: activity.whoId,
            whoName: activity.whoName,
            whoObjectType: activity.whoObjectType,
            whatId: activity.whatId,
            whatName: activity.whatName,
            whatObjectType: activity.whatObjectType,
            // Position and dimensions
            x: 150 + offsetX + Math.random() * 100,
            y: 150 + offsetX + Math.random() * 100,
            width: cardWidth,
            height: cardHeight,
            color: '#f4f6f9',
            zIndex: this.getNextZIndex()
        };

        this.objects.push(obj);
        this.publishObjectAdd(obj);
        // Record for undo
        this.recordAction('object_add', { objectId: obj.id });
    }

    // ========== Utilities ==========

    /**
     * @description Preload SLDS icons as Image objects for canvas drawing
     */
    preloadSLDSIcons() {
        // Include activity icons (task, event, email) and related record icons (account, case)
        const iconTypes = ['contact', 'opportunity', 'lead', 'user', 'task', 'event', 'email', 'account', 'case'];
        let loadedCount = 0;

        iconTypes.forEach(iconType => {
            const img = new Image();
            // Load from the standard Salesforce icon path (PNG version)
            img.src = `/img/icon/t4v35/standard/${iconType}_60.png`;
            img.onload = () => {
                console.log(DEBUG_PREFIX, `Icon loaded: ${iconType}`);
                this.iconImages[iconType] = img;
                loadedCount++;
                if (loadedCount === iconTypes.length) {
                    this.iconsLoaded = true;
                    console.log(DEBUG_PREFIX, 'All SLDS icons loaded');
                }
            };
            img.onerror = (err) => {
                console.error(DEBUG_PREFIX, `Failed to load icon: ${iconType}`, err);
            };
        });
    }

    generateId() {
        return `${userId}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    }

    /**
     * @description Get the next available zIndex (highest + 1) across all elements
     */
    getNextZIndex() {
        const objectZs = this.objects.map(o => o.zIndex || 0);
        const connectorZs = this.connectors.map(c => c.zIndex || 0);
        const allZs = [...objectZs, ...connectorZs];
        if (allZs.length === 0) return 1;
        return Math.max(...allZs) + 1;
    }

    showToast(title, message, variant) {
        this.dispatchEvent(
            new ShowToastEvent({
                title: title,
                message: message,
                variant: variant
            })
        );
    }

    cleanup() {
        console.log(DEBUG_PREFIX, 'Cleanup started');

        // Announce leave
        this.announceLeave();

        // Remove cursor
        removeCursor({ canvasId: this.canvasId }).catch(() => {});

        // Stop intervals
        if (this.cursorPollInterval) {
            clearInterval(this.cursorPollInterval);
        }
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
        }

        // Unsubscribe from platform events
        if (this.subscription) {
            unsubscribe(this.subscription).catch(() => {});
        }

        // Cancel animation frame
        if (this.animationFrameId) {
            cancelAnimationFrame(this.animationFrameId);
        }

        // Remove keyboard listeners
        if (this.boundKeydownHandler) {
            window.removeEventListener('keydown', this.boundKeydownHandler);
        }
        if (this.boundKeyupHandler) {
            window.removeEventListener('keyup', this.boundKeyupHandler);
        }

        console.log(DEBUG_PREFIX, 'Cleanup completed');
    }
}