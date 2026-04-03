import * as fc from 'fast-check';
import { findGreenFromInstances, AsgInstance } from '../lambda/find-green/logic';

/**
 * Property 1: Greenインスタンス特定の正確性
 *
 * 任意のインスタンスリストとblueInstanceIdに対して、
 * blueInstanceId以外のInService状態のインスタンスのみを返すことを検証する。
 *
 * Validates: Requirements 2.3
 */

// --- Generators ---

const lifecycleStates = [
  'Pending', 'Pending:Wait', 'Pending:Proceed',
  'Quarantined', 'InService', 'Terminating',
  'Terminating:Wait', 'Terminating:Proceed',
  'Terminated', 'Detaching', 'Detached',
  'EnteringStandby', 'Standby', 'Warmed:Pending',
  'Warmed:Pending:Wait', 'Warmed:Pending:Proceed',
  'Warmed:Terminating', 'Warmed:Terminating:Wait',
  'Warmed:Terminating:Proceed', 'Warmed:Running',
  'Warmed:Hibernated',
] as const;

const instanceIdArb = fc.stringMatching(/^i-[a-f0-9]{8,17}$/);

const asgInstanceArb: fc.Arbitrary<AsgInstance> = fc.record({
  InstanceId: instanceIdArb,
  LifecycleState: fc.constantFrom(...lifecycleStates),
});

const asgInstanceListArb = fc.array(asgInstanceArb, { minLength: 0, maxLength: 10 });

// --- Tests ---

describe('find-green Lambda - Property Tests', () => {
  /**
   * Property 1: Greenインスタンス特定の正確性
   *
   * For any instance list and blueInstanceId:
   * 1. If found is true, the returned instanceId is NOT the blueInstanceId
   * 2. If found is true, the corresponding instance has LifecycleState === 'InService'
   * 3. If no eligible instance exists (not blue AND InService), found is false
   * 4. The blueInstanceId is never returned as the green instance
   *
   * Validates: Requirements 2.3
   */
  test('Property 1: returned green instance is never blue and is always InService', () => {
    fc.assert(
      fc.property(
        instanceIdArb,
        asgInstanceListArb,
        (blueInstanceId, instances) => {
          const result = findGreenFromInstances(instances, blueInstanceId);

          const eligible = instances.filter(
            (i) => i.InstanceId !== blueInstanceId && i.LifecycleState === 'InService',
          );

          if (eligible.length === 0) {
            // No eligible green instance → must return found: false
            expect(result.found).toBe(false);
            expect(result.instanceId).toBeUndefined();
          } else {
            // Eligible green instance exists → must return found: true
            expect(result.found).toBe(true);
            // Returned instanceId must NOT be the blueInstanceId
            expect(result.instanceId).not.toBe(blueInstanceId);
            // Returned instanceId must be one of the eligible instances
            expect(eligible.map((i) => i.InstanceId)).toContain(result.instanceId);
          }
        },
      ),
      { numRuns: 200 },
    );
  });

  /**
   * Property 1 (supplementary): blueInstanceId is never returned even when
   * it is InService in the instance list.
   *
   * Validates: Requirements 2.3
   */
  test('Property 1: blue instance is never returned as green even when InService', () => {
    fc.assert(
      fc.property(
        instanceIdArb,
        asgInstanceListArb,
        (blueInstanceId, otherInstances) => {
          // Ensure the blue instance is present and InService
          const instances: AsgInstance[] = [
            { InstanceId: blueInstanceId, LifecycleState: 'InService' },
            ...otherInstances,
          ];

          const result = findGreenFromInstances(instances, blueInstanceId);

          if (result.found) {
            expect(result.instanceId).not.toBe(blueInstanceId);
          }
        },
      ),
      { numRuns: 200 },
    );
  });
});
