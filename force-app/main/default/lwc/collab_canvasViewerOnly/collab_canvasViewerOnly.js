/**
 * @description Read-only canvas viewer that displays the last saved state.
 * Lightweight component with no real-time features - just a static preview.
 *
 * @author Nils Lehsten
 * @date 2025-11-26
 */
import { LightningElement, api, track } from 'lwc';
import { NavigationMixin } from 'lightning/navigation';
import loadCanvasState from '@salesforce/apex/collab_CollaborationController.loadCanvasState';

// Shared drawing utilities (US-33)
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
    drawArrowhead,
    drawElbowPath,
    drawCurvedPath,
    getAnchorPoint,
    calculateFitToContent,
    drawConnectorLabel,
    GRID_SIZE,
    ARROWHEAD_SIZE,
    ACTIVITY_ICON_COLORS
} from 'c/collab_canvasDrawingUtils';

const DEBUG_PREFIX = '[CanvasViewer]';
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 2.0;
const ZOOM_STEP = 0.1;
const CANVAS_WORLD_WIDTH = 3200;  // Total canvas working area (match launcher)
const CANVAS_WORLD_HEIGHT = 1800;

export default class Collab_canvasViewerOnly extends NavigationMixin(LightningElement) {
    @api width = 1600;
    @api height = 900;

    @track isLoading = true;
    @track hasContent = false;
    @track errorMessage = '';
    @track zoomLevel = 1.0;

    // Private recordId with setter to trigger load
    _recordId;
    _hasLoaded = false;

    @api
    get recordId() {
        return this._recordId;
    }
    set recordId(value) {
        console.log(DEBUG_PREFIX, 'recordId setter called with:', value);
        console.log(DEBUG_PREFIX, 'Previous recordId:', this._recordId);
        console.log(DEBUG_PREFIX, '_hasLoaded:', this._hasLoaded);

        const oldValue = this._recordId;
        this._recordId = value;

        // Load state when recordId is set (if not already loaded)
        if (value && !this._hasLoaded) {
            console.log(DEBUG_PREFIX, 'Triggering loadState from setter');
            this._hasLoaded = true;
            this.loadState();
        } else if (value && value !== oldValue) {
            // If recordId changed, reload
            console.log(DEBUG_PREFIX, 'recordId changed, reloading state');
            this.loadState();
        } else {
            console.log(DEBUG_PREFIX, 'Not loading - value:', value, '_hasLoaded:', this._hasLoaded);
        }
    }

    // Canvas state (read-only)
    objects = [];
    strokes = [];
    connectors = [];

    // SLDS Icon images (preloaded for canvas drawing)
    iconImages = {};
    iconsLoaded = false;

    // Canvas context
    canvas = null;
    ctx = null;

    // Pan offset for fit-to-content (US-34)
    panOffsetX = 0;
    panOffsetY = 0;
    isRendered = false;

    get canvasId() {
        const id = this._recordId || 'default-canvas';
        console.log(DEBUG_PREFIX, 'canvasId getter returning:', id);
        return id;
    }

    get containerStyle() {
        return `width: 1600px;`;
    }

    get canvasStyle() {
        return `width: 100%; height: ${this.height}px;`;
    }

    get hasError() {
        return !!this.errorMessage;
    }

    get showEmptyState() {
        return !this.isLoading && !this.hasError && !this.hasContent;
    }

    get showCanvas() {
        return !this.isLoading && !this.hasError && this.hasContent;
    }

    get zoomPercentage() {
        return Math.round(this.zoomLevel * 100);
    }

    // ========== Lifecycle ==========

    connectedCallback() {
        console.log(DEBUG_PREFIX, '=== connectedCallback ===');
        console.log(DEBUG_PREFIX, 'this._recordId:', this._recordId);
        console.log(DEBUG_PREFIX, 'this._hasLoaded:', this._hasLoaded);

        // Preload SLDS icons for canvas drawing
        this.preloadSLDSIcons();

        // If recordId is already set (e.g., from design attribute), load state
        // Otherwise, the setter will handle it when recordId becomes available
        if (this._recordId && !this._hasLoaded) {
            console.log(DEBUG_PREFIX, 'Loading state from connectedCallback');
            this._hasLoaded = true;
            this.loadState();
        } else {
            console.log(DEBUG_PREFIX, 'NOT loading from connectedCallback - waiting for recordId');
        }
    }

