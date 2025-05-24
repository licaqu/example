// Require necessary modules
const low = require('lowdb');
const FileSync = require('lowdb/adapters/FileSync');
// keytar is used in main.js. Renderer only passes the reference.
const { randomUUID } = require('crypto'); // For unique tab IDs
const { Terminal } = require('@xterm/xterm');
const { FitAddon } = require('@xterm/addon-fit');
// axios is used in main.js for actual API call

// --- Database Setup ---
const adapter = new FileSync('db.json');
const db = low(adapter);
db.defaults({ sessions: [], groups: [] }).write();

// --- DOM Elements ---
const modal = document.getElementById('sessionFormModal');
const addNewSessionBtn = document.getElementById('addNewSessionBtn');
const closeModalBtn = document.getElementById('closeModalBtn');
const saveSessionBtn = document.getElementById('saveSessionBtn');
const cancelModalBtn = document.getElementById('cancelModalBtn');
const sessionListElement = document.getElementById('sessionList');
const searchSessionsInput = document.getElementById('searchSessions');
const groupFilterSelect = document.getElementById('groupFilter');

// Tab UI Elements
const tabBar = document.getElementById('tab-bar');
const addTabBtn = document.getElementById('add-tab-btn');
const mainContentArea = document.getElementById('main-content-area');

// Status Bar Elements
const connectionStatusEl = document.getElementById('status-connection');
const sessionNameStatusEl = document.getElementById('status-session-name');
const latencyStatusEl = document.getElementById('status-latency');

// AI Settings UI Elements
const setApiKeyBtn = document.getElementById('setApiKeyBtn');
const apiKeyForm = document.getElementById('apiKeyForm');
const apiKeyInput = document.getElementById('apiKeyInput');
const saveApiKeyBtn = document.getElementById('saveApiKeyBtn');
const clearApiKeyBtn = document.getElementById('clearApiKeyBtn');
const apiKeyStatus = document.getElementById('apiKeyStatus');

// Task Templates UI Elements
const taskTemplateSelect = document.getElementById('taskTemplateSelect');
const taskPlaceholdersForm = document.getElementById('taskPlaceholdersForm');
const executeTaskBtn = document.getElementById('executeTaskBtn');
const taskCommandsPreview = document.getElementById('taskCommandsPreview');
const deleteSelectedSessionsBtn = document.getElementById('deleteSelectedSessionsBtn'); // Added


// Form fields
const sessionIdInput = document.getElementById('sessionId');
const formTitle = document.getElementById('formTitle');
const sessionNameInput = document.getElementById('sessionName');
const hostnameInput = document.getElementById('hostname');
const portInput = document.getElementById('port');
const usernameInput = document.getElementById('username');
const authTypeSelect = document.getElementById('authType');
const passwordInput = document.getElementById('password');
const privateKeyPathInput = document.getElementById('privateKeyPath');
const sessionGroupInput = document.getElementById('sessionGroup');
const passwordAuthFields = document.getElementById('passwordAuthFields');
const keyAuthFields = document.getElementById('keyAuthFields');

const APP_NAME = 'AI-SSH-Client';

// --- Global State for Filtering and Tabs ---
let currentSearchTerm = '';
let currentGroupFilter = '';

let activeTabId = null;
let terminals = {}; 
// Structure for terminals[tabId]:
// { 
//   term, fitAddon, containerDiv, tabElement, name, isConnected, sessionId, connectionStateMessage,
//   nlInputArea, nlInput, nlSendBtn, nlExecuteBtn, aiSuggestionsDiv, lastAiSuggestedCommand,
//   context: { os: null, pwd: null },
//   availableTaskTemplates: [], 
//   selectedTaskTemplate: null,
//   currentDiagnosis: '' // Store current diagnosis text for streaming
// }


// --- Status Bar Update Function ---
function updateStatusBarForActiveTab() {
    if (activeTabId && terminals[activeTabId]) {
        const activeTabData = terminals[activeTabId];
        connectionStatusEl.textContent = activeTabData.connectionStateMessage || "Status: Disconnected";
        let sessionNameText = `Session: ${activeTabData.isConnected ? activeTabData.name : "N/A"}`;
        if (activeTabData.isConnected && activeTabData.context && activeTabData.context.os && !activeTabData.context.os.startsWith('unknown')) {
            sessionNameText += ` (OS: ${activeTabData.context.os})`;
        }
        sessionNameStatusEl.textContent = sessionNameText;
        latencyStatusEl.textContent = "Latency: N/A";
    } else {
        connectionStatusEl.textContent = "Status: Disconnected";
        sessionNameStatusEl.textContent = "Session: N/A";
        latencyStatusEl.textContent = "Latency: N/A";
    }
}

