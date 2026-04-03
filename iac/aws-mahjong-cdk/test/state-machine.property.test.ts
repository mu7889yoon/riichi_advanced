import * as cdk from 'aws-cdk-lib/core';
import { Template } from 'aws-cdk-lib/assertions';
import * as fc from 'fast-check';
import { AwsMahjongCdkStack } from '../lib/aws-mahjong-cdk-stack';

/**
 * Property 3: リソースリーク防止（desired capacity復元）
 *
 * 任意のデプロイ実行において、成功パスでも失敗パス（ロールバック）でも、
 * ステートマシンの最終ステートに到達する前にASGのdesired capacityを1に
 * 設定するステップが実行されることを検証する。
 *
 * Validates: Requirements 5.5
 */

// --- Types ---

interface AslState {
  Type: string;
  Next?: string;
  End?: boolean;
  Default?: string;
  Choices?: Array<{ Next: string }>;
  Catch?: Array<{ Next: string }>;
  Parameters?: Record<string, unknown>;
}

interface AslDefinition {
  StartAt: string;
  States: Record<string, AslState>;
}

// --- Helpers ---

/**
 * Synthesize the CDK stack and extract the state machine ASL definition.
 */
function extractStateMachineDefinition(): AslDefinition {
  const app = new cdk.App();
  const stack = new AwsMahjongCdkStack(app, 'TestStack', {
    certificateArn: 'arn:aws:acm:us-east-1:123456789012:certificate/test-cert-id',
    domainName: 'test.example.com',
  });
  const template = Template.fromStack(stack);
  const stateMachines = template.findResources('AWS::StepFunctions::StateMachine');

  const logicalIds = Object.keys(stateMachines);
  if (logicalIds.length === 0) {
    throw new Error('No StateMachine resource found in template');
  }

  const smResource = stateMachines[logicalIds[0]];
  const definitionString = smResource.Properties?.DefinitionString;

  if (!definitionString) {
    throw new Error('StateMachine has no DefinitionString');
  }

  const resolved = resolveCfnValue(definitionString);
  return JSON.parse(resolved) as AslDefinition;
}

/**
 * Recursively resolve Fn::Join, Ref, and Fn::GetAtt tokens in a
 * CloudFormation value so we get a parseable JSON string.
 */
function resolveCfnValue(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.map(resolveCfnValue).join('');

  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    if ('Fn::Join' in obj) {
      const [separator, parts] = obj['Fn::Join'] as [string, unknown[]];
      return parts.map(resolveCfnValue).join(separator);
    }
    if ('Ref' in obj) return `__REF_${obj['Ref']}__`;
    if ('Fn::GetAtt' in obj) {
      const [resource, attr] = obj['Fn::GetAtt'] as [string, string];
      return `__GETATT_${resource}_${attr}__`;
    }
    return JSON.stringify(value);
  }
  return String(value);
}

/**
 * Check if a state sets DesiredCapacity to 1.
 */
function setsDesiredCapacityTo1(state: AslState): boolean {
  if (!state.Parameters) return false;
  const params = state.Parameters as Record<string, unknown>;
  if (params['DesiredCapacity'] === 1) return true;
  const apiParams = params['ApiParameters'] as Record<string, unknown> | undefined;
  if (apiParams?.['DesiredCapacity'] === 1) return true;
  return false;
}

/**
 * Get all possible successor state names from a given state,
 * including Next, Default, Choice branches, and Catch targets.
 */
function getSuccessors(state: AslState): string[] {
  const nexts: string[] = [];
  if (state.Next) nexts.push(state.Next);
  if (state.Default) nexts.push(state.Default);
  if (state.Choices) {
    for (const choice of state.Choices) {
      if (choice.Next) nexts.push(choice.Next);
    }
  }
  if (state.Catch) {
    for (const c of state.Catch) {
      if (c.Next) nexts.push(c.Next);
    }
  }
  return [...new Set(nexts)];
}

/**
 * Check if a state is a terminal state (Succeed or Fail).
 */
function isTerminal(state: AslState): boolean {
  return state.Type === 'Succeed' || state.Type === 'Fail';
}