    renderedCallback() {
        if (!this.isRendered && this.hasContent && this.refs.previewCanvas) {
            console.log(DEBUG_PREFIX, 'renderedCallback: initializing canvas');
            this.initializeCanvas();
            this.isRendered = true;
        }
    }

    // ========== Data Loading ==========

    async loadState() {
        console.log(DEBUG_PREFIX, '=== loadState START ===');
        console.log(DEBUG_PREFIX, 'canvasId:', this.canvasId);
        console.log(DEBUG_PREFIX, '_recordId:', this._recordId);

        try {
            console.log(DEBUG_PREFIX, 'Calling Apex loadCanvasState...');
            const result = await loadCanvasState({ canvasId: this.canvasId });

            console.log(DEBUG_PREFIX, 'Apex raw result:', result);
            console.log(DEBUG_PREFIX, 'Apex result type:', typeof result);
            console.log(DEBUG_PREFIX, 'Apex result length:', result ? result.length : 0);

            const state = JSON.parse(result || '{}');
            console.log(DEBUG_PREFIX, 'Parsed state:', JSON.stringify(state, null, 2));
            console.log(DEBUG_PREFIX, 'state.objects:', state.objects);
            console.log(DEBUG_PREFIX, 'state.strokes:', state.strokes);

            if (state.objects && state.objects.length > 0) {
                console.log(DEBUG_PREFIX, 'Found', state.objects.length, 'objects');
                this.objects = state.objects;
                this.hasContent = true;
            } else {
                console.log(DEBUG_PREFIX, 'No objects found');
            }

            if (state.strokes && state.strokes.length > 0) {
                console.log(DEBUG_PREFIX, 'Found', state.strokes.length, 'strokes');
                this.strokes = state.strokes;
                this.hasContent = true;
            } else {
                console.log(DEBUG_PREFIX, 'No strokes found');
            }

            if (state.connectors && state.connectors.length > 0) {
                console.log(DEBUG_PREFIX, 'Found', state.connectors.length, 'connectors');
                this.connectors = state.connectors;
                this.hasContent = true;
            } else {
                console.log(DEBUG_PREFIX, 'No connectors found');
            }

            console.log(DEBUG_PREFIX, 'hasContent:', this.hasContent);
            this.isLoading = false;
            console.log(DEBUG_PREFIX, '=== loadState END (success) ===');
        } catch (error) {
            console.error(DEBUG_PREFIX, '=== loadState ERROR ===');
            console.error(DEBUG_PREFIX, 'Error:', error);
            console.error(DEBUG_PREFIX, 'Error message:', error.message);
            console.error(DEBUG_PREFIX, 'Error body:', error.body);
            this.errorMessage = 'Unable to load canvas preview';
            this.isLoading = false;
        }
    }

    // ========== Canvas Rendering (Static) ==========

    initializeCanvas() {
        console.log(DEBUG_PREFIX, 'initializeCanvas called');
        this.canvas = this.refs.previewCanvas;
        if (!this.canvas) {
            console.log(DEBUG_PREFIX, 'No canvas element found!');
            return;
        }

        this.ctx = this.canvas.getContext('2d');

        // Fixed canvas size matching main canvas (1600x900)
        const dpr = window.devicePixelRatio || 1;
        this.canvas.width = 1600 * dpr;
        this.canvas.height = 900 * dpr;
        this.canvas.style.width = '1600px';
        this.canvas.style.height = '900px';

        console.log(DEBUG_PREFIX, 'Drawing with', this.objects.length, 'objects and', this.strokes.length, 'strokes');
        this.draw();
    }

    draw() {
        if (!this.ctx) return;

        const ctx = this.ctx;
        const dpr = window.devicePixelRatio || 1;

        // Clear entire canvas
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

        // Apply DPR, zoom, and pan offset (US-34: added pan support for fit-to-content)
        ctx.setTransform(
            dpr * this.zoomLevel, 0, 0,
            dpr * this.zoomLevel,
            this.panOffsetX * dpr * this.zoomLevel,
            this.panOffsetY * dpr * this.zoomLevel
        );

        // Draw grid (5000x5000 world bounds)
        this.drawGrid(ctx);

        // Draw strokes
        this.drawStrokes(ctx);

        // Draw connectors (below objects)
        this.drawConnectors(ctx);

        // Draw objects
        this.drawObjects(ctx);
    }