// --- Tab Management Functions ---
function createTab(sessionName = "New Tab", connectSessionDetails = null) {
    const tabId = `tab-${randomUUID()}`;

    const tabElement = document.createElement('div');
    tabElement.className = 'tab'; 
    tabElement.setAttribute('data-tab-id', tabId);
    const tabNameSpan = document.createElement('span');
    tabNameSpan.className = 'tab-name';
    tabNameSpan.textContent = sessionName;
    tabElement.appendChild(tabNameSpan);
    const closeBtn = document.createElement('button');
    closeBtn.className = 'tab-close-btn';
    closeBtn.innerHTML = '&times;';
    tabElement.appendChild(closeBtn);
    tabBar.insertBefore(tabElement, addTabBtn);

    const tabContentContainer = document.createElement('div');
    tabContentContainer.id = `tab-content-container-${tabId}`;
    tabContentContainer.className = 'terminal-instance-container';
    mainContentArea.appendChild(tabContentContainer);

    const terminalDiv = document.createElement('div');
    terminalDiv.id = `terminal-div-${tabId}`;
    tabContentContainer.appendChild(terminalDiv);

    const term = new Terminal({
        cursorBlink: true, fontFamily: 'monospace', fontSize: 14,
        theme: { background: '#1e1e1e', foreground: '#d4d4d4', cursor: '#d4d4d4', selectionBackground: '#555555', selectionForeground: '#ffffff' },
        convertEol: true
    });
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(terminalDiv);

    const nlInputArea = document.createElement('div');
    nlInputArea.className = 'nl-input-area';
    const nlInputContainer = document.createElement('div');
    nlInputContainer.className = 'nl-input-container';
    const nlInput = document.createElement('input');
    nlInput.type = 'text';
    nlInput.className = 'nl-input';
    nlInput.placeholder = "Enter natural language command (e.g., 'list files')";
    nlInputContainer.appendChild(nlInput);
    const nlSendBtn = document.createElement('button');
    nlSendBtn.className = 'nl-send-btn';
    nlSendBtn.textContent = 'Generate Command';
    nlInputContainer.appendChild(nlSendBtn);
    const nlExecuteBtn = document.createElement('button');
    nlExecuteBtn.className = 'nl-execute-btn';
    nlExecuteBtn.textContent = 'Execute';
    nlExecuteBtn.style.display = 'none';
    nlInputContainer.appendChild(nlExecuteBtn);
    nlInputArea.appendChild(nlInputContainer);
    const aiSuggestionsDiv = document.createElement('div');
    aiSuggestionsDiv.className = 'ai-suggestions';
    aiSuggestionsDiv.textContent = '';
    nlInputArea.appendChild(aiSuggestionsDiv);
    tabContentContainer.appendChild(nlInputArea);

    terminals[tabId] = { 
        term, fitAddon, containerDiv: tabContentContainer, 
        terminalElement: terminalDiv, 
        tabElement, name: sessionName, isConnected: false, 
        sessionId: connectSessionDetails ? connectSessionDetails.id : null,
        connectionStateMessage: "Status: Ready",
        nlInputArea, nlInput, nlSendBtn, nlExecuteBtn, aiSuggestionsDiv,
        lastAiSuggestedCommand: '',
        context: { os: null, pwd: null },
        availableTaskTemplates: [], 
        selectedTaskTemplate: null,
        currentDiagnosis: '' // Initialize for this tab
    };

    nlSendBtn.addEventListener('click', async () => {
        const query = nlInput.value.trim();
        if (!query) { aiSuggestionsDiv.textContent = 'Please enter a natural language query.'; return; }
        const apiKeyVal = await window.electronAPI.getApiKey();
        if (!apiKeyVal) {
            aiSuggestionsDiv.textContent = 'AI API Key is not set. Please set it in AI Settings.';
            terminals[tabId].term.writeln('\r\n\x1b[31mAI API Key is not set. Please set it in AI Settings.\x1b[0m');
            return;
        }
        aiSuggestionsDiv.textContent = 'Generating command...';
        nlExecuteBtn.style.display = 'none';
        terminals[tabId].lastAiSuggestedCommand = ''; 
        terminals[tabId].currentDiagnosis = ''; // Clear previous diagnosis
        window.electronAPI.generateShellCommand({ tabId, nlQuery: query, apiKey: apiKeyVal });
    });

    nlExecuteBtn.addEventListener('click', () => {
        const commandToExecute = terminals[tabId].lastAiSuggestedCommand;
        if (commandToExecute && terminals[tabId].isConnected) {
            // Instead of directly sending to terminal, use the new IPC for analysis
            window.electronAPI.executeAiCommand({ tabId, command: commandToExecute });
            
            // Clear suggestions and input, hide execute button
            // The AI suggestions area will be updated with diagnosis if an error occurs.
            // For now, clear it to indicate the command execution has started.
            aiSuggestionsDiv.textContent = 'Executing command...'; 
            nlExecuteBtn.style.display = 'none';
            nlInput.value = ''; 
        } else if (!terminals[tabId].isConnected) {
             terminals[tabId].term.writeln('\r\n\x1b[31mCannot execute command: Not connected to any SSH session.\x1b[0m');
             aiSuggestionsDiv.textContent = 'Not connected to any SSH session.';
        } else {
            aiSuggestionsDiv.textContent = 'No command to execute.';
        }
    });
    nlInput.addEventListener('keypress', (event) => { if (event.key === 'Enter') nlSendBtn.click(); });

    switchTab(tabId);

    term.onData(data => {
        if (window.electronAPI && window.electronAPI.sendTerminalData) {
            window.electronAPI.sendTerminalData({ tabId, data });
        }
    });
    term.onResize(({ cols, rows }) => {
        if (window.electronAPI && window.electronAPI.sendTerminalResize) {
            window.electronAPI.sendTerminalResize({ tabId, cols, rows });
        }
    });
    
    term.writeln(`Welcome to ${sessionName}!`);
    if (!connectSessionDetails) term.writeln('Select a session from the list to connect.');
    term.writeln('');

    if (connectSessionDetails) {
        term.writeln(`\r\nInitiating connection to ${connectSessionDetails.name}...`);
        terminals[tabId].connectionStateMessage = `Status: Connecting to ${connectSessionDetails.name}...`;
        terminals[tabId].name = connectSessionDetails.name;
        tabNameSpan.textContent = connectSessionDetails.name;
        updateStatusBarForActiveTab();
        window.electronAPI.connectSsh({ sessionDetails: connectSessionDetails, tabId });
    }
    
    return tabId;
}

