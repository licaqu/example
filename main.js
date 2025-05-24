const { app, BrowserWindow, ipcMain, Menu } = require('electron'); // Added Menu
const path = require('path');
const fs = require('fs'); // For reading private key files
const os = require('os'); // For tilde expansion in key paths
const keytar = require('keytar'); // For password retrieval
const { Client } = require('ssh2'); // SSH client

// Data structure for managing multiple tab sessions
let tabSessions = {}; // Key: tabId, Value: { sshClient, sshStream, browserWindow }
// Note: browserWindow might be redundant if we only support one main window,
// but good for future-proofing. For now, it will always be mainWindow.

let mainWindow = null; // Will be set in createWindow

function createWindow () {
  mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.loadFile('index.html');
  // mainWindow.webContents.openDevTools(); // Optional: for debugging
}

// Function to clean up resources for a specific tab
function cleanupSshConnection(tabId) {
    if (tabSessions[tabId]) {
        const { sshStream, sshClient } = tabSessions[tabId];
        if (sshStream) {
            sshStream.end();
        }
        if (sshClient) {
            sshClient.end();
        }
        delete tabSessions[tabId];
        console.log(`Cleaned up SSH connection for tabId: ${tabId}`);
    }
}

// Centralized function to manage SSH connection for a tab
async function manageSshConnection(tabId, sessionDetails, webContents) {
    cleanupSshConnection(tabId); // Clean up any previous connection for this tab

    console.log(`Attempting to connect SSH for tabId ${tabId} with details:`, sessionDetails);
    webContents.send('ssh-status', { tabId, message: `Connecting to ${sessionDetails.name}...` });

    const client = new Client();
    // Initialize context structure early
    tabSessions[tabId] = { 
        sshClient: client, 
        sshStream: null, 
        browserWindow: mainWindow,
        context: { os: null, pwd: null } // Initialize context
    };

    const { host, port, user, authType, keytarAccountRef, privateKeyPath } = sessionDetails;
    const config = { host, port, username: user, readyTimeout: 20000 };

    try {
        if (authType === 'password') {
            if (!keytarAccountRef) {
                console.error(`Keytar account reference is missing for password authentication (tabId: ${tabId}).`);
                webContents.send('ssh-error', { tabId, message: 'Authentication setup error: Missing Keytar reference.' });
                cleanupSshConnection(tabId);
                return;
            }
            const password = await keytar.getPassword('AI-SSH-Client', keytarAccountRef);
            if (password === null) {
                webContents.send('ssh-error', { tabId, message: 'Failed to retrieve password. Ensure it was saved correctly.' });
                cleanupSshConnection(tabId);
                return;
            }
            config.password = password;
        } else if (authType === 'key') {
            if (!privateKeyPath) {
                webContents.send('ssh-error', { tabId, message: 'Private key path is required for key-based authentication.' });
                cleanupSshConnection(tabId);
                return;
            }
            const actualPrivateKeyPath = privateKeyPath.startsWith('~') ? path.join(os.homedir(), privateKeyPath.substring(1)) : privateKeyPath;
            if (!fs.existsSync(actualPrivateKeyPath)) {
                webContents.send('ssh-error', { tabId, message: `Private key not found at: ${actualPrivateKeyPath}` });
                cleanupSshConnection(tabId);
                return;
            }
            config.privateKey = fs.readFileSync(actualPrivateKeyPath);
        } else {
            webContents.send('ssh-error', { tabId, message: `Unsupported authentication type: ${authType}` });
            cleanupSshConnection(tabId);
            return;
        }
    } catch (error) {
        console.error(`Error preparing SSH config for tabId ${tabId}:`, error);
        webContents.send('ssh-error', { tabId, message: `Error preparing connection: ${error.message}` });
        cleanupSshConnection(tabId);
        return;
    }

    client.on('ready', () => {
        console.log(`SSH Client for tabId ${tabId} :: ready`);
        // Send initial connected message before OS detection
        webContents.send('ssh-connected', { tabId, message: `Connected to ${sessionDetails.name}. Detecting OS...` });

        // 1. Determine OS Type
        client.exec('uname -a', (err, execStream) => {
            let osInfo = '';
            if (err) {
                console.error(`Error executing uname for tabId ${tabId}:`, err);
                if (tabSessions[tabId]) tabSessions[tabId].context.os = 'unknown (uname error)';
            } else {
                execStream.on('data', (data) => {
                    osInfo += data.toString();
                }).on('close', () => {
                    if (tabSessions[tabId]) { // Check if session still exists
                        if (osInfo.includes('Linux')) tabSessions[tabId].context.os = 'Linux';
                        else if (osInfo.includes('Darwin')) tabSessions[tabId].context.os = 'macOS';
                        else if (osInfo.includes('CYGWIN') || osInfo.includes('MINGW') || osInfo.includes('MSYS')) tabSessions[tabId].context.os = 'Windows (bash-like)';
                        else tabSessions[tabId].context.os = 'unknown: ' + osInfo.split('\n')[0].trim();
                        console.log(`Tab ${tabId} OS detected:`, tabSessions[tabId].context.os);
                        // Optionally send context update to renderer
                        webContents.send('ssh-context-update', { tabId, context: tabSessions[tabId].context });
                    }
                });
            }

            // 2. Now, establish the interactive shell for the user
            client.shell((shellErr, shellStream) => {
                if (shellErr) {
                    console.error(`SSH Client for tabId ${tabId} :: shell error:`, shellErr);
                    webContents.send('ssh-error', { tabId, message: `Shell error: ${shellErr.message}` });
                    cleanupSshConnection(tabId);
                    return;
                }
                
                console.log(`SSH Client for tabId ${tabId} :: shell established`);
                if (tabSessions[tabId]) {
                    tabSessions[tabId].sshStream = shellStream;
                } else {
                    console.error(`Tab session for tabId ${tabId} disappeared before shell stream could be stored.`);
                    shellStream.end();
                    // client.end(); // client is already handled by cleanupSshConnection if tabSessions[tabId] is gone
                    return;
                }

                shellStream.on('data', (data) => {
                    const rawDataStr = data.toString();
                    const webContents = tabSessions[tabId]?.browserWindow?.webContents;

                    if (webContents && !webContents.isDestroyed()) {
                        webContents.send('terminal-data-reply', { tabId, data: rawDataStr });
                    }

                    const ac = tabSessions[tabId]?.analyzingCommand;
                    if (ac && ac.active) {
                        ac.buffer += rawDataStr; // Accumulate all raw data in buffer while active

                        if (!ac.foundStartMarker && ac.buffer.includes(ac.START_MARKER)) {
                            ac.foundStartMarker = true;
                            // Output capture begins *after* the start marker.
                            // The buffer from this point on (or subsequent data) is part of the command's actual output.
                        }

                        const endMarkerIndexInBuffer = ac.buffer.indexOf(ac.END_MARKER);
                        if (ac.foundStartMarker && endMarkerIndexInBuffer !== -1) {
                            // Extract content between START_MARKER and END_MARKER from the buffer
                            const startMarkerActualIndex = ac.buffer.indexOf(ac.START_MARKER); // Re-check in case it spanned chunks
                            
                            // Ensure startMarkerActualIndex is valid and before endMarkerIndexInBuffer
                            if (startMarkerActualIndex !== -1 && startMarkerActualIndex < endMarkerIndexInBuffer) {
                                ac.output = ac.buffer.substring(startMarkerActualIndex + ac.START_MARKER.length, endMarkerIndexInBuffer);
                                
                                const afterEndMarkerContent = ac.buffer.substring(endMarkerIndexInBuffer + ac.END_MARKER.length);
                                const exitCodeMatch = afterEndMarkerContent.match(/exit_code:(\-?\d+)/);

                                if (exitCodeMatch) {
                                    ac.active = false; // Command processing finished
                                    const exitCode = parseInt(exitCodeMatch[1], 10);
                                    ac.output = ac.output.trim(); // Store final, trimmed output

                                    console.log(`[Main] Command for tab ${tabId} ('${ac.command.substring(0, 30)}...') finished. Exit Code: ${exitCode}`);
                                    
                                    if (exitCode !== 0 && ac.webContents && !ac.webContents.isDestroyed()) {
                                        triggerAIDiagnosis(tabId, ac.command, ac.output, exitCode, ac.webContents);
                                    }
                                    tabSessions[tabId].analyzingCommand = null; // Clear analysis state
                                }
                                // If exit_code isn't found yet, it might be in the next data chunk.
                                // The buffer will continue to accumulate.
                            } else {
                                // Start marker not found before end marker, or indices are problematic.
                                // This might indicate corrupted markers or very unusual output.
                                // For now, we might not be able to reliably parse this.
                                console.warn(`[Main] Marker misplacement for tab ${tabId}. Start: ${startMarkerActualIndex}, End: ${endMarkerIndexInBuffer}. Buffer: ${ac.buffer.substring(0,100)}`);
                                // To prevent getting stuck, maybe deactivate if END_MARKER is found but START is not (or after it).
                                if (endMarkerIndexInBuffer !== -1 && (startMarkerActualIndex === -1 || startMarkerActualIndex > endMarkerIndexInBuffer)) {
                                    console.warn(`[Main] Deactivating analysis for tab ${tabId} due to marker issue.`);
                                    ac.active = false;
                                    tabSessions[tabId].analyzingCommand = null;
                                }
                            }
                        }
                    }
                }).on('close', () => {
                    console.log(`SSH Client for tabId ${tabId} :: stream close`);
                    // If a command was being analyzed and the stream closes, handle it
                    const ac = tabSessions[tabId]?.analyzingCommand;
                    if (ac && ac.active) {
                        console.warn(`[Main] Stream closed for tab ${tabId} while command analysis was active. Command: '${ac.command}'`);
                        if (ac.webContents && !ac.webContents.isDestroyed()) {
                            ac.webContents.send('ai-diagnosis-error', { tabId, error: 'Connection closed during command execution. Cannot determine exit status.' });
                        }
                        tabSessions[tabId].analyzingCommand = null;
                    }

                    if (tabSessions[tabId] && tabSessions[tabId].browserWindow && !tabSessions[tabId].browserWindow.isDestroyed()) {
                         tabSessions[tabId].browserWindow.webContents.send('ssh-disconnect', { tabId, message: 'SSH connection closed.' });
                    }
                    cleanupSshConnection(tabId);
                }).stderr.on('data', (data) => { // stderr data should also be sent to terminal and potentially captured
                    const stderrStr = data.toString();
                    const webContents = tabSessions[tabId]?.browserWindow?.webContents;
                    if (webContents && !webContents.isDestroyed()) {
                        // Send as distinct error type or just part of terminal data, prefixed with red ANSI escape
                        webContents.send('terminal-data-reply', { tabId, data: `\x1b[31m${stderrStr}\x1b[0m` });
                    }
                    // Also add stderr to the analysis buffer if a command is being analyzed
                    const ac = tabSessions[tabId]?.analyzingCommand;
                    if (ac && ac.active && ac.foundStartMarker) { // Only add to output if after start marker
                        ac.buffer += stderrStr; // Add stderr to the same buffer
                        // ac.output += stderrStr; // This will be handled when parsing buffer
                    }
                });
                // Send shell ready AFTER OS detection attempt and shell is actually ready
                webContents.send('ssh-shell-ready', { tabId, message: 'Shell ready.' }); 
            });
        });
    });

    client.on('error', (err) => { // This error handler is for the client itself
        console.error(`SSH Client for tabId ${tabId} :: error:`, err);
        webContents.send('ssh-error', { tabId, message: `SSH connection error: ${err.message}` });
        cleanupSshConnection(tabId);
    });

    client.on('close', () => {
        console.log(`SSH Client for tabId ${tabId} :: close event`);
        // This event might fire after resources are already cleaned up.
        // Check if tabSession still exists before sending message
        if (tabSessions[tabId] && tabSessions[tabId].browserWindow && !tabSessions[tabId].browserWindow.isDestroyed()) {
            tabSessions[tabId].browserWindow.webContents.send('ssh-disconnect', { tabId, message: 'SSH connection closed by remote.' });
        }
        cleanupSshConnection(tabId); // Ensure cleanup
    });
    
    try {
        client.connect(config);
    } catch (error) {
        console.error(`SSH Client for tabId ${tabId} :: connection attempt error:`, error);
        webContents.send('ssh-error', { tabId, message: `Connection attempt failed: ${error.message}` });
        cleanupSshConnection(tabId);
    }
}

