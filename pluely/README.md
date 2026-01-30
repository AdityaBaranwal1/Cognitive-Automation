# Auto-Vision 🚀

> **Cognitive Automation & AI Workflow Engineering** - A visual programming tool for building automated intelligence pipelines with AI integration.

[![Open Source](https://img.shields.io/badge/Open%20Source-❤️-blue)](https://github.com/AdityaBaranwal1/Cognitive-Automation)
[![Tauri](https://img.shields.io/badge/Built%20with-Tauri-orange)](https://tauri.app/)
[![React](https://img.shields.io/badge/Frontend-React%20%2B%20TypeScript-blue)](https://reactjs.org/)
[![License](https://img.shields.io/badge/License-GPL%20v3-blue.svg)](LICENSE)

---

## 🎯 What is Auto-Vision?

Auto-Vision is a **desktop application** for building visual automation workflows powered by AI. Think of it as a "workflow builder meets AI assistant" - create automated sequences that:

- 📸 **Capture screenshots** and screen regions
- 🤖 **Process with AI** using any LLM provider (OpenAI, Claude, local models)
- ⌨️ **Await user input** with customizable hotkeys
- ✍️ **Execute actions** like typing text or triggering sub-workflows

**Perfect for:**
- 🔬 Deep work and focused productivity
- 🔄 Repetitive task automation
- 🧠 AI-assisted workflow engineering
- 📊 Visual programming pipelines

---

## ⚡ Features

### Visual Workflow Builder
Create automation workflows with a node-based visual editor. Connect steps, define triggers, and build complex pipelines without code.

### Multi-Provider AI Integration
Connect to any AI provider using simple configuration:
- OpenAI GPT-4, Claude, Google Gemini
- Local models via Ollama or LM Studio
- Custom endpoints with full streaming support

### Global Hotkeys
Trigger workflows from anywhere with customizable keyboard shortcuts. The app stays invisible while you work.

### Speech-to-Text
Record voice input and convert to text using multiple STT providers. Hands-free interaction with your automation.

### Screenshot Capture
Capture full screen or selected regions. Process images with vision-capable AI models.

### Cross-Platform
Built with Tauri for native performance on Windows, macOS, and Linux.

---

## 📋 Prerequisites & Dependencies

Before installing, ensure you have the required system dependencies:

👉 **[Tauri Prerequisites](https://v2.tauri.app/start/prerequisites/)**

### Quick Start

```bash
# Clone the repository
git clone https://github.com/AdityaBaranwal1/Cognitive-Automation.git
cd Cognitive-Automation/pluely

# Install dependencies
npm install

# Start development server
npm run tauri dev
```

### Build for Production

```bash
npm run tauri build
```

This creates platform-specific installers in `src-tauri/target/release/bundle/`.

---

## 🏗️ Architecture

| Component | Technology |
|-----------|------------|
| **Desktop Runtime** | Tauri v2 (Rust) |
| **Frontend** | React + TypeScript |
| **Visual Editor** | React Flow |
| **Database** | SQLite (local) |
| **Shortcuts** | tauri-plugin-global-shortcut |

---

## 📁 Project Structure

```
src/                    # React frontend
├── components/         # Shared UI components
├── pages/              # Application pages
├── hooks/              # Custom React hooks
├── lib/                # Utilities and database
└── config/             # App configuration

src-tauri/              # Rust backend
├── src/
│   ├── lib.rs          # Main Tauri setup
│   ├── shortcuts.rs    # Global shortcut handling
│   ├── capture.rs      # Screenshot capture
│   ├── input.rs        # Keyboard/mouse input
│   └── speaker/        # Audio capture (per-platform)
└── Cargo.toml          # Rust dependencies
```

---

## 🤝 Contributing

1. **Fork** the repository
2. **Create** a feature branch (`git checkout -b feature/amazing-feature`)
3. **Commit** your changes (`git commit -m 'Add amazing feature'`)
4. **Push** to the branch (`git push origin feature/amazing-feature`)
5. **Open** a Pull Request

---

## 📄 License

This project is licensed under the **GNU General Public License v3.0** - see the [LICENSE](LICENSE) file for details.

---

## 🔗 Links

- **Repository**: [GitHub](https://github.com/AdityaBaranwal1/Cognitive-Automation)
- **Issues**: [GitHub Issues](https://github.com/AdityaBaranwal1/Cognitive-Automation/issues)

---

**Made by [Aditya Baranwal](https://github.com/AdityaBaranwal1)**
