/**
 * @description Shared canvas drawing utility functions for SF-Collab.
 * Single source of truth for all drawing logic used by both
 * collab_collaborativeCanvas (Launcher) and collab_canvasViewerOnly (Viewer).
 *
 * All functions are pure - no component state dependencies.
 * Selection highlighting is handled by each component, not here.
 *
 * @author Nils Lehsten
 * @date 2025-11-28
 * @story US-33
 */

// ========== Constants ==========

export const GRID_SIZE = 20;
export const ARROWHEAD_SIZE = 12;

export const ICON_COLORS = {
    contact: '#a094ed',
    opportunity: '#fcb95b',
    lead: '#f88962',
    user: '#65cae4',
    default: '#7f8de1'
};

// Activity icon colors (SLDS standard colors)
export const ACTIVITY_ICON_COLORS = {
    task: '#4bc076',     // Green
    event: '#eb7092',    // Pink/coral
    email: '#95aec5'     // Blue-gray
};

// ========== Color Utilities ==========

/**
 * @description Darken a hex color by a percentage
 * @param {string} hex - Hex color (e.g., '#E8E8E8')
 * @param {number} percent - Percentage to darken (0-100)
 * @returns {string} Darkened hex color
 */
export function darkenColor(hex, percent) {
    if (!hex) return '#000000';
    const num = parseInt(hex.replace('#', ''), 16);
    const amt = Math.round(2.55 * percent);
    const R = Math.max((num >> 16) - amt, 0);
    const G = Math.max(((num >> 8) & 0x00ff) - amt, 0);
    const B = Math.max((num & 0x0000ff) - amt, 0);
    return '#' + (0x1000000 + R * 0x10000 + G * 0x100 + B).toString(16).slice(1);
}

/**
 * @description Lighten a hex color by a percentage
 * @param {string} hex - Hex color (e.g., '#E8E8E8')
 * @param {number} percent - Percentage to lighten (0-100)
 * @returns {string} Lightened hex color
 */
export function lightenColor(hex, percent) {
    if (!hex) return '#ffffff';
    const num = parseInt(hex.replace('#', ''), 16);
    const amt = Math.round(2.55 * percent);
    const R = Math.min((num >> 16) + amt, 255);
    const G = Math.min(((num >> 8) & 0x00ff) + amt, 255);
    const B = Math.min((num & 0x0000ff) + amt, 255);
    return '#' + (0x1000000 + R * 0x10000 + G * 0x100 + B).toString(16).slice(1);
}

/**
 * @description Calculate contrasting text color (black or white) based on background
 * @param {string} hexColor - Background hex color
 * @returns {string} '#000000' or '#ffffff'
 */
export function getContrastColor(hexColor) {
    if (!hexColor || hexColor.length < 7) return '#000000';
    const r = parseInt(hexColor.slice(1, 3), 16);
    const g = parseInt(hexColor.slice(3, 5), 16);
    const b = parseInt(hexColor.slice(5, 7), 16);
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    return luminance > 0.5 ? '#000000' : '#ffffff';
}

// ========== Text Utilities ==========

/**
 * @description Wrap text into lines that fit within maxWidth
 * @param {CanvasRenderingContext2D} ctx - Canvas context
 * @param {string} text - Text to wrap
 * @param {number} maxWidth - Maximum width in pixels
 * @returns {string[]} Array of text lines
 */
export function wrapText(ctx, text, maxWidth) {
    if (!text) return [''];
    const words = text.split(' ');
    const lines = [];
    let currentLine = '';

    for (const word of words) {
        const testLine = currentLine ? currentLine + ' ' + word : word;
        const metrics = ctx.measureText(testLine);
        if (metrics.width > maxWidth && currentLine) {
            lines.push(currentLine);
            currentLine = word;
        } else {
            currentLine = testLine;
        }
    }
    if (currentLine) {
        lines.push(currentLine);
    }
    return lines.length ? lines : [''];
}

/**
 * @description Draw text inside a shape with vertical alignment support
 * @param {CanvasRenderingContext2D} ctx - Canvas context
 * @param {Object} obj - Shape object with text, x, y, width, height, color, textAlign
 */
export function drawShapeText(ctx, obj) {
    if (!obj.text) return;

    ctx.save();
    const textColor = obj.textColor || getContrastColor(obj.color || '#E8E8E8');
    ctx.fillStyle = textColor;

    // US-41: Dynamic font size (default 14 for shapes)
    const fontSize = obj.fontSize || 14;
    ctx.font = `${fontSize}px sans-serif`;

    const padding = 12;
    const lineHeight = Math.round(fontSize * 1.3);
    const centerX = obj.x + obj.width / 2;
    const maxWidth = obj.width - padding * 2;

    // US-40: Text overflow mode (default 'clip' for shapes)
    const textOverflow = obj.textOverflow || 'clip';
    const textAlign = obj.textAlign || 'middle';

    // Calculate base Y positions for different shape types
    let topY, bottomY, middleY;

    if (obj.type === 'triangle') {
        topY = obj.y + obj.height * 0.4;
        middleY = obj.y + obj.height * 0.6;
        bottomY = obj.y + obj.height * 0.75;
    } else if (obj.type === 'cylinder') {
        topY = obj.y + obj.height * 0.25;
        middleY = obj.y + obj.height * 0.55;
        bottomY = obj.y + obj.height * 0.8;
    } else {
        topY = obj.y + padding + lineHeight / 2;
        bottomY = obj.y + obj.height - padding - lineHeight / 2;
        middleY = obj.y + obj.height / 2;
    }

    if (textOverflow === 'wrap') {
        // Wrap mode - multi-line text
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';

        const lines = wrapText(ctx, obj.text, maxWidth);
        const textBlockHeight = lines.length * lineHeight;

        // Calculate starting Y based on alignment
        let startY;
        switch (textAlign) {
            case 'top':
                startY = (obj.type === 'triangle') ? topY - lineHeight / 2 :
                         (obj.type === 'cylinder') ? topY - lineHeight / 2 :
                         obj.y + padding;
                break;
            case 'bottom':
                startY = (obj.type === 'triangle') ? bottomY - textBlockHeight + lineHeight / 2 :
                         (obj.type === 'cylinder') ? bottomY - textBlockHeight + lineHeight / 2 :
                         obj.y + obj.height - padding - textBlockHeight;
                break;
            case 'middle':
            default:
                startY = middleY - textBlockHeight / 2;
        }

        lines.forEach((line, index) => {
            ctx.fillText(line, centerX, startY + index * lineHeight);
        });
    } else {
        // Clip mode - single line with truncation (default for shapes)
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        let displayText = obj.text;
        if (ctx.measureText(displayText).width > maxWidth) {
            while (ctx.measureText(displayText + '...').width > maxWidth && displayText.length > 0) {
                displayText = displayText.slice(0, -1);
            }
            displayText += '...';
        }

        let textY;
        switch (textAlign) {
            case 'top':
                textY = topY;
                break;
            case 'bottom':
                textY = bottomY;
                break;
            case 'middle':
            default:
                textY = middleY;
        }

        ctx.fillText(displayText, centerX, textY);
    }

    ctx.restore();
}

