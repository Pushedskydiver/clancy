/**
 * esbuild config for bundling runtime scripts.
 *
 * Produces self-contained ESM bundles for clancy-once.js and clancy-afk.js.
 * Strips unused zod locale files (~243 KB) and minifies the output.
 */
import { build } from 'esbuild';
import { mkdirSync } from 'node:fs';

/** Plugin that stubs out zod locale barrel imports (all 50+ languages). */
const stubZodLocales = {
  name: 'stub-zod-locales',
  setup(build) {
    // Match any import resolving to zod's locales barrel (index.js)
    build.onResolve({ filter: /locales\/index\.js$/ }, (args) => {
      if (args.resolveDir.includes('zod')) {
        return { path: 'zod-locales-stub', namespace: 'stub' };
      }
    });

    build.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({
      contents: 'export default {};',
      loader: 'js',
    }));
  },
};

const shared = {
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  minify: true,
  treeShaking: true,
  plugins: [stubZodLocales],
};

mkdirSync('dist/bundle', { recursive: true });

await Promise.all([
  build({
    ...shared,
    entryPoints: ['dist/scripts/once/once.js'],
    outfile: 'dist/bundle/clancy-once.js',
  }),
  build({
    ...shared,
    entryPoints: ['dist/scripts/afk/afk.js'],
    outfile: 'dist/bundle/clancy-afk.js',
  }),
]);
