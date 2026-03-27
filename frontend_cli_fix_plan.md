# Frontend CLI Fix Plan

## Goal

Fix the frontend deployment flow so it:

1. uses the correct generated source artifact
2. sends valid workflow state values to backend
3. supports deployment failure handling for manual fix and AI-assisted fix

---

## Current observed issues

### Issue A: frontend throws

`Deployment failed: No generated files found. Run full source generation first.`

This suggests the frontend deployment flow is failing before actual provider deployment starts.

### Issue B: frontend likely reads the wrong artifact source

The source-code viewer can successfully load:

- `GET /api/apis/:apiId/sessions?mode=FULL_SOURCE`
- `GET /api/apis/:apiId/sessions?mode=PREVIEW`

But deployment still says no generated files found.

This strongly suggests:

- source viewer reads from `FULL_SOURCE` session data
- deployment prerequisite check reads from another source, likely `generated-codes`
- the two flows are not aligned

### Issue C: frontend sends invalid workflow state

Backend rejects a later `PATCH /workflow-state` request because the frontend/client/orchestrator sends a workflow state value not supported by backend.

Allowed backend workflow states are:

- `CONFIGURED`
- `UI_GENERATED`
- `CODE_GENERATED`
- `READY_TO_DEPLOY`
- `DEPLOYING`
- `DEPLOYED`
- `FAILED`

Frontend must use only those values.

---

## Required behavior

### Artifact source behavior

Deployment flow must use the actual generated full-source artifact.

If `FULL_SOURCE` session data exists and contains deployable source, the deployment flow must not incorrectly fail with `No generated files found`.

### Workflow state behavior

Frontend must send only canonical backend workflow state values:

- `DEPLOYING`
- `DEPLOYED`
- `FAILED`

Do not send:

- `DEPLOY_FAILED`
- `ERROR`
- `SUCCESS`
- `READY`
- or any other non-canonical value

### Failure handling modes

For now support these modes safely:

#### Mode 1: user fixes manually

- show deployment error
- show logs/error summary
- allow retry after manual fix

#### Mode 2: user + AI fix together

- show failure details
- allow user to ask AI to analyze/fix
- AI can propose patch
- user reviews/applies
- retry deployment

Do **not** implement full autonomous repair loop yet.

---

## Tasks

1. Find the exact throw location for:
   `No generated files found`

2. Identify which source the deployment flow currently uses as deployable input:
   - `generated-codes`
   - `FULL_SOURCE` session output
   - or another artifact source

3. Compare:
   - source viewer data source
   - deployment artifact data source

4. Patch the deployment flow to use the correct generated source artifact

5. Find the exact frontend code that sends `PATCH /api/apis/:apiId/workflow-state`

6. Identify the invalid workflow state value currently being sent

7. Patch frontend/shared types/constants so only backend-supported workflow states are sent:
   - `DEPLOYING`
   - `DEPLOYED`
   - `FAILED`

8. Keep deployment status handling separate from workflow state handling in UI logic

9. Improve deployment failure UX for:
   - manual fix
   - AI-assisted fix

---

## What to inspect

- frontend deployment orchestrator
- frontend API client / hooks / services
- deployment page/components
- generated source lookup logic
- source code viewer logic
- workflow state patch caller
- shared enums/constants/types if any
- mock/stub deployment data if any

---

## Expected output

1. Exact throw location for `No generated files found`
2. Current artifact source used by deployment
3. Correct artifact source that should be used
4. Root cause of the mismatch
5. Exact invalid workflow state being sent
6. Files to change
7. Exact code patch
8. Verification steps

---

## Constraints

- Do not focus on provider API failures first
- Fix artifact lookup / prerequisite check first
- Do not invent new workflow state values
- Keep frontend aligned with backend workflow-state contract
- Do not stop at analysis only; produce the actual patch

---

## Acceptance criteria

- Frontend no longer throws `No generated files found` when deployable full-source artifact actually exists
- Deployment flow uses the correct source artifact
- Frontend sends only canonical backend workflow states
- Deployment start sends `DEPLOYING`
- Deployment success sends `DEPLOYED`
- Deployment failure sends `FAILED`
- Manual fix flow is supported
- AI-assisted fix flow is supported
- Full autonomous fix flow is not required in this phase
