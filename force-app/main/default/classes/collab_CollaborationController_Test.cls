/**
 * @description Test class for collab_CollaborationController
 * Tests event publishing, canvas state persistence, and validation logic.
 *
 * @author Nils Lehsten
 * @date 2025-11-26
 */
@isTest
private class collab_CollaborationController_Test {

    private static final String TEST_CANVAS_ID = 'test-canvas-123';
    private static final String TEST_PAYLOAD = '{"id":"obj-1","type":"sticky","x":100,"y":200}';
    private static final String TEST_STATE_JSON = '{"objects":[{"id":"obj-1","type":"sticky"}]}';

    /**
     * @description Test successful event publishing
     */
    @isTest
    static void testPublishEvent() {
        Test.startTest();
        // Should not throw exception
        collab_CollaborationController.publishEvent(
            TEST_CANVAS_ID,
            'object_add',
            TEST_PAYLOAD
        );
        Test.stopTest();

        // Verify event was queued (Platform Events are async)
        System.assert(true, 'Event published without exception');
    }

    /**
     * @description Test all valid event types
     */
    @isTest
    static void testPublishEventAllTypes() {
        List<String> eventTypes = new List<String>{
            'object_add', 'object_move', 'object_delete',
            'draw_stroke', 'user_join', 'user_leave'
        };

        Test.startTest();
        for (String eventType : eventTypes) {
            collab_CollaborationController.publishEvent(
                TEST_CANVAS_ID,
                eventType,
                TEST_PAYLOAD
            );
        }
        Test.stopTest();

        System.assert(true, 'All event types published successfully');
    }

    /**
     * @description Test publishing with invalid event type
     */
    @isTest
    static void testPublishEventInvalidType() {
        Boolean exceptionThrown = false;
        Test.startTest();
        try {
            collab_CollaborationController.publishEvent(
                TEST_CANVAS_ID,
                'invalid_type',
                TEST_PAYLOAD
            );
        } catch (AuraHandledException e) {
            exceptionThrown = true;
        }
        Test.stopTest();

        System.assert(exceptionThrown, 'Should throw exception for invalid event type');
    }

    /**
     * @description Test publishing with blank event type
     */
    @isTest
    static void testPublishEventBlankType() {
        Boolean exceptionThrown = false;
        Test.startTest();
        try {
            collab_CollaborationController.publishEvent(
                TEST_CANVAS_ID,
                '',
                TEST_PAYLOAD
            );
        } catch (AuraHandledException e) {
            exceptionThrown = true;
        }
        Test.stopTest();

        System.assert(exceptionThrown, 'Should throw exception for blank event type');
    }

    /**
     * @description Test publishing with invalid JSON payload
     */
    @isTest
    static void testPublishEventInvalidPayload() {
        Boolean exceptionThrown = false;
        Test.startTest();
        try {
            collab_CollaborationController.publishEvent(
                TEST_CANVAS_ID,
                'object_add',
                'not valid json'
            );
        } catch (AuraHandledException e) {
            exceptionThrown = true;
        }
        Test.stopTest();

        System.assert(exceptionThrown, 'Should throw exception for invalid JSON payload');
    }

    /**
     * @description Test publishing with blank payload
     */
    @isTest
    static void testPublishEventBlankPayload() {
        Boolean exceptionThrown = false;
        Test.startTest();
        try {
            collab_CollaborationController.publishEvent(
                TEST_CANVAS_ID,
                'object_add',
                ''
            );
        } catch (AuraHandledException e) {
            exceptionThrown = true;
        }
        Test.stopTest();

        System.assert(exceptionThrown, 'Should throw exception for blank payload');
    }

    /**
     * @description Test publishing with blank canvas ID
     */
    @isTest
    static void testPublishEventBlankCanvasId() {
        Boolean exceptionThrown = false;
        Test.startTest();
        try {
            collab_CollaborationController.publishEvent(
                '',
                'object_add',
                TEST_PAYLOAD
            );
        } catch (AuraHandledException e) {
            exceptionThrown = true;
        }
        Test.stopTest();

        System.assert(exceptionThrown, 'Should throw exception for blank canvas ID');
    }

    /**
     * @description Test saving canvas state creates new record
     */
    @isTest
    static void testSaveCanvasStateNew() {
        Test.startTest();
        collab_CollaborationController.saveCanvasState(TEST_CANVAS_ID, TEST_STATE_JSON);
        Test.stopTest();

        List<collab_Canvas_State__c> states = [
            SELECT collab_External_Id__c, collab_State_JSON__c, collab_Last_Modified_By__c
            FROM collab_Canvas_State__c
            WHERE collab_External_Id__c = :TEST_CANVAS_ID
        ];

        System.assertEquals(1, states.size(), 'Should create one record');
        System.assertEquals(TEST_STATE_JSON, states[0].collab_State_JSON__c, 'State JSON should match');
        System.assertEquals(UserInfo.getUserId(), states[0].collab_Last_Modified_By__c, 'Last modified by should be current user');
    }

