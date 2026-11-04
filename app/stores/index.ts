import { create } from "zustand";
import { devtools, persist } from "zustand/middleware";
import { immer } from "zustand/middleware/immer";

import type { Store } from "./common";
import { createRackSlice } from "./rack";
import { createCatalogueSlice } from "./catalogue";
import { createChatSlice } from "./chat";
import { chatPersistOptions, chatStorage } from "./persist";
import { sandboxSync } from "./sandbox-sync";

export type { Store } from "./common";

export const storage = chatStorage({
  onError: (error) => {
    useStore.getState().chat.setSaveError(error);
  },
});

export const useStore = create<Store>()(
  sandboxSync(
    devtools(
      persist(
        immer((...args) => ({
          rack: createRackSlice(...args),
          catalogue: createCatalogueSlice(...args),
          chat: createChatSlice(...args),
        })),
        chatPersistOptions(
          storage,
          (): string => useStore.persist.getOptions().name ?? "",
        ),
      ),
      { name: "good-vibes" },
    ),
  ),
);