async function loadTaskTemplatesForTab(tabId) {
    if (!tabId || !terminals[tabId] || !terminals[tabId].isConnected) {
        taskTemplateSelect.innerHTML = '<option value="">-- Select a Task --</option>';
        taskPlaceholdersForm.innerHTML = '';
        taskCommandsPreview.textContent = '';
        executeTaskBtn.style.display = 'none';
        if (terminals[tabId]) terminals[tabId].availableTaskTemplates = [];
        return;
    }

    try {
        const templates = await window.electronAPI.getTaskTemplates(tabId);
        terminals[tabId].availableTaskTemplates = templates;
        taskTemplateSelect.innerHTML = '<option value="">-- Select a Task --</option>'; 
        templates.forEach(template => {
            const option = document.createElement('option');
            option.value = template.id;
            option.textContent = template.name;
            taskTemplateSelect.appendChild(option);
        });
    } catch (error) {
        console.error('Error loading task templates:', error);
        taskTemplateSelect.innerHTML = '<option value="">Error loading tasks</option>';
    }
}


function switchTab(tabId) {
    if (!terminals[tabId] || tabId === activeTabId) return; 

    if (activeTabId && terminals[activeTabId]) {
        terminals[activeTabId].containerDiv.classList.remove('active');
        terminals[activeTabId].tabElement.classList.remove('active');
    }

    activeTabId = tabId;
    terminals[activeTabId].containerDiv.classList.add('active');
    terminals[activeTabId].tabElement.classList.add('active');
    terminals[activeTabId].term.focus();
    
    updateStatusBarForActiveTab();
    loadTaskTemplatesForTab(activeTabId); 

    setTimeout(() => {
        try {
            if (terminals[activeTabId] && terminals[activeTabId].fitAddon && terminals[activeTabId].terminalElement) {
                 terminals[activeTabId].fitAddon.fit();
            }
        } catch(e) { console.warn("Error fitting terminal on tab switch:", e.message); }
    }, 50);
}

function closeTab(tabIdToClose) {
    if (!terminals[tabIdToClose]) return;

    if (terminals[tabIdToClose].isConnected && window.electronAPI) {
        window.electronAPI.disconnectSsh(tabIdToClose);
    }

    terminals[tabIdToClose].term.dispose();
    terminals[tabIdToClose].containerDiv.remove();
    terminals[tabIdToClose].tabElement.remove();
    delete terminals[tabIdToClose];

    if (activeTabId === tabIdToClose) {
        activeTabId = null;
        const remainingTabIds = getOrderedTabIds(); 
        if (remainingTabIds.length > 0) {
            switchTab(remainingTabIds[0]);
        } else {
            mainContentArea.innerHTML = ''; 
            updateStatusBarForActiveTab();
            loadTaskTemplatesForTab(null); 
            console.log("All tabs closed.");
        }
    }
}

function getOrderedTabIds() {
    const tabElements = Array.from(tabBar.querySelectorAll('.tab')); 
    return tabElements.map(tabEl => tabEl.getAttribute('data-tab-id'));
}

function switchToNextTab() {
    const orderedTabs = getOrderedTabIds();
    if (orderedTabs.length < 2) return;
    const currentIndex = orderedTabs.indexOf(activeTabId);
    const nextIndex = (currentIndex === -1 ? 0 : currentIndex + 1) % orderedTabs.length;
    switchTab(orderedTabs[nextIndex]);
}

function switchToPreviousTab() {
    const orderedTabs = getOrderedTabIds();
    if (orderedTabs.length < 2) return;
    const currentIndex = orderedTabs.indexOf(activeTabId);
    const previousIndex = (currentIndex === -1 ? 0 : currentIndex - 1 + orderedTabs.length) % orderedTabs.length;
    switchTab(orderedTabs[previousIndex]);
}