/**
 * Find all paths from a start state to a specific target state using DFS.
 * Avoids cycles by tracking visited states per path.
 */
function findAllPathsTo(
  states: Record<string, AslState>,
  from: string,
  target: string,
  maxDepth = 50,
): string[][] {
  const results: string[][] = [];

  function dfs(current: string, path: string[], visited: Set<string>): void {
    if (path.length > maxDepth) return;
    path.push(current);

    if (current === target) {
      results.push([...path]);
      path.pop();
      return;
    }

    const state = states[current];
    if (!state || isTerminal(state)) {
      path.pop();
      return;
    }

    for (const next of getSuccessors(state)) {
      if (!visited.has(next)) {
        visited.add(next);
        dfs(next, path, visited);
        visited.delete(next);
      }
    }
    path.pop();
  }

  const visited = new Set<string>([from]);
  dfs(from, [], visited);
  return results;
}

/**
 * Find all states that can reach a given target state (reverse reachability).
 */
function findStatesReaching(
  states: Record<string, AslState>,
  target: string,
): Set<string> {
  // Build reverse adjacency
  const reverseAdj = new Map<string, string[]>();
  for (const name of Object.keys(states)) {
    reverseAdj.set(name, []);
  }
  for (const [name, state] of Object.entries(states)) {
    for (const succ of getSuccessors(state)) {
      reverseAdj.get(succ)?.push(name);
    }
  }

  // BFS from target backwards
  const reachable = new Set<string>();
  const queue = [target];
  reachable.add(target);
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const pred of (reverseAdj.get(current) ?? [])) {
      if (!reachable.has(pred)) {
        reachable.add(pred);
        queue.push(pred);
      }
    }
  }
  return reachable;
}

// --- Tests ---

