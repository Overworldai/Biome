import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import betterTailwindcss from 'eslint-plugin-better-tailwindcss'

export default tseslint.config(
  {
    ignores: ['dist', 'out', '.vite', 'world_engine', 'server-components', 'node_modules']
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
      betterTailwindcss.configs['recommended-error']
    ],
    languageOptions: {
      globals: globals.browser
    },
    settings: {
      'better-tailwindcss': {
        entryPoint: 'src/css/app.css'
      }
    },
    rules: {
      'better-tailwindcss/enforce-consistent-line-wrapping': ['error', { printWidth: 120, strictness: 'loose' }],
      'better-tailwindcss/no-unknown-classes': ['error', { detectComponentClasses: true }],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      // React Compiler-era rules from eslint-plugin-react-hooks@7. Disabled until the
      // project adopts React Compiler — they flag patterns that are safe without it.
      'react-hooks/refs': 'off',
      'react-hooks/set-state-in-effect': 'off',
      'react-hooks/preserve-manual-memoization': 'off',
      'react-hooks/purity': 'off',
      'react-hooks/immutability': 'off'
    }
  },
  {
    files: ['electron/**/*.ts', 'scripts/**/*.{ts,mjs}', '*.config.ts', 'forge.config.ts'],
    extends: [js.configs.recommended, tseslint.configs.recommended],
    languageOptions: {
      globals: globals.node
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }]
    }
  }
)