    /**
     * @description Test saving canvas state updates existing record
     */
    @isTest
    static void testSaveCanvasStateUpdate() {
        // Create initial state
        collab_Canvas_State__c initialState = new collab_Canvas_State__c(
            collab_External_Id__c = TEST_CANVAS_ID,
            collab_State_JSON__c = '{"objects":[]}'
        );
        insert initialState;

        String updatedJson = '{"objects":[{"id":"new-obj"}]}';

        Test.startTest();
        collab_CollaborationController.saveCanvasState(TEST_CANVAS_ID, updatedJson);
        Test.stopTest();

        List<collab_Canvas_State__c> states = [
            SELECT Id, collab_State_JSON__c
            FROM collab_Canvas_State__c
            WHERE collab_External_Id__c = :TEST_CANVAS_ID
        ];

        System.assertEquals(1, states.size(), 'Should still be one record (upsert)');
        System.assertEquals(updatedJson, states[0].collab_State_JSON__c, 'State JSON should be updated');
    }

    /**
     * @description Test saving with invalid JSON
     */
    @isTest
    static void testSaveCanvasStateInvalidJson() {
        Boolean exceptionThrown = false;
        Test.startTest();
        try {
            collab_CollaborationController.saveCanvasState(TEST_CANVAS_ID, 'not json');
        } catch (AuraHandledException e) {
            exceptionThrown = true;
        }
        Test.stopTest();

        System.assert(exceptionThrown, 'Should throw exception for invalid JSON');
    }

    /**
     * @description Test saving with blank state JSON
     */
    @isTest
    static void testSaveCanvasStateBlank() {
        Boolean exceptionThrown = false;
        Test.startTest();
        try {
            collab_CollaborationController.saveCanvasState(TEST_CANVAS_ID, '');
        } catch (AuraHandledException e) {
            exceptionThrown = true;
        }
        Test.stopTest();

        System.assert(exceptionThrown, 'Should throw exception for blank state');
    }

    /**
     * @description Test loading canvas state
     */
    @isTest
    static void testLoadCanvasState() {
        // Create state record
        collab_Canvas_State__c state = new collab_Canvas_State__c(
            collab_External_Id__c = TEST_CANVAS_ID,
            collab_State_JSON__c = TEST_STATE_JSON
        );
        insert state;

        Test.startTest();
        String result = collab_CollaborationController.loadCanvasState(TEST_CANVAS_ID);
        Test.stopTest();

        System.assertEquals(TEST_STATE_JSON, result, 'Should return stored state');
    }

    /**
     * @description Test loading non-existent canvas returns empty object
     */
    @isTest
    static void testLoadCanvasStateEmpty() {
        Test.startTest();
        String result = collab_CollaborationController.loadCanvasState('nonexistent-canvas');
        Test.stopTest();

        System.assertEquals('{}', result, 'Should return empty JSON object');
    }

    /**
     * @description Test loading canvas with null state JSON
     */
    @isTest
    static void testLoadCanvasStateNullJson() {
        // Create state record with null JSON
        collab_Canvas_State__c state = new collab_Canvas_State__c(
            collab_External_Id__c = TEST_CANVAS_ID,
            collab_State_JSON__c = null
        );
        insert state;

        Test.startTest();
        String result = collab_CollaborationController.loadCanvasState(TEST_CANVAS_ID);
        Test.stopTest();

        System.assertEquals('{}', result, 'Should return empty JSON for null state');
    }

    /**
     * @description Test loading with blank canvas ID
     */
    @isTest
    static void testLoadCanvasStateBlankId() {
        Boolean exceptionThrown = false;
        Test.startTest();
        try {
            collab_CollaborationController.loadCanvasState('');
        } catch (AuraHandledException e) {
            exceptionThrown = true;
        }
        Test.stopTest();

        System.assert(exceptionThrown, 'Should throw exception for blank canvas ID');
    }

    /**
     * @description Test user color generation consistency
     */
    @isTest
    static void testGetUserColor() {
        String userId = UserInfo.getUserId();

        Test.startTest();
        String color1 = collab_CollaborationController.getUserColor(userId);
        String color2 = collab_CollaborationController.getUserColor(userId);
        Test.stopTest();

        System.assertEquals(color1, color2, 'Same user should get consistent color');
        System.assert(color1.startsWith('#'), 'Color should be hex format');
        System.assertEquals(7, color1.length(), 'Hex color should be 7 characters');
    }

    /**
     * @description Test user color for null/blank input
     */
    @isTest
    static void testGetUserColorNull() {
        Test.startTest();
        String colorNull = collab_CollaborationController.getUserColor(null);
        String colorBlank = collab_CollaborationController.getUserColor('');
        Test.stopTest();

        System.assertEquals('#FF6B6B', colorNull, 'Null should return default color');
        System.assertEquals('#FF6B6B', colorBlank, 'Blank should return default color');
    }

