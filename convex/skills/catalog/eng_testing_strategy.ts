// convex/skills/catalog/eng_testing_strategy.ts
// =============================================================================
// System skill: testing-strategy
// Test plan design across unit, integration, e2e, and load testing.
// Inspired by Anthropic knowledge-work-plugins/engineering (Apache 2.0).
// =============================================================================

import { SystemSkillSeedData } from "../mutations_seed";

export const TESTING_STRATEGY_SKILL: SystemSkillSeedData = {
  slug: "testing-strategy",
  name: "Testing Strategy",
  summary:
    "Design comprehensive test plans covering unit, integration, e2e, and load tests. " +
    "Use when planning test coverage for a new feature, refactoring test suites, or " +
    "establishing a testing strategy for a project.",
  instructionsRaw: `# Testing Strategy & Test Plan Design

Design comprehensive testing strategies and detailed test plans. Covers unit, integration, end-to-end, performance, and load testing. Helps identify what to test, how to test it, and how to prioritize test investment.

## When to Use

- Planning test coverage for a new feature or service
- Auditing and improving existing test coverage
- Designing an end-to-end testing strategy for a project
- Writing test cases from requirements or user stories
- Setting up load/performance testing plans
- Deciding between testing approaches (unit vs. integration vs. e2e)

## Testing Pyramid

Structure tests in a pyramid. More fast/cheap tests at the bottom, fewer slow/expensive tests at the top:

\`\`\`
         /\\
        /  \\        E2E Tests (few, slow, high confidence)
       / E2E\\       - Full user flows through real UI
      /------\\
     /        \\     Integration Tests (moderate count)
    / Integr.  \\    - Service boundaries, API contracts, DB queries
   /------------\\
  /              \\  Unit Tests (many, fast, isolated)
 /    Unit        \\ - Pure logic, transformations, validators
/------------------\\
\`\`\`

**Rule of thumb:** ~70% unit, ~20% integration, ~10% e2e.

## Test Plan Template

### Feature: [Feature Name]

**Overview:** [What is being tested and why]

**Risk Assessment:**
| Area | Risk Level | Rationale |
|------|-----------|-----------|
| Data integrity | High | Writes to production database |
| Authentication | High | Handles user credentials |
| UI rendering | Medium | Multiple viewport sizes |
| Performance | Medium | Processes large datasets |
| Edge cases | Low | Well-defined input constraints |

**Test Categories:**

#### Unit Tests
| ID | Test Case | Input | Expected Output | Priority |
|----|-----------|-------|-----------------|----------|
| U-1 | Valid input accepted | \`{name: "Alice", email: "a@b.com"}\` | Returns validated user | P0 |
| U-2 | Missing email rejected | \`{name: "Alice"}\` | Throws ValidationError | P0 |
| U-3 | Trims whitespace | \`{name: " Alice "}\` | Name is "Alice" | P1 |

#### Integration Tests
| ID | Test Case | Components | Expected Behavior | Priority |
|----|-----------|------------|-------------------|----------|
| I-1 | User creation persists | API → DB | User appears in database | P0 |
| I-2 | Duplicate email rejected | API → DB | Returns 409 Conflict | P0 |

#### End-to-End Tests
| ID | Test Case | Steps | Expected Result | Priority |
|----|-----------|-------|-----------------|----------|
| E-1 | Sign-up flow | Fill form → Submit → Verify email | User can log in | P0 |
| E-2 | Sign-up with existing email | Fill form with existing email → Submit | Error message shown | P1 |

## Test Case Design Techniques

### Equivalence Partitioning
Divide inputs into groups that should behave the same. Test one representative from each group:
- Valid email formats (standard, with dots, with plus)
- Invalid email formats (no @, no domain, empty)
- Boundary values (max length, min length, exactly at limit)

### Boundary Value Analysis
Focus on edges:
- If the limit is 1-100, test: 0, 1, 2, 99, 100, 101
- If a date range is required, test: start date, end date, one day before start, one day after end
- Empty collections, single-item collections, maximum-size collections

### Decision Table Testing
For features with multiple conditions:

| Condition | Case 1 | Case 2 | Case 3 | Case 4 |
|-----------|--------|--------|--------|--------|
| User is admin | Y | Y | N | N |
| Resource is public | Y | N | Y | N |
| **Expected: Access granted** | Y | Y | Y | N |

### State Transition Testing
For stateful features (orders, subscriptions, workflows):
\`\`\`
Draft → Submitted → Approved → Active → Cancelled
                  → Rejected → Draft (revised)
\`\`\`
Test each valid transition AND each invalid transition (e.g., Draft → Active should fail).

## Performance & Load Testing

### Load Test Plan
| Scenario | Users | Ramp-up | Duration | Success Criteria |
|----------|-------|---------|----------|-----------------|
| Baseline | 10 | 1 min | 5 min | p99 < 200ms |
| Normal load | 100 | 5 min | 15 min | p99 < 500ms, 0% errors |
| Peak load | 500 | 10 min | 15 min | p99 < 1s, <0.1% errors |
| Stress | 1000 | 10 min | 10 min | Graceful degradation, no data loss |
| Soak | 100 | 5 min | 4 hrs | No memory leaks, stable response times |

### Metrics to Monitor
- Response time: p50, p95, p99
- Throughput: requests per second
- Error rate: 4xx and 5xx responses
- Resource utilization: CPU, memory, connections
- Queue depth: if applicable

## Test Quality Checklist

### Each Test Should:
- [ ] Test one thing (single assertion focus)
- [ ] Have a descriptive name explaining the scenario
- [ ] Be independent (no reliance on other tests' side effects)
- [ ] Be deterministic (same result every run)
- [ ] Be fast (unit tests < 100ms, integration < 5s)
- [ ] Clean up after itself (no persistent side effects)

### The Test Suite Should:
- [ ] Cover happy paths for all core features
- [ ] Cover error/edge cases for high-risk areas
- [ ] Include both positive and negative test cases
- [ ] Run in CI on every PR
- [ ] Complete in a reasonable time (< 10 min for unit + integration)
- [ ] Have no flaky tests (or flaky tests are quarantined)

## Testing Anti-Patterns to Avoid

- **Testing implementation, not behavior.** Test what the code does, not how it does it. If refactoring breaks tests but not behavior, the tests are too coupled.
- **Testing framework code.** Don't test that React renders or that Express routes — test your logic.
- **Snapshot addiction.** Snapshot tests are brittle and hard to review. Use them sparingly for complex UI.
- **Ignoring test maintainability.** Tests are code. They need the same care: readability, DRY (within reason), clear naming.
- **100% coverage worship.** Coverage measures lines executed, not correctness. 80% thoughtful coverage beats 100% mechanical coverage.
- **Flaky tests left unfixed.** A flaky test erodes trust in the entire suite. Fix or quarantine immediately.

## Output Format

When creating a test plan, deliver:

1. **Risk assessment** — What areas need the most coverage and why
2. **Test matrix** — Tables of test cases organized by type (unit/integration/e2e)
3. **Priority ranking** — Which tests to write first (P0 = must have before launch)
4. **Coverage gaps** — Areas that are hard to test or intentionally deferred
5. **Test infrastructure needs** — Mocks, fixtures, test databases, CI configuration

## Guidelines

- **Start from risk.** Test the riskiest code most thoroughly. Not all code deserves the same coverage.
- **Name tests like documentation.** \`test_user_with_expired_token_gets_401\` is clear. \`test_auth_3\` is not.
- **Fast feedback loop.** Unit tests should run in seconds. If they're slow, something is wrong.
- **Test behavior, not implementation.** Tests should survive refactoring. If they don't, they're testing the wrong thing.
- **One assertion per test.** When a test fails, you should immediately know what broke.
- **Prioritize.** A P0 test that prevents a data loss bug is worth more than 50 P2 tests for UI edge cases.`,
  instructionsCompiled: undefined,
  compilationStatus: "compiled",
  scope: "system",
  origin: "nanthaiBuiltin",
  visibility: "visible",
  lockState: "locked",
  status: "active",
  runtimeMode: "toolAugmented",
  requiredToolIds: ["list_documents", "read_document", "find_in_document"],
  requiredToolProfiles: ["docs"],
  requiredIntegrationIds: [],
};
