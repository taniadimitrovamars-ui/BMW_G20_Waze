# Architecture Overview

```mermaid
flowchart TD
    User([User]) --> Browser[Mobile or desktop browser]
    Browser --> HTML[index.html<br/>UI, styles, app state, rendering]

    subgraph PWA[PWA shell]
        Manifest[manifest.json<br/>Install metadata and icons]
        SW[sw.js<br/>Offline cache and update policy]
        Icons[icons/<br/>180 / 192 / 512 px assets]
    end

    HTML --> Manifest
    HTML --> SW
    Manifest --> Icons

    subgraph Local[Local browser data]
        LS[(localStorage<br/>mgu_cars, active VIN, theme)]
        Pending[(Pending cloud events<br/>mgu_cloud_pending)]
    end

    HTML --> LS
    HTML <-->|read and render app state| LS

    HTML --> CloudSync[cloud-sync.js<br/>Authentication, queue, sync, backup]
    CloudSync --> LS
    CloudSync --> Pending
    Pending --> CloudSync

    subgraph Backend[Supabase backend]
        Auth[Supabase Auth]
        UserChanges[(user_changes<br/>ordered entity events)]
        Legacy[(user_data<br/>legacy full payload)]
        History[(sync_history<br/>sync runs and devices)]
    end

    CloudSync --> Auth
    CloudSync -->|create, upsert, fetch| UserChanges
    CloudSync -->|read legacy snapshot| Legacy
    CloudSync -->|write and load| History

    SW -. network-first HTML and JS .-> HTML
    SW -. cache-first static assets .-> Manifest
    SW -. offline fallback .-> Browser

    classDef local fill:#dbeafe,stroke:#2563eb,color:#172033
    classDef cloud fill:#dcfce7,stroke:#16a34a,color:#172033
    classDef pwa fill:#ede9fe,stroke:#7c3aed,color:#172033

    class LS,Pending local
    class Auth,UserChanges,Legacy,History cloud
    class Manifest,SW,Icons pwa
```

## Component Roles

- **`index.html`**: Main PWA interface; contains the application markup, CSS, BMW vehicle and workshop features, UI state, and rendering logic.
- **`manifest.json`**: Defines installable-app metadata, orientation, theme, language, and icon assets.
- **`sw.js`**: Provides offline caching, network-first behavior for HTML and JavaScript, cache-first behavior for other resources, and old-cache cleanup.
- **`cloud-sync.js`**: Imports Supabase, manages authentication, local event detection, pending-change ownership, synchronization, JSON backup/restore, devices, and sync history.
- **Browser `localStorage`**: Stores vehicle profiles, the active VIN, theme, pending events, device identity, restore markers, and the last successful sync time.
- **Supabase**: Supplies auth and cloud persistence through `user_changes`, legacy `user_data`, and `sync_history` tables.

## Runtime Flow

1. The browser loads `index.html` and registers the PWA resources.
2. `index.html` reads and updates vehicle data in `localStorage`.
3. `cloud-sync.js` observes local changes and queues allowed entity events while online or offline.
4. On authentication or network recovery, pending events are uploaded to Supabase and merged with cloud event history.
5. The merged state is sanitized and written back to `localStorage`, then the UI is rendered again.
6. The service worker provides offline access and refreshes HTML/JavaScript from the network when available.