// IPC Handler for starting SSH connection (now uses manageSshConnection)
ipcMain.on('connect-ssh', async (event, { sessionDetails, tabId }) => {
    if (!tabId) {
        console.error('connect-ssh called without tabId.');
        event.sender.send('ssh-error', { tabId: null, message: 'Internal error: tabId not provided for connection.' });
        return;
    }
    manageSshConnection(tabId, sessionDetails, event.sender);
});

// IPC Handler for explicit disconnect from a tab
ipcMain.on('disconnect-ssh', (event, tabId) => {
    if (!tabId) {
        console.error('disconnect-ssh called without tabId.');
        return;
    }
    console.log(`Received disconnect request for tabId: ${tabId}`);
    cleanupSshConnection(tabId);
    // Optionally send confirmation back to renderer
    event.sender.send('ssh-disconnect', { tabId, message: 'Disconnected by user.' });
});

// Modified IPC data handler for terminal
ipcMain.on('terminal-data', (event, { tabId, data }) => {
    if (!tabId || !tabSessions[tabId]) {
        // console.error(`terminal-data received for invalid tabId: ${tabId}`);
        return;
    }
    const { sshStream } = tabSessions[tabId];
    if (sshStream && sshStream.writable) {
        sshStream.write(data);
    }
});

// IPC Handler for deleting a specific session's password from Keytar
ipcMain.handle('delete-session-password', async (event, keytarAccountRef) => {
    if (!keytarAccountRef) {
        console.error('delete-session-password called with no keytarAccountRef.');
        return { success: false, error: 'No keytarAccountRef provided.' };
    }
    try {
        // keytar should already be required at the top of main.js
        await keytar.deletePassword('AI-SSH-Client', keytarAccountRef); // Using 'AI-SSH-Client' as service name
        console.log(`Session password for ref ${keytarAccountRef} deleted from keychain.`);
        return { success: true };
    } catch (error) {
        console.error(`Failed to delete session password from keychain (ref: ${keytarAccountRef}):`, error);
        return { success: false, error: error.message };
    }
});

