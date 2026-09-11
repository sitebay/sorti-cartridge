/** `import runtimeHtml from "../runtime.html"` — bundled as text (wrangler's Text rule). */
declare module "*.html" {
  const html: string;
  export default html;
}
