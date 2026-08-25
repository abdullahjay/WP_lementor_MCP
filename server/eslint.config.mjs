import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    // Not type-checked: it's outside tsconfig.json's `include` on purpose
    // (build config shouldn't compile with the app), and typed rules against
    // ESLint's own default-project fallback produce false positives.
    ignores: ['dist/**', 'node_modules/**', 'coverage/**', 'drizzle/**', 'eslint.config.mjs', 'vitest.config.ts', 'drizzle.config.ts'],
  },
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // CLAUDE.md / prd.md EMCP-005: "No `any`, no `@ts-ignore` without a
      // comment and a follow-up task." Enforced mechanically, not by review.
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/ban-ts-comment': [
        'error',
        {
          'ts-ignore': 'allow-with-description',
          minimumDescriptionLength: 10,
        },
      ],
      // Fastify's idiomatic handler shape is `async (req) => value`, even
      // with no internal await — the framework awaits the returned promise.
      '@typescript-eslint/require-await': 'off',
      // `const { unwanted: _unwanted, ...rest } = obj` is the idiomatic way
      // to drop a key while destructuring; the underscore prefix marks it
      // deliberate.
      '@typescript-eslint/no-unused-vars': ['error', { varsIgnorePattern: '^_', argsIgnorePattern: '^_' }],
    },
  },
);
