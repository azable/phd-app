import prettier from 'eslint-config-prettier';
import path from 'node:path';
import { includeIgnoreFile } from '@eslint/compat';
import js from '@eslint/js';
import svelte from 'eslint-plugin-svelte';
import { defineConfig } from 'eslint/config';
import globals from 'globals';
import ts from 'typescript-eslint';
import svelteConfig from './svelte.config.js';

const gitignorePath = path.resolve(import.meta.dirname, '.gitignore');

export default defineConfig(
  includeIgnoreFile(gitignorePath),
  js.configs.recommended,
  ...ts.configs.recommended,
  ...svelte.configs.recommended,
  prettier,
  ...svelte.configs.prettier,
  {
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    rules: {
      // typescript-eslint strongly recommend that you do not use the no-undef lint rule on TypeScript projects.
      // see: https://typescript-eslint.io/troubleshooting/faqs/eslint/#i-get-errors-from-the-no-undef-rule-about-global-variables-not-being-defined-even-though-there-are-no-typescript-errors
      'no-undef': 'off',
      'require-yield': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_'
        }
      ]
    }
  },
  {
    files: ['**/*.svelte', '**/*.svelte.ts', '**/*.svelte.js'],
    languageOptions: {
      parserOptions: {
        projectService: true,
        extraFileExtensions: ['.svelte'],
        parser: ts.parser,
        svelteConfig
      }
    }
  },
  {
    files: ['src/lib/client/components/ui/**/*.svelte'],
    rules: {
      'svelte/no-navigation-without-resolve': 'off'
    }
  },
  {
    files: ['src/**/*.ts', 'src/**/*.svelte'],
    ignores: ['src/lib/client/components/ui/**'],
    rules: {
      '@typescript-eslint/explicit-module-boundary-types': 'error'
    }
  },
  // A mode's engine never depends on the assistant that works for it. Placed before the narrower
  // rules below, which replace these options for their own files and repeat the pattern.
  {
    files: ['src/lib/modes/*/**/*.{ts,js,svelte}'],
    ignores: ['src/lib/modes/*/assistant/**', 'src/**/*.test.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/assistant/**', '$lib/server/ai/**'],
              message:
                "A mode's engine cannot import AI code: the assistant uses the engine, not the reverse."
            }
          ]
        }
      ]
    }
  },
  {
    files: ['src/lib/shared/**/*.{ts,js}', 'src/lib/studies/**/*.{ts,js}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['$lib/client/**', '$lib/server/**', '$app/**', '$env/**', 'node:*', 'svelte'],
              message: 'Shared contracts and projections must remain environment-neutral.'
            }
          ]
        }
      ]
    }
  },
  {
    files: ['src/lib/client/**/*.{ts,js,svelte}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['$lib/server/**', '$env/**', 'node:*'],
              message: 'Client modules cannot depend on server-only code.'
            }
          ]
        }
      ]
    }
  },
  {
    files: [
      'src/lib/modes/**/contract.ts',
      'src/lib/modes/**/Viewport.svelte',
      'src/lib/modes/catalog.ts',
      'src/lib/modes/sandbox.ts'
    ],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['$lib/server/**', '$env/**', 'node:*'],
              message: 'Browser-safe mode contracts and playback cannot import server code.'
            },
            {
              group: ['**/assistant/**'],
              message:
                "A mode's engine cannot import AI code: the assistant uses the engine, not the reverse."
            }
          ]
        }
      ]
    }
  },
  {
    files: ['src/lib/modes/sverlin/{library,assembly}/**/*.{ts,svelte}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['$lib/**', '$app/**', '$env/**', 'node:*', '**/assistant/**'],
              message:
                'Sandbox library and assembly files are bundled alone; import only svelte and library files.'
            }
          ]
        }
      ]
    }
  },
  {
    files: ['src/lib/server/**/*.{ts,js}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['$lib/client/**'],
              message: 'Server modules cannot depend on browser-only code.'
            }
          ]
        }
      ]
    }
  },
  // Mode-neutral server code reaches a mode only through the registries (modes/catalog,
  // modes/server, modes/assistants.server) and its browser-safe contract; tests may use any part.
  {
    files: ['src/lib/server/**/*.{ts,js}'],
    ignores: ['src/**/*.test.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['$lib/client/**'],
              message: 'Server modules cannot depend on browser-only code.'
            },
            {
              group: ['$lib/modes/*/**', '!$lib/modes/*/contract'],
              message:
                'Reach a mode through modes/catalog, modes/server or modes/assistants.server, not its own files.'
            }
          ]
        }
      ]
    }
  }
);