// --- Modal Logic ---
function openModalForNew() { sessionIdInput.value = ''; formTitle.textContent = 'Add New Session'; clearFormFields(); authTypeSelect.value = 'password'; toggleAuthFields(); modal.style.display = 'block';}
function openModalForEdit(sessionId) { 
    const session = db.get('sessions').find({ id: sessionId }).value();
    if (!session) { console.error('Session not found for editing:', sessionId); return; }
    sessionIdInput.value = session.id; formTitle.textContent = 'Edit Session';
    sessionNameInput.value = session.name; hostnameInput.value = session.host; portInput.value = session.port; usernameInput.value = session.user;
    authTypeSelect.value = session.authType; privateKeyPathInput.value = session.privateKeyPath || ''; sessionGroupInput.value = session.group || '';
    passwordInput.value = ''; passwordInput.placeholder = session.authType === 'password' ? 'Enter new password to change' : '';
    toggleAuthFields(); modal.style.display = 'block';
}
function closeModal() { modal.style.display = 'none'; clearFormFields(); }
function clearFormFields() { 
    sessionNameInput.value = ''; hostnameInput.value = ''; portInput.value = '22'; usernameInput.value = '';
    passwordInput.value = ''; passwordInput.placeholder = ''; privateKeyPathInput.value = ''; sessionGroupInput.value = '';
    authTypeSelect.value = 'password'; toggleAuthFields();
}
function toggleAuthFields() { 
    passwordAuthFields.style.display = authTypeSelect.value === 'password' ? 'block' : 'none';
    keyAuthFields.style.display = authTypeSelect.value === 'key' ? 'block' : 'none';
}

// --- Save Session ---
saveSessionBtn.onclick = async () => { 
    const sessionName = sessionNameInput.value.trim(); const hostname = hostnameInput.value.trim(); const port = parseInt(portInput.value, 10);
    const username = usernameInput.value.trim(); const authType = authTypeSelect.value; const newPassword = passwordInput.value; 
    const privateKeyPath = privateKeyPathInput.value.trim(); const sessionGroup = sessionGroupInput.value.trim(); const existingSessionId = sessionIdInput.value;
    if (!sessionName || !hostname || !port || !username) { alert('Please fill in all required fields.'); return; }
    let sessionData = {
        name: sessionName, host: hostname, port: port, user: username, authType: authType,
        privateKeyPath: authType === 'key' ? privateKeyPath : null, group: sessionGroup || null,
    };
    try {
        if (existingSessionId) {
            const existingSession = db.get('sessions').find({ id: existingSessionId }).value();
            if (!existingSession) { alert('Error: Session to update not found.'); return; }
            sessionData.lastConnected = existingSession.lastConnected;
            if (authType === 'password' && !newPassword && existingSession.authType === 'password') {
                sessionData.keytarAccountRef = existingSession.keytarAccountRef;
            } else { sessionData.keytarAccountRef = existingSession.keytarAccountRef || null; }
            db.get('sessions').find({ id: existingSessionId }).assign(sessionData).write();
        } else {
            sessionData.id = `session-${randomUUID()}`; sessionData.keytarAccountRef = null; 
            db.get('sessions').push(sessionData).write();
        }
        if (sessionGroup && !db.get('groups').find({ name: sessionGroup }).value()) {
            db.get('groups').push({ id: `group-${randomUUID()}`, name: sessionGroup }).write();
        }
        closeModal(); loadAndDisplaySessions();
    } catch (error) { console.error('Error saving session data in renderer:', error); alert(`Failed to save session: ${error.message}.`); }
};

// --- Delete Session ---
async function deleteSession(sessionId, isBatchOperation = false) {
    if (!isBatchOperation) {
        const sessionNameToDelete = db.get('sessions').find({ id: sessionId }).value()?.name || sessionId;
        if (!confirm(`Are you sure you want to delete session: ${sessionNameToDelete}?`)) {
            return false; // User cancelled
        }
    }
    try {
        const session = db.get('sessions').find({ id: sessionId }).value();
        if (session && session.authType === 'password' && session.keytarAccountRef) {
            // TODO: Implement IPC to main process to delete keytar entry securely.
            // Example: await window.electronAPI.deleteSessionKeytarEntry(session.keytarAccountRef);
            console.warn(`Keytar entry for session ${sessionId} (ref: ${session.keytarAccountRef}) needs to be deleted by main process.`);
        }
        db.get('sessions').remove({ id: sessionId }).write();
        return true; // Deletion successful
    } catch (error) { 
        console.error(`Error deleting session ${sessionId}:`, error); 
        // Alert only if not a batch operation, batch will show summary.
        if (!isBatchOperation) alert(`Failed to delete session ${sessionId}.`); 
        return false; // Deletion failed
    }
}