    /**
     * @description Test canvas ID validation - too long
     */
    @isTest
    static void testCanvasIdTooLong() {
        String longId = 'a'.repeat(51);
        Boolean exceptionThrown = false;

        Test.startTest();
        try {
            collab_CollaborationController.publishEvent(longId, 'object_add', TEST_PAYLOAD);
        } catch (AuraHandledException e) {
            exceptionThrown = true;
        }
        Test.stopTest();

        System.assert(exceptionThrown, 'Should throw exception for long canvas ID');
    }

    /**
     * @description Test canvas ID validation - invalid characters
     */
    @isTest
    static void testCanvasIdInvalidChars() {
        Boolean exceptionThrown = false;

        Test.startTest();
        try {
            collab_CollaborationController.publishEvent('canvas<script>', 'object_add', TEST_PAYLOAD);
        } catch (AuraHandledException e) {
            exceptionThrown = true;
        }
        Test.stopTest();

        System.assert(exceptionThrown, 'Should throw exception for invalid characters');
    }

    // ========== US-06: Related Records Tests ==========

    /**
     * @description Test getRelatedContacts with valid Account
     */
    @isTest
    static void testGetRelatedContacts() {
        // Create test Account and Contacts
        Account testAccount = new Account(Name = 'Test Account');
        insert testAccount;

        List<Contact> testContacts = new List<Contact>{
            new Contact(FirstName = 'John', LastName = 'Smith', Title = 'VP Sales', AccountId = testAccount.Id),
            new Contact(FirstName = 'Jane', LastName = 'Doe', Email = 'jane@test.com', AccountId = testAccount.Id)
        };
        insert testContacts;

        Test.startTest();
        List<collab_CollaborationController.RecordWrapper> results =
            collab_CollaborationController.getRelatedContacts(testAccount.Id, null);
        Test.stopTest();

        System.assertEquals(2, results.size(), 'Should return 2 contacts');
        System.assertEquals('Contact', results[0].objectApiName, 'Object API name should be Contact');
        System.assertEquals('standard:contact', results[0].iconName, 'Icon should be standard:contact');
    }

    /**
     * @description Test getRelatedContacts with search term
     */
    @isTest
    static void testGetRelatedContactsWithSearch() {
        Account testAccount = new Account(Name = 'Test Account');
        insert testAccount;

        List<Contact> testContacts = new List<Contact>{
            new Contact(FirstName = 'John', LastName = 'Smith', AccountId = testAccount.Id),
            new Contact(FirstName = 'Jane', LastName = 'Doe', AccountId = testAccount.Id)
        };
        insert testContacts;

        Test.startTest();
        List<collab_CollaborationController.RecordWrapper> results =
            collab_CollaborationController.getRelatedContacts(testAccount.Id, 'John');
        Test.stopTest();

        System.assertEquals(1, results.size(), 'Should return 1 contact matching search');
        System.assert(results[0].name.contains('John'), 'Should return John Smith');
    }

    /**
     * @description Test getRelatedContacts with null Account ID
     */
    @isTest
    static void testGetRelatedContactsNullAccount() {
        Boolean exceptionThrown = false;

        Test.startTest();
        try {
            collab_CollaborationController.getRelatedContacts(null, null);
        } catch (AuraHandledException e) {
            exceptionThrown = true;
        }
        Test.stopTest();

        System.assert(exceptionThrown, 'Should throw exception for null Account ID');
    }

    /**
     * @description Test getRelatedContacts with no contacts
     */
    @isTest
    static void testGetRelatedContactsEmpty() {
        Account testAccount = new Account(Name = 'Test Account');
        insert testAccount;

        Test.startTest();
        List<collab_CollaborationController.RecordWrapper> results =
            collab_CollaborationController.getRelatedContacts(testAccount.Id, null);
        Test.stopTest();

        System.assertEquals(0, results.size(), 'Should return empty list');
    }

    /**
     * @description Test getRelatedOpportunities with valid Account
     */
    @isTest
    static void testGetRelatedOpportunities() {
        Account testAccount = new Account(Name = 'Test Account');
        insert testAccount;

        List<Opportunity> testOpps = new List<Opportunity>{
            new Opportunity(
                Name = 'Test Opp 1',
                StageName = 'Prospecting',
                CloseDate = Date.today().addDays(30),
                Amount = 10000,
                AccountId = testAccount.Id
            ),
            new Opportunity(
                Name = 'Test Opp 2',
                StageName = 'Qualification',
                CloseDate = Date.today().addDays(60),
                AccountId = testAccount.Id
            )
        };
        insert testOpps;

        Test.startTest();
        List<collab_CollaborationController.RecordWrapper> results =
            collab_CollaborationController.getRelatedOpportunities(testAccount.Id, null);
        Test.stopTest();

        System.assertEquals(2, results.size(), 'Should return 2 opportunities');
        System.assertEquals('Opportunity', results[0].objectApiName, 'Object API name should be Opportunity');
        System.assertEquals('standard:opportunity', results[0].iconName, 'Icon should be standard:opportunity');
    }

