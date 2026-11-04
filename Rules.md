# Project Rules - MilestonePay Agent

## Permissions & Workflow
- **Ask Before Action**: Must ask and receive explicit user confirmation before every file change, command, and commit.
- **No Git Push**: Never run `git push`. Do not configure remote origins automatically.
- **No Unsolicited Deletions**: Never delete any file or folder without prior explicit permission.
- **Phase Boundary**: Edit only inside the folder named for the active phase. Never rewrite the entire project. Do not transition to the next phase until the user explicitly states `"next phase"`.

## Scope & Folder Hierarchy
- **PHASE 0**: Repository root and `/docs` only.
- **Subsequent Phases**: Strictly bounded to the active phase's designated directory scope.

## Engineering Standards
- **Backend**: Node.js + Express located in `/server`.
- **Frontend**: React + Vite located in `/client`.
- **Database**: SQLite (local persistence).
- **Payment Integration**:
  - PayPal Sandbox environment only.
  - Currency strictly in USD.
  - Zero hardcoded secrets; use `.env` exclusively.
  - Always verify and align with current PayPal developer documentation before writing PayPal-related code.
- **Runnability**: Ensure the project remains runnable and stable after each phase.
