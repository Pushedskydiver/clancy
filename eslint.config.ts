import eslint from '@eslint/js';
import prettier from 'eslint-config-prettier';
import prettierPlugin from 'eslint-plugin-prettier';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
  {
    plugins: {
      prettier: prettierPlugin,
    },
    rules: {
      'prettier/prettier': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_' },
      ],

      // ── Complexity rules (v0.8.24) ──────────────────────────────────────
      'max-lines-per-function': [
        'warn',
        { max: 60, skipComments: true, skipBlankLines: true },
      ],
      'max-depth': ['warn', 3],
      complexity: ['warn', 10],
      'max-lines': [
        'warn',
        { max: 300, skipComments: true, skipBlankLines: true },
      ],
      'prefer-const': 'error',
    },
  },
  // Typed rules require parserOptions.project
  {
    files: ['src/**/*.ts'],
    languageOptions: {
      parserOptions: {
        project: './tsconfig.json',
      },
    },
    rules: {
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/switch-exhaustiveness-check': 'error',
    },
  },
  {
    ignores: ['dist/', 'node_modules/', 'hooks/', 'bin/', 'test/'],
  },
);