// --- Task Templates ---
const taskTemplates = [
    {
        id: 'install_nginx_debian',
        name: 'Install Nginx (Debian/Ubuntu)',
        osCompat: ['Linux'], // Primarily for Debian/Ubuntu, might work on others.
        placeholders: [],
        commands: [
            'sudo apt update',
            'sudo apt install -y nginx'
        ],
        description: 'Updates package list and installs Nginx for Debian-based systems.'
    },
    {
        id: 'install_nginx_rhel',
        name: 'Install Nginx (RHEL/CentOS)',
        osCompat: ['Linux'], // Primarily for RHEL/CentOS.
        placeholders: [],
        commands: [
            'sudo yum check-update || sudo dnf check-update', // Handle yum/dnf
            'sudo yum install -y nginx || sudo dnf install -y nginx',
            'sudo systemctl start nginx',
            'sudo systemctl enable nginx'
        ],
        description: 'Updates, installs, starts, and enables Nginx for RHEL-based systems.'
    },
    {
        id: 'create_user_linux', // More specific ID
        name: 'Create New User (Linux)',
        osCompat: ['Linux'],
        placeholders: [
            { name: 'USERNAME', prompt: 'Enter username for the new user:' },
            { name: 'USER_SHELL', prompt: 'Enter shell (e.g., /bin/bash):', defaultValue: '/bin/bash' }
        ],
        commands: [
            'sudo useradd -m -s {{USER_SHELL}} {{USERNAME}}',
            'echo "Please set password for {{USERNAME}} using: sudo passwd {{USERNAME}}"' // Modified for non-interactivity
        ],
        description: 'Creates a new user with home directory and specified shell.'
    },
    {
        id: 'create_user_macos',
        name: 'Create New User (macOS)',
        osCompat: ['macOS'],
        placeholders: [
            { name: 'FULL_NAME', prompt: 'Enter full name for the new user:' },
            { name: 'USERNAME', prompt: 'Enter username (short name):' },
            { name: 'USER_SHELL', prompt: 'Enter shell (e.g., /bin/zsh):', defaultValue: '/bin/zsh' }
        ],
        commands: [
            // macOS user creation is more complex for command line, often involves dscl
            // This is a simplified example; real dscl commands are more verbose.
            // For safety, we'll just echo what would be done.
            'echo "On macOS, user creation typically involves dscl commands or System Preferences."',
            'echo "Example steps (manual execution recommended):"',
            'echo "1. sudo dscl . -create /Users/{{USERNAME}}"',
            'echo "2. sudo dscl . -create /Users/{{USERNAME}} UserShell {{USER_SHELL}}"',
            'echo "3. sudo dscl . -create /Users/{{USERNAME}} RealName \\"{{FULL_NAME}}\\""',
            'echo "4. sudo dscl . -create /Users/{{USERNAME}} UniqueID $(dscl . -list /Users UniqueID | awk \'{print $2}\' | sort -n | tail -1 | awk \'{print $1+1}\')"', // Find next UniqueID
            'echo "5. sudo dscl . -create /Users/{{USERNAME}} PrimaryGroupID 20 # Staff group"',
            'echo "6. sudo dscl . -create /Users/{{USERNAME}} NFSHomeDirectory /Users/{{USERNAME}}"',
            'echo "7. sudo createhomedir -c -u {{USERNAME}} # Might need to be run after dscl commands"',
            'echo "8. sudo passwd {{USERNAME}}"'
        ],
        description: 'Provides example steps for creating a new user on macOS. Manual execution is advised.'
    },
    {
        id: 'list_docker_containers',
        name: 'List Docker Containers',
        osCompat: ['Linux', 'macOS', 'Windows (bash-like)'], // Assuming Docker is installed
        placeholders: [],
        commands: ['docker ps -a'],
        description: 'Lists all Docker containers (running and stopped).'
    }
];

