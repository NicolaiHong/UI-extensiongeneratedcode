# Deployment API Wiring Verification Summary

**Session Date:** 2026-03-27  
**Project:** ui-gen-extension  
**Focus:** Vercel, Render, GitHub Pages deployment flow

---

## Task Overview

Verified whether the deployment API flow is consistently wired between backend and frontend for:

- Vercel
- Render
- GitHub Pages

---

## Backend Routes (from attached controller)

| Route                                     | Method | Purpose                  |
| ----------------------------------------- | ------ | ------------------------ |
| `/api/apis/:apiId/deployments/providers`  | GET    | Available providers      |
| `/api/apis/:apiId/deployments`            | GET    | List deployments         |
| `/api/apis/:apiId/deployments/:id`        | GET    | Get deployment detail    |
| `/api/apis/:apiId/deployments`            | POST   | Create deployment record |
| `/api/apis/:apiId/deploy`                 | POST   | Start deployment         |
| `/api/apis/:apiId/deployments/:id/status` | GET    | Deployment status        |
| `/api/apis/:apiId/deployments/:id/retry`  | POST   | Retry deployment         |
| `/api/apis/:apiId/deployments/:id`        | PUT    | Update deployment        |
| `/api/apis/:apiId/deployments/:id`        | DELETE | Delete deployment        |

---

## Wiring Status

### ✅ Wired Routes (5/9)

| Route                     | Frontend Caller            | File                               |
| ------------------------- | -------------------------- | ---------------------------------- |
| `GET /deployments`        | `deploymentsApi.list()`    | `src/api/deployments.api.ts:31-32` |
| `GET /deployments/:id`    | `deploymentsApi.getById()` | `src/api/deployments.api.ts:34-35` |
| `POST /deployments`       | `deploymentsApi.create()`  | `src/api/deployments.api.ts:37-47` |
| `PUT /deployments/:id`    | `deploymentsApi.update()`  | `src/api/deployments.api.ts:49-54` |
| `DELETE /deployments/:id` | `deploymentsApi.delete()`  | `src/api/deployments.api.ts:56-58` |

### ❌ Missing Routes (4/9)

| Route                         | Reason                                                        |
| ----------------------------- | ------------------------------------------------------------- |
| `GET /deployments/providers`  | Providers registered client-side in `getAvailableProviders()` |
| `POST /deploy`                | Deployment executed directly via provider APIs                |
| `GET /deployments/:id/status` | Status polled from provider APIs (Vercel/Render/GitHub)       |
| `POST /deployments/:id/retry` | Retry creates new deployment record instead                   |

---

## Architecture Finding

**Client-Side Orchestration Pattern:**

The frontend does NOT use the backend as the deployment orchestrator. Instead:

1. **Provider selection** → VS Code extension (`deploymentOrchestrator.ts`)
2. **Deployment execution** → Direct calls to Vercel/Render/GitHub APIs
3. **Status polling** → Direct calls to provider APIs
4. **Record keeping** → Backend stores deployment records only

```
User → VS Code Extension → Provider APIs (Vercel/Render/GitHub)
                        ↓
                   Backend (record storage only)
```

---

## Key Files Analyzed

| Category        | File                                       |
| --------------- | ------------------------------------------ |
| API Client      | `src/api/deployments.api.ts`               |
| Client Base     | `src/api/client.ts`                        |
| Orchestrator    | `src/deployment/deploymentOrchestrator.ts` |
| Types           | `src/deployment/types.ts`                  |
| Commands        | `src/commands/deploymentCommands.ts`       |
| Vercel Provider | `src/deployment/providers/vercel.ts`       |
| Render Provider | `src/deployment/providers/render.ts`       |
| GitHub Pages    | `src/deployment/providers/githubPages.ts`  |
| Dashboard UI    | `src/sidebar/DashboardProvider.ts`         |

---

## Contract Verification

### Request Payloads ✅

- Create deployment: `{ provider, status, environment, metadata_json }`
- Update deployment: `{ status, metadata_json }`

### Response Handling ✅

- Uses `unwrap()` function for `{ success: true, data: ... }` pattern
- Correctly extracts nested data

### Status Values

| Frontend Execution State | Backend Record Status |
| ------------------------ | --------------------- |
| PENDING                  | PENDING               |
| VALIDATING               | -                     |
| UPLOADING                | -                     |
| BUILDING                 | IN_PROGRESS           |
| DEPLOYING                | IN_PROGRESS           |
| DEPLOYED                 | DEPLOYED              |
| FAILED                   | FAILED                |
| -                        | ROLLED_BACK           |

_Note: Granular states (VALIDATING, UPLOADING, etc.) are for real-time progress only, not persisted._

---

## Mock/Stub Status

**No mocks found** for deployment flow. All API calls are real:

- Backend calls via axios
- Provider calls via native fetch

---

## Fixes Required

To fully wire the backend:

```typescript
// Add to src/api/deployments.api.ts

getProviders: async (apiId: string) =>
  unwrap(await getApi().get(`/api/apis/${apiId}/deployments/providers`)),

startDeployment: async (apiId: string, data: StartDeploymentDto) =>
  unwrap(await getApi().post(`/api/apis/${apiId}/deploy`, data)),

getStatus: async (apiId: string, id: string) =>
  unwrap(await getApi().get(`/api/apis/${apiId}/deployments/${id}/status`)),

retry: async (apiId: string, id: string) =>
  unwrap(await getApi().post(`/api/apis/${apiId}/deployments/${id}/retry`)),
```

Then refactor `deploymentOrchestrator.ts` to use these endpoints instead of direct provider calls.

---

## Final Verdict

| Verdict              | **PARTIALLY WIRED**           |
| -------------------- | ----------------------------- |
| CRUD Operations      | ✅ Fully wired                |
| Deployment Execution | ❌ Client-side only           |
| Status Polling       | ❌ Uses provider APIs         |
| Provider Listing     | ❌ Client-side only           |
| Retry Flow           | ❌ Not using backend endpoint |

**The backend deployment routes exist but the frontend bypasses them for actual deployment operations, using the backend only for record storage.**
