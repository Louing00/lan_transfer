import { create } from "zustand";

export type FileMeta = {
  id: string;
  name: string;
  size: number;
  mimeType: string;
  lastModified: number;
};

export type TransferView = {
  id: string;
  name: string;
  size: number;
  done: number;
  status: "idle" | "waiting" | "transferring" | "paused" | "stopped" | "done" | "rejected" | "failed";
  direction: "outgoing" | "incoming";
  startedAt?: number;
  completedAt?: number;
  url?: string;
};

type TransferStore = {
  pendingIncoming?: FileMeta & { fromPeerId: string };
  outgoing?: TransferView;
  incoming?: TransferView;
  setPendingIncoming: (file?: FileMeta & { fromPeerId: string }) => void;
  setOutgoing: (transfer?: TransferView) => void;
  setIncoming: (transfer?: TransferView) => void;
  patchOutgoing: (patch: Partial<TransferView>) => void;
  patchIncoming: (patch: Partial<TransferView>) => void;
  reset: () => void;
};

export const useTransferStore = create<TransferStore>((set) => ({
  setPendingIncoming: (pendingIncoming) => set({ pendingIncoming }),
  setOutgoing: (outgoing) => set({ outgoing }),
  setIncoming: (incoming) => set({ incoming }),
  patchOutgoing: (patch) => set((state) => ({ outgoing: state.outgoing ? { ...state.outgoing, ...patch } : undefined })),
  patchIncoming: (patch) => set((state) => ({ incoming: state.incoming ? { ...state.incoming, ...patch } : undefined })),
  reset: () => set({ pendingIncoming: undefined, outgoing: undefined, incoming: undefined })
}));
