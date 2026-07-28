// esbuild injects this virtual module at bundle time (see esbuild.config.mjs);
// it exports the compiled AudioWorklet processor source as a string so the main
// thread can hand it to `AudioWorklet.addModule` via a Blob URL.
declare module 'virtual:pcm-recorder-worklet-source' {
  export const PCM_RECORDER_WORKLET_SOURCE: string;
}

declare module 'virtual:build-mode' {
  export const IS_PRODUCTION_BUILD: boolean;
}

declare module 'virtual:bergamot-worker-source' {
  export const BERGAMOT_WORKER_SOURCE: string;
}