describe('State Machine - Property Tests', () => {
  let definition: AslDefinition;
  let setDesired1StateNames: Set<string>;
  let succeedStates: string[];
  let failStates: string[];

  beforeAll(() => {
    definition = extractStateMachineDefinition();

    // Identify states that set DesiredCapacity to 1
    setDesired1StateNames = new Set(
      Object.entries(definition.States)
        .filter(([_, state]) => setsDesiredCapacityTo1(state))
        .map(([name]) => name),
    );

    // Identify Succeed and Fail terminal states
    succeedStates = Object.entries(definition.States)
      .filter(([_, s]) => s.Type === 'Succeed')
      .map(([name]) => name);

    failStates = Object.entries(definition.States)
      .filter(([_, s]) => s.Type === 'Fail')
      .map(([name]) => name);
  }, 120_000);

  /**
   * Property 3: リソースリーク防止（desired capacity復元）
   *
   * For every possible path through the state machine that reaches
   * a Succeed or Fail terminal state, the path must include a state
   * that sets DesiredCapacity to 1 before the terminal state.
   *
   * We find all entry points to each terminal state's subgraph and
   * enumerate paths, then use fast-check to randomly sample and verify.
   *
   * Validates: Requirements 5.5
   */
  test('Property 3: every path to a terminal state includes SetDesiredCapacity(1)', () => {
    // Collect all paths to all terminal states from any state that can reach them
    const allTerminalPaths: string[][] = [];

    for (const terminal of [...succeedStates, ...failStates]) {
      // Find all states that can reach this terminal
      const reaching = findStatesReaching(definition.States, terminal);

      // Find entry points: states in the reaching set that have predecessors
      // outside the set, or the start state
      for (const entryCandidate of reaching) {
        if (entryCandidate === terminal) continue;
        const paths = findAllPathsTo(definition.States, entryCandidate, terminal);
        // Only keep paths that start from a state reachable from the broader graph
        for (const path of paths) {
          if (path.length >= 2) {
            allTerminalPaths.push(path);
          }
        }
      }
    }

    expect(allTerminalPaths.length).toBeGreaterThan(0);

    // Use fast-check to randomly sample paths and verify the property
    const pathIndexArb = fc.integer({ min: 0, max: allTerminalPaths.length - 1 });

    fc.assert(
      fc.property(pathIndexArb, (pathIndex) => {
        const path = allTerminalPaths[pathIndex];
        const terminalState = path[path.length - 1];

        // The path must include at least one state that sets DesiredCapacity to 1
        // before reaching the terminal state
        const statesBeforeTerminal = path.slice(0, -1);
        const hasSetDesired1 = statesBeforeTerminal.some((s) => setDesired1StateNames.has(s));

        expect(hasSetDesired1).toBe(true);
        expect(
          definition.States[terminalState]?.Type === 'Succeed' ||
          definition.States[terminalState]?.Type === 'Fail',
        ).toBe(true);
      }),
      { numRuns: Math.min(500, allTerminalPaths.length * 5) },
    );
  }, 120_000);

  /**
   * Property 3 (supplementary): success path includes SetDesiredCapacity1
   *
   * Every path reaching the Succeed state must pass through a state
   * that sets DesiredCapacity to 1.
   *
   * Validates: Requirements 5.5
   */
  test('Property 3: success path uses SetDesiredCapacity(1) before Succeed', () => {
    for (const succeedState of succeedStates) {
      const reaching = findStatesReaching(definition.States, succeedState);
      // The SetDesiredCapacity1 state must be in the set of states reaching Succeed
      const hasSetDesired1InPath = [...reaching].some((s) => setDesired1StateNames.has(s));
      expect(hasSetDesired1InPath).toBe(true);

      // Furthermore, verify that the immediate predecessor of Succeed sets DesiredCapacity to 1
      // (i.e., SetDesiredCapacity1 → DeploySuccess)
      const immediatePredecessors = Object.entries(definition.States)
        .filter(([_, state]) => {
          const succs = getSuccessors(state);
          return succs.includes(succeedState);
        })
        .map(([name]) => name);

      const predecessorSetsDesired1 = immediatePredecessors.some((p) =>
        setDesired1StateNames.has(p),
      );
      expect(predecessorSetsDesired1).toBe(true);
    }
  }, 120_000);

  /**
   * Property 3 (supplementary): all failure paths include SetDesiredCapacity(1)
   *
   * Every path reaching the Fail state must pass through a state
   * that sets DesiredCapacity to 1 (RollbackSetDesiredCapacity1).
   *
   * Validates: Requirements 5.5
   */
  test('Property 3: all failure paths include SetDesiredCapacity(1) before Fail', () => {
    for (const failState of failStates) {
      // Find all paths from any state to the Fail state
      const reaching = findStatesReaching(definition.States, failState);

      // Collect paths from states that enter the rollback flow
      const rollbackEntryPaths: string[][] = [];
      for (const state of reaching) {
        if (state === failState) continue;
        const paths = findAllPathsTo(definition.States, state, failState);
        rollbackEntryPaths.push(...paths.filter((p) => p.length >= 2));
      }

      expect(rollbackEntryPaths.length).toBeGreaterThan(0);

      // Use fast-check to randomly sample failure paths
      const pathIndexArb = fc.integer({ min: 0, max: rollbackEntryPaths.length - 1 });

      fc.assert(
        fc.property(pathIndexArb, (pathIndex) => {
          const path = rollbackEntryPaths[pathIndex];
          const statesBeforeTerminal = path.slice(0, -1);
          const hasSetDesired1 = statesBeforeTerminal.some((s) => setDesired1StateNames.has(s));
          expect(hasSetDesired1).toBe(true);
        }),
        { numRuns: Math.min(200, rollbackEntryPaths.length * 5) },
      );
    }
  }, 120_000);

  /**
   * Structural check: both SetDesiredCapacity1 and RollbackSetDesiredCapacity1
   * exist and both set DesiredCapacity to 1.
   *
   * Validates: Requirements 5.5
   */
  test('Property 3: both success and rollback SetDesiredCapacity states set DesiredCapacity to 1', () => {
    // There must be at least 2 states that set DesiredCapacity to 1
    // (one for success path, one for rollback path)
    expect(setDesired1StateNames.size).toBeGreaterThanOrEqual(2);

    // Each must have DesiredCapacity = 1 in its Parameters
    for (const name of setDesired1StateNames) {
      const state = definition.States[name];
      expect(setsDesiredCapacityTo1(state)).toBe(true);
    }
  }, 120_000);
});
