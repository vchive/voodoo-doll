// 固定源码离线构建；生产导入已生成的JS，不加载TS编译器或coding agent。
import { readFile, writeFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
for (const file of ['domain', 'runtime']) {
  const source = await readFile(new URL(`./source/${file}.ts`, import.meta.url), 'utf8');
  const output = stripTypeScriptTypes(source, { mode: 'transform' });
  await writeFile(new URL(`./${file}.js`, import.meta.url), `// Generated from pi-agent-team 0.3.0; see NOTICE.md.\n${output}\n`);
}
