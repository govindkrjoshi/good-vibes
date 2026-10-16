import { useCallback } from "react";
import { rackEnvelope, rackStore, type Outcome, type RackMsg } from "../rack";

// Sends a message as the user's, and says what came of it.
export const useDispatch = (): ((msg: RackMsg) => Outcome) =>
  useCallback(
    (msg: RackMsg) => rackStore.getState().dispatch(rackEnvelope(msg)),
    [],
  );