// IPC Handler to get filtered task templates
ipcMain.handle('get-task-templates', async (event, tabId) => {
    const currentTabSession = tabSessions[tabId];
    const osType = currentTabSession && currentTabSession.context ? currentTabSession.context.os : null;

    if (!osType) {
        // If OS is unknown, maybe return all or a subset? For now, empty or specific error.
        console.warn(`OS type unknown for tabId ${tabId}, cannot filter templates.`);
        return []; // Or send a specific message/error
    }

    const compatibleTemplates = taskTemplates.filter(template => {
        if (template.osCompat.includes(osType)) {
            return true;
        }
        // Special handling for Linux if template is for a more general "Linux"
        // and detected OS is more specific like "Debian" or "RHEL" (if we add such detection later)
        if (osType.startsWith('Linux') && template.osCompat.includes('Linux')) {
            // A more refined check could be: if osType is "Linux (Debian)" and template.osCompat is "Linux (Debian)" or just "Linux"
            // For now, simple "Linux" in osCompat matches any detected Linux.
            return true;
        }
        return false;
    });
    
    // Return only necessary fields to the renderer
    return compatibleTemplates.map(t => ({
        id: t.id,
        name: t.name,
        description: t.description,
        placeholders: t.placeholders,
        // Do not send raw commands here if substitution is done in main process upon request
        // Or send them if substitution is done in renderer. For this subtask, let's try renderer-side substitution.
        commands: t.commands 
    }));
});

// IPC Handler to get template commands (Optional, if substitution done in main)
// For this subtask, we'll send commands with 'get-task-templates' and do substitution in renderer.
// If this handler were used:
/*
ipcMain.handle('get-template-commands', async (event, { templateId, placeholderValues }) => {
    const template = taskTemplates.find(t => t.id === templateId);
    if (!template) {
        return { error: 'Template not found' };
    }
    const processedCommands = template.commands.map(cmd => {
        let processedCmd = cmd;
        for (const key in placeholderValues) {
            processedCmd = processedCmd.replace(new RegExp(`{{${key}}}`, 'g'), placeholderValues[key]);
        }
        return processedCmd;
    });
    return { commands: processedCommands };
});
*/

// --- AI Shell Command Generation ---
const axios = require('axios'); // Ensure axios is required

// Placeholder for AI API configuration
const AI_API_ENDPOINT = 'https://api.deepseek.com/chat/completions'; // Example, make configurable later
// const AI_MODEL = 'deepseek-coder'; // Example, make configurable later // Configurable via UI later
const AI_MODEL = 'deepseek-chat'; // deepseek-coder is often rate-limited for free tier. deepseek-chat is more available.

// --- LowDB Setup (Ensure this is where your db is initialized) ---
// This is conceptual, assuming `db` is already initialized elsewhere like:
// const low = require('lowdb');
// const FileSync = require('lowdb/adapters/FileSync');
// const adapter = new FileSync('db.json'); // Or path.join(app.getPath('userData'), 'db.json'));
// const db = low(adapter);
// db.defaults({ sessions: [], groups: [], aiNlCache: [] }).write(); // Ensure aiNlCache is initialized

function normalizeNlQuery(query) {
    return query.toLowerCase().trim().replace(/\s+/g, ' ');
}

const MAX_CACHE_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const CACHE_LIMIT = 100; // Max number of cache entries