    drawGrid(ctx) {
        ctx.strokeStyle = '#e5e5e5';
        ctx.lineWidth = 1;

        // Calculate visible area in canvas coordinates (accounting for pan and zoom)
        const dpr = window.devicePixelRatio || 1;
        const viewportWidth = this.canvas.width / (dpr * this.zoomLevel);
        const viewportHeight = this.canvas.height / (dpr * this.zoomLevel);
        const visibleLeft = -this.panOffsetX;
        const visibleTop = -this.panOffsetY;
        const visibleRight = visibleLeft + viewportWidth;
        const visibleBottom = visibleTop + viewportHeight;

        // Clamp to canvas world bounds (5000x5000) and align to grid
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

    drawObjects(ctx) {
        console.log(DEBUG_PREFIX, 'drawObjects: drawing', this.objects.length, 'objects');
        // Sort by zIndex (lowest first, so highest renders on top)
        const sortedObjects = [...this.objects].sort((a, b) => (a.zIndex || 0) - (b.zIndex || 0));
        for (const obj of sortedObjects) {
            // US-33: Use shared drawing utilities
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
                    // Groups rendered as indicator (read-only, not selectable)
                    drawGroupIndicator(ctx, obj, false);
                    break;
                default:
                    break;
            }
        }
    }

    // Shape drawing methods removed (US-33) - now using shared collab_canvasDrawingUtils

    drawStrokes(ctx) {
        console.log(DEBUG_PREFIX, 'drawStrokes: drawing', this.strokes.length, 'strokes');
        for (const stroke of this.strokes) {
            if (stroke.points && stroke.points.length > 1) {
                ctx.beginPath();
                ctx.strokeStyle = stroke.color || '#333333';
                ctx.lineWidth = stroke.width || 2;
                ctx.lineCap = 'round';
                ctx.lineJoin = 'round';

                ctx.moveTo(stroke.points[0].x, stroke.points[0].y);
                for (let i = 1; i < stroke.points.length; i++) {
                    ctx.lineTo(stroke.points[i].x, stroke.points[i].y);
                }
                ctx.stroke();
            }
        }
    }

    // ========== Connector Drawing ==========

    drawConnectors(ctx) {
        console.log(DEBUG_PREFIX, 'drawConnectors: drawing', this.connectors.length, 'connectors');
        for (const connector of this.connectors) {
            this.drawConnector(ctx, connector);
        }
    }

    drawConnector(ctx, connector) {
        // Resolve start and end points (handle anchored vs free-floating)
        const start = this.resolveConnectorPoint(connector, 'start');
        const end = this.resolveConnectorPoint(connector, 'end');

        if (!start || !end) return;

        // Set line style
        ctx.strokeStyle = connector.color || '#333333';
        ctx.lineWidth = connector.lineWidth || 2;
        ctx.setLineDash([]);

        // Draw based on connector type
        if (connector.connectorType === 'elbow') {
            this.drawElbowConnector(ctx, connector, start, end);
        } else if (connector.connectorType === 'curved') {
            this.drawCurvedConnector(ctx, connector, start, end);
        } else {
            // Straight line (arrow, line, bidirectional)
            ctx.beginPath();
            ctx.moveTo(start.x, start.y);
            ctx.lineTo(end.x, end.y);
            ctx.stroke();
        }

        // Draw arrowhead(s)
        if (connector.connectorType === 'arrow' || connector.connectorType === 'elbow' || connector.connectorType === 'curved') {
            // For elbow, calculate angle from last segment
            if (connector.connectorType === 'elbow' && connector.waypoints && connector.waypoints.length > 0) {
                const lastWaypoint = connector.waypoints[connector.waypoints.length - 1];
                drawArrowhead(ctx, lastWaypoint, end, connector.color);
            } else if (connector.connectorType === 'curved' && connector.controlPoint2) {
                // For curved, use control point 2 as direction reference
                drawArrowhead(ctx, connector.controlPoint2, end, connector.color);
            } else {
                drawArrowhead(ctx, start, end, connector.color);
            }
        }
        if (connector.connectorType === 'bidirectional') {
            drawArrowhead(ctx, start, end, connector.color);
            drawArrowhead(ctx, end, start, connector.color);
        }

        // US-42: Draw connector label if present
        if (connector.label) {
            drawConnectorLabel(ctx, connector, start, end);
        }
    }

