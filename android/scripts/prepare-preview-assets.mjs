import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const androidRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outputRoot = resolve(process.argv[2] ?? resolve(androidRoot, 'app/build/generated/parityPreviewAssets'));

try {
  // Resolve from this script, not the caller's working directory. No downloads or
  // dependency installation are performed by the Android build.
  const mermaidRoot = dirname(require.resolve('mermaid/package.json'));
  const prismRoot = dirname(require.resolve('prismjs/package.json'));
  const components = require('prismjs/components.json');
  const getLoader = require('prismjs/dependencies.js');
  const languages = getLoader(components, [
    'markup', 'css', 'clike', 'javascript', 'typescript', 'jsx', 'tsx',
    'kotlin', 'java', 'python', 'bash', 'json', 'rust', 'go', 'sql', 'yaml',
  ]).getIds();
  const [mermaid, mermaidLicense, prismLicense, ...prismScripts] = await Promise.all([
    readFile(resolve(mermaidRoot, 'dist/mermaid.min.js'), 'utf8'),
    readFile(resolve(mermaidRoot, 'LICENSE'), 'utf8'),
    readFile(resolve(prismRoot, 'LICENSE'), 'utf8'),
    ...['core', ...languages].map((language) =>
      readFile(resolve(prismRoot, `components/prism-${language}.min.js`), 'utf8')),
  ]);
  // Preserve all shipped source/license comments; include the packages' complete
  // licenses even where their distributed minified components omit a header.
  const mermaidBundle = `/*! Mermaid\n${mermaidLicense}*/\n${mermaid}\n`;
  const prismBundle = `/*! PrismJS\n${prismLicense}*/\n${prismScripts.join('\n;\n')}\n`;
  const previewRoot = resolve(outputRoot, 'preview');
  await mkdir(previewRoot, { recursive: true });
  await Promise.all([
    writeFile(resolve(previewRoot, 'mermaid.min.js'), mermaidBundle),
    writeFile(resolve(previewRoot, 'prism.min.js'), prismBundle),
  ]);
} catch (error) {
  console.error('Unable to prepare offline Android preview assets. Run npm install at the repository root and ensure mermaid and prismjs are installed.');
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
