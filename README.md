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

3. Set up environment variables. Each app has its own `.env.example` file
   (`web-app/.env.example` and `mobile-app/.env.example`), with different
   variable names for each platform. From inside whichever app folder you're
   working in (from step 2), run the command below to create your own `.env` file, then
   open it and fill in the real values (ask Haris for the Supabase URL and
   publishable key):

```bash
   cp .env.example .env
```

4. Run the app. **Make sure you're inside the right folder first** (`web-app` or
   `mobile-app`, not the repo root), you can check where you are with `pwd`. If
   you're not in the right place, use `cd web-app` or `cd mobile-app` (add `cd ..`
   first if you need to go up a level before going into the other folder).
   - **Web app**: `npm run dev`, then open the local URL shown in the terminal
   - **Mobile app**: `npx expo start`, then scan the QR code with Expo Go
     (make sure you're logged into the same Expo account on both your computer and your phone,
     run `npx expo login` on your computer if prompted)

## Adding new packages

- **Web app**: `npm install <package-name>`
- **Mobile app**: `npx expo install <package-name>` (not plain `npm install`, this ensures
  the version installed is compatible with our Expo SDK version)

## Design system

Shared colours, typography, and spacing tokens for both apps are documented in
[`docs/design-system.md`](docs/design-system.md). Don't hardcode colours, fonts,
or spacing values in components, import from `theme/theme.js` instead.

## Shared patterns already built

Before building a new screen, check these existing pieces first, don't duplicate them:

- **Auth & protected routes**: `mobile-app/src/context/AuthContext.js` +
  `RootNavigator.js` (mobile), `web-app/src/context/AuthContext.jsx` +
  `ProtectedRoute.jsx` (web). Role-based routing pattern is already working,
  follow it rather than reinventing.
- **Layouts (web)**: `AppLayout` (nav bar, logged-in pages) and `AuthLayout`
  (login page) in `web-app/src/layouts/`
- **Shared components (mobile)**: `TextInput` and `HeaderIconButton` in
  `mobile-app/src/components/`, use these instead of raw React Native inputs
  or text-based header buttons
- **Web components**: use MUI directly (`TextField`, `Button`, `AppBar`),
  no custom wrapper needed, they already pull from the theme

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

## Task tracking

All tasks are tracked as GitHub Issues, organized on the
[Project board](https://github.com/users/risjonn/projects/2)
by sprint (Sprint 1 = full build, Sprint 2 = testing only).

- Check the **Issues** tab for your assigned tasks
- Move your issue's card on the board as you work (Todo → In Progress → Done)
- When you're doing Pull Request, type `Closes` followed by the issue's title in
  your Pull Request description (GitHub will autocomplete it), don't type the issue
  number directly, since it may not match what you'd expect

## Tech stack

- **Mobile**: React Native + Expo (JavaScript)
- **Web**: React + Vite + Material UI (JavaScript)
- **Backend**: Supabase (Postgres database, authentication, storage, real-time, Edge Functions)
- **IoT**: ESP32 microcontrollers with environmental sensors (exact sensor
  models/components TBD, IoT team to confirm and update this section)