// ========== Shape Drawing Functions ==========

/**
 * @description Draw a sticky note
 * @param {CanvasRenderingContext2D} ctx - Canvas context
 * @param {Object} obj - Sticky object
 */
export function drawSticky(ctx, obj) {
    // Shadow
    ctx.shadowColor = 'rgba(0, 0, 0, 0.2)';
    ctx.shadowBlur = 8;
    ctx.shadowOffsetX = 2;
    ctx.shadowOffsetY = 2;

    // Background
    ctx.fillStyle = obj.color;
    ctx.fillRect(obj.x, obj.y, obj.width, obj.height);

    // Reset shadow
    ctx.shadowColor = 'transparent';

    // Text with vertical alignment and overflow support (US-40, US-41)
    if (obj.text) {
        ctx.save();
        ctx.fillStyle = '#333333';

        // US-41: Dynamic font size (default 12 for stickies)
        const fontSize = obj.fontSize || 12;
        ctx.font = `${fontSize}px sans-serif`;

        const padding = 12;
        const lineHeight = Math.round(fontSize * 1.3);
        const maxWidth = obj.width - padding * 2;

        // US-40: Text overflow mode (default 'wrap' for stickies)
        const textOverflow = obj.textOverflow || 'wrap';
        const textAlign = obj.textAlign || 'top';

        if (textOverflow === 'clip') {
            // Single line, truncate with ellipsis
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            const centerX = obj.x + obj.width / 2;
            const centerY = obj.y + obj.height / 2;
            const truncated = truncateTextInternal(ctx, obj.text, maxWidth);
            ctx.fillText(truncated, centerX, centerY);
        } else {
            // Wrap mode - multi-line text
            ctx.textAlign = 'left';
            ctx.textBaseline = 'top';
            const lines = wrapText(ctx, obj.text, maxWidth);
            const textBlockHeight = lines.length * lineHeight;

            let startY;
            switch (textAlign) {
                case 'top':
                    startY = obj.y + padding;
                    break;
                case 'middle':
                    startY = obj.y + (obj.height - textBlockHeight) / 2;
                    break;
                case 'bottom':
                    startY = obj.y + obj.height - padding - textBlockHeight;
                    break;
                default:
                    startY = obj.y + padding;
            }

            lines.forEach((line, index) => {
                ctx.fillText(line, obj.x + padding, startY + index * lineHeight);
            });
        }
        ctx.restore();
    }
}

// Internal helper for truncation (to avoid name collision with exported truncateText)
function truncateTextInternal(ctx, text, maxWidth) {
    if (ctx.measureText(text).width <= maxWidth) {
        return text;
    }
    let truncated = text;
    while (ctx.measureText(truncated + '...').width > maxWidth && truncated.length > 0) {
        truncated = truncated.slice(0, -1);
    }
    return truncated + '...';
}

/**
 * @description Draw a rectangle shape
 * @param {CanvasRenderingContext2D} ctx - Canvas context
 * @param {Object} obj - Rectangle object
 */
export function drawRectangle(ctx, obj) {
    ctx.fillStyle = obj.color;
    ctx.fillRect(obj.x, obj.y, obj.width, obj.height);

    ctx.strokeStyle = obj.borderColor || '#666666';
    ctx.lineWidth = obj.borderWidth || 2;
    ctx.strokeRect(obj.x, obj.y, obj.width, obj.height);

    // Draw text on shape
    drawShapeText(ctx, obj);
}

/**
 * @description Draw a circle/ellipse shape
 * @param {CanvasRenderingContext2D} ctx - Canvas context
 * @param {Object} obj - Circle object
 */
export function drawCircle(ctx, obj) {
    const centerX = obj.x + obj.width / 2;
    const centerY = obj.y + obj.height / 2;
    const radius = Math.min(obj.width, obj.height) / 2;

    ctx.beginPath();
    ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
    ctx.fillStyle = obj.color;
    ctx.fill();

    ctx.strokeStyle = obj.borderColor || '#666666';
    ctx.lineWidth = obj.borderWidth || 2;
    ctx.stroke();

    // Draw text on shape
    drawShapeText(ctx, obj);
}

/**
 * @description Draw a diamond shape
 * @param {CanvasRenderingContext2D} ctx - Canvas context
 * @param {Object} obj - Diamond object
 */
export function drawDiamond(ctx, obj) {
    const { x, y, width, height, color, borderColor, borderWidth } = obj;
    const cx = x + width / 2;
    const cy = y + height / 2;

    ctx.beginPath();
    ctx.moveTo(cx, y);              // Top
    ctx.lineTo(x + width, cy);      // Right
    ctx.lineTo(cx, y + height);     // Bottom
    ctx.lineTo(x, cy);              // Left
    ctx.closePath();

    ctx.fillStyle = color || '#E8E8E8';
    ctx.fill();

    ctx.strokeStyle = borderColor || '#666666';
    ctx.lineWidth = borderWidth || 2;
    ctx.stroke();

    // Draw text on shape
    drawShapeText(ctx, obj);
}

