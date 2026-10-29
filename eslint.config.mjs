import next from 'eslint-config-next'

const config = [
  ...next,
  {
    rules: {
      // Daten werden in Effects asynchron geladen (setState erst nach await) – das meldet die Regel fälschlich
      'react-hooks/set-state-in-effect': 'off',
    },
  },
  { ignores: ['.open-next/**', '.wrangler/**', 'worker.ts', 'postcss.config.mjs'] },
]

export default config