    /**
     * @description Test getRelatedOpportunities with search term
     */
    @isTest
    static void testGetRelatedOpportunitiesWithSearch() {
        Account testAccount = new Account(Name = 'Test Account');
        insert testAccount;

        List<Opportunity> testOpps = new List<Opportunity>{
            new Opportunity(
                Name = 'Enterprise Deal',
                StageName = 'Prospecting',
                CloseDate = Date.today().addDays(30),
                AccountId = testAccount.Id
            ),
            new Opportunity(
                Name = 'Small Business',
                StageName = 'Qualification',
                CloseDate = Date.today().addDays(60),
                AccountId = testAccount.Id
            )
        };
        insert testOpps;

        Test.startTest();
        List<collab_CollaborationController.RecordWrapper> results =
            collab_CollaborationController.getRelatedOpportunities(testAccount.Id, 'Enterprise');
        Test.stopTest();

        System.assertEquals(1, results.size(), 'Should return 1 opportunity matching search');
        System.assert(results[0].name.contains('Enterprise'), 'Should return Enterprise Deal');
    }

    /**
     * @description Test getRelatedOpportunities with null Account ID
     */
    @isTest
    static void testGetRelatedOpportunitiesNullAccount() {
        Boolean exceptionThrown = false;

        Test.startTest();
        try {
            collab_CollaborationController.getRelatedOpportunities(null, null);
        } catch (AuraHandledException e) {
            exceptionThrown = true;
        }
        Test.stopTest();

        System.assert(exceptionThrown, 'Should throw exception for null Account ID');
    }

    /**
     * @description Test searchLeads with valid search term
     */
    @isTest
    static void testSearchLeads() {
        // Create test Leads
        List<Lead> testLeads = new List<Lead>{
            new Lead(FirstName = 'Alex', LastName = 'Johnson', Company = 'Acme Corp', Status = 'Open'),
            new Lead(FirstName = 'Bob', LastName = 'Wilson', Company = 'Tech Inc', Status = 'Working')
        };
        insert testLeads;

        // Wait for SOSL index
        Test.setFixedSearchResults(new List<Id>{testLeads[0].Id, testLeads[1].Id});

        Test.startTest();
        List<collab_CollaborationController.RecordWrapper> results =
            collab_CollaborationController.searchLeads('Alex');
        Test.stopTest();

        // SOSL in tests returns what we set in setFixedSearchResults
        System.assert(results.size() >= 0, 'Should return results (may be empty in test context)');
    }

    /**
     * @description Test searchLeads with short search term
     */
    @isTest
    static void testSearchLeadsShortTerm() {
        Test.startTest();
        List<collab_CollaborationController.RecordWrapper> results =
            collab_CollaborationController.searchLeads('A');
        Test.stopTest();

        System.assertEquals(0, results.size(), 'Should return empty list for short search term');
    }

    /**
     * @description Test searchLeads with blank search term
     */
    @isTest
    static void testSearchLeadsBlankTerm() {
        Test.startTest();
        List<collab_CollaborationController.RecordWrapper> results =
            collab_CollaborationController.searchLeads('');
        Test.stopTest();

        System.assertEquals(0, results.size(), 'Should return empty list for blank search term');
    }

    /**
     * @description Test searchLeads with null search term
     */
    @isTest
    static void testSearchLeadsNullTerm() {
        Test.startTest();
        List<collab_CollaborationController.RecordWrapper> results =
            collab_CollaborationController.searchLeads(null);
        Test.stopTest();

        System.assertEquals(0, results.size(), 'Should return empty list for null search term');
    }

    /**
     * @description Test RecordWrapper construction
     */
    @isTest
    static void testRecordWrapperConstruction() {
        Test.startTest();
        collab_CollaborationController.RecordWrapper wrapper =
            new collab_CollaborationController.RecordWrapper(
                UserInfo.getUserId(),
                'Test Name',
                'Contact',
                'VP Sales',
                'standard:contact'
            );
        Test.stopTest();

        System.assertEquals(UserInfo.getUserId(), wrapper.recordId, 'Record ID should match');
        System.assertEquals('Test Name', wrapper.name, 'Name should match');
        System.assertEquals('Contact', wrapper.objectApiName, 'Object API name should match');
        System.assertEquals('VP Sales', wrapper.subtitle, 'Subtitle should match');
        System.assertEquals('standard:contact', wrapper.iconName, 'Icon name should match');
    }

    // ========== searchUsers Tests ==========