ipcMain.on('generate-shell-command', async (event, { tabId, nlQuery, apiKey }) => {
    const senderWebContents = event.sender; // Cache sender for async operations
    const normalizedQuery = normalizeNlQuery(nlQuery);

    // 1. Cache Check
    const cachedEntry = db.get('aiNlCache')
                          .find({ nlQuery: normalizedQuery })
                          .value();

    if (cachedEntry) {
        const isExpired = (Date.now() - cachedEntry.timestamp) > MAX_CACHE_AGE_MS;
        if (!isExpired) {
            console.log(`[Main Cache] Cache hit for query: "${nlQuery}"`);
            // Send cached command using existing streaming mechanism
            senderWebContents.send('ai-command-stream-chunk', { tabId, chunk: cachedEntry.shellCommand });
            senderWebContents.send('ai-command-stream-end', { tabId, fullCommand: cachedEntry.shellCommand });
            return; // Skip API call
        } else {
            console.log(`[Main Cache] Expired cache entry for query: "${nlQuery}"`);
            // Remove expired entry
            db.get('aiNlCache').remove({ nlQuery: normalizedQuery }).write();
        }
    }
    console.log(`[Main Cache] Cache miss for query: "${nlQuery}"`);

    // Proceed with AI API call if cache miss or expired
    const currentTabSession = tabSessions[tabId];
    const context = currentTabSession ? currentTabSession.context : null;

    let systemPrompt = "You are a helpful assistant that translates natural language queries into shell commands. Provide only the shell command(s) without any explanation or conversational text. If multiple commands are needed, provide them on separate lines or chained with '&&' or ';' as appropriate for a single line execution.";
    if (context && context.os && !context.os.startsWith('unknown')) { // Don't add prompt for 'unknown' OS
        systemPrompt += ` The target operating system is ${context.os}.`;
    }
    // PWD context can be added here if available:
    // if (context && context.pwd) {
    //     systemPrompt += ` The current working directory is ${context.pwd}.`;
    // } else {
    //     systemPrompt += ` The current working directory is unknown.`;
    }


    if (!apiKey) {
        // Use webContents to send back to the specific renderer that initiated, if event.sender is not ideal for async replies
        const senderWebContents = event.sender; // Or mainWindow.webContents if general
        senderWebContents.send('ai-command-error', { tabId, error: 'API Key is not set. Please set it in AI Settings.' });
        return;
    }

    console.log(`[Main] Received generate-shell-command for tabId: ${tabId}, Query: ${nlQuery}`);
    let assembledCommand = ''; // To assemble the full command from chunks

    try {
        const response = await axios.post(
            AI_API_ENDPOINT,
            {
                model: AI_MODEL,
                messages: [
                    { role: "system", content: systemPrompt },
                    { role: "user", content: nlQuery } // Use original nlQuery for AI, normalized for cache key
                ],
                stream: true
            },
            {
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/json'
                },
                responseType: 'stream'
            }
        );

        response.data.on('data', (chunk) => {
            const chunkStr = chunk.toString();
            // console.log('[Main] Stream chunk received:', chunkStr); // Raw chunk
            
            // Process Server-Sent Events (SSE)
            // Each chunk might contain multiple "data: {...}" lines
            const lines = chunkStr.split('\n').filter(line => line.trim() !== '');
            for (const line of lines) {
                if (line.startsWith('data: ')) {
                    const jsonData = line.substring(6); // Remove "data: " prefix
                    if (jsonData === '[DONE]') {
                        // Stream finished by [DONE] message
                        console.log('[Main] Stream indicated DONE.');
                        event.sender.send('ai-command-stream-end', { tabId, fullCommand: assembledCommand.trim() });
                        return; // Stop further processing for this chunk
                    }
                    try {
                        const parsed = JSON.parse(jsonData);
                        if (parsed.choices && parsed.choices[0] && parsed.choices[0].delta && parsed.choices[0].delta.content) {
                            const contentChunk = parsed.choices[0].delta.content;
                            // console.log('[Main] Extracted content chunk:', contentChunk);
                            assembledCommand += contentChunk;
                            event.sender.send('ai-command-stream-chunk', { tabId, chunk: contentChunk });
                        }
                    } catch (parseError) {
                        console.error('[Main] Error parsing stream JSON:', parseError, 'Original line:', line);
                    }
                }
            }
        });

        response.data.on('end', () => {
            console.log('[Main] Stream ended.');
            // Sometimes [DONE] might not be sent or processed before 'end', ensure we send final command
            const finalCommand = assembledCommand.trim();
            senderWebContents.send('ai-command-stream-end', { tabId, fullCommand: finalCommand });

            // 2. Cache Save
            if (finalCommand) { // Only cache if a command was actually generated
                const newCacheEntry = {
                    nlQuery: normalizedQuery,
                    shellCommand: finalCommand,
                    timestamp: Date.now()
                };
                db.get('aiNlCache').push(newCacheEntry).write();
                console.log(`[Main Cache] Saved to cache: "${normalizedQuery}" -> "${finalCommand.substring(0,50)}..."`);

                // 3. Cache Pruning (Simple strategy: FIFO if over limit)
                let cache = db.get('aiNlCache');
                if (cache.size().value() > CACHE_LIMIT) {
                    console.log(`[Main Cache] Cache limit reached (${CACHE_LIMIT}). Pruning oldest entries.`);
                    db.set('aiNlCache', cache.orderBy('timestamp', 'desc').take(CACHE_LIMIT).value()).write();
                }
            }
        });

        response.data.on('error', (streamError) => {
            console.error('[Main] Stream error:', streamError);
            senderWebContents.send('ai-command-error', { tabId, error: streamError.message });
        });

    } catch (error) {
        console.error('[Main] Axios request error:', error.response ? error.response.data : error.message);
        let errorMessage = error.message;
        if (error.response && error.response.data) {
            const apiErrorData = error.response.data.toString(); 
            try {
                const parsedApiError = JSON.parse(apiErrorData);
                if(parsedApiError.error && parsedApiError.error.message) errorMessage = parsedApiError.error.message;
                else errorMessage = apiErrorData.substring(0, 200); 
            } catch (e) { errorMessage = apiErrorData.substring(0, 200); }
        } else if (error.request) {
            errorMessage = 'No response received from AI service. Check network or API endpoint.';
        }
        senderWebContents.send('ai-command-error', { tabId, error: `AI service request failed: ${errorMessage}` });
    }
});


