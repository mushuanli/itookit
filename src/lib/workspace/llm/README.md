
# LLMWorkspace - The Complete Chat Application UI

**LLMWorkspace** is a powerful, self-contained library that combines `@llm-kit/sidebar` and `@llm-kit/chat-ui` to provide a complete, feature-rich chat application interface out of the box.

It acts as an intelligent orchestrator, handling session management, chat interaction, and data persistence, allowing you to build a production-ready AI chat application with minimal setup. This component follows a **"Bring Your Own Layout"** philosophy, giving you full control over your application's structure.

## ✨ Features

-   **Flexible Layout**: Integrates seamlessly into any existing page layout. You provide the containers, `LLMWorkspace` populates them.
-   **Seamless Integration**: A perfect marriage of a hierarchical session manager and a state-of-the-art chat interface.
-   **Persistent Sessions**: All conversations are automatically saved (defaulting to LocalStorage) and restored on page load.
-   **Encapsulated Logic**: All the complex "wiring" between the two components is handled internally. You interact with a single, clean API.
-   **Configuration Driven**: Deeply customize the behavior of both the sidebar and the chat UI through a single configuration object.
-   **Independent & Reusable**: Can be instantiated multiple times on a single page, perfect for complex dashboard applications.

---

## 🚀 Quick Start

### 1. HTML Setup

You need to create separate container elements for the sidebar and the chat area. You are responsible for styling their layout (e.g., using Flexbox, Grid, etc.).

```html
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>My LLM Workspace</title>
    <!-- CSS for the child components -->
    
    <!-- Icons are used by both libraries -->
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/5.15.4/css/all.min.css">
    
    <style>
        html, body { height: 100vh; margin: 0; overflow: hidden; font-family: sans-serif; }
        .app-layout {
            display: flex;
            height: 100%;
        }
        #sidebar {
            width: 320px;
            flex-shrink: 0;
            border-right: 1px solid #e5e7eb;
        }
        #chat-area {
            flex-grow: 1;
        }
    </style>
</head>
<body>
    <div class="app-layout">
        <aside id="sidebar"></aside>
        <main id="chat-area"></main>
    </div>
    <script type="module" src="main.js"></script>
</body>
</html>
```

### 2. JavaScript Initialization

In your `main.js`, import the factory function, get your containers, and initialize the workspace.

```javascript
// main.js
import { createLLMWorkspace } from './workspace/llm/index.js';

const sidebarContainer = document.getElementById('sidebar');
const chatContainer = document.getElementById('chat-area');

// 1. Create the workspace instance with configuration
const workspace = createLLMWorkspace({
    // Provide the containers
    sidebarContainer: sidebarContainer,
    chatContainer: chatContainer,

    // Configuration for the Chat UI
    chatUIConfig: {
        // This part is required to connect to an LLM
        clientConfig: {
            provider: 'openai',
            apiKey: 'YOUR_OPENAI_API_KEY',
            model: 'gpt-4o',
        },
        // You can also configure the input and history components
        inputUIConfig: {
            // ... see @llm-kit/chat-ui docs
        },
        historyUIConfig: {
            // ... see @llm-kit/history-ui docs
        }
    },
    // Configuration for the Sidebar
    sidebarConfig: {
        storagePrefix: 'my-awesome-chat-app' // To avoid LocalStorage conflicts
    }
});

// 2. Start the application
workspace.start();

// You can now interact with the workspace via its public API
// For example, add a button to create a new chat:
// document.getElementById('new-chat-btn').onclick = () => {
//     workspace.createNewSession();
// };
```

---

## 📚 API Reference

### `createLLMWorkspace(options)`

This is the main factory function.

-   `options` (`Object`): The configuration object.
    -   `sidebarContainer` (`HTMLElement`, **Required**): The DOM element for the session sidebar.
    -   `chatContainer` (`HTMLElement`, **Required**): The DOM element for the chat interface.
    -   `chatUIConfig` (`Object`, **Required**): Configuration passed to `LLMChatUI`.
        -   `clientConfig` (`Object`, **Required**): Config for `@llm-kit/core` `LLMClient`.
    -   `sidebarConfig` (`Object`, Optional): Configuration passed to the sidebar.

### Workspace Instance Methods

-   `workspace.start()`: `async` - Initializes the workspace and loads all session data.
-   `workspace.createNewSession(options)`: `async` - Creates a new, empty chat session.
-   `workspace.destroy()`: Cleans up all components and event listeners.