/**
 * @description Draw a triangle shape
 * @param {CanvasRenderingContext2D} ctx - Canvas context
 * @param {Object} obj - Triangle object
 */
export function drawTriangle(ctx, obj) {
    const { x, y, width, height, color, borderColor, borderWidth } = obj;

    ctx.beginPath();
    ctx.moveTo(x + width / 2, y);        // Top center
    ctx.lineTo(x + width, y + height);   // Bottom right
    ctx.lineTo(x, y + height);           // Bottom left
    ctx.closePath();

    ctx.fillStyle = color || '#E8E8E8';
    ctx.fill();

    ctx.strokeStyle = borderColor || '#666666';
    ctx.lineWidth = borderWidth || 2;
    ctx.stroke();

    // Draw text on shape
    drawShapeText(ctx, obj);
}

/**
 * @description Draw a hexagon shape
 * @param {CanvasRenderingContext2D} ctx - Canvas context
 * @param {Object} obj - Hexagon object
 */
export function drawHexagon(ctx, obj) {
    const { x, y, width, height, color, borderColor, borderWidth } = obj;
    const cx = x + width / 2;
    const cy = y + height / 2;
    const rx = width / 2;
    const ry = height / 2;

    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
        const angle = (Math.PI / 3) * i - Math.PI / 2;
        const px = cx + rx * Math.cos(angle);
        const py = cy + ry * Math.sin(angle);
        if (i === 0) {
            ctx.moveTo(px, py);
        } else {
            ctx.lineTo(px, py);
        }
    }
    ctx.closePath();

    ctx.fillStyle = color || '#E8E8E8';
    ctx.fill();

    ctx.strokeStyle = borderColor || '#666666';
    ctx.lineWidth = borderWidth || 2;
    ctx.stroke();

    // Draw text on shape
    drawShapeText(ctx, obj);
}

/**
 * @description Draw a parallelogram shape
 * @param {CanvasRenderingContext2D} ctx - Canvas context
 * @param {Object} obj - Parallelogram object
 */
export function drawParallelogram(ctx, obj) {
    const { x, y, width, height, color, borderColor, borderWidth } = obj;
    const skew = width * 0.2; // 20% skew

    ctx.beginPath();
    ctx.moveTo(x + skew, y);                    // Top left
    ctx.lineTo(x + width, y);                   // Top right
    ctx.lineTo(x + width - skew, y + height);   // Bottom right
    ctx.lineTo(x, y + height);                  // Bottom left
    ctx.closePath();

    ctx.fillStyle = color || '#E8E8E8';
    ctx.fill();

    ctx.strokeStyle = borderColor || '#666666';
    ctx.lineWidth = borderWidth || 2;
    ctx.stroke();

    // Draw text on shape
    drawShapeText(ctx, obj);
}

/**
 * @description Draw a 3D cylinder shape
 * @param {CanvasRenderingContext2D} ctx - Canvas context
 * @param {Object} obj - Cylinder object
 */
export function drawCylinder(ctx, obj) {
    const { x, y, width, height, color, borderColor, borderWidth } = obj;
    const ellipseHeight = height * 0.15;
    const bodyTop = y + ellipseHeight / 2;
    const bodyBottom = y + height - ellipseHeight / 2;

    // Body sides
    ctx.beginPath();
    ctx.moveTo(x, bodyTop);
    ctx.lineTo(x, bodyBottom);
    ctx.moveTo(x + width, bodyTop);
    ctx.lineTo(x + width, bodyBottom);

    // Body fill
    ctx.fillStyle = color || '#E8E8E8';
    ctx.fillRect(x, bodyTop, width, bodyBottom - bodyTop);

    // Bottom ellipse (visible part)
    ctx.beginPath();
    ctx.ellipse(x + width / 2, bodyBottom, width / 2, ellipseHeight / 2, 0, 0, Math.PI);
    ctx.fillStyle = darkenColor(color || '#E8E8E8', 15);
    ctx.fill();
    ctx.strokeStyle = borderColor || '#666666';
    ctx.lineWidth = borderWidth || 2;
    ctx.stroke();

    // Body rectangle
    ctx.fillStyle = color || '#E8E8E8';
    ctx.fillRect(x, bodyTop, width, bodyBottom - bodyTop);

    // Side lines
    ctx.beginPath();
    ctx.moveTo(x, bodyTop);
    ctx.lineTo(x, bodyBottom);
    ctx.moveTo(x + width, bodyTop);
    ctx.lineTo(x + width, bodyBottom);
    ctx.strokeStyle = borderColor || '#666666';
    ctx.lineWidth = borderWidth || 2;
    ctx.stroke();

    // Top ellipse
    ctx.beginPath();
    ctx.ellipse(x + width / 2, bodyTop, width / 2, ellipseHeight / 2, 0, 0, Math.PI * 2);
    ctx.fillStyle = lightenColor(color || '#E8E8E8', 10);
    ctx.fill();
    ctx.strokeStyle = borderColor || '#666666';
    ctx.lineWidth = borderWidth || 2;
    ctx.stroke();

    // Draw text on shape
    drawShapeText(ctx, obj);
}

/**
 * @description Draw a cloud shape (simplified bezier matching toolbar icon)
 * @param {CanvasRenderingContext2D} ctx - Canvas context
 * @param {Object} obj - Cloud object
 */