// --- Render Sessions ---
function renderSessions(sessionsToRender) { 
    sessionListElement.innerHTML = '';
    if (sessionsToRender.length === 0) { 
        sessionListElement.innerHTML = '<li>No sessions match criteria.</li>'; 
        deleteSelectedSessionsBtn.style.display = 'none'; // Hide if no sessions
        return; 
    }
    sessionsToRender.forEach(session => {
        const listItem = document.createElement('li'); 
        listItem.setAttribute('data-session-id', session.id);
        listItem.style.display = 'flex'; 
        listItem.style.alignItems = 'center';

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.className = 'session-checkbox';
        checkbox.dataset.sessionId = session.id;
        checkbox.style.marginRight = '10px';
        listItem.appendChild(checkbox);

        const sessionInfo = document.createElement('div'); 
        sessionInfo.className = 'session-info';
        sessionInfo.style.flexGrow = '1';
        sessionInfo.innerHTML = `<strong>${session.name}</strong><br><small>${session.user}@${session.host}:${session.port}</small>${session.group ? `<br><small><em>Group: ${session.group}</em></small>` : ''}`;
        
        const sessionActions = document.createElement('div'); 
        sessionActions.className = 'session-actions';
        const connectBtn = document.createElement('button'); connectBtn.className = 'connect-btn'; connectBtn.textContent = 'Connect'; connectBtn.setAttribute('data-id', session.id);
        const editBtn = document.createElement('button'); editBtn.className = 'edit-btn'; editBtn.textContent = 'Edit'; editBtn.setAttribute('data-id', session.id);
        const deleteBtn = document.createElement('button'); deleteBtn.className = 'delete-btn'; deleteBtn.textContent = 'Delete'; deleteBtn.setAttribute('data-id', session.id);
        
        sessionActions.appendChild(connectBtn); 
        sessionActions.appendChild(editBtn); 
        sessionActions.appendChild(deleteBtn);
        
        listItem.appendChild(sessionInfo); 
        listItem.appendChild(sessionActions);
        sessionListElement.appendChild(listItem);
    });
}

// --- Load, Filter, Display Sessions & Groups ---
function loadAndDisplaySessions() { 
    let sessions = db.get('sessions').value();
    if (currentGroupFilter) sessions = sessions.filter(s => s.group === currentGroupFilter);
    if (currentSearchTerm) {
        const searchTermLower = currentSearchTerm.toLowerCase();
        sessions = sessions.filter(s => s.name.toLowerCase().includes(searchTermLower) || s.host.toLowerCase().includes(searchTermLower) || s.user.toLowerCase().includes(searchTermLower) || (s.group && s.group.toLowerCase().includes(searchTermLower)));
    }
    renderSessions(sessions); 
    populateGroupFilter();
    // Update visibility of "Delete Selected" button based on current checkboxes (might be none after re-render)
    const checkedCount = sessionListElement.querySelectorAll('.session-checkbox:checked').length;
    deleteSelectedSessionsBtn.style.display = checkedCount > 0 ? 'block' : 'none';
}
function populateGroupFilter() { 
    const uniqueGroups = [...new Set(db.get('sessions').map('group').filter(g => g).value())];
    groupFilterSelect.innerHTML = '<option value="">All Groups</option>';
    uniqueGroups.forEach(groupName => {
        const option = document.createElement('option'); option.value = groupName; option.textContent = groupName;
        if (groupName === currentGroupFilter) option.selected = true;
        groupFilterSelect.appendChild(option);
    });
}

// --- Task Template Functions ---
function renderPlaceholders(template) {
    taskPlaceholdersForm.innerHTML = '';
    if (!template || !template.placeholders || template.placeholders.length === 0) return;
    template.placeholders.forEach(p => {
        const label = document.createElement('label'); label.textContent = p.prompt; label.style.display = 'block'; label.style.marginBottom = '3px';
        const input = document.createElement('input'); input.type = 'text'; input.name = p.name; input.placeholder = p.defaultValue || `Enter ${p.name}`;
        if (p.defaultValue) input.value = p.defaultValue;
        input.style.width = 'calc(100% - 16px)'; input.style.padding = '6px'; input.style.marginBottom = '8px'; input.style.boxSizing = 'border-box';
        taskPlaceholdersForm.appendChild(label); taskPlaceholdersForm.appendChild(input);
    });
}
function previewTaskCommands() {
    if (!activeTabId || !terminals[activeTabId] || !terminals[activeTabId].selectedTaskTemplate) {
        taskCommandsPreview.textContent = ''; executeTaskBtn.style.display = 'none'; return;
    }
    const template = terminals[activeTabId].selectedTaskTemplate;
    const placeholderValues = {};
    Array.from(taskPlaceholdersForm.querySelectorAll('input')).forEach(input => { placeholderValues[input.name] = input.value; });
    const processedCommands = template.commands.map(cmd => {
        let processedCmd = cmd;
        for (const key in placeholderValues) { processedCmd = processedCmd.replace(new RegExp(`{{${key}}}`, 'g'), placeholderValues[key]); }
        return processedCmd;
    });
    taskCommandsPreview.textContent = processedCommands.join('\n');
    executeTaskBtn.style.display = 'block';
}
taskTemplateSelect.addEventListener('change', () => {
    if (!activeTabId || !terminals[activeTabId]) return;
    const selectedId = taskTemplateSelect.value;
    const template = terminals[activeTabId].availableTaskTemplates.find(t => t.id === selectedId);
    terminals[activeTabId].selectedTaskTemplate = template;
    renderPlaceholders(template); previewTaskCommands(); 
});
taskPlaceholdersForm.addEventListener('input', previewTaskCommands); 
executeTaskBtn.addEventListener('click', () => {
    if (!activeTabId || !terminals[activeTabId] || !terminals[activeTabId].selectedTaskTemplate || !terminals[activeTabId].isConnected) {
        alert('No active connected session or no task selected to execute.'); return;
    }
    const commandsText = taskCommandsPreview.textContent;
    if (!commandsText) { alert('No commands to execute.'); return; }
    const commands = commandsText.split('\n');
    const tabData = terminals[activeTabId];
    tabData.term.writeln(`\r\n\x1b[36m--- Executing Smart Task: ${tabData.selectedTaskTemplate.name} ---\x1b[0m`);
    commands.forEach(command => {
        if (command.trim()) { 
            const commandToSend = command + '\n';
            // For Smart Tasks, we use executeAiCommand to enable potential diagnosis for each command in the task
            window.electronAPI.executeAiCommand({ tabId: activeTabId, command: command.trim() });
            tabData.term.writeln(`\r\n\x1b[33m$ ${command.trim()}\x1b[0m`); 
        }
    });
    tabData.term.writeln(`\r\n\x1b[36m--- Smart Task execution initiated ---\x1b[0m`);
    taskTemplateSelect.value = ''; taskPlaceholdersForm.innerHTML = ''; taskCommandsPreview.textContent = '';
    executeTaskBtn.style.display = 'none'; terminals[activeTabId].selectedTaskTemplate = null;
});

