import type { HostMessage } from "./protocol";

let frame: Window | undefined;

export const attachSandbox = (target: Window) => {
  frame = target;
};

export const detachSandbox = () => {
  frame = undefined;
};

// Whatever is sent before the frame is ready is dropped: its first message is
// the whole rack. The frame's origin is opaque, so "*" is the only way to name it.
export const sendToSandbox = (message: HostMessage) => {
  frame?.postMessage(message, "*");
};