// --- AI Error Diagnosis ---
async function triggerAIDiagnosis(tabId, command, output, exitCode, webContents) {
    console.log(`[Main] Triggering AI Diagnosis for tabId: ${tabId}, Command: ${command}, Exit Code: ${exitCode}`);
    const apiKey = await keytar.getPassword('AI-SSH-Client-APIKey', 'user-api-key');
    if (!apiKey) {
        webContents.send('ai-diagnosis-error', { tabId, error: 'Cannot analyze error: API Key not set.' });
        return;
    }

    const systemPrompt = "You are an AI assistant that analyzes shell command errors. Given the command, its output, and exit code, explain the error and suggest a solution. Be concise and helpful.";
    const userPrompt = `Command: ${command}\nExit Code: ${exitCode}\nOutput:\n${output.substring(0, 2000)}`; // Limit output length for API

    let assembledDiagnosis = '';
    try {
        const response = await axios.post(
            AI_API_ENDPOINT, // Reuse same endpoint
            {
                model: AI_MODEL, // Reuse same model or choose a different one for diagnosis
                messages: [
                    { role: "system", content: systemPrompt },
                    { role: "user", content: userPrompt }
                ],
                stream: true
            },
            {
                headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
                responseType: 'stream'
            }
        );

        response.data.on('data', (chunk) => {
            const chunkStr = chunk.toString();
            const lines = chunkStr.split('\n').filter(line => line.trim() !== '');
            for (const line of lines) {
                if (line.startsWith('data: ')) {
                    const jsonData = line.substring(6);
                    if (jsonData === '[DONE]') {
                        webContents.send('ai-diagnosis-stream-end', { tabId, fullDiagnosis: assembledDiagnosis.trim() });
                        return;
                    }
                    try {
                        const parsed = JSON.parse(jsonData);
                        if (parsed.choices && parsed.choices[0] && parsed.choices[0].delta && parsed.choices[0].delta.content) {
                            const contentChunk = parsed.choices[0].delta.content;
                            assembledDiagnosis += contentChunk;
                            webContents.send('ai-diagnosis-stream-chunk', { tabId, chunk: contentChunk });
                        }
                    } catch (parseError) {
                        console.error('[Main] Error parsing diagnosis stream JSON:', parseError, 'Original line:', line);
                    }
                }
            }
        });
        response.data.on('end', () => {
            webContents.send('ai-diagnosis-stream-end', { tabId, fullDiagnosis: assembledDiagnosis.trim() });
        });
        response.data.on('error', (streamError) => {
            webContents.send('ai-diagnosis-error', { tabId, error: streamError.message });
        });
    } catch (error) {
        console.error('[Main] AI Diagnosis Axios request error:', error.response ? error.response.data : error.message);
        let diagErrorMessage = error.message;
        // Similar error parsing as in generate-shell-command
        if (error.response && error.response.data) {
            const apiErrorData = error.response.data.toString();
            try {
                const parsedApiError = JSON.parse(apiErrorData);
                if(parsedApiError.error && parsedApiError.error.message) diagErrorMessage = parsedApiError.error.message;
                else diagErrorMessage = apiErrorData.substring(0, 200);
            } catch (e) { diagErrorMessage = apiErrorData.substring(0, 200); }
        } else if (error.request) {
            diagErrorMessage = 'No response received from AI service for diagnosis.';
        }
        webContents.send('ai-diagnosis-error', { tabId, error: `AI diagnosis request failed: ${diagErrorMessage}` });
    }
}


// IPC Handler for executing AI-generated command and enabling analysis
ipcMain.on('execute-ai-command', async (event, { tabId, command }) => {
    if (!tabId || !tabSessions[tabId] || !tabSessions[tabId].sshStream || !tabSessions[tabId].sshStream.writable) {
        console.error(`Cannot execute command for tabId ${tabId}: No active or writable SSH stream.`);
        // Optionally send an error back to renderer if needed
        event.sender.send('ai-command-error', { tabId, error: "No active SSH connection for this tab." });
        return;
    }

    const START_MARKER = `CMD_START_MARKER_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
    const END_MARKER = `CMD_END_MARKER_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
    
    // Store command info for analysis. Pass event.sender (webContents) for triggerAIDiagnosis
    tabSessions[tabId].analyzingCommand = {
        command,
        START_MARKER,
        END_MARKER,
        output: '',
        buffer: '', // Temporary buffer for the current data chunk processing
        foundStartMarker: false,
        active: true,
        webContents: event.sender // Store webContents for async diagnosis trigger
    };

    const commandToExecute = `echo "${START_MARKER}"; ${command}; echo "${END_MARKER}"; echo "exit_code:$?"\n`;
    tabSessions[tabId].sshStream.write(commandToExecute);
    // The actual command output will be picked up by the global stream.on('data') handler
});