    /**
     * @description Draw elbow (orthogonal) connector with waypoints
     */
    drawElbowConnector(ctx, connector, start, end) {
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
    drawCurvedConnector(ctx, connector, start, end) {
        const cp1 = connector.controlPoint1 || { x: start.x + (end.x - start.x) * 0.25, y: start.y };
        const cp2 = connector.controlPoint2 || { x: end.x - (end.x - start.x) * 0.25, y: end.y };

        ctx.beginPath();
        ctx.moveTo(start.x, start.y);
        ctx.bezierCurveTo(cp1.x, cp1.y, cp2.x, cp2.y, end.x, end.y);
        ctx.stroke();
    }

    // drawArrowhead() moved to collab_canvasDrawingUtils (US-33)

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

    // getAnchorPoint() moved to collab_canvasDrawingUtils (US-33)

    // ========== Zoom Controls ==========

    handleZoomIn() {
        this.setZoom(this.zoomLevel + ZOOM_STEP);
    }

    handleZoomOut() {
        this.setZoom(this.zoomLevel - ZOOM_STEP);
    }

    handleFitToContent() {
        // US-34: Use shared calculateFitToContent utility
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

        // Redraw with new view
        this.draw();

        console.log(DEBUG_PREFIX, 'Fit to content:', result);
    }

    /**
     * @description Reset view to origin (0,0)
     */
    handleCenterView() {
        // Reset pan to show origin (0,0) at top-left
        this.panOffsetX = 0;
        this.panOffsetY = 0;
        this.draw();
    }

    setZoom(newZoom) {
        this.zoomLevel = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, newZoom));
        this.zoomLevel = Math.round(this.zoomLevel * 10) / 10;
        // Redraw with new zoom
        if (this.canvas && this.ctx) {
            this.draw();
        }
    }

    // ========== Actions ==========

    handleOpenCanvas() {
        console.log(DEBUG_PREFIX, 'handleOpenCanvas clicked');
        console.log(DEBUG_PREFIX, 'recordId:', this.recordId);

        // Trigger the Quick Action programmatically
        this[NavigationMixin.Navigate]({
            type: 'standard__quickAction',
            attributes: {
                apiName: 'Account.collab_Launch_Canvas'
            },
            state: {
                recordId: this.recordId
            }
        });
    }

    // ========== Icon Loading ==========

    preloadSLDSIcons() {
        // Include activity icons (task, event, email) for US-35
        // Include account, case for US-36 (activity related records)
        const iconTypes = ['contact', 'opportunity', 'lead', 'user', 'task', 'event', 'email', 'account', 'case'];
        let loadedCount = 0;

        iconTypes.forEach(iconType => {
            const img = new Image();
            // Try loading from the standard Salesforce icon path (PNG version)
            img.src = `/img/icon/t4v35/standard/${iconType}_60.png`;
            img.onload = () => {
                console.log(DEBUG_PREFIX, `Icon loaded: ${iconType}`);
                this.iconImages[iconType] = img;
                loadedCount++;
                if (loadedCount === iconTypes.length) {
                    this.iconsLoaded = true;
                    console.log(DEBUG_PREFIX, 'All SLDS icons loaded');
                    // Redraw to show icons
                    if (this.ctx) {
                        this.draw();
                    }
                }
            };
            img.onerror = (err) => {
                console.error(DEBUG_PREFIX, `Failed to load icon: ${iconType}`, err);
            };
        });
    }

    // ========== Click Navigation ==========

    handleCanvasClick(event) {
        if (!this.canvas) return;

        const rect = this.canvas.getBoundingClientRect();
        const x = (event.clientX - rect.left) / this.zoomLevel;
        const y = (event.clientY - rect.top) / this.zoomLevel;

        // Find record or activity at click position - search from highest zIndex to lowest
        const sortedByZ = [...this.objects].sort((a, b) => (b.zIndex || 0) - (a.zIndex || 0));
        for (const obj of sortedByZ) {
            // US-35: Handle both record and activity types for navigation
            if ((obj.type === 'record' || obj.type === 'activity') && obj.recordId && this.isPointInObject(x, y, obj)) {
                this.navigateToRecord(obj.recordId, obj.objectApiName);
                return;
            }
        }
    }

    isPointInObject(x, y, obj) {
        return x >= obj.x && x <= obj.x + obj.width &&
               y >= obj.y && y <= obj.y + obj.height;
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
}