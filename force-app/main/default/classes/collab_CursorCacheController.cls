/**
 * @description Controller for managing cursor positions via Platform Cache.
 * Handles high-frequency cursor updates for real-time collaboration without
 * consuming Platform Event limits.
 *
 * Cache Key Structure:
 * - users{canvasId}: List of active user IDs (TTL: 60s)
 * - cursor{canvasId}{userId}: Individual cursor data (TTL: 10s)
 *
 * @author Nils Lehsten
 * @date 2025-11-26
 */
public with sharing class collab_CursorCacheController {

    private static final String PARTITION_NAME = 'local.CollabCanvas';
    private static final Integer CURSOR_TTL = 300;     // seconds (minimum for Org Cache)
    private static final Integer REGISTRY_TTL = 300;   // seconds (minimum for Org Cache)
    private static final Integer STALE_THRESHOLD_MS = 60000; // 60 seconds - matches LWC STALE_THRESHOLD

    // Color palette for user identification
    private static final List<String> USER_COLORS = new List<String>{
        '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4',
        '#FFEAA7', '#DDA0DD', '#98D8C8', '#F7DC6F',
        '#BB8FCE', '#85C1E9', '#F8B500', '#00CED1'
    };

    /**
     * @description Update current user's cursor position in cache
     * @param canvasId The canvas identifier
     * @param x X coordinate
     * @param y Y coordinate
     */
    @AuraEnabled
    public static void updateCursor(String canvasId, Decimal x, Decimal y) {
        validateCanvasId(canvasId);

        String userId = UserInfo.getUserId();
        String userName = UserInfo.getName();

        // Build cursor data
        Map<String, Object> cursorData = new Map<String, Object>{
            'x' => x,
            'y' => y,
            'name' => userName,
            'color' => getUserColor(userId),
            'timestamp' => System.currentTimeMillis()
        };

        try {
            Cache.OrgPartition partition = Cache.Org.getPartition(PARTITION_NAME);

            // Write cursor position (keys must be alphanumeric only)
            String cursorKey = 'cursor' + canvasId + userId;
            partition.put(cursorKey, JSON.serialize(cursorData), CURSOR_TTL);

            // Update user registry
            updateUserRegistry(partition, canvasId, userId);
        } catch (Cache.CacheException e) {
            // Cache partition may not exist - fail gracefully
            throw new AuraHandledException('Platform Cache not available. Please contact your administrator to create the CollabCanvas cache partition.');
        }
    }

    /**
     * @description Get all cursor positions for a canvas (excluding current user)
     * @param canvasId The canvas identifier
     * @return JSON string containing map of userId to cursor data
     */
    @AuraEnabled
    public static String getAllCursors(String canvasId) {
        validateCanvasId(canvasId);

        try {
            Cache.OrgPartition partition = Cache.Org.getPartition(PARTITION_NAME);
            String registryKey = 'users' + canvasId;

            // Get registered users
            String registryJson = (String)partition.get(registryKey);
            if (String.isBlank(registryJson)) {
                return '{}';
            }

            List<String> userIds = (List<String>)JSON.deserialize(registryJson, List<String>.class);
            Map<String, Object> cursors = new Map<String, Object>();
            String currentUserId = UserInfo.getUserId();
            Long now = System.currentTimeMillis();

            for (String otherUserId : userIds) {
                // Skip own cursor
                if (otherUserId == currentUserId) {
                    continue;
                }

                String cursorKey = 'cursor' + canvasId + otherUserId;
                String cursorJson = (String)partition.get(cursorKey);

                if (String.isNotBlank(cursorJson)) {
                    Map<String, Object> cursor = (Map<String, Object>)JSON.deserializeUntyped(cursorJson);

                    // Filter stale cursors (>5 seconds old)
                    Object timestampObj = cursor.get('timestamp');
                    if (timestampObj != null) {
                        Long timestamp = Long.valueOf(String.valueOf(timestampObj));
                        if (now - timestamp < STALE_THRESHOLD_MS) {
                            cursors.put(otherUserId, cursor);
                        }
                    }
                }
            }

            return JSON.serialize(cursors);
        } catch (Cache.CacheException e) {
            // Cache not available - return empty
            return '{}';
        }
    }

    /**
     * @description Remove user's cursor from canvas (called on disconnect)
     * @param canvasId The canvas identifier
     */
    @AuraEnabled
    public static void removeCursor(String canvasId) {
        validateCanvasId(canvasId);

        String userId = UserInfo.getUserId();

        try {
            Cache.OrgPartition partition = Cache.Org.getPartition(PARTITION_NAME);

            // Remove cursor
            String cursorKey = 'cursor' + canvasId + userId;
            partition.remove(cursorKey);

            // Remove from registry
            removeFromRegistry(partition, canvasId, userId);
        } catch (Cache.CacheException e) {
            // Fail silently on disconnect
        }
    }

    /**
     * @description Heartbeat to keep cursor alive during idle periods
     * @param canvasId The canvas identifier
     */
    @AuraEnabled
    public static void heartbeat(String canvasId) {
        validateCanvasId(canvasId);

        String userId = UserInfo.getUserId();

        try {
            Cache.OrgPartition partition = Cache.Org.getPartition(PARTITION_NAME);

            String cursorKey = 'cursor' + canvasId + userId;
            String existing = (String)partition.get(cursorKey);

            if (String.isNotBlank(existing)) {
                // Re-put with fresh TTL and updated timestamp
                Map<String, Object> cursor = (Map<String, Object>)JSON.deserializeUntyped(existing);
                cursor.put('timestamp', System.currentTimeMillis());
                partition.put(cursorKey, JSON.serialize(cursor), CURSOR_TTL);
            }

            // Refresh registry entry
            updateUserRegistry(partition, canvasId, userId);
        } catch (Cache.CacheException e) {
            // Fail silently
        }
    }

    /**
     * @description Generate consistent color for a user based on their ID
     * @param userId The user's Salesforce ID
     * @return Hex color code
     */
    @TestVisible
    private static String getUserColor(String otherUserId) {
        if (String.isBlank(otherUserId)) {
            return USER_COLORS[0];
        }
        Integer hash = Math.abs(otherUserId.hashCode());
        return USER_COLORS[Math.mod(hash, USER_COLORS.size())];
    }

    /**
     * @description Update the user registry for a canvas
     */
    private static void updateUserRegistry(Cache.OrgPartition partition, String canvasId, String userId) {
        String registryKey = 'users' + canvasId;
        String registryJson = (String)partition.get(registryKey);

        Set<String> userIds = new Set<String>();
        if (String.isNotBlank(registryJson)) {
            userIds.addAll((List<String>)JSON.deserialize(registryJson, List<String>.class));
        }

        userIds.add(userId);
        partition.put(registryKey, JSON.serialize(new List<String>(userIds)), REGISTRY_TTL);
    }

    /**
     * @description Remove a user from the registry
     */
    private static void removeFromRegistry(Cache.OrgPartition partition, String canvasId, String userId) {
        String registryKey = 'users' + canvasId;
        String registryJson = (String)partition.get(registryKey);

        if (String.isNotBlank(registryJson)) {
            Set<String> userIds = new Set<String>(
                (List<String>)JSON.deserialize(registryJson, List<String>.class)
            );
            userIds.remove(userId);

            if (userIds.isEmpty()) {
                partition.remove(registryKey);
            } else {
                partition.put(registryKey, JSON.serialize(new List<String>(userIds)), REGISTRY_TTL);
            }
        }
    }

    /**
     * @description Validate canvas ID format
     */
    private static void validateCanvasId(String canvasId) {
        if (String.isBlank(canvasId)) {
            throw new AuraHandledException('Canvas ID is required');
        }
        if (canvasId.length() > 50) {
            throw new AuraHandledException('Canvas ID too long');
        }
        // Allow alphanumeric, underscores, and hyphens only
        if (!Pattern.matches('^[a-zA-Z0-9_\\-]+$', canvasId)) {
            throw new AuraHandledException('Canvas ID contains invalid characters');
        }
    }
}