// Modified stream.on('data') handler inside client.shell callback
// This is a conceptual placement, the actual modification is within manageSshConnection
// ...
// shellStream.on('data', (data) => {
//     const rawDataStr = data.toString(); // Typically utf-8, but be mindful of encoding
//     const webContents = tabSessions[tabId]?.browserWindow?.webContents; // Or event.sender if available
    
//     if (webContents && !webContents.isDestroyed()) {
//         webContents.send('terminal-data-reply', { tabId, data: rawDataStr });
//     }

//     const ac = tabSessions[tabId]?.analyzingCommand;
//     if (ac && ac.active) {
//         ac.buffer += rawDataStr;

//         if (!ac.foundStartMarker && ac.buffer.includes(ac.START_MARKER)) {
//             ac.foundStartMarker = true;
//             // Discard buffer content before START_MARKER for ac.output
//             ac.output = ac.buffer.substring(ac.buffer.indexOf(ac.START_MARKER) + ac.START_MARKER.length);
//             // Reset buffer to only contain post-marker data for further processing of this chunk
//             ac.buffer = ac.output; 
//         } else if (ac.foundStartMarker) {
//             // If start marker was found in a previous chunk, just append current rawDataStr to output
//             // (This check is important because ac.output might have been reset with post-marker data)
//             if (ac.buffer !== ac.output) { // If buffer was reset above, this data is new for output
//                  ac.output += rawDataStr; // This line was the issue, should only append if not already part of buffer reset
//             }
//             // No, this is simpler: if foundStartMarker, all subsequent data in this chunk is part of the command output
//             // The issue was that ac.buffer was reset, then rawDataStr was appended to ac.output again.
//             // Corrected logic:
//             // If foundStartMarker is true, it means the current rawDataStr is part of the command's output
//             // (or contains the end marker).
//             // The ac.output has already been initialized with the post-START_MARKER part of the *first* chunk
//             // that contained the START_MARKER. For *subsequent* chunks, rawDataStr should be appended.
//             // This logic is tricky with the buffer reset. Let's rethink ac.output accumulation.
//             // ac.output should accumulate everything *after* START_MARKER across all chunks.
//             // A simpler way:
//             // Only add to ac.output if ac.foundStartMarker is true.
//             // The initial part of ac.output (after START_MARKER) is handled when foundStartMarker becomes true.
//             // Subsequent full chunks are simply appended.
//             // This happens implicitly if we just let ac.buffer accumulate and then parse ac.output from it
//             // *after* the END_MARKER is found.
//             // Let's use the buffer approach for accumulation and parse output once END_MARKER is confirmed.
//         }

//         const endMarkerIndexInBuffer = ac.buffer.indexOf(ac.END_MARKER);
//         if (endMarkerIndexInBuffer !== -1) {
//             // Extract the part of the buffer that contains the command output (between markers)
//             // This needs to be from the point *after* START_MARKER in the *overall accumulated data*.
//             // The ac.foundStartMarker logic correctly initializes ac.output.
//             // What we need here is to ensure ac.output is the complete output up to END_MARKER.
            
//             // Let's assume ac.output has been accumulating correctly since START_MARKER.
//             // We need to find END_MARKER within the *currently known ac.output*.
//             const endMarkerInOutput = ac.output.indexOf(ac.END_MARKER);
//             if (endMarkerInOutput !== -1) {
//                 const afterEndMarkerContent = ac.output.substring(endMarkerInOutput + ac.END_MARKER.length);
//                 const exitCodeMatch = afterEndMarkerContent.match(/exit_code:(\d+)/); // Regex allows for whitespace before exit_code:

//                 if (exitCodeMatch) {
//                     ac.active = false;
//                     const exitCode = parseInt(exitCodeMatch[1], 10);
//                     // Final captured output is from start of ac.output up to the END_MARKER
//                     ac.output = ac.output.substring(0, endMarkerInOutput); 

//                     console.log(`[Main] Command for tab ${tabId} finished. Exit Code: ${exitCode}`);
//                     // console.log(`[Main] Captured Output for tab ${tabId}: ${ac.output}`);

//                     if (exitCode !== 0) {
//                         triggerAIDiagnosis(tabId, ac.command, ac.output, exitCode, ac.webContents);
//                     }
//                     tabSessions[tabId].analyzingCommand = null; // Clear analysis state
//                     // No need to reset ac.buffer here, it's part of ac which is nulled.
//                 }
//             }
//         }
//         // If end marker not found yet, or exit code not found yet, keep buffering in ac.buffer.
//         // The ac.output is built progressively.
//     }
// });
// The above conceptual placement needs to be integrated into the actual stream.on('data')
// within manageSshConnection's client.shell callback.

// ...

// IPC Handler for terminal resize
ipcMain.on('terminal-resize', (event, { tabId, cols, rows }) => {
    if (!tabId || !tabSessions[tabId]) {
        // console.error(`terminal-resize received for invalid tabId: ${tabId}`);
        return;
    }
    const { sshStream } = tabSessions[tabId];
    if (sshStream && typeof sshStream.setWindow === 'function') {
        sshStream.setWindow(rows, cols, 0, 0); 
        // console.log(`Resized PTY on server for tabId ${tabId} to ${cols}x${rows}`);
    }
});

app.whenReady().then(() => {
  createWindow();

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') {
    // Clean up all active sessions on global window close
    Object.keys(tabSessions).forEach(tabId => {
        cleanupSshConnection(tabId);
    });
    app.quit();
  }
});

