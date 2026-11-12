import {writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const config={mcpServers:{'carving-studio-classic':{command:process.execPath,args:[fileURLToPath(new URL('../mcp-server.mjs',import.meta.url))]}}};
await writeFile(new URL('../mcp-config.json',import.meta.url),JSON.stringify(config,null,2));
