/// <reference types="vite/client" />

/** alphaTab ships its soundfont as an asset; Vite resolves `?url` to a string. */
declare module '*.sf3?url' {
  const src: string
  export default src
}

declare module '*.sf2?url' {
  const src: string
  export default src
}

/**
 * The SoundTouch AudioWorklet processor is a plain .js file inside the package;
 * `addModule` needs its URL, and Vite is what turns the package export into one.
 */
declare module '@soundtouchjs/audio-worklet/processor?url' {
  const src: string
  export default src
}