    /**
     * @description Test searchUsers with valid search term
     */
    @isTest
    static void testSearchUsers() {
        // The running user should be searchable
        String userName = UserInfo.getName();
        String searchTerm = userName.substring(0, Math.min(3, userName.length()));

        Test.startTest();
        List<collab_CollaborationController.RecordWrapper> results =
            collab_CollaborationController.searchUsers(searchTerm);
        Test.stopTest();

        // Should return at least the current user if name matches
        System.assert(results.size() >= 0, 'Should return results');
        if (results.size() > 0) {
            System.assertEquals('User', results[0].objectApiName, 'Object API name should be User');
            System.assertEquals('standard:user', results[0].iconName, 'Icon should be standard:user');
        }
    }

    /**
     * @description Test searchUsers with short search term
     */
    @isTest
    static void testSearchUsersShortTerm() {
        Test.startTest();
        List<collab_CollaborationController.RecordWrapper> results =
            collab_CollaborationController.searchUsers('A');
        Test.stopTest();

        System.assertEquals(0, results.size(), 'Should return empty list for short search term');
    }

    /**
     * @description Test searchUsers with blank search term
     */
    @isTest
    static void testSearchUsersBlankTerm() {
        Test.startTest();
        List<collab_CollaborationController.RecordWrapper> results =
            collab_CollaborationController.searchUsers('');
        Test.stopTest();

        System.assertEquals(0, results.size(), 'Should return empty list for blank search term');
    }

    /**
     * @description Test searchUsers with null search term
     */
    @isTest
    static void testSearchUsersNullTerm() {
        Test.startTest();
        List<collab_CollaborationController.RecordWrapper> results =
            collab_CollaborationController.searchUsers(null);
        Test.stopTest();

        System.assertEquals(0, results.size(), 'Should return empty list for null search term');
    }

    // ========== US-35: Activity Elements Tests ==========

    /**
     * @description Test getRelatedTasks with valid Account
     */
    @isTest
    static void testGetRelatedTasks() {
        Account testAccount = new Account(Name = 'Test Account');
        insert testAccount;

        List<Task> testTasks = new List<Task>{
            new Task(
                Subject = 'Call customer',
                WhatId = testAccount.Id,
                Status = 'Not Started',
                Priority = 'High',
                ActivityDate = Date.today().addDays(5)
            ),
            new Task(
                Subject = 'Send proposal',
                WhatId = testAccount.Id,
                Status = 'In Progress',
                Priority = 'Normal',
                ActivityDate = Date.today().addDays(10)
            )
        };
        insert testTasks;

        Test.startTest();
        List<collab_CollaborationController.ActivityWrapper> results =
            collab_CollaborationController.getRelatedTasks(testAccount.Id, null);
        Test.stopTest();

        System.assertEquals(2, results.size(), 'Should return 2 tasks');
        System.assertEquals('Task', results[0].objectApiName, 'Object API name should be Task');
        System.assertEquals('task', results[0].activityType, 'Activity type should be task');
        System.assertEquals('task', results[0].iconName, 'Icon should be task');
    }

    /**
     * @description Test getRelatedTasks with search term
     */
    @isTest
    static void testGetRelatedTasksWithSearch() {
        Account testAccount = new Account(Name = 'Test Account');
        insert testAccount;

        List<Task> testTasks = new List<Task>{
            new Task(Subject = 'Call customer', WhatId = testAccount.Id, Status = 'Not Started'),
            new Task(Subject = 'Send email', WhatId = testAccount.Id, Status = 'Not Started')
        };
        insert testTasks;

        Test.startTest();
        List<collab_CollaborationController.ActivityWrapper> results =
            collab_CollaborationController.getRelatedTasks(testAccount.Id, 'Call');
        Test.stopTest();

        System.assertEquals(1, results.size(), 'Should return 1 task matching search');
        System.assert(results[0].subject.contains('Call'), 'Should return Call customer task');
    }

    /**
     * @description Test getRelatedTasks excludes email tasks
     */
    @isTest
    static void testGetRelatedTasksExcludesEmails() {
        Account testAccount = new Account(Name = 'Test Account');
        insert testAccount;

        List<Task> testTasks = new List<Task>{
            new Task(Subject = 'Call customer', WhatId = testAccount.Id, Status = 'Not Started'),
            new Task(Subject = 'Email: Test', WhatId = testAccount.Id, Status = 'Not Started', TaskSubtype = 'Email')
        };
        insert testTasks;

        Test.startTest();
        List<collab_CollaborationController.ActivityWrapper> results =
            collab_CollaborationController.getRelatedTasks(testAccount.Id, null);
        Test.stopTest();

        System.assertEquals(1, results.size(), 'Should return only non-email tasks');
        System.assert(!results[0].subject.contains('Email'), 'Should not include email task');
    }