// --- Application Menu for Shortcuts ---
const menuTemplate = [
    // { role: 'appMenu' } // on macOS
    ...(process.platform === 'darwin' ? [{
        label: app.name,
        submenu: [
            { role: 'about' },
            { type: 'separator' },
            { role: 'services' },
            { type: 'separator' },
            { role: 'hide' },
            { role: 'hideOthers' },
            { role: 'unhide' },
            { type: 'separator' },
            { role: 'quit' }
        ]
    }] : []),
    {
        label: 'File',
        submenu: [
            {
                label: 'New Tab',
                accelerator: 'CommandOrControl+T',
                click: () => {
                    if (mainWindow && !mainWindow.isDestroyed()) {
                        mainWindow.webContents.send('shortcut-new-tab');
                    }
                }
            },
            {
                label: 'Close Tab',
                accelerator: 'CommandOrControl+W',
                click: () => {
                    if (mainWindow && !mainWindow.isDestroyed()) {
                        mainWindow.webContents.send('shortcut-close-tab');
                    }
                }
            },
            process.platform === 'darwin' ? { role: 'close' } : { role: 'quit' }
        ]
    },
    {
        label: 'Edit',
        submenu: [
            { role: 'undo' },
            { role: 'redo' },
            { type: 'separator' },
            { role: 'cut' },
            { role: 'copy' },
            { role: 'paste' },
            ...(process.platform === 'darwin' ? [
                { role: 'pasteAndMatchStyle' },
                { role: 'delete' },
                { role: 'selectAll' },
                { type: 'separator' },
                {
                    label: 'Speech',
                    submenu: [
                        { role: 'startSpeaking' },
                        { role: 'stopSpeaking' }
                    ]
                }
            ] : [
                { role: 'delete' },
                { type: 'separator' },
                { role: 'selectAll' }
            ])
        ]
    },
    {
        label: 'View',
        submenu: [
            { role: 'reload' },
            { role: 'forceReload' },
            { role: 'toggleDevTools' },
            { type: 'separator' },
            { role: 'resetZoom' },
            { role: 'zoomIn' },
            { role: 'zoomOut' },
            { type: 'separator' },
            { role: 'togglefullscreen' }
        ]
    },
    {
        label: 'Window',
        submenu: [
            { role: 'minimize' },
            { role: 'zoom' },
            { type: 'separator' },
            {
                label: 'Next Tab',
                accelerator: 'Control+Tab', // Standard across platforms for tab switching
                click: () => {
                    if (mainWindow && !mainWindow.isDestroyed()) {
                        mainWindow.webContents.send('shortcut-next-tab');
                    }
                }
            },
            {
                label: 'Previous Tab',
                accelerator: 'Control+Shift+Tab', // Standard across platforms
                click: () => {
                    if (mainWindow && !mainWindow.isDestroyed()) {
                        mainWindow.webContents.send('shortcut-previous-tab');
                    }
                }
            },
            ...(process.platform === 'darwin' ? [
                { type: 'separator' },
                { role: 'front' },
                { type: 'separator' },
                { role: 'window' }
            ] : [
                { role: 'close' } // On Windows/Linux, 'Close Tab' is in File, 'Close Window' could be here or also File.
                                  // For simplicity, CommandOrControl+W closes tab. Alt+F4 / Ctrl+Q closes window.
            ])
        ]
    },
    {
        role: 'help',
        submenu: [
            {
                label: 'Learn More',
                click: async () => {
                    const { shell } = require('electron');
                    await shell.openExternal('https://electronjs.org');
                }
            }
        ]
    }
];

app.whenReady().then(() => {
    // Build and set the application menu
    const menu = Menu.buildFromTemplate(menuTemplate);
    Menu.setApplicationMenu(menu);

    createWindow(); // Existing createWindow call

    // Global shortcuts (if any were needed beyond menu, but we are using menu)
    // app.on('will-quit', () => {
    //     globalShortcut.unregisterAll();
    // });

    app.on('activate', function () {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
});

// --- API Key Management IPC Handlers ---
const API_KEY_SERVICE = 'AI-SSH-Client-APIKey';
const API_KEY_ACCOUNT = 'user-api-key';

ipcMain.handle('save-api-key', async (event, apiKey) => {
    try {
        await keytar.setPassword(API_KEY_SERVICE, API_KEY_ACCOUNT, apiKey);
        console.log('API Key saved successfully.');
        return { success: true };
    } catch (error) {
        console.error('Failed to save API key:', error);
        return { success: false, error: error.message };
    }
});

ipcMain.handle('get-api-key', async () => {
    try {
        const apiKey = await keytar.getPassword(API_KEY_SERVICE, API_KEY_ACCOUNT);
        return apiKey; // Returns key or null
    } catch (error) {
        console.error('Failed to retrieve API key:', error);
        return null; // Treat errors as key not being available
    }
});

ipcMain.handle('clear-api-key', async () => {
    try {
        const success = await keytar.deletePassword(API_KEY_SERVICE, API_KEY_ACCOUNT);
        if (success) {
            console.log('API Key cleared successfully.');
            return { success: true };
        } else {
            // This case might indicate the key didn't exist, which is still a "successful" clear
            console.log('API Key not found or failed to clear (deletePassword returned false).');
            return { success: true, message: 'API Key was not set or already cleared.' };
        }
    } catch (error) {
        console.error('Failed to clear API key:', error);
        return { success: false, error: error.message };
    }
});
