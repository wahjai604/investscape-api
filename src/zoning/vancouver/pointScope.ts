/**
 * InvestScape™ — © 2026 Lighthouse Research Ltd. Proprietary and confidential.
 * See LICENSE. Not investment, tax, or financial advice.
 *
 * E85 — what a future Vancouver point response may and may not claim. No route
 * uses these yet; they exist so the wording is fixed and tested before one does.
 */

/**
 * Must accompany every future point response, verbatim. A zoning polygon says
 * which district is mapped at a coordinate; it says nothing about the lot the
 * coordinate falls in, its site area, its frontage, its legal description, or
 * what may be built on it.
 */
export const VANCOUVER_POINT_RESPONSE_SCOPE =
  "This describes the zoning mapped at a single point. It is not the entitlement of a parcel: it does not identify a lot, and it does not state what may be built on any property.";

/**
 * PID lookup is UNAVAILABLE. No parcel fabric is loaded, and the zoning layer's
 * object_id is a data-management number for a zoning polygon, not a parcel
 * identifier. Nothing may translate a PID into a point or polygon until a
 * parcel source with its own pinned manifest exists.
 */
export const VANCOUVER_PID_LOOKUP = {
  available: false,
  code: "PID_LOOKUP_UNAVAILABLE",
  reason: "No parcel fabric is loaded. A PID cannot be resolved to a location, and a zoning polygon's object_id is not a PID.",
} as const;

export class VancouverPidLookupUnavailableError extends Error {
  readonly code = VANCOUVER_PID_LOOKUP.code;
  constructor() {
    super(VANCOUVER_PID_LOOKUP.reason);
    this.name = "VancouverPidLookupUnavailableError";
  }
}

/** The only PID entry point, and it always refuses. */
export function lookupVancouverZoningByPid(_pid: string): never {
  throw new VancouverPidLookupUnavailableError();
}