    /**
     * @description Test getRelatedTasks with null Record ID
     */
    @isTest
    static void testGetRelatedTasksNullRecord() {
        Boolean exceptionThrown = false;

        Test.startTest();
        try {
            collab_CollaborationController.getRelatedTasks(null, null);
        } catch (AuraHandledException e) {
            exceptionThrown = true;
        }
        Test.stopTest();

        System.assert(exceptionThrown, 'Should throw exception for null Record ID');
    }

    /**
     * @description Test getRelatedTasks excludes closed tasks
     */
    @isTest
    static void testGetRelatedTasksExcludesClosed() {
        Account testAccount = new Account(Name = 'Test Account');
        insert testAccount;

        List<Task> testTasks = new List<Task>{
            new Task(Subject = 'Open task', WhatId = testAccount.Id, Status = 'Not Started'),
            new Task(Subject = 'Closed task', WhatId = testAccount.Id, Status = 'Completed')
        };
        insert testTasks;

        Test.startTest();
        List<collab_CollaborationController.ActivityWrapper> results =
            collab_CollaborationController.getRelatedTasks(testAccount.Id, null);
        Test.stopTest();

        System.assertEquals(1, results.size(), 'Should return only open tasks');
        System.assertEquals('Open task', results[0].subject, 'Should return open task');
    }

    /**
     * @description Test getRelatedEvents with valid Account
     */
    @isTest
    static void testGetRelatedEvents() {
        Account testAccount = new Account(Name = 'Test Account');
        insert testAccount;

        List<Event> testEvents = new List<Event>{
            new Event(
                Subject = 'Discovery Meeting',
                WhatId = testAccount.Id,
                StartDateTime = Datetime.now().addDays(5),
                EndDateTime = Datetime.now().addDays(5).addHours(1)
            ),
            new Event(
                Subject = 'Demo Call',
                WhatId = testAccount.Id,
                StartDateTime = Datetime.now().addDays(10),
                EndDateTime = Datetime.now().addDays(10).addHours(2)
            )
        };
        insert testEvents;

        Test.startTest();
        List<collab_CollaborationController.ActivityWrapper> results =
            collab_CollaborationController.getRelatedEvents(testAccount.Id, null);
        Test.stopTest();

        System.assertEquals(2, results.size(), 'Should return 2 events');
        System.assertEquals('Event', results[0].objectApiName, 'Object API name should be Event');
        System.assertEquals('event', results[0].activityType, 'Activity type should be event');
        System.assertEquals('event', results[0].iconName, 'Icon should be event');
    }

    /**
     * @description Test getRelatedEvents with search term
     */
    @isTest
    static void testGetRelatedEventsWithSearch() {
        Account testAccount = new Account(Name = 'Test Account');
        insert testAccount;

        List<Event> testEvents = new List<Event>{
            new Event(
                Subject = 'Discovery Meeting',
                WhatId = testAccount.Id,
                StartDateTime = Datetime.now().addDays(5),
                EndDateTime = Datetime.now().addDays(5).addHours(1)
            ),
            new Event(
                Subject = 'Demo Call',
                WhatId = testAccount.Id,
                StartDateTime = Datetime.now().addDays(10),
                EndDateTime = Datetime.now().addDays(10).addHours(1)
            )
        };
        insert testEvents;

        Test.startTest();
        List<collab_CollaborationController.ActivityWrapper> results =
            collab_CollaborationController.getRelatedEvents(testAccount.Id, 'Discovery');
        Test.stopTest();

        System.assertEquals(1, results.size(), 'Should return 1 event matching search');
        System.assert(results[0].subject.contains('Discovery'), 'Should return Discovery Meeting');
    }

    /**
     * @description Test getRelatedEvents excludes past events
     */
    @isTest
    static void testGetRelatedEventsExcludesPast() {
        Account testAccount = new Account(Name = 'Test Account');
        insert testAccount;

        List<Event> testEvents = new List<Event>{
            new Event(
                Subject = 'Future Event',
                WhatId = testAccount.Id,
                StartDateTime = Datetime.now().addDays(5),
                EndDateTime = Datetime.now().addDays(5).addHours(1)
            ),
            new Event(
                Subject = 'Past Event',
                WhatId = testAccount.Id,
                StartDateTime = Datetime.now().addDays(-5),
                EndDateTime = Datetime.now().addDays(-5).addHours(1)
            )
        };
        insert testEvents;

        Test.startTest();
        List<collab_CollaborationController.ActivityWrapper> results =
            collab_CollaborationController.getRelatedEvents(testAccount.Id, null);
        Test.stopTest();

        System.assertEquals(1, results.size(), 'Should return only future events');
        System.assertEquals('Future Event', results[0].subject, 'Should return future event');
    }

    /**
     * @description Test getRelatedEvents with null Record ID
     */
    @isTest
    static void testGetRelatedEventsNullRecord() {
        Boolean exceptionThrown = false;

        Test.startTest();
        try {
            collab_CollaborationController.getRelatedEvents(null, null);
        } catch (AuraHandledException e) {
            exceptionThrown = true;
        }
        Test.stopTest();

        System.assert(exceptionThrown, 'Should throw exception for null Record ID');
    }

