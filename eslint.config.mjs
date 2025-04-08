// @ts-check

import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

export default tseslint.config(
  {
    ignores: ['dist/**/*', 'node_modules/**/*'],
  },

  // Base ESLint recommended config
  eslint.configs.recommended,

  // TypeScript ESLint recommended config
  ...tseslint.configs.recommended,

  // TypeScript ESLint recommended type-checking config
  ...tseslint.configs.recommendedTypeChecked,

  // Custom configuration
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.node,
      },
      parserOptions: {
        project: './tsconfig.json',
      },
    },
    rules: {
      // TypeScript specific rules
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
      '@typescript-eslint/explicit-function-return-type': 'off',
      // General best practices
      'no-debugger': 'warn',
      'no-unused-vars': 'off', // Using TypeScript's no-unused-vars instead
    },
  },
);
