/**
 * @description Controller for real-time object collaboration via Platform Events.
 * Handles publishing collaboration events and persisting canvas state.
 *
 * Event Types:
 * - object_add/move/delete/resize/style/layer: Canvas object operations
 * - draw_stroke/stroke_delete: Freehand drawing operations
 * - connector_add/update/delete/layer: Connector operations
 * - group_create/ungroup: Grouping operations
 * - user_join/leave: Presence tracking
 *
 * @author Nils Lehsten
 * @date 2025-11-26
 */
public with sharing class collab_CollaborationController {

    // Color palette for user identification (shared with CursorCacheController)
    private static final List<String> USER_COLORS = new List<String>{
        '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4',
        '#FFEAA7', '#DDA0DD', '#98D8C8', '#F7DC6F',
        '#BB8FCE', '#85C1E9', '#F8B500', '#00CED1'
    };

    // Valid event types
    private static final Set<String> VALID_EVENT_TYPES = new Set<String>{
        // Object events
        'object_add', 'object_move', 'object_delete', 'object_resize', 'object_style', 'object_layer',
        // Drawing events
        'draw_stroke', 'stroke_delete',
        // Connector events
        'connector_add', 'connector_update', 'connector_delete', 'connector_layer',
        // Group events
        'group_create', 'group_ungroup',
        // User events
        'user_join', 'user_leave'
    };

    /**
     * @description Publish a collaboration event to all canvas subscribers
     * @param canvasId The canvas identifier
     * @param eventType Type of event (object_add, object_move, etc.)
     * @param payload JSON payload with event data
     */
    @AuraEnabled
    public static void publishEvent(String canvasId, String eventType, String payload) {
        validateCanvasId(canvasId);
        validateEventType(eventType);
        validatePayload(payload);

        String userId = UserInfo.getUserId();
        String userName = UserInfo.getName();

        collab_Collaboration_Event__e event = new collab_Collaboration_Event__e(
            collab_Canvas_Id__c = canvasId,
            collab_User_Id__c = userId,
            collab_User_Name__c = userName,
            collab_User_Color__c = getUserColor(userId),
            collab_Event_Type__c = eventType,
            collab_Payload__c = payload,
            collab_Timestamp__c = Datetime.now()
        );

        Database.SaveResult result = EventBus.publish(event);

        if (!result.isSuccess()) {
            String errorMsg = 'Failed to publish event: ';
            for (Database.Error err : result.getErrors()) {
                errorMsg += err.getMessage() + ' ';
            }
            throw new AuraHandledException(errorMsg.trim());
        }
    }

    /**
     * @description Save canvas state to custom object (upsert by External ID)
     * @param canvasId The canvas identifier
     * @param stateJson JSON string containing full canvas state
     */
    @AuraEnabled
    public static void saveCanvasState(String canvasId, String stateJson) {
        validateCanvasId(canvasId);
        validateStateJson(stateJson);

        collab_Canvas_State__c state = new collab_Canvas_State__c(
            collab_External_Id__c = canvasId,
            collab_State_JSON__c = stateJson,
            collab_Last_Modified_By__c = UserInfo.getUserId()
        );

        try {
            upsert state collab_External_Id__c;
        } catch (DmlException e) {
            throw new AuraHandledException('Failed to save canvas state: ' + e.getMessage());
        }
    }

    /**
     * @description Load canvas state from custom object
     * @param canvasId The canvas identifier
     * @return JSON string containing canvas state, or '{}' if not found
     */
    @AuraEnabled
    public static String loadCanvasState(String canvasId) {
        validateCanvasId(canvasId);

        // Note: Uses 'with sharing' for record-level security
        // FLS is enforced via permission sets (collab_CanvasUser, collab_CanvasAdmin)
        List<collab_Canvas_State__c> states = [
            SELECT collab_State_JSON__c
            FROM collab_Canvas_State__c
            WHERE collab_External_Id__c = :canvasId
            LIMIT 1
        ];

        if (states.isEmpty()) {
            return '{}';
        }

        String stateJson = states[0].collab_State_JSON__c;
        return String.isBlank(stateJson) ? '{}' : stateJson;
    }

    /**
     * @description Generate consistent color for a user based on their ID
     * @param userId The user's Salesforce ID
     * @return Hex color code
     */
    @TestVisible
    private static String getUserColor(String userId) {
        if (String.isBlank(userId)) {
            return USER_COLORS[0];
        }
        Integer hash = Math.abs(userId.hashCode());
        return USER_COLORS[Math.mod(hash, USER_COLORS.size())];
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

    /**
     * @description Validate event type
     */
    private static void validateEventType(String eventType) {
        if (String.isBlank(eventType)) {
            throw new AuraHandledException('Event type is required');
        }
        if (!VALID_EVENT_TYPES.contains(eventType)) {
            throw new AuraHandledException('Invalid event type: ' + eventType);
        }
    }

    /**
     * @description Validate payload is valid JSON
     */
    private static void validatePayload(String payload) {
        if (String.isBlank(payload)) {
            throw new AuraHandledException('Payload is required');
        }
        try {
            JSON.deserializeUntyped(payload);
        } catch (JSONException e) {
            throw new AuraHandledException('Payload must be valid JSON');
        }
    }

    /**
     * @description Validate state JSON format
     */
    private static void validateStateJson(String stateJson) {
        if (String.isBlank(stateJson)) {
            throw new AuraHandledException('State JSON is required');
        }
        try {
            JSON.deserializeUntyped(stateJson);
        } catch (JSONException e) {
            throw new AuraHandledException('State must be valid JSON');
        }
    }

    // ========== US-06: Related Records Methods ==========

    /**
     * @description Wrapper class for returning record data to LWC
     */
    public class RecordWrapper {
        @AuraEnabled public Id recordId;
        @AuraEnabled public String name;
        @AuraEnabled public String objectApiName;
        @AuraEnabled public String subtitle;
        @AuraEnabled public String iconName;

        public RecordWrapper(Id recordId, String name, String objectApiName, String subtitle, String iconName) {
            this.recordId = recordId;
            this.name = name;
            this.objectApiName = objectApiName;
            this.subtitle = subtitle;
            this.iconName = iconName;
        }
    }

    /**
     * @description Get Contacts related to an Account
     * @param accountId The Account record ID
     * @param searchTerm Optional search term to filter by Name
     * @return List of RecordWrapper containing Contact data
     */
    @AuraEnabled(cacheable=true)
    public static List<RecordWrapper> getRelatedContacts(Id accountId, String searchTerm) {
        if (accountId == null) {
            throw new AuraHandledException('Account ID is required');
        }

        List<RecordWrapper> results = new List<RecordWrapper>();
        String searchPattern = String.isNotBlank(searchTerm) ? '%' + String.escapeSingleQuotes(searchTerm) + '%' : '%';

        List<Contact> contacts = [
            SELECT Id, Name, Title, Email
            FROM Contact
            WHERE AccountId = :accountId
            AND Name LIKE :searchPattern
            ORDER BY Name ASC
            LIMIT 50
        ];

        for (Contact c : contacts) {
            String subtitle = String.isNotBlank(c.Title) ? c.Title : (String.isNotBlank(c.Email) ? c.Email : '');
            results.add(new RecordWrapper(c.Id, c.Name, 'Contact', subtitle, 'standard:contact'));
        }

        return results;
    }

    /**
     * @description Get Opportunities related to an Account
     * @param accountId The Account record ID
     * @param searchTerm Optional search term to filter by Name
     * @return List of RecordWrapper containing Opportunity data
     */
    @AuraEnabled(cacheable=true)
    public static List<RecordWrapper> getRelatedOpportunities(Id accountId, String searchTerm) {
        if (accountId == null) {
            throw new AuraHandledException('Account ID is required');
        }

        List<RecordWrapper> results = new List<RecordWrapper>();
        String searchPattern = String.isNotBlank(searchTerm) ? '%' + String.escapeSingleQuotes(searchTerm) + '%' : '%';

        List<Opportunity> opps = [
            SELECT Id, Name, StageName, Amount
            FROM Opportunity
            WHERE AccountId = :accountId
            AND Name LIKE :searchPattern
            ORDER BY CloseDate DESC
            LIMIT 50
        ];

        for (Opportunity o : opps) {
            String subtitle = o.StageName;
            if (o.Amount != null) {
                subtitle += ' • $' + o.Amount.format();
            }
            results.add(new RecordWrapper(o.Id, o.Name, 'Opportunity', subtitle, 'standard:opportunity'));
        }

        return results;
    }

    /**
     * @description Search for Leads by name or company
     * @param searchTerm Search term (required, minimum 2 characters)
     * @return List of RecordWrapper containing Lead data
     */
    @AuraEnabled(cacheable=true)
    public static List<RecordWrapper> searchLeads(String searchTerm) {
        if (String.isBlank(searchTerm) || searchTerm.length() < 2) {
            return new List<RecordWrapper>();
        }

        List<RecordWrapper> results = new List<RecordWrapper>();
        String searchQuery = '*' + String.escapeSingleQuotes(searchTerm) + '*';

        List<List<SObject>> searchResults = [
            FIND :searchQuery
            IN NAME FIELDS
            RETURNING Lead(Id, Name, Company, Status ORDER BY Name ASC)
            LIMIT 50
        ];

        if (!searchResults.isEmpty()) {
            for (Lead l : (List<Lead>)searchResults[0]) {
                String subtitle = String.isNotBlank(l.Company) ? l.Company : l.Status;
                results.add(new RecordWrapper(l.Id, l.Name, 'Lead', subtitle, 'standard:lead'));
            }
        }

        return results;
    }

    /**
     * @description Search for active Users by name
     * @param searchTerm Search term (required, minimum 2 characters)
     * @return List of RecordWrapper containing User data
     */
    @AuraEnabled(cacheable=true)
    public static List<RecordWrapper> searchUsers(String searchTerm) {
        if (String.isBlank(searchTerm) || searchTerm.length() < 2) {
            return new List<RecordWrapper>();
        }

        List<RecordWrapper> results = new List<RecordWrapper>();
        String searchPattern = '%' + String.escapeSingleQuotes(searchTerm) + '%';

        List<User> users = [
            SELECT Id, Name, Title, Department
            FROM User
            WHERE IsActive = true
            AND Name LIKE :searchPattern
            ORDER BY Name ASC
            LIMIT 50
        ];

        for (User u : users) {
            String subtitle = '';
            if (String.isNotBlank(u.Title)) {
                subtitle = u.Title;
            }
            if (String.isNotBlank(u.Department)) {
                subtitle += String.isNotBlank(subtitle) ? ' • ' + u.Department : u.Department;
            }
            results.add(new RecordWrapper(u.Id, u.Name, 'User', subtitle, 'standard:user'));
        }

        return results;
    }

    // ========== US-35: Activity Elements Methods ==========

    /**
     * @description Wrapper class for returning activity data to LWC
     */
    public class ActivityWrapper {
        @AuraEnabled public String recordId;
        @AuraEnabled public String objectApiName;
        @AuraEnabled public String activityType;    // 'task', 'event', 'email'
        @AuraEnabled public String subject;
        @AuraEnabled public String subtitle;
        @AuraEnabled public String iconName;        // 'task', 'event', 'email'
        @AuraEnabled public Date activityDate;
        // US-36: Related record fields
        @AuraEnabled public String whoId;
        @AuraEnabled public String whoName;
        @AuraEnabled public String whoObjectType;   // 'Contact' or 'Lead'
        @AuraEnabled public String whatId;
        @AuraEnabled public String whatName;
        @AuraEnabled public String whatObjectType;  // 'Account', 'Opportunity', 'Case', etc.

        public ActivityWrapper(String recordId, String objectApiName, String activityType,
                               String subject, String subtitle, String iconName, Date activityDate) {
            this.recordId = recordId;
            this.objectApiName = objectApiName;
            this.activityType = activityType;
            this.subject = subject;
            this.subtitle = subtitle;
            this.iconName = iconName;
            this.activityDate = activityDate;
        }

        // US-36: Set Who fields (filter out if matches context recordId)
        public void setWho(Id whoId, String whoName, String whoType, Id contextRecordId) {
            if (whoId != null && whoId != contextRecordId) {
                this.whoId = whoId;
                this.whoName = whoName;
                this.whoObjectType = whoType;
            }
        }

        // US-36: Set What fields (filter out if matches context recordId)
        public void setWhat(Id whatId, String whatName, String whatType, Id contextRecordId) {
            if (whatId != null && whatId != contextRecordId) {
                this.whatId = whatId;
                this.whatName = whatName;
                this.whatObjectType = whatType;
            }
        }
    }

    /**
     * @description Get open Tasks related to a record (excluding email tasks)
     * @param recordId The parent record ID (Account, Contact, Opportunity, etc.)
     * @param searchTerm Optional search term to filter by Subject
     * @return List of ActivityWrapper containing Task data
     */
    @AuraEnabled(cacheable=true)
    public static List<ActivityWrapper> getRelatedTasks(Id recordId, String searchTerm) {
        if (recordId == null) {
            throw new AuraHandledException('Record ID is required');
        }

        List<ActivityWrapper> results = new List<ActivityWrapper>();
        String searchPattern = String.isNotBlank(searchTerm) ? '%' + String.escapeSingleQuotes(searchTerm) + '%' : '%';

        List<Task> tasks = [
            SELECT Id, Subject, Status, Priority, ActivityDate, LastModifiedDate,
                   WhoId, Who.Name, Who.Type,
                   WhatId, What.Name, What.Type
            FROM Task
            WHERE (WhatId = :recordId OR WhoId = :recordId)
              AND IsClosed = false
              AND (TaskSubtype = null OR TaskSubtype != 'Email')
              AND Subject LIKE :searchPattern
            ORDER BY LastModifiedDate DESC
            LIMIT 100
        ];

        for (Task t : tasks) {
            String subtitle = '';
            if (t.ActivityDate != null) {
                subtitle = 'Due: ' + t.ActivityDate.format();
            }
            if (String.isNotBlank(t.Priority)) {
                subtitle += String.isNotBlank(subtitle) ? ' • ' + t.Priority : t.Priority;
            }
            ActivityWrapper wrapper = new ActivityWrapper(
                t.Id, 'Task', 'task',
                t.Subject, subtitle, 'task', t.ActivityDate
            );
            // US-36: Add Who/What (filter out context record)
            wrapper.setWho(t.WhoId, t.Who?.Name, t.Who?.Type, recordId);
            wrapper.setWhat(t.WhatId, t.What?.Name, t.What?.Type, recordId);
            results.add(wrapper);
        }

        return results;
    }

    /**
     * @description Get upcoming Events related to a record
     * @param recordId The parent record ID (Account, Contact, Opportunity, etc.)
     * @param searchTerm Optional search term to filter by Subject
     * @return List of ActivityWrapper containing Event data
     */
    @AuraEnabled(cacheable=true)
    public static List<ActivityWrapper> getRelatedEvents(Id recordId, String searchTerm) {
        if (recordId == null) {
            throw new AuraHandledException('Record ID is required');
        }

        List<ActivityWrapper> results = new List<ActivityWrapper>();
        String searchPattern = String.isNotBlank(searchTerm) ? '%' + String.escapeSingleQuotes(searchTerm) + '%' : '%';
        Datetime todayStart = Datetime.now();

        List<Event> events = [
            SELECT Id, Subject, StartDateTime, EndDateTime, LastModifiedDate,
                   WhoId, Who.Name, Who.Type,
                   WhatId, What.Name, What.Type
            FROM Event
            WHERE (WhatId = :recordId OR WhoId = :recordId)
              AND EndDateTime >= :todayStart
              AND Subject LIKE :searchPattern
            ORDER BY LastModifiedDate DESC
            LIMIT 100
        ];

        for (Event e : events) {
            String subtitle = '';
            if (e.StartDateTime != null) {
                // Format: "Dec 10, 2:00 PM"
                subtitle = e.StartDateTime.format('MMM d, h:mm a');
            }
            Date eventDate = e.StartDateTime != null ? e.StartDateTime.date() : null;
            ActivityWrapper wrapper = new ActivityWrapper(
                e.Id, 'Event', 'event',
                e.Subject, subtitle, 'event', eventDate
            );
            // US-36: Add Who/What (filter out context record)
            wrapper.setWho(e.WhoId, e.Who?.Name, e.Who?.Type, recordId);
            wrapper.setWhat(e.WhatId, e.What?.Name, e.What?.Type, recordId);
            results.add(wrapper);
        }

        return results;
    }

    /**
     * @description Get Email Tasks related to a record
     * @param recordId The parent record ID (Account, Contact, Opportunity, etc.)
     * @param searchTerm Optional search term to filter by Subject
     * @return List of ActivityWrapper containing Email data
     */
    @AuraEnabled(cacheable=true)
    public static List<ActivityWrapper> getRelatedEmails(Id recordId, String searchTerm) {
        if (recordId == null) {
            throw new AuraHandledException('Record ID is required');
        }

        List<ActivityWrapper> results = new List<ActivityWrapper>();
        String searchPattern = String.isNotBlank(searchTerm) ? '%' + String.escapeSingleQuotes(searchTerm) + '%' : '%';

        List<Task> emails = [
            SELECT Id, Subject, Status, ActivityDate, LastModifiedDate,
                   WhoId, Who.Name, Who.Type,
                   WhatId, What.Name, What.Type
            FROM Task
            WHERE (WhatId = :recordId OR WhoId = :recordId)
              AND TaskSubtype = 'Email'
              AND IsClosed = false
              AND Subject LIKE :searchPattern
            ORDER BY LastModifiedDate DESC
            LIMIT 100
        ];

        for (Task t : emails) {
            String subtitle = '';
            if (t.ActivityDate != null) {
                // Format: "Nov 28, 2025"
                subtitle = t.ActivityDate.format();
            }
            ActivityWrapper wrapper = new ActivityWrapper(
                t.Id, 'Task', 'email',
                t.Subject, subtitle, 'email', t.ActivityDate
            );
            // US-36: Add Who/What (filter out context record)
            wrapper.setWho(t.WhoId, t.Who?.Name, t.Who?.Type, recordId);
            wrapper.setWhat(t.WhatId, t.What?.Name, t.What?.Type, recordId);
            results.add(wrapper);
        }

        return results;
    }
}
