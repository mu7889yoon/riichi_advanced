/**
 * Pure filtering logic for Green instance identification.
 * Extracted for testability without AWS SDK dependencies.
 */

export interface AsgInstance {
  InstanceId?: string;
  LifecycleState?: string;
}

export interface FindGreenFilterResult {
  found: boolean;
  instanceId?: string;
}

/**
 * Finds the first instance that is NOT the blue instance AND is InService.
 * Returns found: false if no such instance exists.
 */
export function findGreenFromInstances(
  instances: AsgInstance[],
  blueInstanceId: string,
): FindGreenFilterResult {
  const greenInstance = instances.find(
    (i) => i.InstanceId !== blueInstanceId && i.LifecycleState === 'InService',
  );

  if (!greenInstance) {
    return { found: false };
  }

  return {
    found: true,
    instanceId: greenInstance.InstanceId!,
  };
}
