# Open Migration Web Application

React-based web UI for Ownpace — **one app, both editions**
(ADR-0026): the managed edition serves it as its portal; the self-host
appliance serves the same app under `/ui` via the `build:selfhost` bundle.

## Features

- **Multi-tenant Dashboard**: Overview of all migrations and system status
- **Migration Wizard**: Step-by-step configuration for new migrations
- **Real-time Monitoring**: Track sync progress and view logs
- **Team Management**: Invite and manage team members
- **Responsive Design**: Works on desktop and mobile devices

## Tech Stack

- **React 19** with TypeScript
- **Vite** for fast development and building
- **React Query** for server state management
- **Zustand** for client state management
- **Tailwind CSS** for styling
- **react-router v8** for navigation (the `react-router` package — not
  `react-router-dom`, which v7+ folded in)
- **Axios** for HTTP requests
- **Lucide React** for icons

## Getting Started

### Prerequisites

- Node.js 24+
- pnpm package manager
- Running API server (see `apps/api`)

### Installation

1. **Install dependencies:**
```bash
pnpm install
```

2. **Configure environment:**
```bash
cp .env.example .env
```

3. **Start development server:**
```bash
pnpm dev
```

The application will be available at `http://localhost:3123` (the port is
set in `vite.config.ts`).

## Environment Variables

```bash
# Optional — where the API lives. Defaults to '/api' (same-origin), which is
# correct behind the compose stack and the appliance alike.
VITE_API_URL=http://localhost:3001/api

# Set BY the build, not by you: `--mode selfhost` (the build:selfhost script)
# sets VITE_EDITION, which drives the edition split in src/services/edition.ts —
# the ONLY split the client is allowed (URLs + apply's success shape, ADR-0026).
VITE_EDITION=selfhost
```

## Project Structure

```
apps/web/
├── src/
│   ├── components/        # Reusable UI components
│   │   └── Layout.tsx    # Main application layout
│   ├── pages/            # Page components
│   │   ├── Dashboard.tsx / Mappings.tsx / CreateMapping.tsx
│   │   ├── MappingDetail.tsx   # per-mapping hub: the five operating links
│   │   ├── Confirm.tsx         # discovery counts + scope manifest + Start
│   │   ├── Deletions.tsx / Moves.tsx / Failures.tsx   # decision queues
│   │   ├── Verify.tsx / Finish.tsx                    # §20 gate + finish
│   │   ├── Billing.tsx / Tenants.tsx / Settings.tsx / Login.tsx
│   │   └── OperatorDashboard.tsx
│   ├── services/         # API services
│   │   ├── api.ts        # Axios client
│   │   └── mapping-service.ts
│   ├── stores/           # Zustand stores
│   │   ├── auth-store.ts
│   │   └── mapping-store.ts
│   ├── App.tsx           # Main app component
│   ├── index.css         # Tailwind styles
│   └── index.tsx         # Entry point
├── index.html
├── package.json
├── tsconfig.json
├── vite.config.ts
├── tailwind.config.js
└── README.md
```

## Available Scripts

- `pnpm dev` - Start development server (port 3123)
- `pnpm build` - Build for production (managed portal)
- `pnpm build:selfhost` - Build the appliance bundle (`--base=/ui/`, output
  `dist-selfhost/`, `--mode selfhost`) — what the appliance serves at `/ui`
- `pnpm preview` - Preview production build
- `pnpm typecheck` - `tsc --noEmit`
- `pnpm lint` - Run ESLint
- `pnpm test` - Run tests (jsdom, part of the workspace unit gate)

## Key Components

### Dashboard
Overview page showing:
- Statistics (total, active, completed, error mappings)
- Recent activity
- Quick actions

### Migration Wizard
Multi-step wizard for creating new migrations:
1. **Source**: Select source system (IMAP, OAuth2, Graph)
2. **Target**: Select target system (JMAP, IMAP, CalDAV, etc.)
3. **Credentials**: Enter connection details
4. **Data Types**: Choose what to migrate (email, calendar, contacts, files)
5. **Schedule**: Set sync frequency
6. **Review**: Confirm and create

### Mappings List
View and manage all migrations:
- Filter by status
- Trigger manual sync
- View run history
- Edit or delete mappings

## Authentication

Bearer-JWT only — **there is no email/password login endpoint** (SSO is a
later slice). The Login screen takes a pasted token (the managed demo seed
prints demo owner tokens), stores it, and the Axios client sends it on every
request. Authorization is decided server-side by the tenant-membership gate
(role from the `tenant_member` row, never the token — 0020 T1).

## State Management

### Server State (React Query)
- Automatic caching and deduplication
- Background refetching
- Optimistic updates
- Error handling

### Client State (Zustand)
- Authentication state
- Mapping selection
- UI state

## Styling

The app uses Tailwind CSS with a custom design system:
- Custom color palette (primary, success, warning, danger)
- Component classes (btn, card, input, badge)
- Responsive design (mobile-first)
- Dark mode support

## Development Guidelines

### Component Structure
```tsx
import React from 'react';

interface Props {
  // Define props
}

const Component: React.FC<Props> = ({ prop1, prop2 }) => {
  // Component logic
  
  return (
    // JSX
  );
};

export default Component;
```

### API Calls
```tsx
import { useQuery, useMutation } from '@tanstack/react-query';
import { mappingApi } from '../services/mapping-service';

const MyComponent = () => {
  const { data, isLoading } = useQuery({
    queryKey: ['mappings'],
    queryFn: mappingApi.list,
  });

  const mutation = useMutation({
    mutationFn: mappingApi.create,
    onSuccess: () => {
      // Handle success
    },
  });

  // Use data and mutation
};
```

### State Management
```tsx
import { useAuthStore } from '../stores/auth-store';

const MyComponent = () => {
  const { isAuthenticated, user, logout } = useAuthStore();
  
  // Use state
};
```

## Testing

```bash
pnpm test    # jsdom suites; also part of the root workspace unit gate
```

## Production Deployment

### Build
```bash
pnpm build
```

This creates optimized static files in `dist/`.

### Serve
```bash
pnpm preview
```

### Docker / compose

The managed compose stack builds and serves it (`deploy/compose/managed.yml`);
the appliance image runs `build:selfhost` and serves the bundle at `/ui`.

## Browser Support

- Chrome/Edge (latest 2 versions)
- Firefox (latest 2 versions)
- Safari (latest 2 versions)
- Mobile Safari (iOS 14+)
- Chrome Mobile (latest 2 versions)

## Contributing

1. Create a feature branch
2. Make your changes
3. Run `pnpm lint` and `pnpm test`
4. Submit a pull request

## License

Apache-2.0

---

*This web application is part of Ownpace, an open-source project for sovereign email/data migration.*