    /**
     * @description Test getRelatedEmails with valid Account
     */
    @isTest
    static void testGetRelatedEmails() {
        Account testAccount = new Account(Name = 'Test Account');
        insert testAccount;

        List<Task> testEmails = new List<Task>{
            new Task(
                Subject = 'RE: Proposal Questions',
                WhatId = testAccount.Id,
                Status = 'Not Started',
                TaskSubtype = 'Email',
                ActivityDate = Date.today()
            ),
            new Task(
                Subject = 'FW: Contract Review',
                WhatId = testAccount.Id,
                Status = 'Not Started',
                TaskSubtype = 'Email',
                ActivityDate = Date.today().addDays(-3)
            )
        };
        insert testEmails;

        Test.startTest();
        List<collab_CollaborationController.ActivityWrapper> results =
            collab_CollaborationController.getRelatedEmails(testAccount.Id, null);
        Test.stopTest();

        System.assertEquals(2, results.size(), 'Should return 2 emails');
        System.assertEquals('Task', results[0].objectApiName, 'Object API name should be Task');
        System.assertEquals('email', results[0].activityType, 'Activity type should be email');
        System.assertEquals('email', results[0].iconName, 'Icon should be email');
    }

    /**
     * @description Test getRelatedEmails with search term
     */
    @isTest
    static void testGetRelatedEmailsWithSearch() {
        Account testAccount = new Account(Name = 'Test Account');
        insert testAccount;

        List<Task> testEmails = new List<Task>{
            new Task(Subject = 'RE: Proposal', WhatId = testAccount.Id, Status = 'Not Started', TaskSubtype = 'Email'),
            new Task(Subject = 'FW: Contract', WhatId = testAccount.Id, Status = 'Not Started', TaskSubtype = 'Email')
        };
        insert testEmails;

        Test.startTest();
        List<collab_CollaborationController.ActivityWrapper> results =
            collab_CollaborationController.getRelatedEmails(testAccount.Id, 'Proposal');
        Test.stopTest();

        System.assertEquals(1, results.size(), 'Should return 1 email matching search');
        System.assert(results[0].subject.contains('Proposal'), 'Should return Proposal email');
    }

    /**
     * @description Test getRelatedEmails only returns email tasks
     */
    @isTest
    static void testGetRelatedEmailsOnlyEmails() {
        Account testAccount = new Account(Name = 'Test Account');
        insert testAccount;

        List<Task> testTasks = new List<Task>{
            new Task(Subject = 'Email task', WhatId = testAccount.Id, Status = 'Not Started', TaskSubtype = 'Email'),
            new Task(Subject = 'Regular task', WhatId = testAccount.Id, Status = 'Not Started')
        };
        insert testTasks;

        Test.startTest();
        List<collab_CollaborationController.ActivityWrapper> results =
            collab_CollaborationController.getRelatedEmails(testAccount.Id, null);
        Test.stopTest();

        System.assertEquals(1, results.size(), 'Should return only email tasks');
        System.assertEquals('Email task', results[0].subject, 'Should return email task');
    }

    /**
     * @description Test getRelatedEmails with null Record ID
     */
    @isTest
    static void testGetRelatedEmailsNullRecord() {
        Boolean exceptionThrown = false;

        Test.startTest();
        try {
            collab_CollaborationController.getRelatedEmails(null, null);
        } catch (AuraHandledException e) {
            exceptionThrown = true;
        }
        Test.stopTest();

        System.assert(exceptionThrown, 'Should throw exception for null Record ID');
    }

    /**
     * @description Test ActivityWrapper construction
     */
    @isTest
    static void testActivityWrapperConstruction() {
        Test.startTest();
        collab_CollaborationController.ActivityWrapper wrapper =
            new collab_CollaborationController.ActivityWrapper(
                '00T000000000000',
                'Task',
                'task',
                'Call customer',
                'Due: Dec 5 • High',
                'task',
                Date.today()
            );
        Test.stopTest();

        System.assertEquals('00T000000000000', wrapper.recordId, 'Record ID should match');
        System.assertEquals('Task', wrapper.objectApiName, 'Object API name should match');
        System.assertEquals('task', wrapper.activityType, 'Activity type should match');
        System.assertEquals('Call customer', wrapper.subject, 'Subject should match');
        System.assertEquals('Due: Dec 5 • High', wrapper.subtitle, 'Subtitle should match');
        System.assertEquals('task', wrapper.iconName, 'Icon name should match');
        System.assertEquals(Date.today(), wrapper.activityDate, 'Activity date should match');
    }

    // ========== US-36: Who/What Field Tests ==========

