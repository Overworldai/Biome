/**
 * Global mutable debug state for the spark tuning configurator.
 * Read by useBackgroundCycle to pause/lock the background cycle.
 */
export const SPARK_DEBUG = {
  /** When true, background cycling is paused */
  pauseCycling: false,
  /** When >= 0, forces this background index (ignored if -1) */
  lockedIndex: -1
}
