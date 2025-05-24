AI SSH Client
A cross-platform SSH terminal client packed with AI-powered features to streamline your command-line operations. Built with Electron and Node.js, it offers robust session management, a modern multi-tab terminal experience, and intelligent tools to translate natural language into shell commands, diagnose errors, and execute common tasks.

Features
SSH Session Management
Comprehensive CRUD: Create, save, edit, and delete SSH session configurations.
Flexible Authentication: Supports both password and SSH key-based authentication.
Secure Password Storage: Leverages the system keychain (via keytar) for encrypting and storing sensitive passwords.
Efficient Organization: Store session details locally using lowdb (JSON file). Includes session grouping and a quick search filter.
Batch Operations: Select and delete multiple sessions at once.
Modern Terminal Experience
High-Performance Terminal: Integrated with xterm.js for a responsive and smooth terminal emulation experience.
Multi-Tab Interface: Manage multiple independent SSH sessions within a single window using tabs.
Informative Status Bar: Displays current connection status, active session name, and the detected OS of the remote server.
Keyboard Shortcuts:
CmdOrCtrl+T: Open a new tab.
CmdOrCtrl+W: Close the current tab.
Ctrl+Tab: Switch to the next tab.
Ctrl+Shift+Tab: Switch to the previous tab.
AI-Powered Operations
Natural Language to Shell Command: Type commands in plain English (e.g., "show me all running docker containers"), and the AI translates them into appropriate shell commands. Suggestions are streamed in real-time.
Contextual Awareness: The AI considers the detected operating system of the remote server (Linux, macOS, Windows via bash) to provide more accurate command suggestions.
AI-Driven Error Diagnosis: If a command executed via the natural language interface fails, the application automatically sends the command, its output, and exit code to an AI for analysis. The diagnosis and suggested solutions are then streamed back to you.
Smart Task Templates: A library of predefined common tasks (e.g., "Install Nginx," "Create New User"). These templates are OS-aware, can prompt for necessary parameters, and then execute the required command sequences.
Local Caching: Natural language to shell command translations are cached locally to speed up responses for frequently used queries and reduce API calls.
Secure API Key Management: Your API key for the AI service (OpenAI-compatible, e.g., DeepSeek) is stored securely in the system keychain.
Tech Stack
Electron: For building the cross-platform desktop application.
Node.js: As the runtime environment.
Xterm.js: For the integrated terminal emulator.
ssh2: For handling SSH connections.
lowdb: For local JSON database (session configurations, AI cache).
keytar: For secure credential management (session passwords, AI API key).
AI Provider: Designed for OpenAI-compatible APIs like DeepSeek.
Axios: For making HTTP requests to AI services.
Prerequisites (For Development)
Node.js (v16+ recommended) and npm (or yarn).
Git.
A C++ compiler, Python, and other build tools might be required for node-gyp to build native Node.js modules (like keytar, node-pty). Most systems set these up automatically, or your OS package manager can install them (e.g., build-essential on Debian/Ubuntu, Xcode Command Line Tools on macOS, Visual Studio Build Tools on Windows).
Getting Started / Development Setup
Clone the repository:
git clone <repository-url>
cd <repository-name>
Install dependencies:
npm install
# OR
yarn install
Run in development mode:
npm start
# OR
yarn start
Building for Production
The application uses electron-builder to create distributable packages.

Place Icons (Required):

Create a directory named build_resources in the project root.
Add your application icons:
build_resources/icon.ico: For Windows (256x256 recommended).
build_resources/icon.icns: For macOS (Apple ICNS format).
build_resources/icons/: For Linux, a directory containing PNG icons of various sizes (e.g., 32x32.png, 64x64.png, 128x128.png, 256x256.png, 512x512.png).
Run Build Scripts:

To test an unpacked version for your current OS:
npm run pack
To build distributables for your current OS:
npm run dist
To build for specific platforms (cross-compilation may have limitations):
npm run dist:win  # For Windows
npm run dist:mac  # For macOS
npm run dist:linux # For Linux
Packaged application(s) will be found in the dist/ directory.
Usage Guide
SSH Sessions:

Click "Add New Session" in the sidebar.
Fill in the session details (name, host, user, port, authentication type).
For password authentication, the password will be stored in your system's keychain.
For key authentication, provide the path to your private SSH key.
Click "Connect" on a saved session to open it in the active tab (or a new tab).
AI API Key:

Locate the "AI Settings" section in the sidebar.
Click "Set AI API Key," enter your key for an OpenAI-compatible service (like DeepSeek), and click "Save API Key." The key is stored securely in your system's keychain.
The status ("API Key: Set" or "API Key: Not Set") will be displayed.
Natural Language Commands:

Once connected in a tab, an input field will appear below the terminal: "Enter natural language command..."
Type your desired action (e.g., "list files sorted by size," "what's my current IP address").
Click "Generate Command" (or press Enter). The AI's suggested shell command will stream into the suggestion box below.
If you're satisfied, click "Execute" to run the command in the active terminal.
Error Diagnosis:

If a command executed via the "Natural Language" feature (using the "Execute" button) fails (returns a non-zero exit code), the application will automatically send the command, its output, and the exit code to the AI for analysis.
The AI's diagnosis and suggestions will be streamed into the AI suggestion box.
Smart Tasks:

In the sidebar, find the "Smart Tasks" section.
Select a task from the dropdown (e.g., "Install Nginx (Debian/Ubuntu)"). Tasks are filtered by the detected OS of the connected server.
If the task requires parameters (e.g., a username for "Create New User"), input fields will appear.
The commands to be executed will be previewed.
Click "Execute Task Commands" to run them in the active terminal.
Screenshots
Contributing
Contributions, bug reports, and feature requests are welcome! Please feel free to open an issue or submit a pull request.

License
This project is MIT Licensed.
