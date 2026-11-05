/** Source consumers of the public SDK do not need Vite's application-wide types. */
declare module '*.js?raw' {
  const source: string;
  export default source;
}