export function drawCloud(ctx, obj) {
    const { x, y, width, height, color, borderColor, borderWidth } = obj;

    // Cloud shape matching the toolbar SVG icon
    ctx.beginPath();

    // Scale factors to fit the path in the bounding box
    const scaleX = width / 24;
    const scaleY = height / 18;

    // Start at bottom left (flat bottom line)
    ctx.moveTo(x + 4 * scaleX, y + 17 * scaleY);

    // Left side curve up
    ctx.bezierCurveTo(
        x + 1 * scaleX, y + 17 * scaleY,
        x + 0 * scaleX, y + 14 * scaleY,
        x + 0.5 * scaleX, y + 12 * scaleY
    );

    // Left bump
    ctx.bezierCurveTo(
        x + 1 * scaleX, y + 9 * scaleY,
        x + 3 * scaleX, y + 7 * scaleY,
        x + 5 * scaleX, y + 7 * scaleY
    );

    // Small left-top bump
    ctx.bezierCurveTo(
        x + 5 * scaleX, y + 4 * scaleY,
        x + 8 * scaleX, y + 2 * scaleY,
        x + 11 * scaleX, y + 2 * scaleY
    );

    // Large center-right bump (main cloud dome)
    ctx.bezierCurveTo(
        x + 15 * scaleX, y + 2 * scaleY,
        x + 19 * scaleX, y + 5 * scaleY,
        x + 20 * scaleX, y + 9 * scaleY
    );

    // Right side curve down
    ctx.bezierCurveTo(
        x + 23 * scaleX, y + 10 * scaleY,
        x + 24 * scaleX, y + 13 * scaleY,
        x + 23 * scaleX, y + 15 * scaleY
    );

    // Bottom right curve
    ctx.bezierCurveTo(
        x + 23 * scaleX, y + 17 * scaleY,
        x + 21 * scaleX, y + 17 * scaleY,
        x + 19 * scaleX, y + 17 * scaleY
    );

    // Flat bottom back to start
    ctx.lineTo(x + 4 * scaleX, y + 17 * scaleY);

    ctx.closePath();

    ctx.fillStyle = color || '#E8E8E8';
    ctx.fill();

    ctx.strokeStyle = borderColor || '#666666';
    ctx.lineWidth = borderWidth || 2;
    ctx.lineJoin = 'round';
    ctx.stroke();

    // Draw text on shape
    drawShapeText(ctx, obj);
}

/**
 * @description Draw a rounded rectangle shape
 * @param {CanvasRenderingContext2D} ctx - Canvas context
 * @param {Object} obj - Rounded rectangle object
 */
export function drawRoundedRectangle(ctx, obj) {
    const { x, y, width, height, color, borderColor, borderWidth } = obj;
    const radius = Math.min(20, width / 4, height / 4);

    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + width - radius, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
    ctx.lineTo(x + width, y + height - radius);
    ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
    ctx.lineTo(x + radius, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.closePath();

    ctx.fillStyle = color || '#E8E8E8';
    ctx.fill();

    ctx.strokeStyle = borderColor || '#666666';
    ctx.lineWidth = borderWidth || 2;
    ctx.stroke();

    // Draw text on shape
    drawShapeText(ctx, obj);
}

/**
 * @description Draw a document shape with wavy bottom
 * @param {CanvasRenderingContext2D} ctx - Canvas context
 * @param {Object} obj - Document object
 */
export function drawDocument(ctx, obj) {
    const { x, y, width, height, color, borderColor, borderWidth } = obj;
    const waveHeight = height * 0.1;

    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + width, y);
    ctx.lineTo(x + width, y + height - waveHeight);

    // Wavy bottom edge
    ctx.bezierCurveTo(
        x + width * 0.75, y + height - waveHeight * 2,
        x + width * 0.5, y + height,
        x + width * 0.25, y + height - waveHeight
    );
    ctx.bezierCurveTo(
        x + width * 0.1, y + height - waveHeight * 1.5,
        x, y + height - waveHeight * 0.5,
        x, y + height - waveHeight
    );

    ctx.lineTo(x, y);
    ctx.closePath();

    ctx.fillStyle = color || '#E8E8E8';
    ctx.fill();

    ctx.strokeStyle = borderColor || '#666666';
    ctx.lineWidth = borderWidth || 2;
    ctx.stroke();

    // Draw text on shape
    drawShapeText(ctx, obj);
}

/**
 * @description Draw a Salesforce record card
 * @param {CanvasRenderingContext2D} ctx - Canvas context
 * @param {Object} obj - Record object
 * @param {Object} iconImages - Map of icon type to loaded Image objects
 */
export function drawRecord(ctx, obj, iconImages = {}) {
    // Shadow
    ctx.shadowColor = 'rgba(0, 0, 0, 0.12)';
    ctx.shadowBlur = 4;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 2;

    // Rounded rectangle background
    const radius = 6;
    ctx.fillStyle = obj.color || '#f4f6f9';
    ctx.beginPath();
    ctx.moveTo(obj.x + radius, obj.y);
    ctx.lineTo(obj.x + obj.width - radius, obj.y);
    ctx.quadraticCurveTo(obj.x + obj.width, obj.y, obj.x + obj.width, obj.y + radius);
    ctx.lineTo(obj.x + obj.width, obj.y + obj.height - radius);
    ctx.quadraticCurveTo(obj.x + obj.width, obj.y + obj.height, obj.x + obj.width - radius, obj.y + obj.height);
    ctx.lineTo(obj.x + radius, obj.y + obj.height);
    ctx.quadraticCurveTo(obj.x, obj.y + obj.height, obj.x, obj.y + obj.height - radius);
    ctx.lineTo(obj.x, obj.y + radius);
    ctx.quadraticCurveTo(obj.x, obj.y, obj.x + radius, obj.y);
    ctx.closePath();
    ctx.fill();

    // Reset shadow
    ctx.shadowColor = 'transparent';

    // Border
    ctx.strokeStyle = '#d8d8d8';
    ctx.lineWidth = 1;
    ctx.stroke();

    // Icon circle (left side) - US-26, US-38: Always align icon at top left
    const iconX = obj.x + 20;
    // Always position icon at top (y+18) for consistent card appearance
    const iconY = obj.y + 18;
    const iconRadius = 14;

    // Icon background color based on object type
    const iconKey = obj.objectApiName ? obj.objectApiName.toLowerCase() : null;
    const iconBgColor = iconKey ? (ICON_COLORS[iconKey] || ICON_COLORS.default) : ICON_COLORS.default;

    ctx.beginPath();
    ctx.arc(iconX, iconY, iconRadius, 0, Math.PI * 2);
    ctx.fillStyle = iconBgColor;
    ctx.fill();

    // Draw SLDS icon image (if loaded)
    const iconImg = iconKey ? iconImages[iconKey] : null;

    if (iconImg && iconImg.complete && iconImg.naturalWidth > 0) {
        // Draw the actual SLDS icon
        const iconSize = 20;
        ctx.drawImage(
            iconImg,
            iconX - iconSize / 2,
            iconY - iconSize / 2,
            iconSize,
            iconSize
        );
    } else {
        // Fallback: draw first letter if icon not loaded
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 14px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const iconLetter = obj.objectApiName ? obj.objectApiName[0] : 'R';
        ctx.fillText(iconLetter, iconX, iconY);
    }

    // Name text
    ctx.fillStyle = '#181818';
    ctx.font = 'bold 13px sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    const textX = obj.x + 42;

    // US-38: Always position text at top left for consistent card appearance
    ctx.fillText(obj.name, textX, obj.y + 18, obj.width - 50);
    if (obj.subtitle) {
        ctx.fillStyle = '#706e6b';
        ctx.font = '11px sans-serif';
        ctx.fillText(obj.subtitle, textX, obj.y + 34, obj.width - 50);
    }
}

