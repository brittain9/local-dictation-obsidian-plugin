import tsparser from '@typescript-eslint/parser';
import { defineConfig, globalIgnores } from 'eslint/config';
import obsidianmd from 'eslint-plugin-obsidianmd';

// The Obsidian community-review bot lints with eslint-plugin-obsidianmd, whose
// `recommended` config already extends typescript-eslint's type-checked rules.
// Those rules only behave if the parser is given a real, type-resolved program;
// the block below wires `projectService` to our tsconfig so types resolve and
// the `no-unsafe-*` family does not misfire. We lint with Biome for everything
// else; this config exists to enforce the Obsidian guideline + type-aware rules.
export default defineConfig([
  globalIgnores([
    'main.js',
    'dist/**',
    'native/**',
    'docs/**',
    'scripts/**',
    '.github/**',
    '*.config.mjs',
    'coverage/**',
  ]),
  ...obsidianmd.configs.recommended,
  {
    files: ['**/*.ts'],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Disabled deliberately. On this codebase every finding from this rule is a
      // false positive: it lowercases proper nouns and brand names that must stay
      // capitalized (OpenRouter, Ollama, NVIDIA, CUDA, Whisper, CPU/GPU), Obsidian
      // UI section names (Settings, Hotkeys) and literal values (the `sk-or-...`
      // key prefix, the "Auto"/"Any" option names), and it mis-capitalizes
      // mid-sentence words ("context Windows", "0 Is deterministic"). Our UI text
      // is already sentence case. The community-review bot does not run this rule.
      'obsidianmd/ui/sentence-case': 'off',
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              importNames: ['Notice'],
              message:
                'Use the typed user-feedback boundary; only the Obsidian feedback presenter may import Notice.',
              name: 'obsidian',
            },
          ],
        },
      ],
      'no-restricted-syntax': [
        'error',
        {
          message:
            'Construct notices through the typed user-feedback boundary, not directly with new Notice().',
          selector: "NewExpression[callee.name='Notice']",
        },
        {
          message:
            'Construct notices through the typed user-feedback boundary, not through an Obsidian namespace import.',
          selector: "NewExpression[callee.property.name='Notice']",
        },
      ],
    },
  },
  {
    files: ['src/shared/obsidian-feedback-presenter.ts'],
    rules: {
      'no-restricted-imports': 'off',
      'no-restricted-syntax': 'off',
    },
  },
]);
