export type EntityId = number | string;
export type Status = "Owned" | "Ready" | "Published" | "Sold";
export type Item = {
  id: EntityId;
  brand: string;
  description: string;
  size?: string;
  condition?: string;
  category?: string;
  cost: number;
  price: number;
  estimatedResale?: number;
  status: Status;
  photo?: string;
  photoPath?: string;
};
export type Priority = {
  id: EntityId;
  text: string;
  horizon?: "Today" | "Tomorrow" | "Later";
  date?: string;
  category?: string;
  time?: string;
  done: boolean;
};
export type TaxPayment = { id: EntityId; amount: number; date: string };
export type SessionPhase = "driving" | "parking" | "store";
export type CandidateDecision = "undecided" | "bought" | "passed";
export type SessionCandidate = Omit<Item, "status"> & { decision: CandidateDecision };
export type ThriftHistory = {
  id: EntityId;
  routeId?: EntityId;
  date: string;
  startedAt: number;
  endedAt: number;
  location: string;
  budget: number;
  spend: number;
  projectedResale?: number;
  projectedProfit?: number;
  phaseTimes: Record<SessionPhase, number>;
  candidates: SessionCandidate[];
};
export type WorkspaceSnapshot = {
  items: Item[];
  priorities: Priority[];
  taxRate: string;
  taxPayments: TaxPayment[];
  sessions: ThriftHistory[];
};