/**
 * @description Draw an activity card (Task, Event, Email) - US-35, US-36
 * @param {CanvasRenderingContext2D} ctx - Canvas context
 * @param {Object} obj - Activity object
 * @param {Object} iconImages - Map of icon type to loaded Image objects
 */
export function drawActivity(ctx, obj, iconImages = {}) {
    const { x, y, width, height, subject, subtitle, activityType, color,
            whoName, whoObjectType, whatName, whatObjectType } = obj;

    // Check if we have related records (affects icon positioning)
    const hasRelatedRecords = whoName || whatName;

    // Shadow
    ctx.shadowColor = 'rgba(0, 0, 0, 0.12)';
    ctx.shadowBlur = 4;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 2;

    // Rounded rectangle background
    const radius = 4;
    ctx.fillStyle = color || '#f4f6f9';
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + width - radius, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
    ctx.lineTo(x + width, y + height - radius);
    ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
    ctx.lineTo(x + radius, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.closePath();
    ctx.fill();

    // Reset shadow
    ctx.shadowColor = 'transparent';

    // Border
    ctx.strokeStyle = '#dddbda';
    ctx.lineWidth = 1;
    ctx.stroke();

    // Icon background circle - US-38: Always position at top left for consistent appearance
    const iconSize = 28;
    const iconX = x + 10;
    // Always align icon center with first text line (y + 18)
    const iconY = y + 18 - iconSize / 2;

    // Get icon color based on activity type
    const iconColor = ACTIVITY_ICON_COLORS[activityType] || '#7f8de1';

    ctx.fillStyle = iconColor;
    ctx.beginPath();
    ctx.arc(iconX + iconSize/2, iconY + iconSize/2, iconSize/2, 0, Math.PI * 2);
    ctx.fill();

    // Draw icon image if available
    const iconImg = iconImages?.[activityType];
    if (iconImg && iconImg.complete && iconImg.naturalWidth > 0) {
        const imgSize = 18;
        const imgX = iconX + (iconSize - imgSize) / 2;
        const imgY = iconY + (iconSize - imgSize) / 2;
        ctx.drawImage(iconImg, imgX, imgY, imgSize, imgSize);
    } else {
        // Fallback: draw first letter
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 12px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const letter = activityType ? activityType[0].toUpperCase() : 'A';
        ctx.fillText(letter, iconX + iconSize/2, iconY + iconSize/2);
    }

    // Subject text (line 1)
    const textX = iconX + iconSize + 10;
    const textMaxWidth = width - iconSize - 30;

    ctx.fillStyle = '#080707';
    ctx.font = 'bold 13px sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';

    let displaySubject = subject || 'No Subject';
    if (ctx.measureText(displaySubject).width > textMaxWidth) {
        while (ctx.measureText(displaySubject + '...').width > textMaxWidth && displaySubject.length > 0) {
            displaySubject = displaySubject.slice(0, -1);
        }
        displaySubject += '...';
    }
    ctx.fillText(displaySubject, textX, y + 8);

    // Subtitle text (line 2)
    if (subtitle) {
        ctx.fillStyle = '#706e6b';
        ctx.font = '11px sans-serif';
        ctx.fillText(subtitle, textX, y + 25, textMaxWidth);
    }

    // US-36: Related records line (line 3) with icons
    if (hasRelatedRecords) {
        const relatedY = y + 50;
        let relatedX = textX;
        const smallIconSize = 14;

        ctx.font = '11px sans-serif';
        ctx.textBaseline = 'middle';

        // Draw Who icon + name
        if (whoName && whoObjectType) {
            const whoIconKey = whoObjectType.toLowerCase();
            const whoIcon = iconImages?.[whoIconKey];

            // Draw small icon circle background
            const whoIconColor = ICON_COLORS[whoIconKey] || '#7f8de1';
            ctx.fillStyle = whoIconColor;
            ctx.beginPath();
            ctx.arc(relatedX + smallIconSize/2, relatedY, smallIconSize/2, 0, Math.PI * 2);
            ctx.fill();

            // Draw icon image
            if (whoIcon && whoIcon.complete && whoIcon.naturalWidth > 0) {
                ctx.drawImage(whoIcon, relatedX + 2, relatedY - 5, 10, 10);
            }

            relatedX += smallIconSize + 4;

            // Draw name
            ctx.fillStyle = '#706e6b';
            const truncatedWho = truncateText(ctx, whoName, whatName ? (textMaxWidth / 2 - 20) : (textMaxWidth - 20));
            ctx.fillText(truncatedWho, relatedX, relatedY);
            relatedX += ctx.measureText(truncatedWho).width + 10;
        }

        // Draw separator if both present
        if (whoName && whatName) {
            ctx.fillStyle = '#dddbda';
            ctx.fillText('•', relatedX, relatedY);
            relatedX += 12;
        }

        // Draw What icon + name
        if (whatName && whatObjectType) {
            const whatIconKey = whatObjectType.toLowerCase();
            const whatIcon = iconImages?.[whatIconKey];

            // Draw small icon circle background
            const whatIconColor = ICON_COLORS[whatIconKey] || '#7f8de1';
            ctx.fillStyle = whatIconColor;
            ctx.beginPath();
            ctx.arc(relatedX + smallIconSize/2, relatedY, smallIconSize/2, 0, Math.PI * 2);
            ctx.fill();

            // Draw icon image
            if (whatIcon && whatIcon.complete && whatIcon.naturalWidth > 0) {
                ctx.drawImage(whatIcon, relatedX + 2, relatedY - 5, 10, 10);
            }

            relatedX += smallIconSize + 4;

            // Draw name
            ctx.fillStyle = '#706e6b';
            const remainingWidth = width - (relatedX - x) - 10;
            const truncatedWhat = truncateText(ctx, whatName, remainingWidth);
            ctx.fillText(truncatedWhat, relatedX, relatedY);
        }
    }
}

/**
 * @description Helper to truncate text with ellipsis
 */
function truncateText(ctx, text, maxWidth) {
    if (ctx.measureText(text).width <= maxWidth) {
        return text;
    }
    let truncated = text;
    while (ctx.measureText(truncated + '...').width > maxWidth && truncated.length > 0) {
        truncated = truncated.slice(0, -1);
    }
    return truncated + '...';
}

/**
 * @description Draw a group indicator (dotted border with label)
 * @param {CanvasRenderingContext2D} ctx - Canvas context
 * @param {Object} group - Group object with x, y, width, height
 * @param {boolean} isSelected - Whether the group is selected
 */
export function drawGroupIndicator(ctx, group, isSelected = false) {
    // Only show indicator when group is selected
    if (!isSelected) return;

    ctx.save();

    // Draw subtle dotted border around group bounds
    ctx.strokeStyle = '#0176d3';
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]);

    // Draw bounding box with padding
    const padding = 8;
    ctx.strokeRect(
        group.x - padding,
        group.y - padding,
        group.width + padding * 2,
        group.height + padding * 2
    );

    // Draw "GROUP" label at top-left
    ctx.setLineDash([]);
    ctx.fillStyle = '#0176d3';
    ctx.font = '10px sans-serif';
    ctx.fillText('GROUP', group.x - padding, group.y - padding - 4);

    ctx.restore();
}

