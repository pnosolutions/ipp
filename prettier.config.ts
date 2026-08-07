import type { Config } from 'prettier';

const config = {
  singleQuote: true,

  // Git normalizes to LF on commit (see .gitattributes), but working trees on
  // Windows get CRLF. 'auto' keeps `--check` honest on both.
  endOfLine: 'auto',

  plugins: ['@ianvs/prettier-plugin-sort-imports'],

  importOrder: [
    '<BUILTIN_MODULES>',
    '<THIRD_PARTY_MODULES>',
    '',
    '^@/(.*)$',
    '^~/(.*)$',
    '',
    '^[.]',
    '',
    '<TYPES>^(node:)',
    '<TYPES>',
    '<TYPES>^[.]',
    '',
    '^types$',
    '^@/types/(.*)$',
    '^~/types/(.*)$',
  ],
  importOrderTypeScriptVersion: '6.0.0',
  importOrderParserPlugins: ['typescript', 'decorators-legacy'],
} satisfies Config;

export default config;