// --- Event Listeners ---
addNewSessionBtn.onclick = openModalForNew;
closeModalBtn.onclick = closeModal;
cancelModalBtn.onclick = closeModal;
window.onclick = (event) => { if (event.target == modal) closeModal(); };
authTypeSelect.onchange = toggleAuthFields;
searchSessionsInput.addEventListener('input', (e) => { currentSearchTerm = e.target.value; loadAndDisplaySessions(); });
groupFilterSelect.addEventListener('change', (e) => { currentGroupFilter = e.target.value; loadAndDisplaySessions(); });

sessionListElement.addEventListener('click', (event) => {
    const target = event.target;
    // Handle checkbox change directly on sessionListElement due to event delegation
    if (target.classList.contains('session-checkbox')) {
        const checkedCount = sessionListElement.querySelectorAll('.session-checkbox:checked').length;
        deleteSelectedSessionsBtn.style.display = checkedCount > 0 ? 'block' : 'none';
        return; // Stop further processing if it was just a checkbox click
    }

    const sessionListItem = target.closest('li');
    if (!sessionListItem) return;
    
    const sessionListItemId = sessionListItem.getAttribute('data-session-id');
    if (!sessionListItemId) return;

    if (target.classList.contains('edit-btn')) {
        openModalForEdit(sessionListItemId);
    } else if (target.classList.contains('delete-btn')) {
        deleteSession(sessionListItemId, false).then(deleted => { // isBatchOperation = false
            if (deleted) loadAndDisplaySessions(); // Refresh list if single delete was successful
        });
    } else if (target.classList.contains('connect-btn')) {
        const sessionDetails = db.get('sessions').find({ id: sessionListItemId }).value();
        if (sessionDetails) {
            let tabToConnectId = activeTabId;
            if (!activeTabId || (terminals[activeTabId] && terminals[activeTabId].isConnected && terminals[activeTabId].sessionId !== sessionDetails.id)) {
                tabToConnectId = createTab(sessionDetails.name, sessionDetails);
            } else if (activeTabId && terminals[activeTabId]) {
                terminals[activeTabId].name = sessionDetails.name;
                terminals[activeTabId].tabElement.querySelector('.tab-name').textContent = sessionDetails.name;
                terminals[activeTabId].sessionId = sessionDetails.id;
                terminals[activeTabId].term.reset();
                terminals[activeTabId].term.writeln(`\r\nInitiating connection to ${sessionDetails.name}...`);
                terminals[activeTabId].connectionStateMessage = `Status: Connecting to ${sessionDetails.name}...`;
                updateStatusBarForActiveTab();
                window.electronAPI.connectSsh({ sessionDetails, tabId: activeTabId });
                terminals[activeTabId].term.focus();
            } else {
                 tabToConnectId = createTab(sessionDetails.name, sessionDetails);
            }
        } else {
            console.error(`Could not find session details for ID ${sessionListItemId}`);
            if(activeTabId && terminals[activeTabId]) terminals[activeTabId].term.writeln(`\r\n\x1b[31mError: Session details not found\x1b[0m`);
        }
    }
});

addTabBtn.onclick = () => createTab(); 
tabBar.addEventListener('click', (event) => {
    const target = event.target;
    const tabElement = target.closest('.tab'); 
    const closeButton = target.closest('.tab-close-btn');
    if (closeButton && tabElement) {
        event.stopPropagation();
        const tabIdToClose = tabElement.getAttribute('data-tab-id');
        closeTab(tabIdToClose);
    } else if (tabElement) {
        const tabIdToSwitch = tabElement.getAttribute('data-tab-id');
        if (tabIdToSwitch !== activeTabId) switchTab(tabIdToSwitch);
    }
});

