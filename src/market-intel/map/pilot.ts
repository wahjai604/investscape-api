/** Display configuration only. None of these descriptors publishes a source or creates a release. */
export const PILOT_GEOGRAPHIES = {
  'CA-CMA-535': { name: 'Toronto CMA', level: 'metro', featureId: '535', country: 'CA' },
  'CA-CMA-933': { name: 'Vancouver CMA', level: 'metro', featureId: '933', country: 'CA' },
  'US-STATE-04': { name: 'Arizona', level: 'province_state', featureId: '04', country: 'US' },
  'US-STATE-48': { name: 'Texas', level: 'province_state', featureId: '48', country: 'US' },
} as const;
export type PilotGeographyId = keyof typeof PILOT_GEOGRAPHIES;
export const PILOT_LAYERS = [
  { layerId: 'ca-cma-population', country: 'CA', label: 'Population; July 1 estimate', unit: 'persons' },
  { layerId: 'ca-cma-qrs-asking-rent-2br', country: 'CA', label: 'Average asking rent; two-bedroom; experimental', unit: 'CAD/month' },
  { layerId: 'ca-cma-qrs-paid-rent-2br', country: 'CA', label: 'Average paid rent; two-bedroom; three-quarter moving average; experimental', unit: 'CAD/month' },
  { layerId: 'ca-cma-cmhc-vacancy', country: 'CA', label: 'CMHC vacancy; specified rental survey universe', unit: 'percent' },
  { layerId: 'ca-cma-cmhc-rent-2br', country: 'CA', label: 'CMHC average rent; two-bedroom apartments', unit: 'CAD/month' },
  { layerId: 'us-state-acs-population', country: 'US', label: 'Population; ACS five-year estimate', unit: 'persons' },
  { layerId: 'us-state-acs-household-income', country: 'US', label: 'Median household income; ACS five-year estimate', unit: 'USD' },
  { layerId: 'us-state-acs-gross-rent', country: 'US', label: 'Median gross rent; ACS five-year estimate', unit: 'USD/month' },
  { layerId: 'us-state-acs-tenure-counts', country: 'US', label: 'Occupied housing units by tenure; separate category counts', unit: 'housing units' },
] as const;