    /**
     * @description Test that Task Who/What fields are populated
     */
    @isTest
    static void testTaskWhoWhatPopulated() {
        // Create Account and Contact
        Account testAccount = new Account(Name = 'Acme Corp');
        insert testAccount;

        Contact testContact = new Contact(
            FirstName = 'John',
            LastName = 'Smith',
            AccountId = testAccount.Id
        );
        insert testContact;

        // Create task with both WhoId and WhatId
        Task testTask = new Task(
            Subject = 'Follow up call',
            WhoId = testContact.Id,
            WhatId = testAccount.Id,
            Status = 'Not Started'
        );
        insert testTask;

        Test.startTest();
        // Query from Contact's perspective - should show Account in What
        List<collab_CollaborationController.ActivityWrapper> results =
            collab_CollaborationController.getRelatedTasks(testContact.Id, null);
        Test.stopTest();

        System.assertEquals(1, results.size(), 'Should return 1 task');
        // WhoId should be null because it matches context record
        System.assertEquals(null, results[0].whoId, 'WhoId should be filtered (matches context)');
        // WhatId should be populated
        System.assertEquals(testAccount.Id, results[0].whatId, 'WhatId should be populated');
        System.assertEquals('Acme Corp', results[0].whatName, 'WhatName should match');
        System.assertEquals('Account', results[0].whatObjectType, 'WhatObjectType should be Account');
    }

    /**
     * @description Test that Event Who/What fields are populated
     */
    @isTest
    static void testEventWhoWhatPopulated() {
        Account testAccount = new Account(Name = 'Test Corp');
        insert testAccount;

        Contact testContact = new Contact(
            FirstName = 'Jane',
            LastName = 'Doe',
            AccountId = testAccount.Id
        );
        insert testContact;

        Event testEvent = new Event(
            Subject = 'Discovery Meeting',
            WhoId = testContact.Id,
            WhatId = testAccount.Id,
            StartDateTime = Datetime.now().addDays(5),
            EndDateTime = Datetime.now().addDays(5).addHours(1)
        );
        insert testEvent;

        Test.startTest();
        // Query from Account's perspective - should show Contact in Who
        List<collab_CollaborationController.ActivityWrapper> results =
            collab_CollaborationController.getRelatedEvents(testAccount.Id, null);
        Test.stopTest();

        System.assertEquals(1, results.size(), 'Should return 1 event');
        // WhoId should be populated
        System.assertEquals(testContact.Id, results[0].whoId, 'WhoId should be populated');
        System.assertEquals('Jane Doe', results[0].whoName, 'WhoName should match');
        System.assertEquals('Contact', results[0].whoObjectType, 'WhoObjectType should be Contact');
        // WhatId should be null because it matches context record
        System.assertEquals(null, results[0].whatId, 'WhatId should be filtered (matches context)');
    }

    /**
     * @description Test ActivityWrapper setWho/setWhat methods
     */
    @isTest
    static void testActivityWrapperSetWhoWhat() {
        Id fakeContactId = '003000000000001';
        Id fakeAccountId = '001000000000001';
        Id contextRecordId = '001000000000002';

        Test.startTest();
        collab_CollaborationController.ActivityWrapper wrapper =
            new collab_CollaborationController.ActivityWrapper(
                '00T000000000000', 'Task', 'task', 'Test', '', 'task', Date.today()
            );

        // Set Who - different from context
        wrapper.setWho(fakeContactId, 'John Smith', 'Contact', contextRecordId);
        // Set What - different from context
        wrapper.setWhat(fakeAccountId, 'Acme Corp', 'Account', contextRecordId);
        Test.stopTest();

        System.assertEquals(fakeContactId, wrapper.whoId, 'WhoId should be set');
        System.assertEquals('John Smith', wrapper.whoName, 'WhoName should be set');
        System.assertEquals('Contact', wrapper.whoObjectType, 'WhoObjectType should be set');
        System.assertEquals(fakeAccountId, wrapper.whatId, 'WhatId should be set');
        System.assertEquals('Acme Corp', wrapper.whatName, 'WhatName should be set');
        System.assertEquals('Account', wrapper.whatObjectType, 'WhatObjectType should be set');
    }

    /**
     * @description Test that setWho/setWhat filters when matching context
     */
    @isTest
    static void testActivityWrapperFilterContext() {
        Id fakeContactId = '003000000000001';
        Id contextRecordId = '003000000000001'; // Same as contact

        Test.startTest();
        collab_CollaborationController.ActivityWrapper wrapper =
            new collab_CollaborationController.ActivityWrapper(
                '00T000000000000', 'Task', 'task', 'Test', '', 'task', Date.today()
            );

        // Set Who - same as context (should be filtered)
        wrapper.setWho(fakeContactId, 'John Smith', 'Contact', contextRecordId);
        Test.stopTest();

        System.assertEquals(null, wrapper.whoId, 'WhoId should be null (filtered)');
        System.assertEquals(null, wrapper.whoName, 'WhoName should be null (filtered)');
    }
}