// Event listener for "Delete Selected Sessions" button
deleteSelectedSessionsBtn.addEventListener('click', async () => {
    const selectedCheckboxes = sessionListElement.querySelectorAll('.session-checkbox:checked');
    const sessionsToDelete = Array.from(selectedCheckboxes).map(cb => cb.dataset.sessionId);

    if (sessionsToDelete.length === 0) {
        alert("No sessions selected for deletion.");
        return;
    }

    if (confirm(`Are you sure you want to delete ${sessionsToDelete.length} selected session(s)?`)) {
        let allSucceeded = true;
        let successCount = 0;
        for (const sessionId of sessionsToDelete) {
            const success = await deleteSession(sessionId, true); // isBatchOperation = true
            if (success) {
                successCount++;
            } else {
                allSucceeded = false;
            }
        }
        
        if (successCount > 0) {
             alert(`${successCount} session(s) deleted successfully.`);
        }
        if (!allSucceeded) {
            alert("Some sessions could not be deleted or were already removed. Please check console for errors if any.");
        }
        
        loadAndDisplaySessions(); // Refresh list and button visibility
    }
});


// --- Terminal IPC and Event Handling ---
if (window.electronAPI && window.electronAPI.handleTerminalData) {
    window.electronAPI.handleTerminalData((payload) => {
        if (terminals[payload.tabId]) {
            terminals[payload.tabId].term.write(typeof payload.data === 'string' ? payload.data : new Uint8Array(payload.data));
        }
    });
} else { console.error('electronAPI.handleTerminalData is not available.'); }

window.addEventListener('resize', () => {
    if (activeTabId && terminals[activeTabId] && terminals[activeTabId].fitAddon) { 
        try { terminals[activeTabId].fitAddon.fit(); } catch (e) { console.warn("Error fitting terminal on window resize:", e.message); }
    }
});

