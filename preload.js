// This file runs in a privileged environment with Node.js APIs available.
// It's used to securely expose specific APIs to the renderer process.
// This file runs in a privileged environment with Node.js APIs available.
// It's used to securely expose specific APIs to the renderer process.

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // Terminal Data
  sendTerminalData: (payload) // { tabId, data }
    => ipcRenderer.send('terminal-data', payload),
  handleTerminalData: (callback) => { // callback receives { tabId, data }
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on('terminal-data-reply', handler);
    return () => ipcRenderer.removeListener('terminal-data-reply', handler);
  },

  // Terminal Resize
  sendTerminalResize: (payload) // { tabId, cols, rows }
    => ipcRenderer.send('terminal-resize', payload),

  // SSH Connection Management
  connectSsh: (payload) // { sessionDetails, tabId }
    => ipcRenderer.send('connect-ssh', payload),
  disconnectSsh: (tabId) // New
    => ipcRenderer.send('disconnect-ssh', tabId),

  // Listeners for SSH events - callbacks will receive { tabId, message/data }
  onSshStatus: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on('ssh-status', handler);
    return () => ipcRenderer.removeListener('ssh-status', handler);
  },
  onSshConnected: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on('ssh-connected', handler);
    return () => ipcRenderer.removeListener('ssh-connected', handler);
  },
  onSshError: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on('ssh-error', handler);
    return () => ipcRenderer.removeListener('ssh-error', handler);
  },
  onSshDisconnect: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on('ssh-disconnect', handler);
    return () => ipcRenderer.removeListener('ssh-disconnect', handler);
  },
  onSshShellReady: (callback) => { // callback receives { tabId }
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on('ssh-shell-ready', handler);
    return () => ipcRenderer.removeListener('ssh-shell-ready', handler);
  },

  // Keyboard Shortcut Listeners
  onNewTabShortcut: (callback) => {
    ipcRenderer.on('shortcut-new-tab', () => callback());
    return () => ipcRenderer.removeAllListeners('shortcut-new-tab');
  },
  onCloseTabShortcut: (callback) => {
    ipcRenderer.on('shortcut-close-tab', () => callback());
    return () => ipcRenderer.removeAllListeners('shortcut-close-tab');
  },
  onNextTabShortcut: (callback) => {
    ipcRenderer.on('shortcut-next-tab', () => callback());
    return () => ipcRenderer.removeAllListeners('shortcut-next-tab');
  },
  onPreviousTabShortcut: (callback) => {
    ipcRenderer.on('shortcut-previous-tab', () => callback());
    return () => ipcRenderer.removeAllListeners('shortcut-previous-tab');
  },

  // API Key Management
  saveApiKey: (apiKey) => ipcRenderer.invoke('save-api-key', apiKey),
  getApiKey: () => ipcRenderer.invoke('get-api-key'),
  clearApiKey: () => ipcRenderer.invoke('clear-api-key'),

  // AI Command Generation
  generateShellCommand: (payload) => ipcRenderer.send('generate-shell-command', payload), // Use send for fire-and-forget to start stream
  onAiCommandStreamChunk: (callback) => {
    ipcRenderer.on('ai-command-stream-chunk', (_event, data) => callback(data));
    return () => ipcRenderer.removeAllListeners('ai-command-stream-chunk');
  },
  onAiCommandStreamEnd: (callback) => {
    ipcRenderer.on('ai-command-stream-end', (_event, data) => callback(data));
    return () => ipcRenderer.removeAllListeners('ai-command-stream-end');
  },
  onAiCommandError: (callback) => {
    ipcRenderer.on('ai-command-error', (_event, data) => callback(data));
    return () => ipcRenderer.removeAllListeners('ai-command-error');
  },

  // SSH Context Update Listener
  onSshContextUpdate: (callback) => { // callback receives { tabId, context }
    ipcRenderer.on('ssh-context-update', (_event, data) => callback(data));
    return () => ipcRenderer.removeAllListeners('ssh-context-update');
  },

  // Task Templates
  getTaskTemplates: (tabId) => ipcRenderer.invoke('get-task-templates', tabId),
  // getTemplateCommands: (payload) => ipcRenderer.invoke('get-template-commands', payload) // If chosen to implement

  // AI Error Diagnosis
  executeAiCommand: (payload) => ipcRenderer.send('execute-ai-command', payload), // { tabId, command }
  onAiDiagnosisStreamChunk: (callback) => {
    ipcRenderer.on('ai-diagnosis-stream-chunk', (_event, data) => callback(data)); // data: { tabId, chunk }
    return () => ipcRenderer.removeAllListeners('ai-diagnosis-stream-chunk');
  },
  onAiDiagnosisStreamEnd: (callback) => {
    ipcRenderer.on('ai-diagnosis-stream-end', (_event, data) => callback(data)); // data: { tabId, fullDiagnosis }
    return () => ipcRenderer.removeAllListeners('ai-diagnosis-stream-end');
  },
  onAiDiagnosisError: (callback) => {
    ipcRenderer.on('ai-diagnosis-error', (_event, data) => callback(data)); // data: { tabId, error }
    return () => ipcRenderer.removeAllListeners('ai-diagnosis-error');
  },

  // Session Password Deletion
  deleteSessionPassword: (keytarAccountRef) => ipcRenderer.invoke('delete-session-password', keytarAccountRef)
});

console.log('Preload script (multi-tab, shortcuts, API key mgmt, AI cmd gen, context, tasks, AI diagnosis, session pass delete) loaded and electronAPI exposed.');
