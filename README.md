# UI Gen AI — VS Code Extension

Generate production-ready React UI code from natural language prompts, with full project management, AI generation, live preview, and deployment tracking — all inside VS Code.

## Prerequisites

| Requirement | Version                                                             |
| ----------- | ------------------------------------------------------------------- |
| VS Code     | `≥ 1.85.0`                                                          |
| Node.js     | `≥ 18`                                                              |
| Backend API | [`ai-idea-api`](../ai-idea-api/) running at `http://localhost:3000` |

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Compile
npm run compile

# 3. Launch Extension Development Host
#    Press F5 in VS Code (or Run → Start Debugging)
```

The extension will appear as a **UI Gen AI** icon in the Activity Bar.

## Project Structure

```
src/
├── extension.ts              # Activation entry point, command registration, OAuth handler
├── api/                      # HTTP API layer (Axios)
│   ├── client.ts             # Axios instance with auth interceptor
│   ├── auth.api.ts           # Login, register, refresh, logout, getMe
│   ├── projects.api.ts       # CRUD projects
│   ├── apis.api.ts           # CRUD APIs
│   ├── apiConfigs.api.ts     # CRUD API configs (key/value)
│   ├── documents.api.ts      # Upload & manage documents
│   ├── sessions.api.ts       # Generation sessions
│   ├── generate.api.ts       # AI code generation endpoint
│   ├── generatedCodes.api.ts # View/manage generated code
│   ├── uiSchemas.api.ts      # UI Schema CRUD
│   └── deployments.api.ts    # Deployment management
├── auth/
│   ├── authManager.ts        # Token storage (SecretStorage), auth state
│   └── loginWebview.ts       # Login/Register panel with OAuth buttons
├── commands/
│   ├── generateCommand.ts    # AI generation + live preview panel
│   ├── projectCommands.ts    # Create/edit/delete projects
│   ├── apiCommands.ts        # Create/edit/delete APIs
│   ├── apiConfigCommands.ts  # Create/edit/delete API configs
│   ├── documentCommands.ts   # Upload documents
│   ├── sessionCommands.ts    # Run generation sessions
│   ├── generatedCodeCommands.ts # View/apply/preview/delete generated code
│   ├── uiSchemaCommands.ts   # Create/edit/delete UI schemas
│   └── deploymentCommands.ts # Create deployment + update status
└── sidebar/
    └── DashboardProvider.ts  # Webview sidebar — main dashboard UI
```

## Features

### 1. Authentication

- **Email/Password** — Register or sign in with email
- **OAuth** — Google and GitHub sign-in via browser redirect
- Tokens stored securely in VS Code's `SecretStorage`

### 2. Project Management

- Create, edit, delete projects from the sidebar
- Each project can have documents, sessions, and deployments

### 3. Document Upload

- Upload design docs, requirements, or reference files
- Supports paste from clipboard, active editor, or file picker
- Types: `requirement`, `design`, `reference`, `other`

### 4. API Management

- Create APIs with name, method, endpoint, base URL
- Attach **API Configs** (key/value pairs, with secret support)
- Attach **UI Schemas** (JSON) defining the UI structure

### 5. AI Code Generation

- Describe your UI in natural language
- Choose AI provider (Gemini / OpenAI) and model
- Optionally link to an API to save generated code
- **Live Preview** — renders generated JSX/TSX/HTML in a webview with responsive viewport (Mobile / Tablet / Desktop)

### 6. Generated Code Management

- View generated code in editor or **Live Preview**
- Apply files to workspace with one click
- Copy to clipboard, delete, or apply individual files

### 7. Generation Sessions

- Run sessions with customizable provider, model, framework, and CSS library
- Track session history per project

### 8. Deployment Tracking

- Create deployments with URL and platform
- Update deployment status

## Available Commands

Open Command Palette (`Ctrl+Shift+P`) and type `UI Gen AI`:

| Command                             | Description                                  |
| ----------------------------------- | -------------------------------------------- |
| `UI Gen AI: Login / Register`       | Open login/register panel                    |
| `UI Gen AI: Logout`                 | Clear tokens and sign out                    |
| `UI Gen AI: Generate Code`          | AI-powered code generation with live preview |
| `UI Gen AI: Set Server URL`         | Change backend API URL                       |
| `UI Gen AI: Create Project`         | Create a new project                         |
| `UI Gen AI: Create API`             | Create a new API entry                       |
| `UI Gen AI: Upload Document`        | Upload a document to a project               |
| `UI Gen AI: Run Generation Session` | Start an AI generation session               |
| `UI Gen AI: Create Deployment`      | Create a deployment record                   |
| `Refresh`                           | Refresh the sidebar dashboard                |

## Configuration

Settings can be changed in VS Code Settings (`Ctrl+,`) under **UI Gen AI**:

| Setting                   | Default                 | Description                                |
| ------------------------- | ----------------------- | ------------------------------------------ |
| `uigenai.serverUrl`       | `http://localhost:3000` | Backend API server URL                     |
| `uigenai.defaultProvider` | `gemini`                | Default AI provider (`gemini` or `openai`) |
| `uigenai.defaultModel`    | `gemini-2.0-flash`      | Default AI model name                      |

## OAuth Setup

For Google/GitHub OAuth to work with the extension, the backend needs:

```env
# In ai-idea-api/.env
FRONTEND_REDIRECT_URL="vscode://ui-gen-ai.ui-gen-ai/auth-callback"
```

Flow: Extension opens browser → OAuth provider → Backend callback → Redirect to `vscode://` URI → Extension receives tokens.

## Development

```bash
# Watch mode (auto-rebuild on save)
npm run watch

# Then press F5 to launch Extension Development Host
# Changes rebuild automatically — reload the window (Ctrl+R) to pick them up
```

## Build & Package

```bash
# Compile for production
npm run compile

# Package as .vsix (requires vsce)
npx @vscode/vsce package
```

## Tech Stack

- **TypeScript** 5.3+ with strict mode
- **esbuild** for fast bundling
- **Axios** for HTTP with auth interceptor
- **VS Code Webview API** for sidebar dashboard, login panel, and live preview
- **VS Code SecretStorage** for secure token storage

## License

ISC
