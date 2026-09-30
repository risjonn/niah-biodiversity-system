# Smart Ground-Truthing and Digital Biodiversity System

A digital ground-truthing and biodiversity management platform for Niah National Park,
built for Sarawak Forestry Corporation (SFC) and NeuonAI. COS30049 group project.

## Project structure

- `mobile-app/` — React Native + Expo app (botanist field registration, guest QR-scan mode)
- `web-app/` — React + Vite + Material UI app (officer dashboard, species knowledge base)
- `database/` — Supabase schema, migrations, and seed data
- `iot-firmware/` — ESP32 sensor code for plant protection monitoring
- `docs/` — design system, proposal, and other project documentation

## Prerequisites

- **Node.js**: v24.x (LTS). Download from [nodejs.org](https://nodejs.org), pick the LTS version.
  Check your version with `node -v` after installing.
- **Git** and a **GitHub account** with access to this repo
- **VS Code** (recommended) or any code editor
- **Expo Go** app on your phone (from the App Store or Play Store), for testing the mobile app
- A free **Expo account** ([expo.dev/signup](https://expo.dev/signup)), you'll need to be logged
  in on both your computer and the Expo Go app to run the mobile app

### Windows-specific notes

- **Avoid OneDrive-synced folders.** Clone this repo somewhere outside OneDrive (e.g. directly
  on `D:\` or `C:\Projects\`), OneDrive syncing `node_modules` in real time causes slow installs
  and file-lock errors.
- **PowerShell script execution may be blocked by default.** If `npm -v` gives a
  "running scripts is disabled" error, run this once:
```powershell
  Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned
```

## Getting started

1. Clone the repo:
```bash
   git clone https://github.com/risjonn/niah-biodiversity-system.git
   cd niah-biodiversity-system
```

2. Pick the app you're working on and install its dependencies:
```bash
   cd web-app        # or mobile-app
   npm install
```

3. Set up environment variables. Copy the example file and fill in the real values
   (ask Haris for the Supabase URL and publishable key):
```bash
   cp .env.example .env
```
   
4. Run the app:
   - **Web app**: `npm run dev`, then open the local URL shown in the terminal
   - **Mobile app**: `npx expo start`, then scan the QR code with Expo Go
     (make sure you're logged into the same Expo account on both your computer and your phone,
     run `npx expo login` on your computer if prompted)

## Adding new packages

- **Web app**: `npm install <package-name>`
- **Mobile app**: `npx expo install <package-name>` (not plain `npm install`, this ensures
  the version installed is compatible with our Expo SDK version)

## Branching workflow

- `main` is protected, all changes go through a pull request, direct pushes are blocked
- Branch naming: `feature/task-name` for new features, `fix/task-name` for bug fixes,
  `docs/task-name` for documentation
- After your Pull Requests is merged, delete the branch, then run:
```bash
  git checkout main
  git pull
```
  before starting your next piece of work

## Tech stack

- **Mobile**: React Native + Expo (JavaScript)
- **Web**: React + Vite + Material UI (JavaScript)
- **Backend**: Supabase (Postgres database, authentication, storage, real-time, Edge Functions)
- **IoT**: ESP32 microcontrollers with environmental sensors (IoT team can double check again later)