// --- SSH Connection Event Handlers from Main Process ---
if (window.electronAPI) {
    const updateTabAndStatusBarGeneric = (tabId, message, styleCode, isConnectedState, stateMessagePrefix = "Status: ") => {
        if (terminals[tabId]) {
            terminals[tabId].term.writeln(`\r\n\x1b[${styleCode}m${message}\x1b[0m`);
            terminals[tabId].isConnected = isConnectedState;
            terminals[tabId].connectionStateMessage = `${stateMessagePrefix}${message}`;
            if (tabId === activeTabId) updateStatusBarForActiveTab();
        }
    };

    window.electronAPI.onSshStatus(payload => { 
        updateTabAndStatusBarGeneric(payload.tabId, payload.message, '33', terminals[payload.tabId]?.isConnected || false, "Status: "); 
    });
    window.electronAPI.onSshConnected(payload => { 
        updateTabAndStatusBarGeneric(payload.tabId, payload.message, '32', true, "Status: "); 
         if(terminals[payload.tabId]) { 
            const sessionNameFromServer = payload.message.startsWith("Connected to ") ? payload.message.substring("Connected to ".length).split('.')[0] : terminals[payload.tabId].name;
            terminals[payload.tabId].name = sessionNameFromServer;
            terminals[payload.tabId].tabElement.querySelector('.tab-name').textContent = sessionNameFromServer;
            if (payload.tabId === activeTabId) sessionNameStatusEl.textContent = `Session: ${sessionNameFromServer}`;
            loadTaskTemplatesForTab(payload.tabId); 
        }
    });
    window.electronAPI.onSshError(payload => { 
        updateTabAndStatusBarGeneric(payload.tabId, `ERROR: ${payload.message}`, '31', false, "Status: "); 
        if(terminals[payload.tabId]) loadTaskTemplatesForTab(payload.tabId); 
    });
    window.electronAPI.onSshDisconnect(payload => { 
        updateTabAndStatusBarGeneric(payload.tabId, payload.message || 'Connection closed.', '33', false, "Status: "); 
        if (payload.tabId === activeTabId) sessionNameStatusEl.textContent = "Session: N/A"; 
        if (terminals[payload.tabId]) {
            terminals[payload.tabId].context = { os: null, pwd: null }; 
            loadTaskTemplatesForTab(payload.tabId); 
        }
    });
    window.electronAPI.onSshShellReady(payload => { 
        if (terminals[payload.tabId]) {
            terminals[payload.tabId].term.writeln(`\r\n\x1b[32m${payload.message || 'Shell ready.'}\x1b[0m`);
            if (window.electronAPI.sendTerminalResize) {
                const { term } = terminals[payload.tabId];
                window.electronAPI.sendTerminalResize({ tabId: payload.tabId, cols: term.cols, rows: term.rows });
            }
             if (payload.tabId === activeTabId) updateStatusBarForActiveTab(); 
        }
    });
    window.electronAPI.onSshContextUpdate(({ tabId, context }) => {
        if (terminals[tabId]) {
            terminals[tabId].context = context;
            console.log(`Context updated for tab ${tabId}: OS = ${context.os}`);
            terminals[tabId].term.writeln(`\r\n\x1b[36mOS detected: ${context.os || 'unknown'}\x1b[0m`);
            if (tabId === activeTabId) updateStatusBarForActiveTab(); 
            loadTaskTemplatesForTab(tabId); 
        }
    });

    // --- Keyboard Shortcut Handlers ---
    window.electronAPI.onNewTabShortcut(() => createTab("New Tab", null));
    window.electronAPI.onCloseTabShortcut(() => { if (activeTabId) closeTab(activeTabId); });
    window.electronAPI.onNextTabShortcut(() => switchToNextTab());
    window.electronAPI.onPreviousTabShortcut(() => switchToPreviousTab());

    // --- API Key Management Event Handlers ---
    setApiKeyBtn.addEventListener('click', () => {
        apiKeyForm.style.display = apiKeyForm.style.display === 'none' ? 'block' : 'none';
    });
    saveApiKeyBtn.addEventListener('click', async () => {
        const key = apiKeyInput.value.trim();
        if (key) {
            try {
                const result = await window.electronAPI.saveApiKey(key);
                if (result.success) { alert('API Key saved successfully.'); apiKeyStatus.textContent = 'API Key: Set'; } 
                else { alert(`Failed to save API Key: ${result.error || 'Unknown error'}`); apiKeyStatus.textContent = 'API Key: Error Saving'; }
            } catch (err) { alert(`Error saving API Key: ${err.message}`); apiKeyStatus.textContent = 'API Key: Error Saving'; }
            apiKeyInput.value = ''; apiKeyForm.style.display = 'none';
        } else { alert('Please enter an API key.'); }
    });
    clearApiKeyBtn.addEventListener('click', async () => {
        if (confirm('Are you sure you want to clear the API key?')) {
            try {
                const result = await window.electronAPI.clearApiKey();
                if (result.success) { alert('API Key cleared successfully.'); apiKeyStatus.textContent = 'API Key: Not Set'; } 
                else { alert(`Failed to clear API Key: ${result.error || 'Unknown error'}`); apiKeyStatus.textContent = 'API Key: Error Clearing'; }
            } catch (err) { alert(`Error clearing API Key: ${err.message}`); apiKeyStatus.textContent = 'API Key: Error Clearing'; }
        }
    });
    async function checkApiKeyStatus() {
        try {
            const key = await window.electronAPI.getApiKey();
            apiKeyStatus.textContent = key ? 'API Key: Set' : 'API Key: Not Set';
        } catch (err) { console.error("Error checking API key status:", err); apiKeyStatus.textContent = 'API Key: Error Checking';}
    }
    checkApiKeyStatus(); 

    // AI Command Generation IPC Listeners
    window.electronAPI.onAiCommandStreamChunk(payload => { 
        if (terminals[payload.tabId]) {
            const tabData = terminals[payload.tabId];
            if (tabData.aiSuggestionsDiv.textContent === 'Generating command...' || tabData.aiSuggestionsDiv.textContent === 'Executing command...') tabData.aiSuggestionsDiv.textContent = '';
            tabData.aiSuggestionsDiv.textContent += payload.chunk;
            tabData.lastAiSuggestedCommand += payload.chunk; 
        }
    });
    window.electronAPI.onAiCommandStreamEnd(payload => { 
        if (terminals[payload.tabId]) {
            const tabData = terminals[payload.tabId];
            tabData.lastAiSuggestedCommand = payload.fullCommand; 
            tabData.aiSuggestionsDiv.textContent = payload.fullCommand; 
            if (payload.fullCommand) tabData.nlExecuteBtn.style.display = 'inline-block';
        }
    });
    window.electronAPI.onAiCommandError(payload => { 
        if (terminals[payload.tabId]) {
            terminals[payload.tabId].aiSuggestionsDiv.textContent = `Error: ${payload.error}`;
            terminals[payload.tabId].nlExecuteBtn.style.display = 'none';
        }
    });

    // AI Error Diagnosis IPC Listeners
    window.electronAPI.onAiDiagnosisStreamChunk(payload => { // { tabId, chunk }
        if (terminals[payload.tabId]) {
            const tabData = terminals[payload.tabId];
            if (tabData.aiSuggestionsDiv.textContent === 'Executing command...' || !tabData.currentDiagnosis) { // Clear "Executing..." or if first chunk
                tabData.aiSuggestionsDiv.textContent = '';
                tabData.currentDiagnosis = ''; // Initialize/reset
            }
            tabData.aiSuggestionsDiv.textContent += payload.chunk;
            tabData.currentDiagnosis += payload.chunk;
        }
    });
    window.electronAPI.onAiDiagnosisStreamEnd(payload => { // { tabId, fullDiagnosis }
        if (terminals[payload.tabId]) {
            const tabData = terminals[payload.tabId];
            tabData.aiSuggestionsDiv.textContent = `Diagnosis:\n${payload.fullDiagnosis}`;
            tabData.currentDiagnosis = payload.fullDiagnosis; // Store final diagnosis
            // No "Execute" button for diagnosis results
        }
    });
    window.electronAPI.onAiDiagnosisError(payload => { // { tabId, error }
        if (terminals[payload.tabId]) {
            terminals[payload.tabId].aiSuggestionsDiv.textContent = `Diagnosis Error: ${payload.error}`;
            terminals[payload.tabId].currentDiagnosis = ''; // Clear diagnosis
        }
    });
}

// --- Initial Load ---
document.addEventListener('DOMContentLoaded', () => {
    toggleAuthFields(); 
    loadAndDisplaySessions(); 
    createTab("Tab 1"); 
    if (window.electronAPI) { /* checkApiKeyStatus is called within the if block */ }
});

console.log('Renderer script (with AI Diagnosis logic) loaded and initialized.');
