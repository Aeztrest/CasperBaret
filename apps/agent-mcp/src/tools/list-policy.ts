import { AGENT_POLICY, checkPolicy } from "../policy.js";

export function listPolicy() {
  const probe = checkPolicy(0); // 0-cost check, just to read current spend totals
  return {
    caps: AGENT_POLICY,
    spentThisHourUsdc: probe.spentHourUsdc,
    spentTodayUsdc: probe.spentDayUsdc,
  };
}
