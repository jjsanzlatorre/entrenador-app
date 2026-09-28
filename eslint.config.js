import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'
import globals from 'globals'
import prettier from 'eslint-config-prettier'

export default tseslint.config(
  {
    ignores: [
      '.output',
      '.vercel',
      '.nitro',
      '.tanstack',
      'dist',
      'node_modules',
      'src/routeTree.gen.ts',
      'src/sw/sw.js',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
    },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  {
    files: ['src/sw/**/*.js'],
    languageOptions: { globals: { ...globals.serviceworker } },
  },
  prettier,
)
