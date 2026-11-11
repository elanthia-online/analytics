// The aggregation layer: turns an analytics.lic database into the JSON the
// dashboard renders. Pure functions of (connection, now); nothing here
// reads the clock, the DOM or the network, so Node tests run it as is.
import { buildOverview } from './overview.js';
import { buildCharacter, RANGES } from './character.js';
import { buildIncome, buildHunting, buildBounties, buildHistory, buildDaily, buildProgress, buildReconciliation, buildCompare, buildCombat, targetEta, SECTIONS, DETAIL_RANGES } from './details.js';
import { RANGE_DEFAULTS, RANGE_CHOICES, rangeRules, rangeLabels } from './report.js';

export { buildOverview, buildCharacter, RANGES, buildIncome, buildHunting, buildBounties, buildHistory, buildDaily, buildProgress, buildReconciliation, buildCompare, buildCombat, targetEta, SECTIONS, DETAIL_RANGES };
export { RANGE_DEFAULTS, RANGE_CHOICES, rangeRules, rangeLabels };

// analytics.lic schema versions this build has been checked against
// (metadata.schema_version). Others load with a warning.
export const KNOWN_SCHEMAS = ['11'];

// Both views for one refresh, from one open database
export function buildViews(conn, { now, who, range }) {
  const overview = buildOverview(conn, { now });
  const character = who ? buildCharacter(conn, overview, who, range, { now }) : null;
  return { overview, character };
}