// ========== Stroke Drawing ==========

/**
 * @description Draw a single freehand stroke
 * @param {CanvasRenderingContext2D} ctx - Canvas context
 * @param {Object} stroke - Stroke object with points, color, width
 */
export function drawSingleStroke(ctx, stroke) {
    if (!stroke.points || stroke.points.length < 2) return;

    ctx.beginPath();
    ctx.strokeStyle = stroke.color || '#333333';
    ctx.lineWidth = stroke.width || 3;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    ctx.moveTo(stroke.points[0].x, stroke.points[0].y);
    for (let i = 1; i < stroke.points.length; i++) {
        ctx.lineTo(stroke.points[i].x, stroke.points[i].y);
    }
    ctx.stroke();
}

// ========== Connector Drawing ==========

/**
 * @description Draw an arrowhead at the end of a line
 * @param {CanvasRenderingContext2D} ctx - Canvas context
 * @param {Object} from - Start point {x, y}
 * @param {Object} to - End point {x, y}
 * @param {string} color - Arrow color
 */
export function drawArrowhead(ctx, from, to, color) {
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
 * @description Draw an elbow (orthogonal) connector path
 * @param {CanvasRenderingContext2D} ctx - Canvas context
 * @param {Object} start - Start point {x, y}
 * @param {Object} end - End point {x, y}
 * @param {Array} waypoints - Array of waypoint {x, y} objects
 */
export function drawElbowPath(ctx, start, end, waypoints = []) {
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
 * @description Draw a curved (bezier) connector path
 * @param {CanvasRenderingContext2D} ctx - Canvas context
 * @param {Object} start - Start point {x, y}
 * @param {Object} end - End point {x, y}
 * @param {Object} cp1 - Control point 1 {x, y}
 * @param {Object} cp2 - Control point 2 {x, y}
 */
export function drawCurvedPath(ctx, start, end, cp1, cp2) {
    const controlPoint1 = cp1 || { x: start.x + (end.x - start.x) * 0.25, y: start.y };
    const controlPoint2 = cp2 || { x: end.x - (end.x - start.x) * 0.25, y: end.y };

    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    ctx.bezierCurveTo(controlPoint1.x, controlPoint1.y, controlPoint2.x, controlPoint2.y, end.x, end.y);
    ctx.stroke();
}

// ========== Anchor Point Utilities ==========

/**
 * @description Get anchor point position on an object
 * @param {Object} obj - Object with x, y, width, height, type
 * @param {string} position - 'top', 'bottom', 'left', 'right', or 'center'
 * @returns {Object} Point {x, y}
 */
export function getAnchorPoint(obj, position) {
    // Diamond shape has anchors at vertices (not edge midpoints)
    if (obj.type === 'diamond') {
        const cx = obj.x + obj.width / 2;
        const cy = obj.y + obj.height / 2;
        switch (position) {
            case 'top':
                return { x: cx, y: obj.y };
            case 'bottom':
                return { x: cx, y: obj.y + obj.height };
            case 'left':
                return { x: obj.x, y: cy };
            case 'right':
                return { x: obj.x + obj.width, y: cy };
            default:
                return { x: cx, y: cy };
        }
    }

    // Triangle has anchors at vertices
    if (obj.type === 'triangle') {
        switch (position) {
            case 'top':
                return { x: obj.x + obj.width / 2, y: obj.y };
            case 'bottom':
                return { x: obj.x + obj.width / 2, y: obj.y + obj.height };
            case 'left':
                return { x: obj.x + obj.width * 0.25, y: obj.y + obj.height * 0.5 };
            case 'right':
                return { x: obj.x + obj.width * 0.75, y: obj.y + obj.height * 0.5 };
            default:
                return { x: obj.x + obj.width / 2, y: obj.y + obj.height * 0.6 };
        }
    }

    // Default bounding box anchors for all other shapes
    switch (position) {
        case 'top':
            return { x: obj.x + obj.width / 2, y: obj.y };
        case 'bottom':
            return { x: obj.x + obj.width / 2, y: obj.y + obj.height };
        case 'left':
            return { x: obj.x, y: obj.y + obj.height / 2 };
        case 'right':
            return { x: obj.x + obj.width, y: obj.y + obj.height / 2 };
        case 'center':
        default:
            return { x: obj.x + obj.width / 2, y: obj.y + obj.height / 2 };
    }
}

// ========== Connector Label Functions (US-42) ==========

/**
 * @description Get point on a straight line at position t (0-1)
 * @param {Object} start - Start point {x, y}
 * @param {Object} end - End point {x, y}
 * @param {number} t - Position along line (0 = start, 1 = end)
 * @returns {Object} Point {x, y}
 */
export function getPointOnLine(start, end, t) {
    return {
        x: start.x + (end.x - start.x) * t,
        y: start.y + (end.y - start.y) * t
    };
}

/**
 * @description Get point on a cubic bezier curve at position t (0-1)
 * @param {Object} p0 - Start point
 * @param {Object} p1 - Control point 1
 * @param {Object} p2 - Control point 2
 * @param {Object} p3 - End point
 * @param {number} t - Position along curve (0-1)
 * @returns {Object} Point {x, y}
 */
export function getPointOnBezier(p0, p1, p2, p3, t) {
    const mt = 1 - t;
    return {
        x: mt * mt * mt * p0.x + 3 * mt * mt * t * p1.x + 3 * mt * t * t * p2.x + t * t * t * p3.x,
        y: mt * mt * mt * p0.y + 3 * mt * mt * t * p1.y + 3 * mt * t * t * p2.y + t * t * t * p3.y
    };
}

/**
 * @description Get point on an elbow connector at position t (0-1)
 * @param {Array} points - Array of all points [start, ...waypoints, end]
 * @param {number} t - Position along path (0-1)
 * @returns {Object} Point {x, y}
 */
export function getPointOnElbow(points, t) {
    if (points.length < 2) return points[0] || { x: 0, y: 0 };
    if (points.length === 2) return getPointOnLine(points[0], points[1], t);

    // Calculate total length and segment lengths
    let totalLength = 0;
    const segmentLengths = [];
    for (let i = 0; i < points.length - 1; i++) {
        const dx = points[i + 1].x - points[i].x;
        const dy = points[i + 1].y - points[i].y;
        const len = Math.sqrt(dx * dx + dy * dy);
        segmentLengths.push(len);
        totalLength += len;
    }

    if (totalLength === 0) return points[0];

    // Find which segment contains position t
    const targetLength = t * totalLength;
    let accumulatedLength = 0;

    for (let i = 0; i < segmentLengths.length; i++) {
        if (accumulatedLength + segmentLengths[i] >= targetLength) {
            // Found the segment - interpolate within it
            const segmentT = (targetLength - accumulatedLength) / segmentLengths[i];
            return getPointOnLine(points[i], points[i + 1], segmentT);
        }
        accumulatedLength += segmentLengths[i];
    }

    // Return end point if t >= 1
    return points[points.length - 1];
}

/**
 * @description Draw a connector label with white pill background
 * @param {CanvasRenderingContext2D} ctx - Canvas context
 * @param {Object} connector - Connector object with label, labelPosition
 * @param {Object} start - Resolved start point {x, y}
 * @param {Object} end - Resolved end point {x, y}
 */
export function drawConnectorLabel(ctx, connector, start, end) {
    if (!connector.label) return;

    const labelPosition = connector.labelPosition ?? 0.5;
    let pos;

    // Calculate position based on connector type
    if (connector.connectorType === 'curved') {
        const cp1 = connector.controlPoint1 || { x: start.x + (end.x - start.x) * 0.25, y: start.y };
        const cp2 = connector.controlPoint2 || { x: end.x - (end.x - start.x) * 0.25, y: end.y };
        pos = getPointOnBezier(start, cp1, cp2, end, labelPosition);
    } else if (connector.connectorType === 'elbow') {
        const waypoints = connector.waypoints || [];
        const points = [start, ...waypoints, end];
        pos = getPointOnElbow(points, labelPosition);
    } else {
        // Straight line (arrow, line)
        pos = getPointOnLine(start, end, labelPosition);
    }

    // Draw label
    const fontSize = connector.labelFontSize || 12;
    const padding = 6;

    ctx.save();
    ctx.font = `${fontSize}px sans-serif`;
    const metrics = ctx.measureText(connector.label);
    const width = metrics.width + padding * 2;
    const height = fontSize + padding * 2;

    // White pill background
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#d8d8d8';
    ctx.lineWidth = 1;
    ctx.beginPath();
    const radius = height / 2;
    ctx.roundRect(pos.x - width / 2, pos.y - height / 2, width, height, radius);
    ctx.fill();
    ctx.stroke();

    // Text
    ctx.fillStyle = '#333333';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(connector.label, pos.x, pos.y);

    ctx.restore();
}

/**
 * @description Get label bounding box for hit detection
 * @param {Object} connector - Connector with label
 * @param {Object} start - Resolved start point
 * @param {Object} end - Resolved end point
 * @returns {Object|null} Bounding box {x, y, width, height} or null if no label
 */
export function getConnectorLabelBounds(connector, start, end) {
    if (!connector.label) return null;

    const labelPosition = connector.labelPosition ?? 0.5;
    let pos;

    if (connector.connectorType === 'curved') {
        const cp1 = connector.controlPoint1 || { x: start.x + (end.x - start.x) * 0.25, y: start.y };
        const cp2 = connector.controlPoint2 || { x: end.x - (end.x - start.x) * 0.25, y: end.y };
        pos = getPointOnBezier(start, cp1, cp2, end, labelPosition);
    } else if (connector.connectorType === 'elbow') {
        const waypoints = connector.waypoints || [];
        const points = [start, ...waypoints, end];
        pos = getPointOnElbow(points, labelPosition);
    } else {
        pos = getPointOnLine(start, end, labelPosition);
    }

    // Estimate label size (matches drawConnectorLabel)
    const fontSize = connector.labelFontSize || 12;
    const padding = 6;
    // Approximate width: ~7px per character for 12px font
    const charWidth = fontSize * 0.6;
    const width = connector.label.length * charWidth + padding * 2;
    const height = fontSize + padding * 2;

    return {
        x: pos.x - width / 2,
        y: pos.y - height / 2,
        width,
        height
    };
}

/**
 * @description Find closest position (t value) on connector to a point
 * @param {Object} connector - The connector
 * @param {Object} start - Resolved start point
 * @param {Object} end - Resolved end point
 * @param {number} mouseX - Mouse X coordinate
 * @param {number} mouseY - Mouse Y coordinate
 * @returns {number} t value (0-1) for closest point on connector
 */
export function findClosestPositionOnConnector(connector, start, end, mouseX, mouseY) {
    // Sample points along the connector and find closest
    const samples = 50;
    let closestT = 0.5;
    let closestDist = Infinity;

    for (let i = 0; i <= samples; i++) {
        const t = i / samples;
        let pos;

        if (connector.connectorType === 'curved') {
            const cp1 = connector.controlPoint1 || { x: start.x + (end.x - start.x) * 0.25, y: start.y };
            const cp2 = connector.controlPoint2 || { x: end.x - (end.x - start.x) * 0.25, y: end.y };
            pos = getPointOnBezier(start, cp1, cp2, end, t);
        } else if (connector.connectorType === 'elbow') {
            const waypoints = connector.waypoints || [];
            const points = [start, ...waypoints, end];
            pos = getPointOnElbow(points, t);
        } else {
            pos = getPointOnLine(start, end, t);
        }

        const dx = mouseX - pos.x;
        const dy = mouseY - pos.y;
        const dist = dx * dx + dy * dy;

        if (dist < closestDist) {
            closestDist = dist;
            closestT = t;
        }
    }

    // Clamp to 0.05-0.95 to keep label away from endpoints
    return Math.max(0.05, Math.min(0.95, closestT));
}

// ========== Fit to Content (US-34) ==========

/**
 * @description Calculate zoom and pan to fit all content in view
 * @param {Array} objects - Canvas objects
 * @param {Array} strokes - Freehand strokes
 * @param {Array} connectors - Connector lines
 * @param {number} canvasWidth - Canvas element width
 * @param {number} canvasHeight - Canvas element height
 * @param {Object} options - { padding, minZoom, maxZoom, resolveConnectorPoint }
 * @returns {Object} { zoomLevel, panOffsetX, panOffsetY, hasContent }
 */
export function calculateFitToContent(objects, strokes, connectors, canvasWidth, canvasHeight, options = {}) {
    const {
        padding = 50,
        minZoom = 0.5,
        maxZoom = 2.0,
        resolveConnectorPoint = null // Function to resolve connector anchors
    } = options;

    // Initialize bounds to invalid state
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    // Include all objects in bounds
    for (const obj of objects) {
        if (obj.x !== undefined && obj.y !== undefined && obj.width !== undefined && obj.height !== undefined) {
            minX = Math.min(minX, obj.x);
            minY = Math.min(minY, obj.y);
            maxX = Math.max(maxX, obj.x + obj.width);
            maxY = Math.max(maxY, obj.y + obj.height);
        }
    }

    // Include all stroke points in bounds
    for (const stroke of strokes) {
        if (stroke.points && stroke.points.length > 0) {
            for (const point of stroke.points) {
                minX = Math.min(minX, point.x);
                minY = Math.min(minY, point.y);
                maxX = Math.max(maxX, point.x);
                maxY = Math.max(maxY, point.y);
            }
        }
    }

    // Include connector endpoints in bounds
    for (const connector of connectors) {
        // Try to resolve anchor points if function provided
        if (resolveConnectorPoint) {
            const start = resolveConnectorPoint(connector, 'start');
            const end = resolveConnectorPoint(connector, 'end');
            if (start) {
                minX = Math.min(minX, start.x);
                minY = Math.min(minY, start.y);
                maxX = Math.max(maxX, start.x);
                maxY = Math.max(maxY, start.y);
            }
            if (end) {
                minX = Math.min(minX, end.x);
                minY = Math.min(minY, end.y);
                maxX = Math.max(maxX, end.x);
                maxY = Math.max(maxY, end.y);
            }
        } else {
            // Fallback to direct coordinates
            if (connector.startX !== undefined) {
                minX = Math.min(minX, connector.startX);
                minY = Math.min(minY, connector.startY);
                maxX = Math.max(maxX, connector.startX);
                maxY = Math.max(maxY, connector.startY);
            }
            if (connector.endX !== undefined) {
                minX = Math.min(minX, connector.endX);
                minY = Math.min(minY, connector.endY);
                maxX = Math.max(maxX, connector.endX);
                maxY = Math.max(maxY, connector.endY);
            }
        }
    }

    // Check if we have any content
    const hasContent = minX !== Infinity && maxX !== -Infinity;

    if (!hasContent) {
        // No content - return default view
        return {
            zoomLevel: 1.0,
            panOffsetX: 0,
            panOffsetY: 0,
            hasContent: false
        };
    }

    // Calculate content dimensions with padding
    const contentWidth = maxX - minX + padding * 2;
    const contentHeight = maxY - minY + padding * 2;

    // Calculate zoom to fit content
    const zoomX = canvasWidth / contentWidth;
    const zoomY = canvasHeight / contentHeight;

    // Use smaller zoom to fit both dimensions, clamped to limits
    let zoomLevel = Math.min(zoomX, zoomY);
    zoomLevel = Math.max(minZoom, Math.min(maxZoom, zoomLevel));
    zoomLevel = Math.round(zoomLevel * 10) / 10; // Round to 1 decimal

    // Calculate pan to center content
    const contentCenterX = minX + (maxX - minX) / 2;
    const contentCenterY = minY + (maxY - minY) / 2;

    const viewportCenterX = canvasWidth / (2 * zoomLevel);
    const viewportCenterY = canvasHeight / (2 * zoomLevel);

    const panOffsetX = viewportCenterX - contentCenterX;
    const panOffsetY = viewportCenterY - contentCenterY;

    return {
        zoomLevel,
        panOffsetX,
        panOffsetY,
        hasContent: true
    };
}