// SPDX-License-Identifier: AGPL-3.0-only
import { build } from 'esbuild';
await build({entryPoints:['index.js','style.css'],outdir:'.',entryNames:'[name].build',bundle:true,minify:true,
    format:'esm',platform:'browser',sourcemap:'external',legalComments:'eof',
    banner:{js:'/* Memory Books © 2024–2026 Aiko Hanasaki; Archive Lore © 2026 foreverharibo-boop. AGPL-3.0-only */'},
    plugins:[{name:'host-imports',setup(b){b.onResolve({filter:/^\.\.\//},args=>({path:args.path,external:true}));}}],
});
