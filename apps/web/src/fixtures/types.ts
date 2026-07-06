export type Metro = "Denver, CO" | "Austin, TX";

export type ProviderKind = "therapist" | "facility";

export interface Provider {
  id: string;
  name: string;
  credential: string;
  kind: ProviderKind;
  metro: Metro;
  license: {
    status: "verified" | "pending";
    board: string;
    checkedAt: string; // ISO date
  };
}

export interface Recommendation {
  id: string;
  providerId: string;
  issues: string[];
  population: string;
  modality: string[];
  quote: string;
  recommenderContext: string;
  freshnessConfirmedAt: string; // ISO date
}
