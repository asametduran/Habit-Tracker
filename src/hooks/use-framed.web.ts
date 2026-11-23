import { useSyncExternalStore } from 'react';

// Web: another site could show the app in a frame and trick the user into clicking it
// (clickjacking). A page can't refuse framing itself (frame-ancestors only works as a header,
// and the host is unknown), so the app checks once it runs. The native version is use-framed.ts.

const subscribe = () => () => {};

function framed(): boolean {
  try {
    return window.self !== window.top;
  } catch {
    return true; // can't even compare with the parent: treat as framed
  }
}

/** True when the page is inside another page's frame. False while rendering in Node and hydrating. */
export function useFramed(): boolean {
  return useSyncExternalStore(subscribe, framed, () => false);
}
