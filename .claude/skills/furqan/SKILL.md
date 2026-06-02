```markdown
# furqan Development Patterns

> Auto-generated skill from repository analysis

## Overview
This skill teaches the core development conventions and patterns used in the `furqan` repository, a TypeScript project built with the Next.js framework. You'll learn how to structure files, write imports/exports, follow commit message standards, and organize tests according to the repository's established practices.

## Coding Conventions

### File Naming
- Use **camelCase** for file names.
  - Example: `userProfile.ts`, `fetchData.tsx`

### Import Style
- Use **relative imports** for modules within the project.
  - Example:
    ```typescript
    import { fetchData } from './apiUtils';
    import { UserProfile } from '../components/userProfile';
    ```

### Export Style
- Use **named exports** for all modules.
  - Example:
    ```typescript
    // In userProfile.ts
    export const UserProfile = () => { /* ... */ };
    ```

### Commit Messages
- Follow **conventional commit** style.
- Use the `chore` prefix for maintenance and non-feature commits.
  - Example:
    ```
    chore: update dependencies and fix minor lint errors
    ```

## Workflows

### Creating a New Feature
**Trigger:** When adding a new feature or component  
**Command:** `/create-feature`

1. Create a new file using camelCase naming (e.g., `newFeature.tsx`).
2. Use relative imports to include dependencies.
3. Export your feature/component using named exports.
4. Write a test file named `newFeature.test.tsx` alongside your feature.
5. Commit your changes using a conventional commit message.

### Refactoring Code
**Trigger:** When improving or restructuring existing code  
**Command:** `/refactor-code`

1. Identify the code to refactor.
2. Update file and variable names to use camelCase if needed.
3. Ensure all imports remain relative.
4. Use named exports throughout.
5. Update or add relevant test files.
6. Commit with a message like:  
   ```
   chore: refactor userProfile component for readability
   ```

### Running Tests
**Trigger:** To verify code correctness  
**Command:** `/run-tests`

1. Locate test files matching the `*.test.*` pattern.
2. Run the test suite using your preferred test runner (framework is unspecified; check project documentation or scripts).
3. Review test results and address any failures.

## Testing Patterns

- Test files are named with the pattern `*.test.*` (e.g., `userProfile.test.tsx`).
- Place test files near the code they test for clarity and maintainability.
- The specific testing framework is not detected; refer to project scripts or documentation for details.

## Commands
| Command           | Purpose                                      |
|-------------------|----------------------------------------------|
| /create-feature   | Scaffold a new feature/component             |
| /refactor-code    | Refactor existing code following conventions |
| /run-tests        | Run all test files in the repository         |
```